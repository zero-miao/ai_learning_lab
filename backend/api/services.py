import ipaddress
import re
import socket
from copy import deepcopy
from hashlib import sha256
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4

import anydoc
import trafilatura
from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction

from .models import MaterialChunk

MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024
MAX_IMAGE_COUNT = 50
RESTRICTED_DOCUMENT_HOSTS = {"scribd.com"}
MARKDOWN_IMAGE_PATTERN = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\("
    r"(?P<url><[^>\n]+>|[^)\s]+)"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'))?\)"
)
IMAGE_TOKEN_PATTERN = re.compile(r"AILAB_IMAGE_TOKEN_\d{4}")


def _validate_remote_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("材料链接仅支持 http 或 https 地址。")
    if parsed.username or parsed.password:
        raise ValueError("材料链接不能包含用户名或密码。")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname, port, type=socket.SOCK_STREAM
            )
        }
    except (OSError, ValueError) as error:
        raise ValueError("材料链接的主机无法解析。") from error

    if not addresses or any(
        not ipaddress.ip_address(address).is_global for address in addresses
    ):
        raise ValueError("材料链接不能指向本机或局域网地址。")


class _SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_remote_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _is_pdf_url(url):
    return urlparse(url).path.lower().endswith(".pdf")


def _download_remote_resource(
    url,
    *,
    max_bytes=MAX_DOCUMENT_BYTES,
    accept="text/html,application/xhtml+xml,application/pdf",
):
    _validate_remote_url(url)
    request = Request(
        url,
        headers={
            "Accept": accept,
            "User-Agent": "AI-Learning-Lab/1.0",
        },
    )
    with build_opener(_SafeRedirectHandler()).open(request, timeout=45) as response:
        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                declared_size = int(content_length)
            except (TypeError, ValueError):
                declared_size = None
            if declared_size is not None and declared_size > max_bytes:
                raise ValueError("远程资源超过允许的大小。")
        content = response.read(max_bytes + 1)
        final_url = response.geturl()
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0]
    if len(content) > max_bytes:
        raise ValueError("远程资源超过允许的大小。")
    return content, final_url, content_type.lower()


def _download_remote(url):
    content, _, _ = _download_remote_resource(url)
    return content


def _download_pdf(url):
    content = _download_remote(url)
    if not content.startswith(b"%PDF-"):
        raise ValueError("链接返回的内容不是有效 PDF。")
    return content


def _image_type(content):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", ".gif"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if (
        len(content) >= 12
        and content[4:8] == b"ftyp"
        and content[8:12]
        in {
            b"avif",
            b"avis",
        }
    ):
        return "image/avif", ".avif"
    raise ValueError("远程资源不是支持的 PNG、JPEG、GIF、WebP 或 AVIF 图片。")


def _delete_paths(paths):
    for path in paths:
        if not path:
            continue
        try:
            default_storage.delete(path)
        except (OSError, SuspiciousFileOperation):
            # A stale or invalid historical path must not invalidate a new import.
            continue


def _localize_markdown_images(markdown, *, base_url, material_id):
    assets = []
    failures = []
    image_replacements = {}
    total_bytes = 0
    generation = uuid4().hex

    def replace_image(match):
        nonlocal total_bytes
        alt = match.group("alt").strip()
        raw_url = match.group("url").strip("<>")
        image_url = urljoin(base_url, raw_url)
        if image_url in image_replacements:
            saved_path = image_replacements[image_url]
            if saved_path:
                return f"![{alt}]({settings.MEDIA_URL}{saved_path})"
            return f"*图片未导入：{alt or '未命名图片'}*"
        if len(image_replacements) >= MAX_IMAGE_COUNT:
            if len(failures) < MAX_IMAGE_COUNT:
                failures.append(
                    {"source_url": image_url, "error": "图片数量超过 50 张，已跳过。"}
                )
            return f"*图片未导入：{alt or '未命名图片'}*"

        try:
            content, final_url, _ = _download_remote_resource(
                image_url,
                max_bytes=MAX_IMAGE_BYTES,
                accept="image/avif,image/webp,image/png,image/jpeg,image/gif",
            )
            content_type, extension = _image_type(content)
            if total_bytes + len(content) > MAX_IMAGE_TOTAL_BYTES:
                raise ValueError("材料图片总大小超过 50 MB。")
            digest = sha256(content).hexdigest()
            target = (
                f"materials/images/{material_id}/{generation}/{digest[:24]}{extension}"
            )
            saved_path = default_storage.save(target, ContentFile(content))
            total_bytes += len(content)
            assets.append(
                {
                    "source_url": final_url,
                    "path": saved_path,
                    "content_type": content_type,
                    "size": len(content),
                }
            )
        except (OSError, ValueError) as error:
            if len(failures) < MAX_IMAGE_COUNT:
                failures.append({"source_url": image_url, "error": str(error)[:200]})
            saved_path = None
        image_replacements[image_url] = saved_path
        if saved_path:
            return f"![{alt}]({settings.MEDIA_URL}{saved_path})"
        return f"*图片未导入：{alt or '未命名图片'}*"

    try:
        localized = MARKDOWN_IMAGE_PATTERN.sub(replace_image, markdown)
    except Exception:
        _delete_paths(asset["path"] for asset in assets)
        raise
    return localized, assets, failures


def protect_markdown_images(markdown):
    images = []

    def replace_image(match):
        token = f"AILAB_IMAGE_TOKEN_{len(images):04d}"
        images.append((token, match.group(0)))
        return token

    return MARKDOWN_IMAGE_PATTERN.sub(replace_image, markdown), images


def restore_markdown_images(markdown, images):
    restored = markdown
    missing = []
    for token, image in images:
        if token in restored:
            restored = restored.replace(token, image, 1)
            restored = restored.replace(token, "")
        else:
            missing.append(image)
    restored = IMAGE_TOKEN_PATTERN.sub("", restored).strip()
    if missing:
        restored = f"{restored}\n\n" + "\n\n".join(missing)
    return restored.strip()


def _reject_restricted_document_host(url):
    hostname = (urlparse(url).hostname or "").lower().rstrip(".")
    if any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in RESTRICTED_DOCUMENT_HOSTS
    ):
        raise ValueError(
            "该文档预览页未提供完整正文，请改用原始 PDF 直链或 Markdown 文本导入。"
        )


def extract_web_text(url):
    _reject_restricted_document_host(url)
    _validate_remote_url(url)
    if not _is_pdf_url(url):
        return trafilatura.extract(_download_remote(url), include_comments=False) or ""

    try:
        return anydoc.to_markdown_bytes(_download_pdf(url), "pdf").strip()
    except anydoc.EncryptedError as error:
        raise ValueError("PDF 已加密，暂时无法提取正文。") from error
    except anydoc.ConvertError as error:
        raise ValueError(
            "PDF 不含可提取的文字；扫描版 PDF 暂不支持，请改用带文本层的文件。"
        ) from error


def extract_web_document(url, material_id):
    _reject_restricted_document_host(url)
    _validate_remote_url(url)
    if _is_pdf_url(url):
        try:
            markdown = anydoc.to_markdown_bytes(_download_pdf(url), "pdf").strip()
        except anydoc.EncryptedError as error:
            raise ValueError("PDF 已加密，暂时无法提取正文。") from error
        except anydoc.ConvertError as error:
            raise ValueError(
                "PDF 不含可提取的文字；扫描版 PDF 暂不支持，请改用带文本层的文件。"
            ) from error
    else:
        content, final_url, _ = _download_remote_resource(url)
        markdown = (
            trafilatura.extract(
                content,
                url=final_url,
                include_comments=False,
                include_formatting=True,
                include_images=True,
                include_links=True,
                output_format="markdown",
            )
            or ""
        )
        url = final_url
    return _localize_markdown_images(
        markdown,
        base_url=url,
        material_id=material_id,
    )


class MaterialService:
    @staticmethod
    def process_material(material):
        new_asset_paths = []
        try:
            material.error = ""
            material.save(update_fields=["error", "updated_at"])

            if material.media_type == "web_page":
                raw_text, image_assets, image_failures = extract_web_document(
                    material.media_uri,
                    material.id,
                )
                new_asset_paths = [asset["path"] for asset in image_assets]
            elif material.media_type == "text":
                raw_text = material.raw_text
            else:
                raw_text = material.raw_text

            if not raw_text:
                raise ValueError("未能从材料中提取到可阅读的正文。")

            old_meta = (
                deepcopy(material.media_meta)
                if isinstance(material.media_meta, dict)
                else {}
            )
            old_asset_paths = [
                asset.get("path")
                for asset in old_meta.get("images", [])
                if isinstance(asset, dict)
            ]
            with transaction.atomic():
                MaterialChunk.objects.filter(material=material).delete()
                material.raw_text = raw_text
                material.clean_text = ""
                material.digest = ""
                if material.media_type == "web_page":
                    material.media_meta = old_meta
                    material.media_meta["images"] = image_assets
                    if image_failures:
                        material.media_meta["image_import_warnings"] = image_failures
                    else:
                        material.media_meta.pop("image_import_warnings", None)
                material.save(
                    update_fields=[
                        "raw_text",
                        "clean_text",
                        "digest",
                        "media_meta",
                        "updated_at",
                    ]
                )
            _delete_paths(set(old_asset_paths) - set(new_asset_paths))
        except Exception as error:
            _delete_paths(new_asset_paths)
            material.status = "failed"
            material.error = f"导入时发生错误：{str(error)[:300]}"
            material.save(update_fields=["status", "error", "updated_at"])
            raise RuntimeError(material.error) from error

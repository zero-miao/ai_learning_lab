import ipaddress
import socket
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

import anydoc
import trafilatura
from django.db import transaction

from .models import MaterialChunk

MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
RESTRICTED_DOCUMENT_HOSTS = {"scribd.com"}


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


def _download_remote(url):
    _validate_remote_url(url)
    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/pdf",
            "User-Agent": "AI-Learning-Lab/1.0",
        },
    )
    with build_opener(_SafeRedirectHandler()).open(request, timeout=45) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_DOCUMENT_BYTES:
            raise ValueError("远程材料超过 50 MB，无法导入。")
        content = response.read(MAX_DOCUMENT_BYTES + 1)
    if len(content) > MAX_DOCUMENT_BYTES:
        raise ValueError("远程材料超过 50 MB，无法导入。")
    return content


def _download_pdf(url):
    content = _download_remote(url)
    if not content.startswith(b"%PDF-"):
        raise ValueError("链接返回的内容不是有效 PDF。")
    return content


def extract_web_text(url):
    hostname = (urlparse(url).hostname or "").lower().rstrip(".")
    if any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in RESTRICTED_DOCUMENT_HOSTS
    ):
        raise ValueError(
            "该文档预览页未提供完整正文，请改用原始 PDF 直链或 Markdown 文本导入。"
        )

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


class MaterialService:
    @staticmethod
    def process_material(material):
        try:
            material.error = ""
            material.save(update_fields=["error", "updated_at"])

            if material.media_type == "web_page":
                raw_text = extract_web_text(material.media_uri)
            elif material.media_type == "text":
                raw_text = material.raw_text
            else:
                raw_text = material.raw_text

            if not raw_text:
                material.status = "failed"
                material.error = "未能从材料中提取到可阅读的正文。"
                material.save(update_fields=["status", "error", "updated_at"])
                return

            with transaction.atomic():
                MaterialChunk.objects.filter(material=material).delete()
                material.raw_text = raw_text
                material.clean_text = ""
                material.digest = ""
                material.save(
                    update_fields=[
                        "raw_text",
                        "clean_text",
                        "digest",
                        "updated_at",
                    ]
                )
        except Exception as error:
            material.status = "failed"
            material.error = f"导入时发生错误：{str(error)[:300]}"
            material.save(update_fields=["status", "error", "updated_at"])

import re
from hashlib import sha256
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import F, Func, IntegerField
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import CapturedDocument, Material, MaterialDraft, Topic, TopicMaterial
from .services import _delete_paths, _image_type
from .task_service import enqueue_or_reuse
from .tasks import _create_material_chunks

MAX_CAPTURE_ASSETS = 100
MAX_CAPTURE_ASSET_BYTES = 20 * 1024 * 1024
MAX_CAPTURE_TOTAL_BYTES = 200 * 1024 * 1024
ASSET_REFERENCE = re.compile(r"asset://(?P<asset_id>[A-Za-z0-9:._-]+)")


def _inline_text(block):
    if block.get("text") is not None:
        return str(block["text"]).strip()
    return "".join(str(span.get("text", "")) for span in block.get("spans", [])).strip()


def _markdown_table_cell(value):
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\n", "<br>")


def snapshot_to_markdown(snapshot):
    lines = []
    for block in snapshot.get("blocks", []):
        block_type = block.get("type")
        text = _inline_text(block)
        if block_type == "heading":
            level = min(max(int(block.get("level", 2)), 1), 6)
            lines.append(f"{'#' * level} {text}")
        elif block_type == "paragraph":
            if text:
                lines.append(text)
        elif block_type == "quote":
            lines.append("\n".join(f"> {line}" for line in text.splitlines()))
        elif block_type == "code":
            language = str(block.get("language", "")).strip()
            lines.append(f"```{language}\n{text}\n```")
        elif block_type in {"ordered_list", "unordered_list"}:
            marker = "1." if block_type == "ordered_list" else "-"
            items = block.get("items", [])
            lines.append(
                "\n".join(
                    f"{marker} {_inline_text(item) if isinstance(item, dict) else item}"
                    for item in items
                )
            )
        elif block_type == "table":
            rows = block.get("rows", [])
            if rows:
                normalized = [
                    [
                        _markdown_table_cell(cell.get("text", ""))
                        if isinstance(cell, dict)
                        else _markdown_table_cell(cell)
                        for cell in row
                    ]
                    for row in rows
                ]
                width = max(len(row) for row in normalized)
                normalized = [row + [""] * (width - len(row)) for row in normalized]
                lines.append(
                    "\n".join(
                        [
                            "| " + " | ".join(normalized[0]) + " |",
                            "| " + " | ".join(["---"] * width) + " |",
                            *["| " + " | ".join(row) + " |" for row in normalized[1:]],
                        ]
                    )
                )
        elif block_type == "image":
            asset_id = str(block.get("asset_id", "")).strip()
            alt = str(block.get("alt", "")).replace("]", "").strip()
            if asset_id:
                lines.append(f"![{alt}](asset://{asset_id})")
        elif block_type in {"link_card", "attachment"}:
            url = str(block.get("url", "")).strip()
            if url:
                lines.append(f"[{text or url}]({url})")
        elif block_type == "divider":
            lines.append("---")
    return "\n\n".join(line for line in lines if line).strip()


def _capture_asset_path(capture_id, digest, extension):
    return f"browser-captures/{capture_id}/{digest}{extension}"


def _asset_map(capture):
    return {
        asset["id"]: asset
        for asset in capture.asset_manifest
        if isinstance(asset, dict) and asset.get("id")
    }


def complete_capture(capture):
    assets = _asset_map(capture)
    warnings = list(capture.snapshot_json.get("warnings", []))

    def replace_asset(match):
        asset_id = match.group("asset_id")
        asset = assets.get(asset_id)
        if asset and asset.get("path"):
            return f"{settings.MEDIA_URL}{asset['path']}"
        warnings.append(f"图片资源未上传：{asset_id}")
        return ""

    capture.markdown = ASSET_REFERENCE.sub(
        replace_asset, snapshot_to_markdown(capture.snapshot_json)
    )
    capture.warnings = list(dict.fromkeys(str(item) for item in warnings))
    capture.status = "ready"
    capture.save(update_fields=["markdown", "warnings", "status", "updated_at"])
    return capture


def attach_capture_assets_to_material(capture, material, markdown=None):
    manifest = []
    markdown = capture.markdown if markdown is None else markdown
    for asset in capture.asset_manifest:
        source = asset.get("path") if isinstance(asset, dict) else None
        if not source or not default_storage.exists(source):
            continue
        extension = Path(source).suffix
        target = f"materials/images/{material.id}/{asset['sha256']}{extension}"
        with default_storage.open(source, "rb") as source_file:
            saved = default_storage.save(target, ContentFile(source_file.read()))
        markdown = markdown.replace(
            f"{settings.MEDIA_URL}{source}", f"{settings.MEDIA_URL}{saved}"
        )
        manifest.append({**asset, "path": saved})
    material.raw_text = markdown
    material.clean_text = markdown
    material.media_meta = {
        "source_format": "browser_capture",
        "source_url": capture.source_url,
        "site_name": capture.site_name,
        "adapter": capture.adapter,
        "images": manifest,
    }
    material.save(update_fields=["raw_text", "clean_text", "media_meta", "updated_at"])
    _delete_paths(asset.get("path") for asset in capture.asset_manifest)
    capture.asset_manifest = manifest
    capture.material = material
    capture.draft = None
    capture.status = "imported"
    capture.markdown = markdown
    capture.save(
        update_fields=[
            "asset_manifest",
            "material",
            "draft",
            "status",
            "markdown",
            "updated_at",
        ]
    )
    return markdown


class CapturedDocumentSerializer(serializers.ModelSerializer):
    block_count = serializers.SerializerMethodField()
    asset_count = serializers.SerializerMethodField()

    class Meta:
        model = CapturedDocument
        fields = [
            "id",
            "title",
            "source_url",
            "site_name",
            "adapter",
            "snapshot_json",
            "markdown",
            "asset_manifest",
            "warnings",
            "status",
            "draft",
            "material",
            "block_count",
            "asset_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "markdown",
            "asset_manifest",
            "warnings",
            "status",
            "draft",
            "material",
            "block_count",
            "asset_count",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "title": {"required": False, "allow_blank": True},
            "source_url": {"required": False, "allow_blank": True},
            "site_name": {"required": False, "allow_blank": True},
            "adapter": {"required": False, "allow_blank": True},
        }

    def validate_snapshot_json(self, value):
        if not isinstance(value, dict) or not isinstance(value.get("blocks"), list):
            raise serializers.ValidationError("文档快照必须包含 blocks 数组。")
        if len(value["blocks"]) > 10000:
            raise serializers.ValidationError("文档块数量超过 10000 个。")
        return value

    def create(self, validated_data):
        snapshot = validated_data["snapshot_json"]
        validated_data.setdefault("title", str(snapshot.get("title", "")).strip())
        validated_data.setdefault("source_url", snapshot.get("source_url", ""))
        validated_data.setdefault("site_name", snapshot.get("site_name", ""))
        validated_data.setdefault("adapter", snapshot.get("adapter", "generic"))
        if not validated_data["title"]:
            raise serializers.ValidationError({"title": "采集标题不能为空。"})
        return super().create(validated_data)

    def get_block_count(self, capture):
        annotated = getattr(capture, "block_count_value", None)
        return (
            annotated
            if annotated is not None
            else len(capture.snapshot_json.get("blocks", []))
        )

    def get_asset_count(self, capture):
        annotated = getattr(capture, "asset_count_value", None)
        return annotated if annotated is not None else len(capture.asset_manifest)


class CapturedDocumentSummarySerializer(serializers.ModelSerializer):
    block_count = serializers.SerializerMethodField()
    asset_count = serializers.SerializerMethodField()

    class Meta:
        model = CapturedDocument
        fields = [
            "id",
            "title",
            "source_url",
            "site_name",
            "adapter",
            "status",
            "draft",
            "material",
            "block_count",
            "asset_count",
            "created_at",
            "updated_at",
        ]

    def get_block_count(self, capture):
        return capture.block_count_value

    def get_asset_count(self, capture):
        return capture.asset_count_value


class CapturedDocumentViewSet(viewsets.ModelViewSet):
    queryset = CapturedDocument.objects.all()
    serializer_class = CapturedDocumentSerializer
    authentication_classes = []
    http_method_names = ["get", "post", "patch", "put", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "list":
            return CapturedDocumentSummarySerializer
        return CapturedDocumentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if self.action == "list":
            queryset = queryset.annotate(
                block_count_value=Func(
                    F("snapshot_json__blocks"),
                    function="json_array_length",
                    output_field=IntegerField(),
                ),
                asset_count_value=Func(
                    F("asset_manifest"),
                    function="json_array_length",
                    output_field=IntegerField(),
                ),
            ).defer("snapshot_json", "markdown", "asset_manifest", "warnings")
        return queryset

    def perform_update(self, serializer):
        capture = serializer.instance
        if capture.status in {"imported", "failed"}:
            raise serializers.ValidationError("已结束的采集记录不能修改。")
        snapshot_changed = "snapshot_json" in serializer.validated_data
        capture = serializer.save()
        if snapshot_changed and capture.status == "ready":
            complete_capture(capture)

    def perform_destroy(self, instance):
        if instance.draft_id or instance.material_id:
            raise serializers.ValidationError("已关联草稿或材料的采集记录不能删除。")
        _delete_paths(asset.get("path") for asset in instance.asset_manifest)
        instance.delete()

    @action(
        detail=True,
        methods=["put"],
        url_path=r"assets/(?P<asset_id>[^/]+)",
    )
    def upload_asset(self, request, pk=None, asset_id=None):
        capture = self.get_object()
        upload = request.FILES.get("file")
        if capture.status != "receiving":
            return Response(
                {"detail": "该采集记录已结束接收。"},
                status=status.HTTP_409_CONFLICT,
            )
        if upload is None:
            return Response(
                {"detail": "缺少资源文件。"}, status=status.HTTP_400_BAD_REQUEST
            )
        if upload.size > MAX_CAPTURE_ASSET_BYTES:
            return Response(
                {"detail": "单个资源超过 20 MB。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        manifest = list(capture.asset_manifest)
        existing = next((item for item in manifest if item["id"] == asset_id), None)
        if existing:
            return Response(existing)
        if len(manifest) >= MAX_CAPTURE_ASSETS:
            return Response(
                {"detail": "资源数量超过 100 个。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if (
            sum(item["size"] for item in manifest) + upload.size
            > MAX_CAPTURE_TOTAL_BYTES
        ):
            return Response(
                {"detail": "采集资源总大小超过 200 MB。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        content = upload.read()
        try:
            content_type, extension = _image_type(content)
        except ValueError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        digest = sha256(content).hexdigest()
        if asset_id.startswith("sha256:") and asset_id[7:].lower() != digest:
            return Response(
                {"detail": "资源内容与 asset_id 不一致。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        path = default_storage.save(
            _capture_asset_path(capture.id, digest, extension),
            ContentFile(content),
        )
        item = {
            "id": asset_id,
            "sha256": digest,
            "path": path,
            "content_type": content_type,
            "size": len(content),
        }
        manifest.append(item)
        capture.asset_manifest = manifest
        capture.save(update_fields=["asset_manifest", "updated_at"])
        return Response(item, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        capture = self.get_object()
        if capture.status != "receiving":
            return Response(self.get_serializer(capture).data)
        complete_capture(capture)
        return Response(self.get_serializer(capture).data)

    @action(detail=True, methods=["post"], url_path="create-draft")
    def create_draft(self, request, pk=None):
        capture = self.get_object()
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        if capture.status != "ready" or topic is None:
            return Response(
                {"detail": "采集记录未就绪或学习主题不存在。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if capture.material_id:
            return Response(
                {"detail": "该采集记录已经导入材料。"},
                status=status.HTTP_409_CONFLICT,
            )
        if capture.draft_id:
            return Response(
                {
                    "draft": capture.draft_id,
                    "capture": self.get_serializer(capture).data,
                }
            )
        draft = MaterialDraft.objects.create(
            topic=topic, title=capture.title, content=capture.markdown
        )
        capture.draft = draft
        capture.save(update_fields=["draft", "updated_at"])
        return Response(
            {"draft": draft.id, "capture": self.get_serializer(capture).data},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="import")
    def import_capture(self, request, pk=None):
        capture = self.get_object()
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        if capture.status != "ready" or topic is None:
            return Response(
                {"detail": "采集记录未就绪或学习主题不存在。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if capture.draft_id:
            return Response(
                {"detail": "该采集记录已生成草稿，请从草稿发布。"},
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            material = Material.objects.create(
                title=capture.title,
                media_type="text",
                status="summarizing",
                created_by="manual",
            )
            attach_capture_assets_to_material(capture, material)
            TopicMaterial.objects.create(
                topic=topic,
                material=material,
                import_by="manual",
                import_reason="浏览器页面采集",
            )
            _create_material_chunks(material)
            task, _ = enqueue_or_reuse(
                "briefing", trigger_type="Material", trigger_id=material.id
            )
        return Response(
            {"material": material.id, "task": task.id},
            status=status.HTTP_201_CREATED,
        )

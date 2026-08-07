import shutil
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import (
    AITask,
    Concept,
    ConceptRelation,
    Exam,
    Highlight,
    Material,
    MaterialChunk,
    MaterialRecommendation,
    MaterialTextLocator,
    Question,
    ReviewRecord,
    Session,
    SessionMessage,
    SystemConfiguration,
    Topic,
    TopicMaterial,
)
from .serializers import (
    AITaskSerializer,
    ConceptRelationSerializer,
    ConceptSerializer,
    ExamSerializer,
    HighlightSerializer,
    MaterialRecommendationSerializer,
    MaterialSerializer,
    MaterialTextLocatorSerializer,
    ModelDiscoverySerializer,
    QuestionSerializer,
    ReviewRecordSerializer,
    SessionMessageSerializer,
    SessionSerializer,
    SystemConfigurationSerializer,
    TopicDetailSerializer,
    TopicListSerializer,
    TopicMaterialSerializer,
)
from .system_config import get_config_value
from .task_service import INTERACTIVE_TASK_PRIORITY, enqueue_or_reuse, retry_task


@api_view(["GET"])
def health_check(request):
    return Response({"status": "ok"})


@api_view(["GET", "PUT"])
def system_configuration_detail(request):
    configuration = SystemConfiguration.load()
    if request.method == "GET":
        return Response(SystemConfigurationSerializer(configuration).data)

    serializer = SystemConfigurationSerializer(configuration, data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()

    from .ai_gateway import AIGateway

    AIGateway.reset_providers()
    return Response(serializer.data)


@api_view(["POST"])
def discover_llm_models(request):
    serializer = ModelDiscoverySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    from .ai_gateway import AIGateway

    try:
        models = AIGateway.discover_models(
            serializer.validated_data["llm_provider_type"],
            serializer.validated_data["llm_base_url"],
            serializer.validated_data["llm_api_key"],
        )
    except ValueError as error:
        return Response(
            {"detail": str(error)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as error:
        return Response(
            {"detail": f"读取模型列表失败：{error}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response({"models": models})


def _topic_material(topic, material_id):
    return Material.objects.filter(
        pk=material_id,
        topic_materials__topic=topic,
        topic_materials__removed_at__isnull=True,
    ).first()


def _locator_data(topic, data):
    material = _topic_material(topic, data.get("material"))
    if material is None:
        raise ValueError("材料不存在或未关联到当前主题。")
    start = int(data["start_offset"])
    end = int(data["end_offset"])
    if not 0 <= start < end <= len(material.clean_text):
        raise ValueError("来源锚点不在材料正文范围内。")
    chunk = MaterialChunk.objects.filter(
        material=material, start_offset__lte=start, end_offset__gt=start
    ).first()
    return material, chunk, material.clean_text[start:end], start, end


def _create_locator(
    entity_type, entity_id, topic, material, chunk, text, start, end, source_text=None
):
    return MaterialTextLocator.objects.get_or_create(
        entity_type=entity_type,
        entity_id=entity_id,
        material=material,
        start_offset=start,
        end_offset=end,
        defaults={
            "topic": topic,
            "chunk": chunk,
            "source_text": source_text or text,
            "time_start_offset": chunk.start_time if chunk else None,
            "time_end_offset": chunk.end_time if chunk else None,
        },
    )


def _build_topic_context(topic):
    materials = (
        topic.topic_materials.filter(removed_at__isnull=True, material__status="ready")
        .select_related("material")
        .order_by("import_at")
    )
    return "\n\n".join(
        f"材料：{link.material.title}\n{link.material.clean_text}"
        for link in materials
        if link.material.clean_text
    )[:12000]


def _build_review_context(review):
    material_context = _build_topic_context(review.topic)
    concept_context = "\n\n".join(
        (
            f"概念：{concept.title}\n定义：{concept.definition}\n"
            f"原理：{concept.principle}\n易错点：{concept.pitfalls}"
        )
        for concept in review.topic.concepts.all()
    )
    question_ids = MaterialTextLocator.objects.filter(
        topic=review.topic, entity_type="question"
    ).values_list("entity_id", flat=True)
    question_context = "\n\n".join(
        f"学习问答：{question.question_text}\n结论：{question.conclusion}"
        for question in Question.objects.filter(id__in=question_ids)
        if question.conclusion
    )
    return "\n\n".join(
        section
        for section in (material_context, concept_context, question_context)
        if section
    )[:12000]


def _delete_material_files(material, material_id):
    relative_paths = set()
    if (
        material.media_type in {"video", "audio"}
        and material.media_uri
        and "://" not in material.media_uri
    ):
        relative_paths.add(material.media_uri)

    media_meta = material.media_meta if isinstance(material.media_meta, dict) else {}
    subtitle_uri = media_meta.get("subtitle_uri")
    if subtitle_uri:
        relative_paths.add(str(subtitle_uri))
    for voice_data in media_meta.get("tts", {}).get("voices", {}).values():
        path = voice_data.get("path") if isinstance(voice_data, dict) else None
        if path:
            relative_paths.add(str(path))

    for relative_path in relative_paths:
        default_storage.delete(relative_path)

    media_root = Path(settings.MEDIA_ROOT).resolve()
    tts_directory = (media_root / "materials" / "tts" / str(material_id)).resolve()
    if tts_directory.is_relative_to(media_root):
        shutil.rmtree(tts_directory, ignore_errors=True)


class TopicViewSet(viewsets.ModelViewSet):
    queryset = Topic.objects.all()
    serializer_class = TopicDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "list":
            return queryset.annotate(
                material_count=Count(
                    "topic_materials",
                    filter=Q(topic_materials__removed_at__isnull=True),
                    distinct=True,
                )
            )
        return queryset

    def get_serializer_class(self):
        return TopicListSerializer if self.action == "list" else TopicDetailSerializer

    @transaction.atomic
    def perform_destroy(self, instance):
        topic_id = instance.id
        session_id = instance.session_id
        session_is_exclusive = (
            session_id is not None
            and not Topic.objects.exclude(pk=topic_id)
            .filter(session_id=session_id)
            .exists()
        )

        task_scope = Q(
            task_data__topic_id=topic_id,
        ) | Q(trigger_type="Topic", trigger_id=topic_id)
        related_triggers = [
            ("Concept", list(instance.concepts.values_list("id", flat=True))),
            ("Exam", list(instance.exams.values_list("id", flat=True))),
            (
                "ReviewRecord",
                list(instance.review_records.values_list("id", flat=True)),
            ),
        ]
        locator_entities = list(
            instance.text_locators.values_list("entity_type", "entity_id")
        )
        question_ids = [
            entity_id
            for entity_type, entity_id in locator_entities
            if entity_type == "question"
        ]
        highlight_ids = [
            entity_id
            for entity_type, entity_id in locator_entities
            if entity_type == "highlight"
        ]
        related_triggers.extend(
            [
                ("Question", question_ids),
                ("Highlight", highlight_ids),
            ]
        )
        reading_session_ids = Question.objects.filter(id__in=question_ids).values_list(
            "session_id", flat=True
        )
        session_message_ids = list(
            SessionMessage.objects.filter(
                session_id__in=reading_session_ids
            ).values_list("id", flat=True)
        )
        if session_is_exclusive:
            session_message_ids.extend(
                SessionMessage.objects.filter(session_id=session_id).values_list(
                    "id", flat=True
                )
            )
        related_triggers.append(("SessionMessage", session_message_ids))
        for trigger_type, trigger_ids in related_triggers:
            if trigger_ids:
                task_scope |= Q(
                    trigger_type=trigger_type,
                    trigger_id__in=trigger_ids,
                )

        AITask.objects.filter(task_scope).delete()
        instance.delete()
        if session_is_exclusive:
            Session.objects.filter(pk=session_id).delete()

    @action(detail=True, methods=["post"], url_path="concepts")
    def create_concept(self, request, pk=None):
        topic = self.get_object()
        try:
            material, chunk, text, start, end = _locator_data(topic, request.data)
        except (KeyError, TypeError, ValueError) as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        title = str(request.data.get("title", "")).strip()
        if not title:
            return Response(
                {"detail": "请输入概念名称。"}, status=status.HTTP_400_BAD_REQUEST
            )
        with transaction.atomic():
            concept, _ = Concept.objects.get_or_create(topic=topic, title=title)
            _create_locator(
                "concept", concept.id, topic, material, chunk, text, start, end
            )
            task, _ = enqueue_or_reuse(
                "concept_draft",
                trigger_type="Concept",
                trigger_id=concept.id,
                task_data={"source_text": text, "context": material.clean_text},
            )
        return Response(
            {
                "concept": ConceptSerializer(concept).data,
                "task": AITaskSerializer(task).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="highlights")
    def create_highlight(self, request, pk=None):
        topic = self.get_object()
        try:
            material, chunk, text, start, end = _locator_data(topic, request.data)
        except (KeyError, TypeError, ValueError) as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        highlight = Highlight.objects.create(
            user_note=str(request.data.get("user_note", ""))
        )
        _create_locator(
            "highlight", highlight.id, topic, material, chunk, text, start, end
        )
        return Response(
            HighlightSerializer(highlight).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"], url_path="supplement")
    def supplement(self, request, pk=None):
        topic = self.get_object()
        trigger_type = str(request.data.get("trigger_source_type", "Topic"))
        trigger_id = request.data.get("trigger_source_id", topic.id)
        valid_triggers = {
            "Topic": Topic,
            "Concept": Concept,
            "Question": Question,
            "Highlight": Highlight,
        }
        model = valid_triggers.get(trigger_type)
        if model is None:
            return Response(
                {"detail": "补料来源必须是 Topic、Concept、Question 或 Highlight。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            trigger_id = int(trigger_id)
            trigger = model.objects.get(pk=trigger_id)
        except (TypeError, ValueError, model.DoesNotExist):
            return Response(
                {"detail": "补料来源不存在。"}, status=status.HTTP_400_BAD_REQUEST
            )
        if trigger_type == "Concept" and trigger.topic_id != topic.id:
            return Response(
                {"detail": "概念不属于当前主题。"}, status=status.HTTP_400_BAD_REQUEST
            )
        if (
            trigger_type in {"Question", "Highlight"}
            and not MaterialTextLocator.objects.filter(
                topic=topic,
                entity_type=trigger_type.lower(),
                entity_id=trigger.id,
            ).exists()
        ):
            return Response(
                {"detail": "补料来源不属于当前主题。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task, created = enqueue_or_reuse(
            "supplement_search",
            trigger_type=trigger_type,
            trigger_id=trigger_id,
            task_data={
                "topic_id": topic.id,
                "relevance_threshold": get_config_value(
                    "supplement_relevance_threshold"
                ),
                "max_recommendations": 5,
            },
        )
        return Response(
            {"task": AITaskSerializer(task).data, "created": created},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["get", "post"], url_path="discussion")
    def discussion(self, request, pk=None):
        topic = self.get_object()
        if topic.session_id is None:
            topic.session = Session.objects.create(session_scene="topic_discussion")
            topic.save(update_fields=["session", "updated_at"])
        if request.method == "GET":
            active_tasks = AITask.objects.filter(
                status__in=("pending", "running"),
                task_type__in=("discussion_reply", "supplement_search"),
                task_data__topic_id=topic.id,
            ).order_by("-priority", "-created_at")
            return Response(
                {
                    "messages": SessionMessageSerializer(
                        topic.session.messages.all(), many=True
                    ).data,
                    "recommendations": MaterialRecommendationSerializer(
                        topic.material_recommendations.select_related(
                            "message", "material"
                        )[:50],
                        many=True,
                    ).data,
                    "active_tasks": AITaskSerializer(active_tasks, many=True).data,
                }
            )
        content = str(request.data.get("content", "")).strip()
        if not content:
            return Response(
                {"detail": "请输入讨论内容。"}, status=status.HTTP_400_BAD_REQUEST
            )
        message = SessionMessage.objects.create(
            session=topic.session, msg_from="user", msg_content=content
        )
        task, _ = enqueue_or_reuse(
            "discussion_reply",
            trigger_type="SessionMessage",
            trigger_id=message.id,
            priority=INTERACTIVE_TASK_PRIORITY,
            task_data={"topic_id": topic.id},
        )
        return Response(
            {
                "message": SessionMessageSerializer(message).data,
                "task": AITaskSerializer(task).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class MaterialRecommendationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MaterialRecommendation.objects.select_related(
        "topic", "message", "source_task", "material"
    )
    serializer_class = MaterialRecommendationSerializer

    @action(detail=True, methods=["post"])
    def adopt(self, request, pk=None):
        recommendation = self.get_object()
        if recommendation.status != "pending":
            return Response(
                {"detail": "该推荐已经处理。"}, status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            material = (
                Material.objects.filter(
                    media_meta__md5=recommendation.content_md5
                ).first()
                or Material.objects.filter(media_uri=recommendation.url).first()
            )
            if material is None:
                material = Material.objects.create(
                    title=recommendation.title or recommendation.url,
                    media_type="web_page",
                    media_uri=recommendation.url,
                    media_meta={"md5": recommendation.content_md5},
                    raw_text=recommendation.content_snapshot,
                    status="pending",
                    created_by="ai_recommended",
                )

            relation, _ = TopicMaterial.objects.get_or_create(
                topic=recommendation.topic,
                material=material,
                defaults={
                    "import_by": "ai_recommended",
                    "category": recommendation.category,
                    "relevance_score": recommendation.relevance_score,
                    "import_reason": recommendation.reason,
                },
            )
            relation.import_by = "ai_recommended"
            relation.category = recommendation.category
            relation.relevance_score = recommendation.relevance_score
            relation.import_reason = recommendation.reason
            relation.removed_at = None
            relation.save(
                update_fields=[
                    "import_by",
                    "category",
                    "relevance_score",
                    "import_reason",
                    "removed_at",
                ]
            )

            recommendation.status = "adopted"
            recommendation.material = material
            recommendation.decided_at = timezone.now()
            recommendation.save(update_fields=["status", "material", "decided_at"])

        task = None
        if material.status != "ready":
            task, _ = enqueue_or_reuse(
                "clean_text", trigger_type="Material", trigger_id=material.id
            )
        return Response(
            {
                "recommendation": MaterialRecommendationSerializer(recommendation).data,
                "topic_material": TopicMaterialSerializer(
                    relation, context={"request": request}
                ).data,
                "task": AITaskSerializer(task).data if task else None,
            }
        )

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        recommendation = self.get_object()
        if recommendation.status != "pending":
            return Response(
                {"detail": "该推荐已经处理。"}, status=status.HTTP_400_BAD_REQUEST
            )
        recommendation.status = "dismissed"
        recommendation.decided_at = timezone.now()
        recommendation.save(update_fields=["status", "decided_at"])
        return Response(MaterialRecommendationSerializer(recommendation).data)


class MaterialViewSet(viewsets.ModelViewSet):
    queryset = Material.objects.prefetch_related("topic_materials__topic", "chunks")
    serializer_class = MaterialSerializer

    def perform_destroy(self, instance):
        material_id = instance.id
        with transaction.atomic():
            AITask.objects.filter(
                trigger_type="Material",
                trigger_id=instance.id,
                status__in=("pending", "running"),
            ).update(
                status="cancelled",
                error_message="材料已删除",
                finished_at=timezone.now(),
            )
            instance.delete()
        _delete_material_files(instance, material_id)

    def create(self, request, *args, **kwargs):
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        if topic is None:
            return Response(
                {"detail": "学习主题不存在。"}, status=status.HTTP_404_NOT_FOUND
            )
        payload = request.data.copy()

        # Handle existing material linking
        existing_id = payload.get("existing_material_id")
        if existing_id:
            material = Material.objects.filter(pk=existing_id).first()
            if material is None:
                return Response(
                    {"detail": "指定的材料不存在。"}, status=status.HTTP_404_NOT_FOUND
                )
            # Create or update relation
            TopicMaterial.objects.update_or_create(
                topic=topic,
                material=material,
                defaults={"removed_at": None, "import_by": "manual"},
            )
            return Response(
                self.get_serializer(material).data, status=status.HTTP_201_CREATED
            )

        media_type = payload.get("media_type") or (
            "web_page" if payload.get("type") == "url" else "text"
        )
        serializer = self.get_serializer(
            data={
                "title": payload.get("title"),
                "raw_text": payload.get("raw_text", ""),
                "media_type": media_type,
                "media_uri": payload.get("media_uri") or payload.get("source_url", ""),
            }
        )
        serializer.is_valid(raise_exception=True)
        material = serializer.save(created_by="manual")
        TopicMaterial.objects.create(
            topic=topic,
            material=material,
            import_by="manual",
            import_reason="人工导入",
        )
        enqueue_or_reuse("process", trigger_type="Material", trigger_id=material.id)
        return Response(
            self.get_serializer(material).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def re_import(self, request, pk=None):
        material = self.get_object()
        with transaction.atomic():
            material.status = "pending"
            material.error = ""
            material.digest = ""
            material.save(update_fields=["status", "error", "digest", "updated_at"])

            if material.media_type == "video":
                task, _ = enqueue_or_reuse(
                    "asr",
                    trigger_type="Material",
                    trigger_id=material.id,
                    model=get_config_value("asr_model"),
                )
            else:
                task, _ = enqueue_or_reuse(
                    "process", trigger_type="Material", trigger_id=material.id
                )

        return Response(
            {
                "material": MaterialSerializer(material).data,
                "task": AITaskSerializer(task).data if task else None,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["post"], url_path="upload-video")
    def upload_video(self, request):
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        video = request.FILES.get("video")
        if topic is None or video is None:
            return Response(
                {"detail": "缺少主题或视频文件。"}, status=status.HTTP_400_BAD_REQUEST
            )
        suffix = Path(video.name).suffix.lower()
        if suffix not in {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}:
            return Response(
                {"detail": "不支持的视频格式。"}, status=status.HTTP_400_BAD_REQUEST
            )
        uri = default_storage.save(f"materials/{uuid4().hex}{suffix}", video)
        media_meta = {}
        subtitle = request.FILES.get("subtitle")
        if subtitle is not None:
            subtitle_suffix = Path(subtitle.name).suffix.lower()
            if subtitle_suffix not in {".srt", ".vtt"}:
                default_storage.delete(uri)
                return Response(
                    {"detail": "仅支持 .srt 或 .vtt 字幕文件。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            media_meta["subtitle_uri"] = default_storage.save(
                f"materials/{uuid4().hex}{subtitle_suffix}",
                subtitle,
            )
        material = Material.objects.create(
            title=str(request.data.get("title") or Path(video.name).stem),
            media_type="video",
            media_uri=uri,
            media_meta=media_meta,
            status="pending",
            created_by="manual",
        )
        TopicMaterial.objects.create(topic=topic, material=material, import_by="manual")
        task, _ = enqueue_or_reuse(
            "asr",
            trigger_type="Material",
            trigger_id=material.id,
            model=get_config_value("asr_model"),
        )
        return Response(
            {
                "material": MaterialSerializer(material).data,
                "task": AITaskSerializer(task).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["get"], url_path="timeline-markers")
    def timeline_markers(self, request, pk=None):
        markers = MaterialTextLocator.objects.filter(
            material=self.get_object(), time_start_offset__isnull=False
        ).order_by("time_start_offset")
        return Response(
            {"markers": MaterialTextLocatorSerializer(markers, many=True).data}
        )

    @action(detail=True, methods=["get"])
    def annotations(self, request, pk=None):
        material = self.get_object()
        locators = MaterialTextLocator.objects.filter(material=material)
        topic_id = request.query_params.get("topic")
        if topic_id:
            if not str(topic_id).isdigit():
                return Response(
                    {"detail": "话题参数无效。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            locators = locators.filter(topic_id=int(topic_id))

        entity_ids = {
            entity_type: list(
                locators.filter(entity_type=entity_type).values_list(
                    "entity_id", flat=True
                )
            )
            for entity_type in ("concept", "question", "highlight")
        }
        serializer_context = {
            "request": request,
            "material_id": material.id,
            "topic_id": int(topic_id) if topic_id else None,
        }
        return Response(
            {
                "concepts": ConceptSerializer(
                    Concept.objects.filter(id__in=entity_ids["concept"]).order_by(
                        "created_at"
                    ),
                    many=True,
                    context=serializer_context,
                ).data,
                "questions": QuestionSerializer(
                    Question.objects.filter(id__in=entity_ids["question"]).order_by(
                        "created_at"
                    ),
                    many=True,
                    context=serializer_context,
                ).data,
                "highlights": HighlightSerializer(
                    Highlight.objects.filter(id__in=entity_ids["highlight"]).order_by(
                        "created_at"
                    ),
                    many=True,
                    context=serializer_context,
                ).data,
            }
        )


class QuestionViewSet(viewsets.ModelViewSet):
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        if topic is None:
            return Response(
                {"detail": "学习主题不存在。"}, status=status.HTTP_404_NOT_FOUND
            )
        try:
            material, chunk, text, start, end = _locator_data(topic, request.data)
        except (KeyError, TypeError, ValueError) as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        session = Session.objects.create(
            session_scene="reading_question", context_material=material
        )
        question = Question.objects.create(
            session=session, question_text=str(request.data.get("question_text", ""))
        )
        _create_locator(
            "question",
            question.id,
            topic,
            material,
            chunk,
            text,
            start,
            end,
            source_text=request.data.get("source_text"),
        )
        message = SessionMessage.objects.create(
            session=session,
            msg_from="user",
            msg_content=question.question_text,
        )
        task, _ = enqueue_or_reuse(
            "answer_question",
            trigger_type="SessionMessage",
            trigger_id=message.id,
            task_data={"question_id": question.id},
        )
        return Response(
            {
                "question": QuestionSerializer(question).data,
                "task": AITaskSerializer(task).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class ConceptViewSet(viewsets.ModelViewSet):
    queryset = Concept.objects.all()
    serializer_class = ConceptSerializer

    def get_queryset(self):
        topic = self.request.query_params.get("topic")
        return (
            super().get_queryset().filter(topic_id=topic)
            if topic
            else super().get_queryset()
        )


class ConceptRelationViewSet(viewsets.ModelViewSet):
    queryset = ConceptRelation.objects.all()
    serializer_class = ConceptRelationSerializer


class HighlightViewSet(viewsets.ModelViewSet):
    queryset = Highlight.objects.all()
    serializer_class = HighlightSerializer


class TopicMaterialViewSet(viewsets.ModelViewSet):
    queryset = TopicMaterial.objects.select_related("topic", "material")
    serializer_class = TopicMaterialSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("topic"):
            queryset = queryset.filter(topic_id=self.request.query_params["topic"])
        return queryset.filter(removed_at__isnull=True)

    def create(self, request, *args, **kwargs):
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        material = Material.objects.filter(pk=request.data.get("material")).first()
        if topic is None or material is None:
            return Response(
                {"detail": "话题或材料不存在。"}, status=status.HTTP_400_BAD_REQUEST
            )
        relation, created = TopicMaterial.objects.update_or_create(
            topic=topic,
            material=material,
            defaults={
                "removed_at": None,
                "import_by": "manual",
                "import_reason": "从全局材料管理关联",
            },
        )
        return Response(
            self.get_serializer(relation).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def destroy(self, request, *args, **kwargs):
        relation = self.get_object()
        relation.removed_at = timezone.now()
        relation.save(update_fields=["removed_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ExamViewSet(viewsets.ModelViewSet):
    queryset = Exam.objects.select_related("topic").prefetch_related("questions")
    serializer_class = ExamSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        topic_id = self.request.query_params.get("topic")
        return queryset.filter(topic_id=topic_id) if topic_id else queryset

    def create(self, request, *args, **kwargs):
        topic = Topic.objects.filter(pk=request.data.get("topic")).first()
        if topic is None:
            return Response(
                {"detail": "学习主题不存在。"}, status=status.HTTP_404_NOT_FOUND
            )
        context = _build_topic_context(topic)
        if not context:
            return Response(
                {"detail": "请先保留至少一份可学习的材料。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task, _ = enqueue_or_reuse(
            "generate_exam",
            trigger_type="Topic",
            trigger_id=topic.id,
            task_data={"context": context},
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        exam = self.get_object()
        if exam.status != "draft":
            return Response(
                {"detail": "该评估不能重复提交。"}, status=status.HTTP_400_BAD_REQUEST
            )
        answers = request.data.get("answers")
        questions = list(exam.questions.all())
        if not isinstance(answers, list):
            return Response(
                {"detail": "answers 必须是作答列表。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        answers_by_id = {
            item.get("id"): item.get("answer_text", "")
            for item in answers
            if isinstance(item, dict)
        }
        if len(answers_by_id) != len(questions) or any(
            not str(answers_by_id.get(question.id, "")).strip()
            for question in questions
        ):
            return Response(
                {"detail": "请完成全部题目后再提交。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for question in questions:
            question.answer_text = str(answers_by_id[question.id]).strip()
            question.save(update_fields=["answer_text"])
        exam.status = "submitted"
        exam.submitted_at = timezone.now()
        exam.save(update_fields=["status", "submitted_at"])
        task, _ = enqueue_or_reuse(
            "grade_exam", trigger_type="Exam", trigger_id=exam.id
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=["post"], url_path="save")
    def save_answers(self, request, pk=None):
        exam = self.get_object()
        if exam.status != "draft":
            return Response(
                {"detail": "只有待作答的评估可以保存草稿。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        answers = request.data.get("answers")
        if not isinstance(answers, list):
            return Response(
                {"detail": "answers 必须是作答列表。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        questions = {question.id: question for question in exam.questions.all()}
        for item in answers:
            if not isinstance(item, dict) or item.get("id") not in questions:
                return Response(
                    {"detail": "答案包含不属于当前评估的题目。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            question = questions[item["id"]]
            question.answer_text = str(item.get("answer_text", ""))
            question.save(update_fields=["answer_text"])
        return Response(ExamSerializer(exam).data)


class ReviewRecordViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ReviewRecord.objects.select_related("topic", "exam")
    serializer_class = ReviewRecordSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        result = self.request.query_params.get("result")
        return queryset.filter(result=result) if result else queryset

    @action(detail=True, methods=["post"], url_path="prompt")
    def create_prompt(self, request, pk=None):
        review = self.get_object()
        if review.result == "completed":
            return Response(
                {"detail": "已完成的复习记录不能生成提示。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        context = _build_review_context(review)
        if not context:
            return Response(
                {"detail": "复习记录缺少学习上下文。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task, _ = enqueue_or_reuse(
            "review_prompt",
            trigger_type="ReviewRecord",
            trigger_id=review.id,
            task_data={"context": context},
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=["post"], url_path="submit")
    def submit_review(self, request, pk=None):
        review = self.get_object()
        response_text = str(request.data.get("response_text", "")).strip()
        if review.result == "completed" or not response_text:
            return Response(
                {"detail": "复习记录已完成或未填写复盘回答。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        context = _build_review_context(review)
        if not context:
            return Response(
                {"detail": "复习记录缺少学习上下文。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        review.response_text = response_text
        review.save(update_fields=["response_text"])
        task, _ = enqueue_or_reuse(
            "grade_review",
            trigger_type="ReviewRecord",
            trigger_id=review.id,
            task_data={"context": context, "response_text": response_text},
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )


class SessionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Session.objects.prefetch_related("messages")
    serializer_class = SessionSerializer

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def messages(self, request, pk=None):
        session = self.get_object()
        content = str(request.data.get("content", "")).strip()
        if not content:
            return Response(
                {"detail": "请输入消息内容。"}, status=status.HTTP_400_BAD_REQUEST
            )

        task_type = None
        task_data = {}
        if session.session_scene == "topic_discussion":
            topic = Topic.objects.filter(session=session).first()
            if topic is None:
                return Response(
                    {"detail": "讨论会话不属于学习主题。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            task_type = "discussion_reply"
            task_data = {"topic_id": topic.id}
        elif session.session_scene == "reading_question":
            question = Question.objects.filter(session=session).first()
            if question is None:
                return Response(
                    {"detail": "阅读会话缺少关联问题。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            task_type = "answer_question"
            task_data = {"question_id": question.id}

        message = SessionMessage.objects.create(
            session=session, msg_from="user", msg_content=content
        )

        if task_type:
            task, _ = enqueue_or_reuse(
                task_type,
                trigger_type="SessionMessage",
                trigger_id=message.id,
                priority=INTERACTIVE_TASK_PRIORITY,
                task_data=task_data,
            )
            return Response(
                {
                    "message": SessionMessageSerializer(message).data,
                    "task": AITaskSerializer(task).data,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        return Response(
            {"message": SessionMessageSerializer(message).data},
            status=status.HTTP_201_CREATED,
        )


class AITaskViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AITask.objects.all()
    serializer_class = AITaskSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        for field in ("trigger_type", "trigger_id", "status", "task_type"):
            if self.request.query_params.get(field):
                queryset = queryset.filter(**{field: self.request.query_params[field]})
        return queryset

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        task = self.get_object()
        try:
            retry_task(task)
        except ValueError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AITaskSerializer(task).data, status=status.HTTP_202_ACCEPTED)

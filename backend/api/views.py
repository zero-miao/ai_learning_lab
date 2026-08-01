from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import (
    AITask,
    Concept,
    ConceptAnchor,
    ConceptRelation,
    Exam,
    Highlight,
    Material,
    MaterialChunk,
    Note,
    Question,
    ReviewRecord,
    Topic,
)
from .note_service import build_note_source
from .serializers import (
    AITaskSerializer,
    ConceptRelationSerializer,
    ConceptSerializer,
    ExamSerializer,
    HighlightSerializer,
    MaterialSerializer,
    NoteSerializer,
    QuestionSerializer,
    ReviewRecordSerializer,
    TopicSerializer,
)
from .services import MaterialService
from .task_service import enqueue_or_reuse, retry_task


@api_view(["GET"])
def health_check(request):
    return Response({"status": "ok", "message": "AI Learning Lab API is running"})


def _build_review_context(review):
    materials = review.topic.materials.filter(import_status="success").exclude(
        clean_text=""
    )
    material_context = "\n\n".join(
        f"材料：{material.title}\n{material.clean_text}" for material in materials
    )
    note_context = "\n\n".join(
        f"结构化笔记：{note.title}\n{note.content}" for note in review.topic.notes.all()
    )
    return "\n\n".join(
        section for section in (material_context, note_context) if section
    )[:12000]


def _get_anchor_data(topic, data):
    try:
        material_id = int(data.get("material"))
        start_offset = int(data.get("start_offset"))
        end_offset = int(data.get("end_offset"))
    except (TypeError, ValueError) as error:
        raise serializers.ValidationError(
            {"detail": "材料和来源偏移必须是整数。"}
        ) from error

    material = Material.objects.filter(pk=material_id, topic=topic).first()
    if material is None:
        raise serializers.ValidationError({"material": "材料不存在或不属于当前话题。"})
    if not 0 <= start_offset < end_offset <= len(material.clean_text):
        raise serializers.ValidationError({"detail": "来源锚点不在材料正文范围内。"})

    source_text = material.clean_text[start_offset:end_offset]
    if not source_text.strip():
        raise serializers.ValidationError({"detail": "不能为纯空白文本创建锚点。"})
    chunk = (
        MaterialChunk.objects.filter(
            material=material,
            start_offset__lte=start_offset,
            end_offset__gt=start_offset,
        )
        .order_by("chunk_index")
        .first()
    )
    return material, chunk, source_text, start_offset, end_offset


class TopicViewSet(viewsets.ModelViewSet):
    queryset = Topic.objects.all()
    serializer_class = TopicSerializer

    @action(detail=True, methods=["post"], url_path="note-drafts")
    def create_note_draft(self, request, pk=None):
        topic = self.get_object()
        context, material_fingerprint = build_note_source(topic)
        if not context:
            return Response(
                {"detail": "请先导入至少一份处理成功的学习材料。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instructions = str(request.data.get("instructions", "")).strip()
        has_current_note = Note.objects.filter(
            topic=topic, material_fingerprint=material_fingerprint
        ).exists()
        if has_current_note and not instructions:
            return Response(
                {
                    "detail": (
                        "学习材料未变化，已有最新笔记。"
                        "可编辑现有笔记，或填写新的生成要求后再生成。"
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        task, _ = enqueue_or_reuse(
            "note_draft",
            topic=topic,
            input_json={
                "topic_id": topic.id,
                "context": context[:12000],
                "material_fingerprint": material_fingerprint,
                "instructions": instructions,
            },
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=["post"], url_path="concepts")
    def create_concept(self, request, pk=None):
        topic = self.get_object()
        title = str(request.data.get("title", "")).strip()
        if not title:
            return Response(
                {"detail": "请输入概念名称。"}, status=status.HTTP_400_BAD_REQUEST
            )
        if len(title) > 255:
            return Response(
                {"detail": "概念名称不能超过 255 个字符。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        material, chunk, source_text, start_offset, end_offset = _get_anchor_data(
            topic, request.data
        )
        context_start = max(0, start_offset - 1200)
        context_end = min(len(material.clean_text), end_offset + 1200)
        context = material.clean_text[context_start:context_end]

        with transaction.atomic():
            concept = Concept.objects.filter(topic=topic, title__iexact=title).first()
            created = concept is None
            if concept is None:
                concept = Concept.objects.create(topic=topic, title=title)
            ConceptAnchor.objects.get_or_create(
                concept=concept,
                material=material,
                start_offset=start_offset,
                end_offset=end_offset,
                defaults={"chunk": chunk, "source_text": source_text},
            )
            task, _ = enqueue_or_reuse(
                "concept_draft",
                topic=topic,
                material=material,
                concept=concept,
                input_json={
                    "concept_id": concept.id,
                    "source_text": source_text,
                    "context": context,
                },
            )
        return Response(
            {
                "concept": ConceptSerializer(concept).data,
                "task": AITaskSerializer(task).data,
                "created": created,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="highlights")
    def create_highlight(self, request, pk=None):
        topic = self.get_object()
        material, chunk, source_text, start_offset, end_offset = _get_anchor_data(
            topic, request.data
        )
        highlight, created = Highlight.objects.get_or_create(
            material=material,
            start_offset=start_offset,
            end_offset=end_offset,
            defaults={
                "topic": topic,
                "chunk": chunk,
                "source_text": source_text,
            },
        )
        return Response(
            {"highlight": highlight.id, "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MaterialViewSet(viewsets.ModelViewSet):
    queryset = Material.objects.all()
    serializer_class = MaterialSerializer

    def perform_create(self, serializer):
        material = serializer.save()
        MaterialService.process_material(material)
        if material.import_status == "success":
            enqueue_or_reuse(
                "briefing",
                topic=material.topic,
                material=material,
                input_json={"material_id": material.id},
            )


class QuestionViewSet(viewsets.ModelViewSet):
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer

    def create(self, request, *args, **kwargs):
        topic_id = request.data.get("topic")
        try:
            topic = Topic.objects.get(pk=topic_id)
        except (Topic.DoesNotExist, TypeError, ValueError):
            return Response(
                {"detail": "学习主题不存在。"}, status=status.HTTP_404_NOT_FOUND
            )

        request_data = request.data.copy()
        anchor_fields = {}
        if "start_offset" in request_data or "end_offset" in request_data:
            material, chunk, source_text, start_offset, end_offset = _get_anchor_data(
                topic, request_data
            )
            request_data["material"] = material.id
            request_data["chunk"] = chunk.id if chunk else None
            anchor_fields = {
                "selected_text": source_text,
                "start_offset": start_offset,
                "end_offset": end_offset,
            }
        serializer = self.get_serializer(data=request_data)
        serializer.is_valid(raise_exception=True)
        question = serializer.save(**anchor_fields)
        context = ""
        if question.material:
            context = question.material.clean_text
        elif question.chunk:
            context = question.chunk.content
        task, _ = enqueue_or_reuse(
            "answer_question",
            topic=question.topic,
            question=question,
            input_json={"question_id": question.id, "context": context},
        )
        return Response(
            {
                "question": QuestionSerializer(question).data,
                "task": AITaskSerializer(task).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="save")
    def save_question(self, request, pk=None):
        question = self.get_object()
        concept_id = request.data.get("concept")
        concept = None
        if concept_id is not None:
            concept = Concept.objects.filter(
                pk=concept_id, topic=question.topic
            ).first()
            if concept is None:
                return Response(
                    {"detail": "概念不存在或不属于当前话题。"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        question.concept = concept
        question.is_saved = True
        question.saved_at = timezone.now()
        question.save(update_fields=["concept", "is_saved", "saved_at"])
        return Response(QuestionSerializer(question).data)


class ConceptViewSet(viewsets.ModelViewSet):
    queryset = Concept.objects.select_related("topic", "source_task").prefetch_related(
        "anchors__material", "anchors__chunk"
    )
    serializer_class = ConceptSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        topic_id = self.request.query_params.get("topic")
        return queryset.filter(topic_id=topic_id) if topic_id else queryset

    def create(self, request, *args, **kwargs):
        return Response(
            {"detail": "请从话题阅读上下文创建概念。"},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class ConceptRelationViewSet(viewsets.ModelViewSet):
    queryset = ConceptRelation.objects.select_related("from_concept", "to_concept")
    serializer_class = ConceptRelationSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        topic_id = self.request.query_params.get("topic")
        if topic_id:
            queryset = queryset.filter(topic_id=topic_id)
        return queryset


class HighlightViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Highlight.objects.select_related("topic", "material", "chunk")
    serializer_class = HighlightSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        topic_id = self.request.query_params.get("topic")
        material_id = self.request.query_params.get("material")
        if topic_id:
            queryset = queryset.filter(topic_id=topic_id)
        if material_id:
            queryset = queryset.filter(material_id=material_id)
        return queryset

    def destroy(self, request, *args, **kwargs):
        highlight = self.get_object()
        highlight.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NoteViewSet(viewsets.ModelViewSet):
    queryset = Note.objects.select_related("topic", "source_task")
    serializer_class = NoteSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        topic_id = self.request.query_params.get("topic")
        return queryset.filter(topic_id=topic_id) if topic_id else queryset

    def perform_create(self, serializer):
        task_id = self.request.data.get("source_task")
        task = None
        if task_id:
            task = AITask.objects.filter(
                pk=task_id, task_type="note_draft", status="succeeded"
            ).first()
            if task is None:
                raise serializers.ValidationError(
                    {"source_task": "笔记草稿任务不存在或尚未完成。"}
                )
            if task.topic_id != serializer.validated_data["topic"].id:
                raise serializers.ValidationError(
                    {"source_task": "笔记草稿与所属主题不一致。"}
                )
        serializer.save(
            source_task=task,
            material_fingerprint=task.input_json.get("material_fingerprint", ""),
        )


class ExamViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Exam.objects.select_related("topic").prefetch_related("questions")
    serializer_class = ExamSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        topic_id = self.request.query_params.get("topic")
        return queryset.filter(topic_id=topic_id) if topic_id else queryset

    def create(self, request, *args, **kwargs):
        topic_id = request.data.get("topic")
        if not topic_id:
            return Response(
                {"detail": "缺少 topic。"}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            topic = Topic.objects.get(pk=topic_id)
        except Topic.DoesNotExist:
            return Response(
                {"detail": "学习主题不存在。"}, status=status.HTTP_404_NOT_FOUND
            )

        context = "\n\n".join(
            f"材料：{material.title}\n{material.clean_text}"
            for material in topic.materials.filter(import_status="success")
            if material.clean_text
        )
        if not context:
            return Response(
                {"detail": "请先导入至少一份处理成功的学习材料。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task, _ = enqueue_or_reuse(
            "generate_exam",
            topic=topic,
            input_json={"topic_id": topic.id, "context": context[:12000]},
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        exam = self.get_object()
        if exam.status != "draft":
            return Response(
                {"detail": "该考试已经提交，不能重复阅卷。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        answers = request.data.get("answers")
        if not isinstance(answers, list):
            return Response(
                {"detail": "answers 必须是作答列表。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        questions = list(exam.questions.all())
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
            "grade_exam",
            topic=exam.topic,
            exam=exam,
            input_json={"exam_id": exam.id},
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )


class ReviewRecordViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ReviewRecord.objects.select_related("topic", "exam")
    serializer_class = ReviewRecordSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        result = self.request.query_params.get("result")
        return queryset.filter(result=result) if result else queryset

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        review = self.get_object()
        if review.result == "completed":
            return Response(
                {"detail": "该复习记录已完成。"}, status=status.HTTP_400_BAD_REQUEST
            )
        review.result = "completed"
        review.completed_at = timezone.now()
        review.save(update_fields=["result", "completed_at"])
        return Response(ReviewRecordSerializer(review).data)

    @action(detail=True, methods=["post"], url_path="prompt")
    def create_prompt(self, request, pk=None):
        review = self.get_object()
        if review.result == "completed":
            return Response(
                {"detail": "已完成的复习记录不能再生成提示。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        context = _build_review_context(review)
        if not context:
            return Response(
                {"detail": "请先保留至少一份处理成功的材料或结构化笔记。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task, _ = enqueue_or_reuse(
            "review_prompt",
            topic=review.topic,
            review=review,
            input_json={"review_id": review.id, "context": context},
        )
        return Response(
            {"task": AITaskSerializer(task).data}, status=status.HTTP_202_ACCEPTED
        )


class AITaskViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AITask.objects.select_related(
        "topic", "material", "question", "concept", "exam", "review"
    )
    serializer_class = AITaskSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        for field in ("topic", "material", "question", "concept", "exam", "review"):
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{f"{field}_id": value})
        return queryset

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        task = self.get_object()
        try:
            retry_task(task)
        except ValueError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AITaskSerializer(task).data, status=status.HTTP_202_ACCEPTED)

from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import AITask, Exam, Material, Note, Question, ReviewRecord, Topic
from .note_service import build_note_source
from .serializers import (
    AITaskSerializer,
    ExamSerializer,
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
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        question = serializer.save()
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
        "topic", "material", "question", "exam", "review"
    )
    serializer_class = AITaskSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        for field in ("topic", "material", "question", "exam", "review"):
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

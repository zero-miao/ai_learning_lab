from rest_framework import serializers

from .models import (
    AIResponse,
    AITask,
    Exam,
    ExamQuestion,
    Material,
    MaterialChunk,
    Question,
    Topic,
)


class AIResponseSerializer(serializers.ModelSerializer):
    task_type_display = serializers.CharField(
        source="get_task_type_display", read_only=True
    )

    class Meta:
        model = AIResponse
        fields = [
            "id",
            "task_type",
            "task_type_display",
            "content",
            "model",
            "created_at",
        ]


class QuestionSerializer(serializers.ModelSerializer):
    ai_responses = AIResponseSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = [
            "id",
            "topic",
            "material",
            "chunk",
            "selected_text",
            "question_text",
            "created_at",
            "ai_responses",
        ]
        read_only_fields = ["created_at"]


class MaterialChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialChunk
        fields = ["id", "chunk_index", "content", "start_offset", "end_offset"]


class MaterialSerializer(serializers.ModelSerializer):
    chunks = MaterialChunkSerializer(many=True, read_only=True)
    ai_responses = AIResponseSerializer(many=True, read_only=True)
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    import_status_display = serializers.CharField(
        source="get_import_status_display", read_only=True
    )

    class Meta:
        model = Material
        fields = [
            "id",
            "topic",
            "type",
            "type_display",
            "source_url",
            "title",
            "raw_text",
            "clean_text",
            "import_status",
            "import_status_display",
            "created_at",
            "chunks",
            "ai_responses",
        ]
        read_only_fields = ["created_at", "clean_text", "import_status"]


class TopicSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mastery_level_display = serializers.CharField(
        source="get_mastery_level_display", read_only=True
    )
    materials = MaterialSerializer(many=True, read_only=True)

    class Meta:
        model = Topic
        fields = [
            "id",
            "title",
            "goal",
            "scope",
            "status",
            "status_display",
            "mastery_level",
            "mastery_level_display",
            "created_at",
            "updated_at",
            "materials",
        ]
        read_only_fields = ["created_at", "updated_at"]


class ExamQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamQuestion
        fields = [
            "id",
            "question_type",
            "scenario",
            "question_text",
            "rubric_json",
            "answer_text",
            "feedback",
            "score",
        ]
        read_only_fields = ["rubric_json", "feedback", "score"]


class ExamSerializer(serializers.ModelSerializer):
    questions = ExamQuestionSerializer(many=True, read_only=True)
    exam_type_display = serializers.CharField(
        source="get_exam_type_display", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    review_due_at = serializers.SerializerMethodField()

    def get_review_due_at(self, exam):
        review = exam.review_records.order_by("due_at").first()
        return review.due_at if review else None

    class Meta:
        model = Exam
        fields = [
            "id",
            "topic",
            "exam_type",
            "exam_type_display",
            "status",
            "status_display",
            "score",
            "feedback",
            "created_at",
            "submitted_at",
            "review_due_at",
            "questions",
        ]
        read_only_fields = [
            "exam_type",
            "status",
            "score",
            "feedback",
            "created_at",
            "submitted_at",
            "questions",
        ]


class AITaskSerializer(serializers.ModelSerializer):
    task_type_display = serializers.CharField(
        source="get_task_type_display", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = AITask
        fields = [
            "id",
            "task_type",
            "task_type_display",
            "status",
            "status_display",
            "topic",
            "material",
            "question",
            "exam",
            "result_json",
            "error_message",
            "attempt_count",
            "max_attempts",
            "next_run_at",
            "started_at",
            "finished_at",
            "model",
            "prompt_version",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

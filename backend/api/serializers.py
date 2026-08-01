from rest_framework import serializers

from .models import (
    AIResponse,
    AITask,
    Concept,
    ConceptAnchor,
    ConceptRelation,
    DiscussionMessage,
    Exam,
    ExamQuestion,
    Highlight,
    Material,
    MaterialChunk,
    Note,
    Question,
    ReviewRecord,
    Topic,
)
from .note_service import build_note_source


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
    concept_title = serializers.CharField(source="concept.title", read_only=True)

    class Meta:
        model = Question
        fields = [
            "id",
            "topic",
            "material",
            "chunk",
            "concept",
            "concept_title",
            "selected_text",
            "start_offset",
            "end_offset",
            "question_text",
            "is_saved",
            "saved_at",
            "created_at",
            "ai_responses",
        ]
        read_only_fields = [
            "selected_text",
            "start_offset",
            "end_offset",
            "is_saved",
            "saved_at",
            "created_at",
        ]


class DiscussionMessageSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    message_type_display = serializers.CharField(
        source="get_message_type_display", read_only=True
    )

    class Meta:
        model = DiscussionMessage
        fields = [
            "id",
            "topic",
            "role",
            "role_display",
            "message_type",
            "message_type_display",
            "content",
            "source_task",
            "created_at",
        ]
        read_only_fields = [
            "topic",
            "role",
            "message_type",
            "source_task",
            "created_at",
        ]


class ConceptAnchorSerializer(serializers.ModelSerializer):
    material_title = serializers.CharField(source="material.title", read_only=True)

    class Meta:
        model = ConceptAnchor
        fields = [
            "id",
            "material",
            "material_title",
            "chunk",
            "source_text",
            "start_offset",
            "end_offset",
            "created_at",
        ]
        read_only_fields = fields


class ConceptSerializer(serializers.ModelSerializer):
    anchors = ConceptAnchorSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Concept
        fields = [
            "id",
            "topic",
            "title",
            "definition",
            "principle",
            "pitfalls",
            "applications",
            "status",
            "status_display",
            "source_task",
            "anchors",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "topic",
            "source_task",
            "anchors",
            "created_at",
            "updated_at",
        ]


class ConceptRelationSerializer(serializers.ModelSerializer):
    from_concept_title = serializers.CharField(
        source="from_concept.title", read_only=True
    )
    to_concept_title = serializers.CharField(source="to_concept.title", read_only=True)

    class Meta:
        model = ConceptRelation
        fields = [
            "id",
            "topic",
            "from_concept",
            "from_concept_title",
            "to_concept",
            "to_concept_title",
            "relation_type",
            "description",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "from_concept_title",
            "to_concept_title",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        from_concept = attrs.get(
            "from_concept",
            self.instance.from_concept if self.instance else None,
        )
        to_concept = attrs.get(
            "to_concept",
            self.instance.to_concept if self.instance else None,
        )
        if from_concept == to_concept:
            raise serializers.ValidationError("概念不能关联自身。")
        topic = attrs.get("topic", self.instance.topic if self.instance else None)
        if (
            from_concept.topic_id != to_concept.topic_id
            or topic.id != from_concept.topic_id
        ):
            raise serializers.ValidationError("概念关系必须位于同一学习话题。")
        return attrs


class HighlightSerializer(serializers.ModelSerializer):
    class Meta:
        model = Highlight
        fields = [
            "id",
            "topic",
            "material",
            "chunk",
            "source_text",
            "start_offset",
            "end_offset",
            "created_at",
        ]
        read_only_fields = fields


class MaterialChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialChunk
        fields = ["id", "chunk_index", "content", "start_offset", "end_offset"]


class MaterialSerializer(serializers.ModelSerializer):
    chunks = MaterialChunkSerializer(many=True, read_only=True)
    ai_responses = AIResponseSerializer(many=True, read_only=True)
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    source_type_display = serializers.CharField(
        source="get_source_type_display", read_only=True
    )
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
            "source_type",
            "source_type_display",
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


class NoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = [
            "id",
            "topic",
            "title",
            "content",
            "material_fingerprint",
            "source_task",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "material_fingerprint",
            "source_task",
            "created_at",
            "updated_at",
        ]


class TopicSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    discussion_outcome_display = serializers.CharField(
        source="get_discussion_outcome_display", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mastery_level_display = serializers.CharField(
        source="get_mastery_level_display", read_only=True
    )
    materials = MaterialSerializer(many=True, read_only=True)
    notes = NoteSerializer(many=True, read_only=True)
    concepts = ConceptSerializer(many=True, read_only=True)
    concept_relations = ConceptRelationSerializer(many=True, read_only=True)
    highlights = HighlightSerializer(many=True, read_only=True)
    learning_output = serializers.SerializerMethodField()
    has_current_note = serializers.SerializerMethodField()

    def get_learning_output(self, topic):
        return {
            "concept_count": topic.concepts.count(),
            "saved_question_count": topic.questions.filter(is_saved=True).count(),
            "summary_count": topic.notes.count(),
            "map_node_count": topic.concepts.count(),
        }

    def get_has_current_note(self, topic):
        _, fingerprint = build_note_source(topic)
        return topic.notes.filter(material_fingerprint=fingerprint).exists()

    class Meta:
        model = Topic
        fields = [
            "id",
            "title",
            "type",
            "type_display",
            "discussion_outcome",
            "discussion_outcome_display",
            "discussion_rationale",
            "goal",
            "scope",
            "status",
            "status_display",
            "mastery_level",
            "mastery_level_display",
            "created_at",
            "updated_at",
            "materials",
            "notes",
            "concepts",
            "concept_relations",
            "highlights",
            "learning_output",
            "has_current_note",
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


class ReviewRecordSerializer(serializers.ModelSerializer):
    topic_title = serializers.CharField(source="topic.title", read_only=True)
    topic_mastery_level = serializers.CharField(
        source="topic.mastery_level", read_only=True
    )
    topic_mastery_level_display = serializers.CharField(
        source="topic.get_mastery_level_display", read_only=True
    )
    result_display = serializers.CharField(source="get_result_display", read_only=True)
    exam_score = serializers.IntegerField(source="exam.score", read_only=True)

    class Meta:
        model = ReviewRecord
        fields = [
            "id",
            "topic",
            "topic_title",
            "topic_mastery_level",
            "topic_mastery_level_display",
            "exam",
            "exam_score",
            "due_at",
            "completed_at",
            "result",
            "result_display",
            "next_due_at",
            "review_prompt",
            "review_prompt_generated_at",
        ]
        read_only_fields = fields


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
            "concept",
            "discussion_message",
            "exam",
            "review",
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

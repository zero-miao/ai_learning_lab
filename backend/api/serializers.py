from django.conf import settings
from rest_framework import serializers

from .models import (
    AITask,
    Concept,
    ConceptRelation,
    Exam,
    ExamQuestion,
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
    UserFeedback,
)
from .tasks import TaskRegistry


class ModelDiscoverySerializer(serializers.Serializer):
    llm_provider_type = serializers.ChoiceField(
        choices=SystemConfiguration.PROVIDER_CHOICES
    )
    llm_base_url = serializers.URLField()
    llm_api_key = serializers.CharField(
        allow_blank=True,
        required=False,
        default="",
        trim_whitespace=False,
    )


class SystemConfigurationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemConfiguration
        fields = [
            "llm_provider_type",
            "llm_base_url",
            "llm_api_key",
            "llm_model",
            "llm_model_management_assistant",
            "llm_model_topic_chat",
            "llm_model_supplement_query",
            "llm_model_supplement_evaluate",
            "llm_model_briefing",
            "llm_model_clean_text",
            "llm_model_answer_question",
            "llm_model_concept_draft",
            "llm_model_generate_exam",
            "llm_model_grade_exam",
            "llm_model_review_prompt",
            "llm_model_grade_review",
            "ollama_keep_alive",
            "asr_model",
            "tts_voices",
            "searxng_base_url",
            "crawl4ai_base_url",
            "supplement_relevance_threshold",
            "default_site_theme",
            "default_reader_font",
            "api_timeout_ms",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def validate_tts_voices(self, value):
        voices = [item.strip() for item in value.split(",") if item.strip()]
        if not voices:
            raise serializers.ValidationError("至少配置一个 TTS 音色。")
        if any(not item.partition("|")[0].strip() for item in voices):
            raise serializers.ValidationError("TTS 音色格式无效。")
        return ",".join(voices)


class MaterialTextLocatorSerializer(serializers.ModelSerializer):
    material_title = serializers.CharField(source="material.title", read_only=True)
    topic_title = serializers.CharField(source="topic.title", read_only=True)

    class Meta:
        model = MaterialTextLocator
        fields = [
            "id",
            "material",
            "material_title",
            "chunk",
            "topic",
            "topic_title",
            "source_text",
            "start_offset",
            "end_offset",
            "time_start_offset",
            "time_end_offset",
            "entity_type",
            "entity_id",
            "created_at",
        ]
        read_only_fields = fields


class MaterialChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialChunk
        fields = [
            "id",
            "chunk_index",
            "content",
            "start_offset",
            "end_offset",
            "start_time",
            "end_time",
        ]


class MaterialSerializer(serializers.ModelSerializer):
    chunks = MaterialChunkSerializer(many=True, read_only=True)
    media_url = serializers.SerializerMethodField()
    tts_assets = serializers.SerializerMethodField()
    topic_links = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    def get_media_url(self, material):
        if material.media_type not in {"video", "audio"} or not material.media_uri:
            return ""
        path = f"{settings.MEDIA_URL}{material.media_uri}"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_tts_assets(self, material):
        request = self.context.get("request")
        voices = material.media_meta.get("tts", {}).get("voices", {})
        assets = []
        for voice, data in voices.items():
            path = data.get("path", "")
            url = f"{settings.MEDIA_URL}{path}" if path else ""
            assets.append(
                {
                    "voice": voice,
                    "label": data.get("label", voice),
                    "status": data.get("status", "failed"),
                    "url": request.build_absolute_uri(url) if request and url else url,
                    "error": data.get("error", ""),
                }
            )
        return assets

    def get_topic_links(self, material):
        links = (
            link for link in material.topic_materials.all() if link.removed_at is None
        )
        return [
            {
                "topic": link.topic_id,
                "topic_title": link.topic.title,
                "category": link.category,
                "import_by": link.import_by,
                "import_at": link.import_at,
                "relevance_score": link.relevance_score,
            }
            for link in links
        ]

    class Meta:
        model = Material
        fields = [
            "id",
            "title",
            "created_by",
            "created_at",
            "updated_at",
            "error",
            "media_type",
            "media_uri",
            "media_url",
            "tts_assets",
            "topic_links",
            "raw_text",
            "clean_text",
            "media_meta",
            "digest",
            "status",
            "status_display",
            "chunks",
        ]
        read_only_fields = [
            "created_at",
            "updated_at",
            "error",
            "clean_text",
            "media_meta",
            "digest",
            "status",
            "status_display",
            "chunks",
        ]


class MaterialListSerializer(MaterialSerializer):
    raw_text_length = serializers.IntegerField(read_only=True)
    clean_text_length = serializers.IntegerField(read_only=True)
    digest_length = serializers.IntegerField(read_only=True)
    chunk_count = serializers.IntegerField(read_only=True)

    class Meta(MaterialSerializer.Meta):
        fields = [
            "id",
            "title",
            "created_by",
            "created_at",
            "updated_at",
            "error",
            "media_type",
            "media_uri",
            "tts_assets",
            "topic_links",
            "raw_text_length",
            "clean_text_length",
            "digest_length",
            "chunk_count",
            "status",
            "status_display",
        ]
        read_only_fields = fields


class TopicMaterialSerializer(serializers.ModelSerializer):
    material = MaterialSerializer(read_only=True)
    material_id = serializers.IntegerField(source="material.id", read_only=True)

    class Meta:
        model = TopicMaterial
        fields = [
            "id",
            "topic",
            "material",
            "material_id",
            "import_by",
            "import_at",
            "import_reason",
            "category",
            "relevance_score",
            "removed_at",
        ]
        read_only_fields = [
            "import_by",
            "import_at",
            "import_reason",
            "relevance_score",
            "removed_at",
        ]


class QuestionSerializer(serializers.ModelSerializer):
    locators = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    def get_locators(self, question):
        locators = MaterialTextLocator.objects.filter(
            entity_type="question", entity_id=question.id
        ).select_related("material", "chunk", "topic")
        material_id = self.context.get("material_id")
        topic_id = self.context.get("topic_id")
        if material_id is not None:
            locators = locators.filter(material_id=material_id)
        if topic_id is not None:
            locators = locators.filter(topic_id=topic_id)
        return MaterialTextLocatorSerializer(locators, many=True).data

    class Meta:
        model = Question
        fields = [
            "id",
            "session",
            "question_text",
            "conclusion",
            "status",
            "status_display",
            "created_at",
            "locators",
        ]
        read_only_fields = ["created_at", "locators", "status_display"]


class ConceptSerializer(serializers.ModelSerializer):
    locators = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    def get_locators(self, concept):
        locators = MaterialTextLocator.objects.filter(
            entity_type="concept", entity_id=concept.id
        ).select_related("material", "chunk", "topic")
        material_id = self.context.get("material_id")
        topic_id = self.context.get("topic_id")
        if material_id is not None:
            locators = locators.filter(material_id=material_id)
        if topic_id is not None:
            locators = locators.filter(topic_id=topic_id)
        return MaterialTextLocatorSerializer(locators, many=True).data

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
            "locators",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["topic", "locators", "created_at", "updated_at"]


class HighlightSerializer(serializers.ModelSerializer):
    locators = serializers.SerializerMethodField()

    def get_locators(self, highlight):
        locators = MaterialTextLocator.objects.filter(
            entity_type="highlight", entity_id=highlight.id
        ).select_related("material", "chunk", "topic")
        material_id = self.context.get("material_id")
        topic_id = self.context.get("topic_id")
        if material_id is not None:
            locators = locators.filter(material_id=material_id)
        if topic_id is not None:
            locators = locators.filter(topic_id=topic_id)
        return MaterialTextLocatorSerializer(locators, many=True).data

    class Meta:
        model = Highlight
        fields = [
            "id",
            "user_note",
            "created_at",
            "updated_at",
            "locators",
        ]
        read_only_fields = ["created_at", "updated_at", "locators"]


class SessionMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = SessionMessage
        fields = ["id", "session", "msg_from", "msg_content", "msg_at"]
        read_only_fields = fields


class SessionSerializer(serializers.ModelSerializer):
    messages = SessionMessageSerializer(many=True, read_only=True)

    class Meta:
        model = Session
        fields = [
            "id",
            "system_prompt",
            "model",
            "session_scene",
            "context_material",
            "context_msg",
            "created_at",
            "updated_at",
            "messages",
        ]
        read_only_fields = fields


class MaterialRecommendationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    category_display = serializers.CharField(
        source="get_category_display", read_only=True
    )

    class Meta:
        model = MaterialRecommendation
        fields = [
            "id",
            "topic",
            "message",
            "source_task",
            "material",
            "title",
            "url",
            "category",
            "category_display",
            "relevance_score",
            "reason",
            "status",
            "status_display",
            "created_at",
            "decided_at",
        ]
        read_only_fields = fields


class ConceptRelationSerializer(serializers.ModelSerializer):
    from_concept_title = serializers.CharField(
        source="from_concept.title", read_only=True
    )
    to_concept_title = serializers.CharField(source="to_concept.title", read_only=True)

    class Meta:
        model = ConceptRelation
        fields = [
            "id",
            "from_topic",
            "to_topic",
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
            "from_topic",
            "to_topic",
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
        attrs["from_topic"] = from_concept.topic
        attrs["to_topic"] = to_concept.topic
        return attrs


class TopicListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mastery_level_display = serializers.CharField(
        source="get_mastery_level_display", read_only=True
    )
    material_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Topic
        fields = [
            "id",
            "title",
            "goal",
            "is_pinned",
            "status",
            "status_display",
            "mastery_level",
            "mastery_level_display",
            "material_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class TopicDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mastery_level_display = serializers.CharField(
        source="get_mastery_level_display", read_only=True
    )
    topic_materials = serializers.SerializerMethodField()
    concepts = ConceptSerializer(many=True, read_only=True)
    questions = serializers.SerializerMethodField()
    highlights = serializers.SerializerMethodField()
    concept_relations = serializers.SerializerMethodField()
    learning_output = serializers.SerializerMethodField()

    def get_topic_materials(self, topic):
        links = topic.topic_materials.filter(removed_at__isnull=True).select_related(
            "material"
        )
        return TopicMaterialSerializer(links, many=True, context=self.context).data

    def get_questions(self, topic):
        ids = MaterialTextLocator.objects.filter(
            topic=topic, entity_type="question"
        ).values_list("entity_id", flat=True)
        return QuestionSerializer(Question.objects.filter(id__in=ids), many=True).data

    def get_highlights(self, topic):
        ids = MaterialTextLocator.objects.filter(
            topic=topic, entity_type="highlight"
        ).values_list("entity_id", flat=True)
        return HighlightSerializer(Highlight.objects.filter(id__in=ids), many=True).data

    def get_concept_relations(self, topic):
        relations = ConceptRelation.objects.filter(
            from_topic=topic
        ) | ConceptRelation.objects.filter(to_topic=topic)
        return ConceptRelationSerializer(relations.distinct(), many=True).data

    def get_learning_output(self, topic):
        question_count = MaterialTextLocator.objects.filter(
            topic=topic, entity_type="question"
        ).count()
        return {
            "concept_count": topic.concepts.count(),
            "question_count": question_count,
            "map_node_count": topic.concepts.count(),
        }

    class Meta:
        model = Topic
        fields = [
            "id",
            "title",
            "session",
            "goal",
            "scope",
            "is_pinned",
            "status",
            "status_display",
            "mastery_level",
            "mastery_level_display",
            "created_at",
            "updated_at",
            "topic_materials",
            "concepts",
            "questions",
            "concept_relations",
            "highlights",
            "learning_output",
        ]
        read_only_fields = [
            "session",
            "created_at",
            "updated_at",
        ]


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
            "questions",
        ]
        read_only_fields = fields


class ReviewRecordSerializer(serializers.ModelSerializer):
    topic_title = serializers.CharField(source="topic.title", read_only=True)
    topic_mastery_level = serializers.CharField(
        source="topic.mastery_level", read_only=True
    )
    topic_mastery_level_display = serializers.CharField(
        source="topic.get_mastery_level_display", read_only=True
    )
    exam_score = serializers.IntegerField(source="exam.score", read_only=True)
    result_display = serializers.CharField(source="get_result_display", read_only=True)

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
            "previous_review",
            "due_at",
            "completed_at",
            "result",
            "result_display",
            "next_due_at",
            "review_prompt",
            "review_prompt_generated_at",
            "response_text",
            "feedback",
            "score",
            "graded_at",
        ]
        read_only_fields = fields


class AITaskSerializer(serializers.ModelSerializer):
    task_type_display = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    def get_task_type_display(self, obj):
        choices = dict(TaskRegistry.get_choices())
        return choices.get(obj.task_type, obj.task_type)

    class Meta:
        model = AITask
        fields = [
            "id",
            "task_type",
            "task_type_display",
            "status",
            "status_display",
            "priority",
            "trigger_type",
            "trigger_id",
            "task_data",
            "full_context",
            "result_json",
            "error_message",
            "attempt_count",
            "max_attempts",
            "next_run_at",
            "started_at",
            "finished_at",
            "model",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AITaskListSerializer(AITaskSerializer):
    class Meta(AITaskSerializer.Meta):
        fields = [
            "id",
            "task_type",
            "task_type_display",
            "status",
            "status_display",
            "priority",
            "trigger_type",
            "trigger_id",
            "error_message",
            "attempt_count",
            "max_attempts",
            "next_run_at",
            "started_at",
            "finished_at",
            "model",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class UserFeedbackSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = UserFeedback
        fields = [
            "id",
            "category",
            "category_display",
            "description",
            "page_url",
            "page_title",
            "user_agent",
            "context",
            "status",
            "status_display",
            "resolution_note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "category_display",
            "status",
            "status_display",
            "resolution_note",
            "created_at",
            "updated_at",
        ]

    def validate_description(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("请填写反馈内容。")
        return value

from django.contrib import admin
from django.db.models import Count, Q

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


@admin.register(SystemConfiguration)
class SystemConfigurationAdmin(admin.ModelAdmin):
    fieldsets = (
        (
            "LLM 服务",
            {
                "fields": (
                    "llm_provider_type",
                    "llm_base_url",
                    "llm_api_key",
                    "llm_model",
                    "ollama_keep_alive",
                )
            },
        ),
        (
            "任务模型",
            {
                "fields": (
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
                )
            },
        ),
        (
            "本地服务",
            {
                "fields": (
                    "asr_model",
                    "tts_voices",
                    "searxng_base_url",
                    "crawl4ai_base_url",
                    "supplement_relevance_threshold",
                )
            },
        ),
        (
            "界面默认值",
            {
                "fields": (
                    "default_site_theme",
                    "default_reader_font",
                    "api_timeout_ms",
                )
            },
        ),
        ("时间", {"fields": ("updated_at",)}),
    )
    readonly_fields = ("updated_at",)

    def has_add_permission(self, request):
        return not SystemConfiguration.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "status",
        "mastery_level",
        "material_count",
        "concept_count",
        "session",
        "updated_at",
    )
    list_filter = ("status", "mastery_level")
    search_fields = ("title", "goal", "scope")
    readonly_fields = ("created_at", "updated_at")
    list_select_related = ("session",)
    fieldsets = (
        (None, {"fields": ("title", "status", "goal", "scope")}),
        ("学习进度", {"fields": ("mastery_level",)}),
        ("学习讨论", {"fields": ("session",)}),
        ("时间", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="资料数", ordering="_material_count")
    def material_count(self, topic):
        return topic._material_count

    @admin.display(description="概念数", ordering="_concept_count")
    def concept_count(self, topic):
        return topic._concept_count

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                _material_count=Count(
                    "topic_materials",
                    filter=Q(topic_materials__removed_at__isnull=True),
                    distinct=True,
                ),
                _concept_count=Count("concepts", distinct=True),
            )
        )


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "media_type",
        "status",
        "created_by",
        "topic_count",
        "chunk_count",
        "has_error",
        "updated_at",
    )
    list_filter = ("media_type", "status", "created_by")
    search_fields = ("title", "media_uri", "digest", "clean_text")
    readonly_fields = ("created_at", "updated_at", "media_meta", "digest", "error")
    list_select_related = ()
    fieldsets = (
        (None, {"fields": ("title", "media_type", "media_uri", "created_by")}),
        ("处理结果", {"fields": ("status", "error", "media_meta", "digest")}),
        ("内容", {"fields": ("raw_text", "clean_text")}),
        ("时间", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="关联主题", ordering="_topic_count")
    def topic_count(self, material):
        return material._topic_count

    @admin.display(description="片段数", ordering="_chunk_count")
    def chunk_count(self, material):
        return material._chunk_count

    @admin.display(boolean=True, description="有错误")
    def has_error(self, material):
        return bool(material.error)

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                _topic_count=Count("topic_materials", distinct=True),
                _chunk_count=Count("chunks", distinct=True),
            )
        )


@admin.register(TopicMaterial)
class TopicMaterialAdmin(admin.ModelAdmin):
    list_display = (
        "topic",
        "material",
        "category",
        "import_by",
        "relevance_score",
        "removed_at",
        "import_at",
    )
    list_filter = ("category", "import_by", "removed_at")
    search_fields = ("topic__title", "material__title", "import_reason")
    list_select_related = ("topic", "material")
    readonly_fields = ("import_at",)
    autocomplete_fields = ("topic", "material")


@admin.register(MaterialRecommendation)
class MaterialRecommendationAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "topic",
        "status",
        "relevance_score",
        "category",
        "material",
        "created_at",
    )
    list_filter = ("status", "category")
    search_fields = ("title", "url", "reason", "topic__title")
    list_select_related = ("topic", "message", "source_task", "material")
    readonly_fields = ("created_at", "decided_at", "content_md5")
    autocomplete_fields = ("topic", "message", "source_task", "material")


@admin.register(MaterialChunk)
class MaterialChunkAdmin(admin.ModelAdmin):
    list_display = (
        "material",
        "chunk_index",
        "start_offset",
        "end_offset",
        "start_time",
        "end_time",
    )
    list_filter = ("material__media_type",)
    search_fields = ("material__title", "content")
    list_select_related = ("material",)
    autocomplete_fields = ("material",)


@admin.register(MaterialTextLocator)
class MaterialTextLocatorAdmin(admin.ModelAdmin):
    list_display = (
        "entity_type",
        "entity_id",
        "topic",
        "material",
        "chunk",
        "text_range",
        "time_range",
        "created_at",
    )
    list_filter = ("entity_type", "topic", "material__media_type")
    search_fields = ("source_text", "material__title", "topic__title")
    list_select_related = ("topic", "material", "chunk")
    readonly_fields = ("created_at",)
    autocomplete_fields = ("topic", "material", "chunk")

    @admin.display(description="文本范围")
    def text_range(self, locator):
        return f"{locator.start_offset} - {locator.end_offset}"

    @admin.display(description="时间范围")
    def time_range(self, locator):
        if locator.time_start_offset is None:
            return "-"
        return f"{locator.time_start_offset:.2f}s - {locator.time_end_offset:.2f}s"


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "session_scene",
        "context_material",
        "model",
        "message_count",
        "updated_at",
    )
    list_filter = ("session_scene",)
    search_fields = ("context_msg", "system_prompt", "context_material__title")
    list_select_related = ("context_material",)
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("context_material",)

    @admin.display(description="消息数", ordering="_message_count")
    def message_count(self, session):
        return session._message_count

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_message_count=Count("messages"))


@admin.register(SessionMessage)
class SessionMessageAdmin(admin.ModelAdmin):
    list_display = ("session", "msg_from", "content_preview", "msg_at")
    list_filter = ("msg_from", "session__session_scene")
    search_fields = ("msg_content", "session__context_material__title")
    list_select_related = ("session", "session__context_material")
    readonly_fields = ("msg_at",)
    autocomplete_fields = ("session",)

    @admin.display(description="内容")
    def content_preview(self, message):
        return message.msg_content[:80]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = (
        "question_preview",
        "session",
        "status",
        "has_conclusion",
        "created_at",
    )
    list_filter = ("status", "session__session_scene")
    search_fields = ("question_text", "conclusion")
    list_select_related = ("session",)
    readonly_fields = ("created_at",)
    autocomplete_fields = ("session",)

    @admin.display(description="问题")
    def question_preview(self, question):
        return question.question_text[:100]

    @admin.display(boolean=True, description="已有结论")
    def has_conclusion(self, question):
        return bool(question.conclusion)


@admin.register(Concept)
class ConceptAdmin(admin.ModelAdmin):
    list_display = ("title", "topic", "status", "locator_count", "updated_at")
    list_filter = ("status", "topic")
    search_fields = ("title", "definition", "principle", "topic__title")
    list_select_related = ("topic",)
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("topic",)

    @admin.display(description="定位数")
    def locator_count(self, concept):
        return MaterialTextLocator.objects.filter(
            entity_type="concept", entity_id=concept.id
        ).count()


@admin.register(ConceptRelation)
class ConceptRelationAdmin(admin.ModelAdmin):
    list_display = (
        "from_concept",
        "relation_type",
        "to_concept",
        "from_topic",
        "to_topic",
        "updated_at",
    )
    list_filter = ("relation_type", "from_topic", "to_topic")
    search_fields = ("from_concept__title", "to_concept__title", "description")
    list_select_related = ("from_concept", "to_concept", "from_topic", "to_topic")
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("from_concept", "to_concept", "from_topic", "to_topic")


@admin.register(Highlight)
class HighlightAdmin(admin.ModelAdmin):
    list_display = ("id", "note_preview", "locator_count", "updated_at")
    search_fields = ("user_note",)
    readonly_fields = ("created_at", "updated_at")

    @admin.display(description="备注")
    def note_preview(self, highlight):
        return highlight.user_note[:100] or "-"

    @admin.display(description="定位数")
    def locator_count(self, highlight):
        return MaterialTextLocator.objects.filter(
            entity_type="highlight", entity_id=highlight.id
        ).count()


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = (
        "topic",
        "status",
        "score",
        "question_count",
        "created_at",
        "submitted_at",
    )
    list_filter = ("status", "exam_type")
    search_fields = ("topic__title", "feedback")
    list_select_related = ("topic",)
    readonly_fields = ("created_at", "submitted_at", "score", "feedback")
    autocomplete_fields = ("topic",)

    @admin.display(description="题目数", ordering="_question_count")
    def question_count(self, exam):
        return exam._question_count

    def get_queryset(self, request):
        return (
            super().get_queryset(request).annotate(_question_count=Count("questions"))
        )


@admin.register(ExamQuestion)
class ExamQuestionAdmin(admin.ModelAdmin):
    list_display = ("exam", "question_type", "score", "question_preview")
    list_filter = ("question_type", "exam__status")
    search_fields = ("question_text", "scenario", "answer_text", "feedback")
    list_select_related = ("exam", "exam__topic")
    autocomplete_fields = ("exam",)

    @admin.display(description="题干")
    def question_preview(self, question):
        return question.question_text[:100]


@admin.register(ReviewRecord)
class ReviewRecordAdmin(admin.ModelAdmin):
    list_display = ("topic", "result", "due_at", "score", "completed_at", "next_due_at")
    list_filter = ("result",)
    search_fields = ("topic__title", "response_text", "feedback")
    list_select_related = ("topic", "exam", "previous_review")
    readonly_fields = ("completed_at", "next_due_at", "score", "feedback", "graded_at")
    autocomplete_fields = ("topic", "exam", "previous_review")


@admin.register(AITask)
class AITaskAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "task_type_display",
        "status",
        "trigger",
        "priority",
        "attempt_progress",
        "model",
        "created_at",
        "finished_at",
    )
    list_filter = ("task_type", "status", "trigger_type")
    search_fields = ("trigger_type", "trigger_id", "error_message", "model")
    readonly_fields = (
        "trigger_type",
        "trigger_id",
        "task_data",
        "full_context",
        "result_json",
        "error_message",
        "attempt_count",
        "next_run_at",
        "started_at",
        "finished_at",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "created_at"

    @admin.display(description="任务类型")
    def task_type_display(self, obj):
        choices = dict(TaskRegistry.get_choices())
        return choices.get(obj.task_type, obj.task_type)

    @admin.display(description="触发源")
    def trigger(self, task):
        return f"{task.trigger_type or '-'} #{task.trigger_id or '-'}"

    @admin.display(description="尝试次数")
    def attempt_progress(self, task):
        return f"{task.attempt_count}/{task.max_attempts}"

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "task_type":
            from django import forms

            kwargs["widget"] = forms.Select(choices=TaskRegistry.get_choices())
        return super().formfield_for_dbfield(db_field, request, **kwargs)


@admin.register(UserFeedback)
class UserFeedbackAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "category",
        "status",
        "description_preview",
        "page_title",
        "created_at",
        "updated_at",
    )
    list_filter = ("status", "category", "created_at")
    search_fields = ("description", "page_url", "page_title", "resolution_note")
    readonly_fields = (
        "category",
        "description",
        "page_url",
        "page_title",
        "user_agent",
        "context",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "created_at"

    @admin.display(description="反馈内容")
    def description_preview(self, feedback):
        return feedback.description[:100]

from django.contrib import admin

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


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "type",
        "status",
        "discussion_outcome",
        "mastery_level",
        "created_at",
        "updated_at",
    )
    list_filter = ("type", "status", "mastery_level", "discussion_outcome")
    search_fields = ("title", "goal", "scope")


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "topic",
        "type",
        "source_type",
        "import_status",
        "created_at",
    )
    list_filter = ("type", "source_type", "import_status")
    search_fields = ("title", "source_url", "raw_text")


@admin.register(MaterialChunk)
class MaterialChunkAdmin(admin.ModelAdmin):
    list_display = ("material", "chunk_index", "start_offset", "end_offset")
    list_filter = ("material",)
    search_fields = ("content",)


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = (
        "topic",
        "material",
        "concept",
        "is_saved",
        "question_text",
        "created_at",
    )
    list_filter = ("topic", "material", "concept", "is_saved")
    search_fields = ("question_text", "selected_text")


@admin.register(Concept)
class ConceptAdmin(admin.ModelAdmin):
    list_display = ("title", "topic", "status", "source_task", "updated_at")
    list_filter = ("status", "topic")
    search_fields = ("title", "definition", "principle", "topic__title")
    readonly_fields = ("source_task", "created_at", "updated_at")


@admin.register(ConceptAnchor)
class ConceptAnchorAdmin(admin.ModelAdmin):
    list_display = (
        "concept",
        "material",
        "chunk",
        "start_offset",
        "end_offset",
        "created_at",
    )
    list_filter = ("material",)
    search_fields = ("concept__title", "source_text", "material__title")


@admin.register(ConceptRelation)
class ConceptRelationAdmin(admin.ModelAdmin):
    list_display = ("from_concept", "relation_type", "to_concept", "updated_at")
    list_filter = ("relation_type",)
    search_fields = (
        "from_concept__title",
        "to_concept__title",
        "description",
    )


@admin.register(DiscussionMessage)
class DiscussionMessageAdmin(admin.ModelAdmin):
    list_display = ("topic", "role", "message_type", "source_task", "created_at")
    list_filter = ("role", "message_type")
    search_fields = ("topic__title", "content")
    readonly_fields = ("source_task", "created_at")


@admin.register(Highlight)
class HighlightAdmin(admin.ModelAdmin):
    list_display = (
        "topic",
        "material",
        "chunk",
        "start_offset",
        "end_offset",
        "created_at",
    )
    list_filter = ("topic", "material")
    search_fields = ("source_text", "material__title")


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("title", "topic", "source_task", "created_at", "updated_at")
    list_filter = ("topic",)
    search_fields = ("title", "content", "topic__title")
    readonly_fields = ("source_task", "created_at", "updated_at")


@admin.register(AIResponse)
class AIResponseAdmin(admin.ModelAdmin):
    list_display = ("task_type", "material", "question", "model", "created_at")
    list_filter = ("task_type", "model")
    search_fields = ("content",)


@admin.register(AITask)
class AITaskAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "task_type",
        "status",
        "topic",
        "material",
        "question",
        "concept",
        "discussion_message",
        "exam",
        "review",
        "attempt_count",
        "max_attempts",
        "next_run_at",
        "created_at",
    )
    list_filter = ("task_type", "status")
    search_fields = ("error_message", "material__title", "question__question_text")
    readonly_fields = ("created_at", "updated_at", "started_at", "finished_at")


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = (
        "topic",
        "exam_type",
        "status",
        "score",
        "created_at",
        "submitted_at",
    )
    list_filter = ("exam_type", "status")
    search_fields = ("topic__title", "feedback")


@admin.register(ExamQuestion)
class ExamQuestionAdmin(admin.ModelAdmin):
    list_display = ("exam", "question_type", "score")
    list_filter = ("question_type",)
    search_fields = ("scenario", "question_text", "answer_text")


@admin.register(ReviewRecord)
class ReviewRecordAdmin(admin.ModelAdmin):
    list_display = (
        "topic",
        "exam",
        "previous_review",
        "due_at",
        "result",
        "score",
        "graded_at",
        "review_prompt_generated_at",
        "completed_at",
    )
    list_filter = ("result",)
    search_fields = ("topic__title", "response_text", "feedback")

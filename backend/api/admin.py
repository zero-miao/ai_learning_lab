from django.contrib import admin

from .models import (
    AIResponse,
    AITask,
    Exam,
    ExamQuestion,
    Material,
    MaterialChunk,
    Note,
    Question,
    ReviewRecord,
    Topic,
)


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "mastery_level", "created_at", "updated_at")
    list_filter = ("status", "mastery_level")
    search_fields = ("title", "goal", "scope")


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ("title", "topic", "type", "import_status", "created_at")
    list_filter = ("type", "import_status")
    search_fields = ("title", "source_url", "raw_text")


@admin.register(MaterialChunk)
class MaterialChunkAdmin(admin.ModelAdmin):
    list_display = ("material", "chunk_index", "start_offset", "end_offset")
    list_filter = ("material",)
    search_fields = ("content",)


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("topic", "material", "question_text", "created_at")
    list_filter = ("topic", "material")
    search_fields = ("question_text", "selected_text")


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
        "exam",
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
    list_display = ("topic", "exam", "due_at", "result", "completed_at")
    list_filter = ("result",)
    search_fields = ("topic__title",)

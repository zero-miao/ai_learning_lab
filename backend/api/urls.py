from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AITaskViewSet,
    ConceptViewSet,
    ExamViewSet,
    HighlightViewSet,
    MaterialViewSet,
    NoteViewSet,
    QuestionViewSet,
    ReviewRecordViewSet,
    TopicViewSet,
    health_check,
)

router = DefaultRouter()
router.register(r"topics", TopicViewSet)
router.register(r"materials", MaterialViewSet)
router.register(r"questions", QuestionViewSet)
router.register(r"concepts", ConceptViewSet)
router.register(r"highlights", HighlightViewSet)
router.register(r"notes", NoteViewSet)
router.register(r"exams", ExamViewSet)
router.register(r"reviews", ReviewRecordViewSet)
router.register(r"ai-tasks", AITaskViewSet)

urlpatterns = [
    path("health/", health_check, name="health_check"),
    path("", include(router.urls)),
]

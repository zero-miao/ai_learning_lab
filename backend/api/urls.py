from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AITaskViewSet,
    ConceptRelationViewSet,
    ConceptViewSet,
    ExamViewSet,
    HighlightViewSet,
    MaterialViewSet,
    QuestionViewSet,
    ReviewRecordViewSet,
    SessionViewSet,
    TopicMaterialViewSet,
    TopicViewSet,
    health_check,
)

router = DefaultRouter()
router.register(r"topics", TopicViewSet)
router.register(r"sessions", SessionViewSet)
router.register(r"materials", MaterialViewSet)
router.register(r"topic-materials", TopicMaterialViewSet)
router.register(r"questions", QuestionViewSet)
router.register(r"concepts", ConceptViewSet)
router.register(r"concept-relations", ConceptRelationViewSet)
router.register(r"highlights", HighlightViewSet)
router.register(r"exams", ExamViewSet)
router.register(r"reviews", ReviewRecordViewSet)
router.register(r"ai-tasks", AITaskViewSet)

urlpatterns = [
    path("health/", health_check, name="health_check"),
    path("", include(router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AITaskViewSet,
    ConceptRelationViewSet,
    ConceptViewSet,
    ExamViewSet,
    HighlightViewSet,
    MaterialRecommendationViewSet,
    MaterialViewSet,
    QuestionViewSet,
    ReviewRecordViewSet,
    SessionViewSet,
    TopicMaterialViewSet,
    TopicViewSet,
    discover_llm_models,
    health_check,
    system_configuration_detail,
)

router = DefaultRouter()
router.register(r"topics", TopicViewSet)
router.register(r"sessions", SessionViewSet)
router.register(r"materials", MaterialViewSet)
router.register(r"material-recommendations", MaterialRecommendationViewSet)
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
    path(
        "system-configuration/",
        system_configuration_detail,
        name="system_configuration",
    ),
    path(
        "system-configuration/models/",
        discover_llm_models,
        name="discover_llm_models",
    ),
    path("", include(router.urls)),
]

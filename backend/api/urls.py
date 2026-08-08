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
    UserFeedbackViewSet,
    current_reading_preferences,
    discover_llm_models,
    health_check,
    management_assistant_confirm_topic,
    management_assistant_detail,
    management_assistant_message,
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
router.register(r"feedback", UserFeedbackViewSet)

urlpatterns = [
    path("health/", health_check, name="health_check"),
    path(
        "assistant/",
        management_assistant_detail,
        name="management_assistant_detail",
    ),
    path(
        "assistant/messages/",
        management_assistant_message,
        name="management_assistant_message",
    ),
    path(
        "assistant/topics/confirm/",
        management_assistant_confirm_topic,
        name="management_assistant_confirm_topic",
    ),
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
    path(
        "system-configuration/preferences/",
        current_reading_preferences,
        name="current_reading_preferences",
    ),
    path("", include(router.urls)),
]

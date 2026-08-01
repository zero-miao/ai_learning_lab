from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AITaskViewSet,
    ExamViewSet,
    MaterialViewSet,
    QuestionViewSet,
    TopicViewSet,
    health_check,
)

router = DefaultRouter()
router.register(r"topics", TopicViewSet)
router.register(r"materials", MaterialViewSet)
router.register(r"questions", QuestionViewSet)
router.register(r"exams", ExamViewSet)
router.register(r"ai-tasks", AITaskViewSet)

urlpatterns = [
    path("health/", health_check, name="health_check"),
    path("", include(router.urls)),
]

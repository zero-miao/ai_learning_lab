from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import AIResponse, AITask, Exam, Material, ReviewRecord, Topic
from .task_service import execute_task, recover_interrupted_tasks


class AsyncTaskApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.topic = Topic.objects.create(
            title="Django ORM", goal="能在项目中选择合适的查询方式"
        )
        self.material = Material.objects.create(
            topic=self.topic,
            type="text",
            title="ORM 基础",
            raw_text="Django ORM 通过 QuerySet 表达数据库查询。",
            clean_text="Django ORM 通过 QuerySet 表达数据库查询。",
            import_status="success",
        )

    def test_question_request_returns_task_and_reuses_pending_task(self):
        payload = {
            "topic": self.topic.id,
            "material": self.material.id,
            "question_text": "QuerySet 为什么可组合？",
        }
        first = self.client.post("/api/questions/", payload, format="json")
        second = self.client.post("/api/questions/", payload, format="json")

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.data["task"]["status"], "pending")
        self.assertNotEqual(first.data["question"]["id"], second.data["question"]["id"])

    def test_exam_request_returns_reused_pending_task(self):
        first = self.client.post("/api/exams/", {"topic": self.topic.id}, format="json")
        second = self.client.post(
            "/api/exams/", {"topic": self.topic.id}, format="json"
        )

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.data["task"]["id"], second.data["task"]["id"])

    @patch("api.task_service.AIGateway.generate_exam")
    def test_exam_worker_creates_questions(self, generate_exam):
        generate_exam.return_value = [
            {
                "scenario": "后台报表筛选。",
                "question_text": "如何组合 QuerySet？",
                "rubric": {"key_points": ["链式调用"]},
            },
        ]
        response = self.client.post(
            "/api/exams/", {"topic": self.topic.id}, format="json"
        )
        task = AITask.objects.get(pk=response.data["task"]["id"])
        task.status = "running"
        task.attempt_count = 1
        task.save()

        execute_task(task.id)

        task.refresh_from_db()
        self.assertEqual(task.status, "succeeded")
        exam = Exam.objects.get(pk=task.result_json["exam_id"])
        self.assertEqual(exam.questions.count(), 1)

    @patch("api.task_service.AIGateway.ask_question")
    def test_question_worker_saves_answer(self, ask_question):
        ask_question.return_value = "QuerySet 支持链式调用。"
        response = self.client.post(
            "/api/questions/",
            {
                "topic": self.topic.id,
                "material": self.material.id,
                "question_text": "QuerySet 为什么可组合？",
            },
            format="json",
        )
        task = AITask.objects.get(pk=response.data["task"]["id"])
        task.status = "running"
        task.attempt_count = 1
        task.save()

        execute_task(task.id)

        self.assertEqual(
            AIResponse.objects.filter(task_type="answer_question").count(), 1
        )

    @patch("api.task_service.AIGateway.grade_exam")
    @patch("api.task_service.AIGateway.generate_exam")
    def test_grading_worker_updates_mastery_and_review(self, generate_exam, grade_exam):
        generate_exam.return_value = [
            {
                "scenario": "新场景",
                "question_text": "如何应用这个概念？",
                "rubric": {"key_points": ["关键点"]},
            }
        ]
        create_response = self.client.post(
            "/api/exams/", {"topic": self.topic.id}, format="json"
        )
        generation_task = AITask.objects.get(pk=create_response.data["task"]["id"])
        generation_task.status = "running"
        generation_task.attempt_count = 1
        generation_task.save()
        execute_task(generation_task.id)
        generation_task.refresh_from_db()
        exam = Exam.objects.get(pk=generation_task.result_json["exam_id"])

        grade_exam.return_value = {
            "questions": [
                {
                    "id": exam.questions.first().id,
                    "score": 90,
                    "feedback": "回答完整。",
                }
            ],
            "overall_feedback": "可以进入下一轮复习。",
        }
        response = self.client.post(
            f"/api/exams/{exam.id}/submit/",
            {
                "answers": [
                    {"id": exam.questions.first().id, "answer_text": "我的迁移分析。"}
                ]
            },
            format="json",
        )
        grading_task = AITask.objects.get(pk=response.data["task"]["id"])
        grading_task.status = "running"
        grading_task.attempt_count = 1
        grading_task.save()
        execute_task(grading_task.id)

        exam.refresh_from_db()
        self.topic.refresh_from_db()
        self.assertEqual(exam.status, "graded")
        self.assertEqual(exam.score, 90)
        self.assertEqual(self.topic.mastery_level, "strong")
        self.assertTrue(
            ReviewRecord.objects.filter(topic=self.topic, exam=exam).exists()
        )

    @patch(
        "api.task_service.AIGateway.generate_briefing",
        side_effect=RuntimeError("模型不可用"),
    )
    def test_failed_task_retries_then_fails(self, _):
        task = AITask.objects.create(
            task_type="briefing",
            topic=self.topic,
            material=self.material,
            status="running",
            attempt_count=1,
            next_run_at=timezone.now(),
        )
        execute_task(task.id)
        task.refresh_from_db()
        self.assertEqual(task.status, "pending")
        self.assertIn("自动重试", task.error_message)

        for attempt in (2, 3):
            task.status = "running"
            task.attempt_count = attempt
            task.save()
            execute_task(task.id)
        task.refresh_from_db()
        self.assertEqual(task.status, "failed")

    def test_retry_and_recovery(self):
        failed = AITask.objects.create(
            task_type="briefing",
            topic=self.topic,
            material=self.material,
            status="failed",
            attempt_count=3,
            next_run_at=timezone.now(),
        )
        response = self.client.post(f"/api/ai-tasks/{failed.id}/retry/", format="json")
        self.assertEqual(response.status_code, 202)
        failed.refresh_from_db()
        self.assertEqual(failed.status, "pending")
        self.assertEqual(failed.attempt_count, 0)

        interrupted = AITask.objects.create(
            task_type="briefing",
            topic=self.topic,
            material=self.material,
            status="running",
            attempt_count=1,
            next_run_at=timezone.now(),
        )
        recover_interrupted_tasks()
        interrupted.refresh_from_db()
        self.assertEqual(interrupted.status, "pending")

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    AIResponse,
    AITask,
    Concept,
    ConceptAnchor,
    Exam,
    Highlight,
    Material,
    MaterialChunk,
    Note,
    Question,
    ReviewRecord,
    Topic,
)
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

    def test_question_anchor_and_save_to_concept(self):
        MaterialChunk.objects.create(
            material=self.material,
            chunk_index=0,
            content=self.material.clean_text,
            start_offset=0,
            end_offset=len(self.material.clean_text),
        )
        concept = Concept.objects.create(topic=self.topic, title="QuerySet")
        start_offset = self.material.clean_text.index("QuerySet")
        end_offset = start_offset + len("QuerySet")

        response = self.client.post(
            "/api/questions/",
            {
                "topic": self.topic.id,
                "material": self.material.id,
                "selected_text": "伪造内容",
                "start_offset": start_offset,
                "end_offset": end_offset,
                "question_text": "为什么可以组合？",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        question = Question.objects.get(pk=response.data["question"]["id"])
        self.assertEqual(question.selected_text, "QuerySet")
        self.assertEqual(question.start_offset, start_offset)
        self.assertEqual(question.end_offset, end_offset)
        self.assertIsNotNone(question.chunk)
        self.assertFalse(question.is_saved)

        save_response = self.client.post(
            f"/api/questions/{question.id}/save/",
            {"concept": concept.id},
            format="json",
        )
        self.assertEqual(save_response.status_code, 200)
        question.refresh_from_db()
        self.assertTrue(question.is_saved)
        self.assertEqual(question.concept_id, concept.id)
        self.assertIsNotNone(question.saved_at)

    def test_topic_type_and_material_source_type_are_exposed(self):
        topic_response = self.client.post(
            "/api/topics/",
            {
                "title": "是否学习向量数据库",
                "type": "discussion",
                "goal": "判断是否值得投入时间。",
            },
            format="json",
        )
        self.assertEqual(topic_response.status_code, 201)
        self.assertEqual(topic_response.data["type"], "discussion")
        self.assertEqual(topic_response.data["type_display"], "讨论")

        material_response = self.client.post(
            "/api/materials/",
            {
                "topic": topic_response.data["id"],
                "type": "text",
                "source_type": "ai_recommended",
                "title": "向量数据库概览",
                "raw_text": "向量数据库用于高维向量相似度检索。",
            },
            format="json",
        )
        self.assertEqual(material_response.status_code, 201)
        self.assertEqual(material_response.data["source_type"], "ai_recommended")
        self.assertEqual(material_response.data["source_type_display"], "AI 推荐")

    @patch("api.task_service.AIGateway.generate_concept_draft")
    def test_concept_draft_worker_persists_anchor_and_allows_confirmation(
        self, generate_concept_draft
    ):
        MaterialChunk.objects.create(
            material=self.material,
            chunk_index=0,
            content=self.material.clean_text,
            start_offset=0,
            end_offset=len(self.material.clean_text),
        )
        start_offset = self.material.clean_text.index("QuerySet")
        end_offset = start_offset + len("QuerySet")
        generate_concept_draft.return_value = {
            "definition": "可组合的查询对象。",
            "principle": "查询条件以惰性方式累积。",
            "pitfalls": "不要误以为每次链式调用都会立即查询数据库。",
            "applications": "用于逐步构建数据库查询。",
        }

        response = self.client.post(
            f"/api/topics/{self.topic.id}/concepts/",
            {
                "title": "QuerySet",
                "material": self.material.id,
                "start_offset": start_offset,
                "end_offset": end_offset,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.data["created"])
        concept = Concept.objects.get(pk=response.data["concept"]["id"])
        self.assertEqual(concept.status, "draft")
        anchor = ConceptAnchor.objects.get(concept=concept)
        self.assertEqual(anchor.source_text, "QuerySet")
        self.assertEqual(anchor.start_offset, start_offset)
        self.assertIsNotNone(anchor.chunk)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.task_type, "concept_draft")
        self.assertEqual(task.concept_id, concept.id)
        task.status = "running"
        task.attempt_count = 1
        task.save()

        execute_task(task.id)

        concept.refresh_from_db()
        self.assertEqual(
            concept.definition, generate_concept_draft.return_value["definition"]
        )
        self.assertEqual(concept.source_task_id, task.id)
        confirm_response = self.client.patch(
            f"/api/concepts/{concept.id}/",
            {"status": "confirmed", "definition": "用户确认后的定义。"},
            format="json",
        )
        self.assertEqual(confirm_response.status_code, 200)
        concept.refresh_from_db()
        self.assertEqual(concept.status, "confirmed")
        self.assertEqual(concept.definition, "用户确认后的定义。")

        repeated_response = self.client.post(
            f"/api/topics/{self.topic.id}/concepts/",
            {
                "title": "QuerySet",
                "material": self.material.id,
                "start_offset": start_offset,
                "end_offset": end_offset,
            },
            format="json",
        )
        self.assertEqual(repeated_response.status_code, 202)
        self.assertFalse(repeated_response.data["created"])
        self.assertEqual(Concept.objects.filter(topic=self.topic).count(), 1)
        self.assertEqual(ConceptAnchor.objects.filter(concept=concept).count(), 1)

    def test_highlight_uses_server_derived_anchor_text(self):
        start_offset = self.material.clean_text.index("Django")
        end_offset = start_offset + len("Django ORM")
        response = self.client.post(
            f"/api/topics/{self.topic.id}/highlights/",
            {
                "material": self.material.id,
                "start_offset": start_offset,
                "end_offset": end_offset,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        highlight = Highlight.objects.get(pk=response.data["highlight"])
        self.assertEqual(highlight.source_text, "Django ORM")
        self.assertEqual(highlight.topic_id, self.topic.id)

        invalid_response = self.client.post(
            f"/api/topics/{self.topic.id}/highlights/",
            {
                "material": self.material.id,
                "start_offset": -1,
                "end_offset": 2,
            },
            format="json",
        )
        self.assertEqual(invalid_response.status_code, 400)

    def test_highlight_can_be_deleted(self):
        highlight = Highlight.objects.create(
            topic=self.topic,
            material=self.material,
            source_text="Django ORM",
            start_offset=0,
            end_offset=10,
        )
        response = self.client.delete(f"/api/highlights/{highlight.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Highlight.objects.filter(pk=highlight.id).exists())

    def test_exam_request_returns_reused_pending_task(self):
        first = self.client.post("/api/exams/", {"topic": self.topic.id}, format="json")
        second = self.client.post(
            "/api/exams/", {"topic": self.topic.id}, format="json"
        )

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.data["task"]["id"], second.data["task"]["id"])

    @patch("api.task_service.AIGateway.generate_note_draft")
    def test_note_draft_worker_and_confirmation(self, generate_note_draft):
        generate_note_draft.return_value = "## 核心结论\nQuerySet 可以组合。"
        response = self.client.post(
            f"/api/topics/{self.topic.id}/note-drafts/", format="json"
        )
        self.assertEqual(response.status_code, 202)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.task_type, "note_draft")
        task.status = "running"
        task.attempt_count = 1
        task.save()

        execute_task(task.id)

        task.refresh_from_db()
        self.assertEqual(task.status, "succeeded")
        self.assertEqual(task.result_json["content"], generate_note_draft.return_value)
        confirm_response = self.client.post(
            "/api/notes/",
            {
                "topic": self.topic.id,
                "title": task.result_json["title"],
                "content": task.result_json["content"],
                "source_task": task.id,
            },
            format="json",
        )
        self.assertEqual(confirm_response.status_code, 201)
        self.assertEqual(Note.objects.count(), 1)
        note = Note.objects.first()
        self.assertEqual(note.source_task_id, task.id)
        self.assertEqual(
            note.material_fingerprint, task.input_json["material_fingerprint"]
        )

        topic_response = self.client.get(f"/api/topics/{self.topic.id}/")
        self.assertTrue(topic_response.data["has_current_note"])
        repeated_response = self.client.post(
            f"/api/topics/{self.topic.id}/note-drafts/", format="json"
        )
        self.assertEqual(repeated_response.status_code, 409)

        updated_note = self.client.patch(
            f"/api/notes/{note.id}/",
            {"content": "补充了适用边界。"},
            format="json",
        )
        self.assertEqual(updated_note.status_code, 200)
        note.refresh_from_db()
        self.assertEqual(note.content, "补充了适用边界。")

        regenerate_response = self.client.post(
            f"/api/topics/{self.topic.id}/note-drafts/",
            {"instructions": "重点说明查询优化。"},
            format="json",
        )
        self.assertEqual(regenerate_response.status_code, 202)
        regeneration_task = AITask.objects.get(
            pk=regenerate_response.data["task"]["id"]
        )
        self.assertEqual(
            regeneration_task.input_json["instructions"], "重点说明查询优化。"
        )
        regeneration_task.status = "running"
        regeneration_task.attempt_count = 1
        regeneration_task.save()
        generate_note_draft.reset_mock()
        execute_task(regeneration_task.id)
        generate_note_draft.assert_called_once_with(
            self.topic.title,
            self.topic.goal,
            regeneration_task.input_json["context"],
            "重点说明查询优化。",
        )
        delete_response = self.client.delete(f"/api/notes/{note.id}/")
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(Note.objects.filter(pk=note.id).exists())

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

    def test_review_list_and_completion(self):
        due_review = ReviewRecord.objects.create(
            topic=self.topic,
            due_at=timezone.now() - timedelta(hours=1),
        )
        future_review = ReviewRecord.objects.create(
            topic=self.topic,
            due_at=timezone.now() + timedelta(days=3),
        )
        ReviewRecord.objects.create(
            topic=self.topic,
            due_at=timezone.now() - timedelta(days=1),
            result="completed",
            completed_at=timezone.now() - timedelta(hours=2),
        )

        response = self.client.get("/api/reviews/?result=pending")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.data], [due_review.id, future_review.id]
        )
        self.assertEqual(response.data[0]["topic_title"], self.topic.title)

        complete_response = self.client.post(
            f"/api/reviews/{due_review.id}/complete/", format="json"
        )

        self.assertEqual(complete_response.status_code, 200)
        due_review.refresh_from_db()
        self.assertEqual(due_review.result, "completed")
        self.assertIsNotNone(due_review.completed_at)

        repeated_response = self.client.post(
            f"/api/reviews/{due_review.id}/complete/", format="json"
        )
        self.assertEqual(repeated_response.status_code, 400)

    @patch("api.task_service.AIGateway.generate_review_prompt")
    def test_review_prompt_worker_persists_prompt(self, generate_review_prompt):
        generate_review_prompt.return_value = (
            "## 主动回忆\n\n1. QuerySet 为什么可以组合？"
        )
        review = ReviewRecord.objects.create(
            topic=self.topic,
            due_at=timezone.now(),
        )

        response = self.client.post(f"/api/reviews/{review.id}/prompt/", format="json")

        self.assertEqual(response.status_code, 202)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.task_type, "review_prompt")
        self.assertEqual(task.review_id, review.id)
        task.status = "running"
        task.attempt_count = 1
        task.save()

        execute_task(task.id)

        task.refresh_from_db()
        review.refresh_from_db()
        self.assertEqual(task.status, "succeeded")
        self.assertEqual(review.review_prompt, generate_review_prompt.return_value)
        self.assertIsNotNone(review.review_prompt_generated_at)

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

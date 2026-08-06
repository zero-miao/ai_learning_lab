import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    AITask,
    Concept,
    Highlight,
    Material,
    MaterialChunk,
    MaterialTextLocator,
    Question,
    ReviewRecord,
    Session,
    Topic,
    TopicMaterial,
)
from .task_service import enqueue_or_reuse
from .tasks import TaskRegistry, _create_material_chunks


class V2ErApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.topic = Topic.objects.create(title="Django ORM")
        self.material = Material.objects.create(
            title="ORM 基础",
            media_type="text",
            raw_text="Django ORM 通过 QuerySet 表达数据库查询。",
            clean_text="Django ORM 通过 QuerySet 表达数据库查询。",
            status="ready",
        )
        TopicMaterial.objects.create(topic=self.topic, material=self.material)
        self.chunk = MaterialChunk.objects.create(
            material=self.material,
            chunk_index=0,
            content=self.material.clean_text,
            start_offset=0,
            end_offset=len(self.material.clean_text),
        )

    def test_annotation_uses_locator_without_legacy_anchor_tables(self):
        start = self.material.clean_text.index("QuerySet")
        response = self.client.post(
            f"/api/topics/{self.topic.id}/concepts/",
            {
                "title": "QuerySet",
                "material": self.material.id,
                "start_offset": start,
                "end_offset": start + len("QuerySet"),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        concept = Concept.objects.get(pk=response.data["concept"]["id"])
        locator = MaterialTextLocator.objects.get(
            entity_type="concept", entity_id=concept.id
        )
        self.assertEqual(locator.material_id, self.material.id)
        self.assertEqual(locator.topic_id, self.topic.id)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.trigger_type, "Concept")
        self.assertEqual(task.trigger_id, concept.id)

    def test_question_uses_session_and_locator(self):
        response = self.client.post(
            "/api/questions/",
            {
                "topic": self.topic.id,
                "material": self.material.id,
                "start_offset": 0,
                "end_offset": 10,
                "question_text": "QuerySet 为什么可组合？",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        question = Question.objects.get(pk=response.data["question"]["id"])
        self.assertIsInstance(question.session, Session)
        self.assertTrue(
            MaterialTextLocator.objects.filter(
                entity_type="question", entity_id=question.id
            ).exists()
        )

    def test_highlight_and_topic_material_soft_removal(self):
        response = self.client.post(
            f"/api/topics/{self.topic.id}/highlights/",
            {
                "material": self.material.id,
                "start_offset": 0,
                "end_offset": 10,
                "user_note": "重点",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        highlight = Highlight.objects.get(pk=response.data["id"])
        self.assertTrue(
            MaterialTextLocator.objects.filter(
                entity_type="highlight", entity_id=highlight.id
            ).exists()
        )
        relation = TopicMaterial.objects.get(topic=self.topic, material=self.material)
        delete_response = self.client.delete(f"/api/topic-materials/{relation.id}/")
        self.assertEqual(delete_response.status_code, 204)
        relation.refresh_from_db()
        self.assertIsNotNone(relation.removed_at)

    @patch("api.views.default_storage.save", return_value="materials/video.mp4")
    def test_video_upload_uses_global_material_and_task_trigger(self, save):
        response = self.client.post(
            "/api/materials/upload-video/",
            {
                "topic": self.topic.id,
                "title": "Django 课程",
                "video": SimpleUploadedFile("course.mp4", b"video", "video/mp4"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 202)
        material = Material.objects.get(pk=response.data["material"]["id"])
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(material.media_type, "video")
        self.assertEqual(task.trigger_type, "Material")
        self.assertEqual(task.trigger_id, material.id)
        save.assert_called_once()

    @patch(
        "api.views.default_storage.save",
        side_effect=["materials/video.mp4", "materials/subtitle.srt"],
    )
    def test_video_upload_accepts_optional_subtitle(self, save):
        response = self.client.post(
            "/api/materials/upload-video/",
            {
                "topic": self.topic.id,
                "video": SimpleUploadedFile("course.mp4", b"video", "video/mp4"),
                "subtitle": SimpleUploadedFile(
                    "course.srt", b"1\n00:00:00,000 --> 00:00:01,000\nhello\n"
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 202)
        material = Material.objects.get(pk=response.data["material"]["id"])
        self.assertEqual(material.media_meta["subtitle_uri"], "materials/subtitle.srt")
        self.assertEqual(save.call_count, 2)

    def test_media_url_uses_api_host_for_video(self):
        video = Material.objects.create(
            title="视频",
            media_type="video",
            media_uri="materials/video.mp4",
            status="ready",
        )
        TopicMaterial.objects.create(topic=self.topic, material=video)

        response = self.client.get(f"/api/topics/{self.topic.id}/")
        serialized = next(
            item["material"]
            for item in response.data["topic_materials"]
            if item["material_id"] == video.id
        )
        self.assertEqual(
            serialized["media_url"], "http://testserver/media/materials/video.mp4"
        )

    def test_media_range_request_returns_partial_content(self):
        with TemporaryDirectory() as media_root:
            media_path = Path(media_root) / "materials" / "video.mp4"
            media_path.parent.mkdir()
            media_path.write_bytes(b"0123456789")

            with self.settings(MEDIA_ROOT=media_root):
                response = self.client.get(
                    "/media/materials/video.mp4",
                    HTTP_RANGE="bytes=2-5",
                )
                content = b"".join(response.streaming_content)

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        self.assertEqual(response["Content-Range"], "bytes 2-5/10")
        self.assertEqual(response["Content-Length"], "4")
        self.assertEqual(content, b"2345")

    def test_video_chunks_align_merged_paragraphs_to_asr_timestamps(self):
        video = Material.objects.create(
            title="视频",
            media_type="video",
            clean_text="Alpha beta\n\nGamma",
            media_meta={
                "segments": [
                    {"start": 0.0, "end": 1.0, "text": "alpha"},
                    {"start": 1.0, "end": 2.0, "text": "beta"},
                    {"start": 2.0, "end": 3.0, "text": "gamma"},
                ]
            },
        )

        _create_material_chunks(video)

        chunks = list(video.chunks.order_by("chunk_index"))
        self.assertEqual(len(chunks), 2)
        self.assertEqual((chunks[0].start_time, chunks[0].end_time), (0.0, 2.0))
        self.assertEqual((chunks[1].start_time, chunks[1].end_time), (2.0, 3.0))

    def test_topic_supplement_creates_explicit_topic_task(self):
        response = self.client.post(
            f"/api/topics/{self.topic.id}/supplement/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.task_type, "supplement_search")
        self.assertEqual(task.trigger_type, "Topic")
        self.assertEqual(task.trigger_id, self.topic.id)
        self.assertEqual(task.task_data["topic_id"], self.topic.id)

    @patch("api.tasks.BaseTask._call_llm")
    @patch("api.supplement_service.crawl")
    @patch("api.supplement_service.search")
    def test_supplement_imports_qualified_candidate(
        self, search, crawl, call_llm
    ):
        # Mocking the two LLM calls: generate_queries and evaluate_supplement
        call_llm.side_effect = [
            json.dumps({"queries": ["Django ORM QuerySet"]}),  # generate_queries
            json.dumps({                                       # evaluate_supplement
                "relevance_score": 0.92,
                "category": "exam_material",
                "import_reason": "直接解释 QuerySet 的查询与惰性求值。",
            })
        ]
        search.return_value = [
            {
                "title": "QuerySet 指南",
                "url": "https://example.com/queryset",
                "snippet": "",
                "engine": "test",
            }
        ]
        crawl.return_value = "Django ORM QuerySet " * 50
        
        task, _ = enqueue_or_reuse(
            "supplement_search",
            trigger_type="Topic",
            trigger_id=self.topic.id,
            task_data={"topic_id": self.topic.id, "relevance_threshold": 0.8},
        )

        task_cls = TaskRegistry.get_task_class(task.task_type)
        task_obj = task_cls(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model
        )
        result = task_obj.run()

        self.assertEqual(result["imported_count"], 1)
        relation = TopicMaterial.objects.get(
            topic=self.topic, material_id=result["imported_material_ids"][0]
        )
        self.assertEqual(relation.import_by, "ai_recommended")
        self.assertEqual(relation.category, "exam_material")
        self.assertEqual(relation.relevance_score, 0.92)
        self.assertTrue(relation.material.chunks.exists())

    @patch("api.tasks.BaseTask._call_llm")
    @patch("api.supplement_service.crawl")
    @patch("api.supplement_service.search")
    def test_supplement_filters_low_relevance_candidate(
        self, search, crawl, call_llm
    ):
        # Mocking the two LLM calls
        call_llm.side_effect = [
            json.dumps({"queries": ["Django ORM QuerySet"]}),  # generate_queries
            json.dumps({                                       # evaluate_supplement
                "relevance_score": 0.2,
                "category": "recommended_reading",
                "import_reason": "无关。",
            })
        ]
        search.return_value = [
            {
                "title": "无关内容",
                "url": "https://example.com/unrelated",
                "snippet": "",
                "engine": "test",
            }
        ]
        crawl.return_value = "无关内容 " * 100
        
        task, _ = enqueue_or_reuse(
            "supplement_search",
            trigger_type="Topic",
            trigger_id=self.topic.id,
            task_data={"topic_id": self.topic.id, "relevance_threshold": 0.8},
        )

        task_cls = TaskRegistry.get_task_class(task.task_type)
        task_obj = task_cls(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model
        )
        result = task_obj.run()

        self.assertEqual(result["imported_count"], 0)
        self.assertEqual(result["candidates"][0]["reason"], "相关度低于阈值")

    def test_task_reuse_is_scoped_to_trigger(self):
        first, created = enqueue_or_reuse(
            "briefing", trigger_type="Material", trigger_id=self.material.id
        )
        second, reused = enqueue_or_reuse(
            "briefing", trigger_type="Material", trigger_id=self.material.id
        )
        self.assertTrue(created)
        self.assertFalse(reused)
        self.assertEqual(first.id, second.id)

    def test_exam_generation_uses_topic_trigger(self):
        response = self.client.post(
            "/api/exams/", {"topic": self.topic.id}, format="json"
        )
        self.assertEqual(response.status_code, 202)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.task_type, "generate_exam")
        self.assertEqual(task.trigger_type, "Topic")
        self.assertEqual(task.trigger_id, self.topic.id)

    def test_review_prompt_uses_review_record_trigger(self):
        review = ReviewRecord.objects.create(
            topic=self.topic, due_at="2026-08-05T00:00:00Z"
        )
        response = self.client.post(f"/api/reviews/{review.id}/prompt/", format="json")
        self.assertEqual(response.status_code, 202)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.task_type, "review_prompt")
        self.assertEqual(task.trigger_type, "ReviewRecord")
        self.assertEqual(task.trigger_id, review.id)

    def test_edge_tts_allows_partial_voice_success(self):
        class FakeCommunicate:
            def __init__(self, text, voice):
                self.text = text
                self.voice = voice

            def save_sync(self, path):
                if self.voice == "zh-CN-YunxiNeural":
                    raise RuntimeError("voice unavailable")
                Path(path).write_bytes(b"fake mp3")

        task, _ = enqueue_or_reuse(
            "edge_tts",
            trigger_type="Material",
            trigger_id=self.material.id,
            model="edge-tts",
        )
        task_cls = TaskRegistry.get_task_class(task.task_type)
        task_obj = task_cls(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model,
        )

        with (
            TemporaryDirectory() as media_root,
            self.settings(MEDIA_ROOT=media_root),
            patch(
                "api.tts_service.configured_voices",
                return_value=(
                    ("zh-CN-XiaoxiaoNeural", "晓晓"),
                    ("zh-CN-YunxiNeural", "云希"),
                ),
            ),
            patch("api.tts_service.edge_tts.Communicate", FakeCommunicate),
        ):
            result = task_obj.run()

        self.material.refresh_from_db()
        voices = self.material.media_meta["tts"]["voices"]
        self.assertEqual(result["successful"], 1)
        self.assertEqual(self.material.status, "ready")
        self.assertEqual(voices["zh-CN-XiaoxiaoNeural"]["status"], "ready")
        self.assertEqual(voices["zh-CN-YunxiNeural"]["status"], "failed")

    def test_briefing_with_digest_queues_edge_tts(self):
        self.material.digest = "已有摘要"
        self.material.save(update_fields=["digest"])
        task, _ = enqueue_or_reuse(
            "briefing",
            trigger_type="Material",
            trigger_id=self.material.id,
        )
        task_cls = TaskRegistry.get_task_class(task.task_type)
        result = task_cls(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model,
        ).run()

        self.material.refresh_from_db()
        self.assertTrue(result["skipped"])
        self.assertEqual(self.material.status, "generating_audio")
        self.assertTrue(
            AITask.objects.filter(
                task_type="edge_tts",
                trigger_type="Material",
                trigger_id=self.material.id,
            ).exists()
        )

    def test_backfill_tts_queues_existing_material(self):
        call_command("backfill_tts")
        self.material.refresh_from_db()
        self.assertEqual(self.material.status, "generating_audio")
        self.assertTrue(
            AITask.objects.filter(
                task_type="edge_tts",
                trigger_type="Material",
                trigger_id=self.material.id,
            ).exists()
        )

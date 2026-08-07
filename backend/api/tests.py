import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from .ai_gateway import AIGateway
from .models import (
    AITask,
    Concept,
    Highlight,
    Material,
    MaterialChunk,
    MaterialRecommendation,
    MaterialTextLocator,
    Question,
    ReviewRecord,
    Session,
    SessionMessage,
    SystemConfiguration,
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

    def test_system_configuration_persists_and_controls_runtime_models(self):
        response = self.client.get("/api/system-configuration/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(SystemConfiguration.objects.filter(singleton_id=1).exists())

        payload = dict(response.data)
        payload.update(
            {
                "llm_model": "default-model",
                "llm_model_answer_question": "question-model",
                "supplement_relevance_threshold": 0.65,
                "default_site_theme": "midnight",
                "default_reader_font": "song",
                "api_timeout_ms": 15000,
            }
        )
        update_response = self.client.put(
            "/api/system-configuration/", payload, format="json"
        )

        self.assertEqual(update_response.status_code, 200)
        configuration = SystemConfiguration.load()
        self.assertEqual(configuration.default_site_theme, "midnight")
        self.assertEqual(configuration.default_reader_font, "song")
        self.assertEqual(configuration.supplement_relevance_threshold, 0.65)
        self.assertEqual(
            AIGateway.get_model_for_task("answer_question"), "question-model"
        )
        self.assertEqual(AIGateway.get_model_for_task("process"), "default-model")

    def test_system_configuration_rejects_invalid_threshold(self):
        response = self.client.get("/api/system-configuration/")
        payload = dict(response.data)
        payload["supplement_relevance_threshold"] = 1.5

        update_response = self.client.put(
            "/api/system-configuration/", payload, format="json"
        )

        self.assertEqual(update_response.status_code, 400)

    @patch("api.ai_gateway.OpenAI")
    def test_system_configuration_discovers_provider_models(self, openai):
        openai.return_value.models.list.return_value.data = [
            SimpleNamespace(id="qwen3:30b-a3b"),
            SimpleNamespace(id="qwen3.6:35b-a3b"),
            SimpleNamespace(id="qwen3:30b-a3b"),
        ]

        response = self.client.post(
            "/api/system-configuration/models/",
            {
                "llm_provider_type": "ollama",
                "llm_base_url": "http://localhost:11434/v1",
                "llm_api_key": "ollama",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["models"],
            ["qwen3.6:35b-a3b", "qwen3:30b-a3b"],
        )
        openai.assert_called_once_with(
            api_key="ollama",
            base_url="http://localhost:11434/v1",
            max_retries=0,
            timeout=10.0,
        )

    def test_model_discovery_requires_key_for_openai_provider(self):
        response = self.client.post(
            "/api/system-configuration/models/",
            {
                "llm_provider_type": "openai",
                "llm_base_url": "https://api.openai.com/v1",
                "llm_api_key": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

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
        message = question.session.messages.get(msg_from="user")
        self.assertEqual(message.msg_content, question.question_text)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        self.assertEqual(task.trigger_type, "SessionMessage")
        self.assertEqual(task.trigger_id, message.id)
        self.assertEqual(task.task_data, {"question_id": question.id})

    @patch("api.tasks.BaseTask._call_llm")
    def test_reading_question_uses_selection_and_session_history(self, call_llm):
        call_llm.side_effect = ["QuerySet 支持链式组合。", "因为查询在求值前不会执行。"]
        response = self.client.post(
            "/api/questions/",
            {
                "topic": self.topic.id,
                "material": self.material.id,
                "start_offset": 14,
                "end_offset": 22,
                "question_text": "为什么可以组合？",
            },
            format="json",
        )
        question = Question.objects.get(pk=response.data["question"]["id"])
        first_task = AITask.objects.get(pk=response.data["task"]["id"])
        TaskRegistry.get_task_class(first_task.task_type)(
            task_id=first_task.id,
            task_data=first_task.task_data,
            trigger_type=first_task.trigger_type,
            trigger_id=first_task.trigger_id,
            model=first_task.model,
        ).run()

        follow_up = self.client.post(
            f"/api/sessions/{question.session_id}/messages/",
            {"content": "为什么要等到求值时？"},
            format="json",
        )
        self.assertEqual(follow_up.status_code, 202)
        follow_up_task = AITask.objects.get(pk=follow_up.data["task"]["id"])
        self.assertEqual(follow_up_task.trigger_type, "SessionMessage")
        self.assertNotEqual(follow_up_task.trigger_id, first_task.trigger_id)
        TaskRegistry.get_task_class(follow_up_task.task_type)(
            task_id=follow_up_task.id,
            task_data=follow_up_task.task_data,
            trigger_type=follow_up_task.trigger_type,
            trigger_id=follow_up_task.trigger_id,
            model=follow_up_task.model,
        ).run()

        messages = call_llm.call_args.args[0]
        self.assertIn("QuerySet", messages[0]["content"])
        self.assertEqual(
            [message["content"] for message in messages[1:]],
            [
                "为什么可以组合？",
                "QuerySet 支持链式组合。",
                "为什么要等到求值时？",
            ],
        )
        question.refresh_from_db()
        self.assertEqual(question.conclusion, "因为查询在求值前不会执行。")
        self.assertEqual(
            list(question.session.messages.values_list("msg_from", "msg_content")),
            [
                ("user", "为什么可以组合？"),
                ("ai", "QuerySet 支持链式组合。"),
                ("user", "为什么要等到求值时？"),
                ("ai", "因为查询在求值前不会执行。"),
            ],
        )

    def test_delete_topic_removes_discussion_session_and_related_tasks(self):
        discussion = self.client.get(f"/api/topics/{self.topic.id}/discussion/")
        session_id = discussion.data["topic"]["session"]
        discussion_response = self.client.post(
            f"/api/topics/{self.topic.id}/discussion/",
            {"content": "还缺什么材料？"},
            format="json",
        )
        discussion_task_id = discussion_response.data["task"]["id"]
        supplement_task, _ = enqueue_or_reuse(
            "supplement_search",
            trigger_type="Topic",
            trigger_id=self.topic.id,
            task_data={"topic_id": self.topic.id},
        )

        question_response = self.client.post(
            "/api/questions/",
            {
                "topic": self.topic.id,
                "material": self.material.id,
                "start_offset": 0,
                "end_offset": 10,
                "question_text": "什么是 ORM？",
            },
            format="json",
        )
        question_task_id = question_response.data["task"]["id"]
        other_topic = Topic.objects.create(title="保留的话题")
        other_task, _ = enqueue_or_reuse(
            "supplement_search",
            trigger_type="Topic",
            trigger_id=other_topic.id,
            task_data={"topic_id": other_topic.id},
        )

        response = self.client.delete(f"/api/topics/{self.topic.id}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Session.objects.filter(pk=session_id).exists())
        self.assertFalse(SessionMessage.objects.filter(session_id=session_id).exists())
        self.assertFalse(
            AITask.objects.filter(
                id__in=[discussion_task_id, supplement_task.id, question_task_id]
            ).exists()
        )
        self.assertTrue(AITask.objects.filter(pk=other_task.id).exists())
        self.assertTrue(Material.objects.filter(pk=self.material.id).exists())

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

    def test_global_material_can_be_linked_and_restored_to_topic(self):
        other_topic = Topic.objects.create(title="另一个话题")
        response = self.client.post(
            "/api/topic-materials/",
            {"topic": other_topic.id, "material": self.material.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        relation = TopicMaterial.objects.get(topic=other_topic, material=self.material)
        self.assertEqual(relation.import_by, "manual")

        relation.removed_at = "2026-08-07T00:00:00Z"
        relation.save(update_fields=["removed_at"])
        restore_response = self.client.post(
            "/api/topic-materials/",
            {"topic": other_topic.id, "material": self.material.id},
            format="json",
        )
        self.assertEqual(restore_response.status_code, 200)
        relation.refresh_from_db()
        self.assertIsNone(relation.removed_at)

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

    def test_delete_material_removes_media_subtitle_and_tts_files(self):
        self.material.media_type = "video"
        self.material.media_uri = "materials/source.mp4"
        self.material.media_meta = {
            "subtitle_uri": "materials/source.srt",
            "tts": {
                "voices": {
                    "voice": {
                        "path": f"materials/tts/{self.material.id}/voice.mp3",
                        "status": "ready",
                    }
                }
            },
        }
        self.material.save(update_fields=["media_type", "media_uri", "media_meta"])
        task, _ = enqueue_or_reuse(
            "edge_tts",
            trigger_type="Material",
            trigger_id=self.material.id,
            model="edge-tts",
        )

        with TemporaryDirectory() as media_root, self.settings(MEDIA_ROOT=media_root):
            paths = [
                Path(media_root) / "materials" / "source.mp4",
                Path(media_root) / "materials" / "source.srt",
                Path(media_root)
                / "materials"
                / "tts"
                / str(self.material.id)
                / "voice.mp3",
            ]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"data")

            response = self.client.delete(f"/api/materials/{self.material.id}/")

            self.assertEqual(response.status_code, 204)
            self.assertTrue(all(not path.exists() for path in paths))
            self.assertFalse(
                (
                    Path(media_root) / "materials" / "tts" / str(self.material.id)
                ).exists()
            )

        task.refresh_from_db()
        self.assertEqual(task.status, "cancelled")

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
    def test_supplement_creates_candidate_for_manual_adoption(
        self, search, crawl, call_llm
    ):
        # Mocking the two LLM calls: generate_queries and evaluate_supplement
        call_llm.side_effect = [
            json.dumps({"queries": ["Django ORM QuerySet"]}),  # generate_queries
            json.dumps(
                {  # evaluate_supplement
                    "relevance_score": 0.92,
                    "category": "exam_material",
                    "import_reason": "直接解释 QuerySet 的查询与惰性求值。",
                }
            ),
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
            model=task.model,
        )
        result = task_obj.run()

        self.assertEqual(result["recommended_count"], 1)
        recommendation = MaterialRecommendation.objects.get(
            pk=result["recommendation_ids"][0]
        )
        self.assertEqual(recommendation.status, "pending")
        self.assertFalse(
            TopicMaterial.objects.filter(
                topic=self.topic, material__media_uri=recommendation.url
            ).exists()
        )

        response = self.client.post(
            f"/api/material-recommendations/{recommendation.id}/adopt/"
        )

        self.assertEqual(response.status_code, 200)
        recommendation.refresh_from_db()
        relation = TopicMaterial.objects.get(
            topic=self.topic, material=recommendation.material
        )
        self.assertEqual(recommendation.status, "adopted")
        self.assertEqual(relation.import_by, "ai_recommended")
        self.assertEqual(relation.category, "exam_material")
        self.assertEqual(relation.relevance_score, 0.92)
        self.assertTrue(
            AITask.objects.filter(
                task_type="clean_text",
                trigger_type="Material",
                trigger_id=relation.material_id,
            ).exists()
        )

    @patch("api.tasks.BaseTask._call_llm")
    @patch("api.supplement_service.crawl")
    @patch("api.supplement_service.search")
    def test_supplement_filters_low_relevance_candidate(self, search, crawl, call_llm):
        # Mocking the two LLM calls
        call_llm.side_effect = [
            json.dumps({"queries": ["Django ORM QuerySet"]}),  # generate_queries
            json.dumps(
                {  # evaluate_supplement
                    "relevance_score": 0.2,
                    "category": "recommended_reading",
                    "import_reason": "无关。",
                }
            ),
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
            model=task.model,
        )
        result = task_obj.run()

        self.assertEqual(result["recommended_count"], 0)
        self.assertEqual(result["candidates"][0]["reason"], "相关度低于阈值")

    @patch("api.tasks.BaseTask._call_llm")
    def test_topic_discussion_uses_topic_context_and_queues_material_search(
        self, call_llm
    ):
        call_llm.return_value = json.dumps(
            {
                "reply": "现有材料没有覆盖事务边界，建议补一份资料。",
                "material_search": {
                    "queries": ["Django transaction atomic 事务边界"],
                    "reason": "当前材料只覆盖 QuerySet。",
                },
            }
        )
        response = self.client.post(
            f"/api/topics/{self.topic.id}/discussion/",
            {"content": "事务部分还需要补什么？"},
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        task = AITask.objects.get(pk=response.data["task"]["id"])
        result = TaskRegistry.get_task_class(task.task_type)(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model,
        ).run()

        self.assertIn("Django ORM", call_llm.call_args.args[0][1]["content"])
        self.assertIsNotNone(result["supplement_task_id"])
        supplement_task = AITask.objects.get(pk=result["supplement_task_id"])
        self.assertEqual(
            supplement_task.task_data["suggested_queries"],
            ["Django transaction atomic 事务边界"],
        )

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

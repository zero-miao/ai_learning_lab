import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.utils import timezone
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
    UserFeedback,
)
from .task_service import claim_due_task, enqueue_or_reuse, execute_task
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
                "supplement_relevance_threshold": 0.9,
                "supplement_excluded_domains": "wikipedia.org, example.test",
                "default_site_theme": "midnight",
                "default_reader_font": "song",
                "default_tts_voice": "zh-CN-YunxiNeural",
                "default_speech_rate": 1.5,
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
        self.assertEqual(configuration.supplement_relevance_threshold, 0.9)
        self.assertEqual(
            configuration.supplement_excluded_domains,
            "wikipedia.org,example.test",
        )
        self.assertEqual(configuration.default_tts_voice, "zh-CN-YunxiNeural")
        self.assertEqual(configuration.default_speech_rate, 1.5)
        self.assertEqual(
            AIGateway.get_model_for_task("answer_question"), "question-model"
        )
        self.assertEqual(AIGateway.get_model_for_task("process"), "default-model")

    def test_system_configuration_rejects_invalid_threshold(self):
        response = self.client.get("/api/system-configuration/")
        payload = dict(response.data)
        payload["supplement_relevance_threshold"] = 0.8

        update_response = self.client.put(
            "/api/system-configuration/", payload, format="json"
        )

        self.assertEqual(update_response.status_code, 400)

    def test_current_reading_preferences_update_independently(self):
        configuration = SystemConfiguration.load()
        original_model = configuration.llm_model

        response = self.client.patch(
            "/api/system-configuration/preferences/",
            {
                "current_site_theme": "midnight",
                "current_reader_font": "kai",
                "current_tts_voice": "zh-CN-YunxiNeural",
                "current_speech_rate": 1.75,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        configuration.refresh_from_db()
        self.assertEqual(configuration.current_site_theme, "midnight")
        self.assertEqual(configuration.current_reader_font, "kai")
        self.assertEqual(configuration.current_tts_voice, "zh-CN-YunxiNeural")
        self.assertEqual(configuration.current_speech_rate, 1.75)
        self.assertEqual(configuration.llm_model, original_model)

        invalid_response = self.client.patch(
            "/api/system-configuration/preferences/",
            {"current_speech_rate": 4},
            format="json",
        )
        self.assertEqual(invalid_response.status_code, 400)

    @patch("api.tasks.AIGateway.get_provider")
    def test_management_assistant_lists_topic_learning_scopes(self, get_provider):
        self.topic.goal = "能够设计可靠的数据访问层"
        self.topic.scope = "QuerySet、事务与性能分析"
        self.topic.save()
        get_provider.return_value.generate_response.return_value = json.dumps(
            {
                "reply": "以下是全部话题。",
                "action": "list_topics",
                "topic_draft": None,
            }
        )

        response = self.client.post(
            "/api/assistant/messages/",
            {"content": "列出所有 topic 的学习范围"},
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        execute_task(response.data["task"]["id"])

        detail = self.client.get("/api/assistant/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(
            detail.data["session"]["session_scene"], "management_assistant"
        )
        reply = detail.data["session"]["messages"][-1]["msg_content"]
        self.assertIn("| 话题 | 学习目标 | 学习范围 |", reply)
        self.assertIn("QuerySet、事务与性能分析", reply)
        self.assertEqual(detail.data["tasks"][0]["status"], "succeeded")

    @patch("api.tasks.AIGateway.get_provider")
    def test_management_assistant_confirms_topic_draft_idempotently(self, get_provider):
        get_provider.return_value.generate_response.return_value = json.dumps(
            {
                "reply": "已整理草稿，请确认。",
                "action": "draft_topic",
                "topic_draft": {
                    "title": "Go 并发模型",
                    "goal": "能够设计可取消的并发任务",
                    "scope": "goroutine、channel、context",
                },
            }
        )
        response = self.client.post(
            "/api/assistant/messages/",
            {"content": "创建 Go 并发模型话题"},
            format="json",
        )
        task_id = response.data["task"]["id"]
        execute_task(task_id)

        first = self.client.post(
            "/api/assistant/topics/confirm/",
            {"task_id": task_id},
            format="json",
        )
        second = self.client.post(
            "/api/assistant/topics/confirm/",
            {"task_id": task_id},
            format="json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["topic"]["id"], second.data["topic"]["id"])
        self.assertEqual(Topic.objects.filter(title="Go 并发模型").count(), 1)
        created = Topic.objects.get(title="Go 并发模型")
        self.assertEqual(created.goal, "能够设计可取消的并发任务")
        self.assertEqual(created.scope, "goroutine、channel、context")

    @patch("api.tasks.AIGateway.get_provider")
    def test_management_assistant_applies_valid_batch_changes_and_keeps_blocked_items(
        self, get_provider
    ):
        get_provider.return_value.generate_response.return_value = json.dumps(
            {
                "reply": "已识别批量变更。",
                "action": "manage_topics",
                "topic_draft": None,
                "topic_changes": [
                    {
                        "operation": "update",
                        "topic_id": self.topic.id,
                        "title": "Django 数据访问",
                        "goal": None,
                        "scope": "《QuerySet》；《事务》；《查询优化》",
                    },
                    {
                        "operation": "create",
                        "topic_id": None,
                        "title": "Go 并发模型",
                        "goal": "设计可取消的并发任务",
                        "scope": "goroutine、channel、context",
                    },
                    {
                        "operation": "create",
                        "topic_id": None,
                        "title": "工程生产应用",
                        "goal": "",
                        "scope": "TOC 与精益生产",
                    },
                ],
            }
        )
        response = self.client.post(
            "/api/assistant/messages/",
            {
                "content": (
                    "批量更新并创建这些话题\n"
                    "Django 数据访问\n"
                    "《QuerySet》\n"
                    "《事务》\n"
                    "《查询优化》"
                )
            },
            format="json",
        )
        task_id = response.data["task"]["id"]
        execute_task(task_id)
        task = AITask.objects.get(pk=task_id)
        plan = task.result_json["plan"]

        self.assertEqual(len(plan["updates"]), 1)
        self.assertEqual(len(plan["creates"]), 1)
        self.assertEqual(len(plan["blocked"]), 1)
        self.assertEqual(plan["blocked"][0]["missing_fields"], ["goal"])

        first = self.client.post(
            "/api/assistant/topics/confirm/",
            {"task_id": task_id},
            format="json",
        )
        second = self.client.post(
            "/api/assistant/topics/confirm/",
            {"task_id": task_id},
            format="json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["updated_count"], 1)
        self.assertEqual(first.data["created_count"], 1)
        self.topic.refresh_from_db()
        self.assertEqual(self.topic.title, "Django 数据访问")
        self.assertEqual(self.topic.scope, "《QuerySet》\n《事务》\n《查询优化》")
        self.assertTrue(Topic.objects.filter(title="Go 并发模型").exists())
        self.assertFalse(Topic.objects.filter(title="工程生产应用").exists())

    @patch("api.tasks.AIGateway.get_provider")
    def test_management_assistant_rejects_stale_batch_update(self, get_provider):
        get_provider.return_value.generate_response.return_value = json.dumps(
            {
                "reply": "已识别更新。",
                "action": "manage_topics",
                "topic_changes": [
                    {
                        "operation": "update",
                        "topic_id": self.topic.id,
                        "title": None,
                        "goal": "新的学习目标",
                        "scope": None,
                    }
                ],
            }
        )
        response = self.client.post(
            "/api/assistant/messages/",
            {"content": "更新学习目标"},
            format="json",
        )
        task_id = response.data["task"]["id"]
        execute_task(task_id)
        self.topic.goal = "其他页面刚刚保存的目标"
        self.topic.save(update_fields=["goal", "updated_at"])

        confirm = self.client.post(
            "/api/assistant/topics/confirm/",
            {"task_id": task_id},
            format="json",
        )

        self.assertEqual(confirm.status_code, 409)
        self.topic.refresh_from_db()
        self.assertEqual(self.topic.goal, "其他页面刚刚保存的目标")

    def test_feedback_records_page_context_and_supports_filters(self):
        response = self.client.post(
            "/api/feedback/",
            {
                "category": "usability",
                "feature": "material_reader",
                "description": " 阅读页保存高亮后发生跳动。 ",
                "page_url": "http://192.168.1.10:5173/topics/1/materials/1",
                "page_title": "AI Learning Lab",
                "user_agent": "Mobile Browser",
                "context": {"viewport": {"width": 390, "height": 844}},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        feedback = UserFeedback.objects.get()
        self.assertEqual(feedback.description, "阅读页保存高亮后发生跳动。")
        self.assertEqual(feedback.feature, "material_reader")
        self.assertEqual(feedback.status, "new")
        self.assertEqual(response.data["feature_display"], "学习阅读")
        self.assertEqual(response.data["status_display"], "待处理")
        filtered = self.client.get(
            "/api/feedback/",
            {
                "status": "new",
                "category": "usability",
                "feature": "material_reader",
            },
        )
        self.assertEqual(filtered.data["count"], 1)
        blank = self.client.post(
            "/api/feedback/",
            {"category": "bug", "description": "  "},
            format="json",
        )
        self.assertEqual(blank.status_code, 400)

    def test_topic_list_returns_summary_without_nested_business_data(self):
        Topic.objects.bulk_create(
            [Topic(title=f"Python {index}") for index in range(25)]
        )

        with self.assertNumQueries(2):
            response = self.client.get("/api/topics/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 26)
        self.assertEqual(len(response.data["results"]), 20)
        self.assertIsNotNone(response.data["next"])
        filtered_response = self.client.get("/api/topics/", {"q": "Django ORM"})
        self.assertEqual(filtered_response.data["count"], 1)
        serialized = filtered_response.data["results"][0]
        self.assertEqual(
            set(serialized),
            {
                "id",
                "title",
                "goal",
                "is_pinned",
                "status",
                "status_display",
                "mastery_level",
                "mastery_level_display",
                "material_count",
                "created_at",
                "updated_at",
            },
        )
        self.assertEqual(serialized["material_count"], 1)

    def test_topic_pin_is_persisted_and_pinned_topics_sort_first(self):
        pinned = Topic.objects.create(title="置顶话题", is_pinned=True)
        Topic.objects.create(title="更新但未置顶的话题")

        response = self.client.get("/api/topics/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["id"], pinned.id)
        self.assertTrue(response.data["results"][0]["is_pinned"])

        unpin = self.client.patch(
            f"/api/topics/{pinned.id}/",
            {"is_pinned": False},
            format="json",
        )
        self.assertEqual(unpin.status_code, 200)
        self.assertFalse(unpin.data["is_pinned"])
        pinned.refresh_from_db()
        self.assertFalse(pinned.is_pinned)

    def test_material_list_returns_summary_and_searches_server_side(self):
        self.material.digest = "QuerySet 查询摘要"
        self.material.media_meta = {"tts": {"voices": {}}}
        self.material.save(update_fields=["digest", "media_meta"])
        Material.objects.create(title="无关材料", raw_text="other")

        with self.assertNumQueries(3):
            response = self.client.get("/api/materials/", {"q": "查询摘要"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        serialized = response.data["results"][0]
        self.assertEqual(serialized["id"], self.material.id)
        self.assertEqual(serialized["raw_text_length"], len(self.material.raw_text))
        self.assertEqual(serialized["clean_text_length"], len(self.material.clean_text))
        self.assertEqual(serialized["digest_length"], len(self.material.digest))
        self.assertEqual(serialized["chunk_count"], 1)
        for field in ("raw_text", "clean_text", "digest", "media_meta", "chunks"):
            self.assertNotIn(field, serialized)

        detail = self.client.get(f"/api/materials/{self.material.id}/")
        self.assertEqual(detail.status_code, 200)
        for field in ("raw_text", "clean_text", "digest", "media_meta", "chunks"):
            self.assertIn(field, detail.data)

    def test_ai_task_list_omits_payload_but_detail_keeps_it(self):
        task = AITask.objects.create(
            task_type="process",
            trigger_type="Material",
            trigger_id=self.material.id,
            task_data={"context": "x" * 1000},
            full_context="y" * 1000,
            result_json={"content": "z" * 1000},
            next_run_at=timezone.now(),
        )

        with self.assertNumQueries(2):
            response = self.client.get("/api/ai-tasks/")

        self.assertEqual(response.status_code, 200)
        serialized = next(
            item for item in response.data["results"] if item["id"] == task.id
        )
        for field in ("task_data", "full_context", "result_json"):
            self.assertNotIn(field, serialized)

        detail = self.client.get(f"/api/ai-tasks/{task.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["task_data"], task.task_data)
        self.assertEqual(detail.data["full_context"], task.full_context)
        self.assertEqual(detail.data["result_json"], task.result_json)

    def test_task_claims_keep_tts_in_an_independent_lane(self):
        llm_task = AITask.objects.create(
            task_type="briefing",
            trigger_type="Material",
            trigger_id=self.material.id,
            next_run_at=timezone.now(),
        )
        tts_task = AITask.objects.create(
            task_type="edge_tts",
            trigger_type="Material",
            trigger_id=self.material.id,
            next_run_at=timezone.now(),
            model="edge-tts",
        )

        claimed_tts = claim_due_task(task_types=("edge_tts",))
        claimed_default = claim_due_task(exclude_task_types=("edge_tts",))

        self.assertEqual(claimed_tts.id, tts_task.id)
        self.assertEqual(claimed_default.id, llm_task.id)
        self.assertEqual(claimed_tts.status, "running")
        self.assertEqual(claimed_default.status, "running")

    def test_all_standard_list_endpoints_are_paginated(self):
        endpoints = [
            "topics",
            "sessions",
            "materials",
            "material-recommendations",
            "topic-materials",
            "questions",
            "concepts",
            "concept-relations",
            "highlights",
            "exams",
            "reviews",
            "ai-tasks",
            "feedback",
        ]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                response = self.client.get(f"/api/{endpoint}/", {"page_size": 1})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    set(response.data),
                    {"count", "next", "previous", "results"},
                )
                self.assertLessEqual(len(response.data["results"]), 1)

    def test_collection_query_indexes_cover_filter_and_order_paths(self):
        expected_indexes = {
            "api_aitask": {
                "task_trigger_lookup_idx",
                "task_status_due_idx",
                "task_status_type_idx",
            },
            "api_concept": {"concept_topic_updated_idx"},
            "api_exam": {"exam_topic_created_idx"},
            "api_reviewrecord": {"review_result_due_idx"},
            "api_session": {"session_updated_idx"},
            "api_topic": {"topic_updated_idx", "topic_pinned_updated_idx"},
            "api_topicmaterial": {
                "topicmat_active_topic_idx",
                "topicmat_active_mat_idx",
            },
        }
        with connection.cursor() as cursor:
            for table, names in expected_indexes.items():
                constraints = connection.introspection.get_constraints(cursor, table)
                self.assertTrue(names.issubset(constraints))

            cursor.execute(
                """
                EXPLAIN QUERY PLAN
                SELECT id FROM api_aitask
                WHERE trigger_type = %s AND trigger_id = %s AND task_type = %s
                ORDER BY created_at DESC LIMIT 20
                """,
                ["Material", self.material.id, "process"],
            )
            task_plan = " ".join(str(row[-1]) for row in cursor.fetchall())
            cursor.execute(
                """
                EXPLAIN QUERY PLAN
                SELECT id FROM api_topicmaterial
                WHERE topic_id = %s AND removed_at IS NULL
                """,
                [self.topic.id],
            )
            relation_plan = " ".join(str(row[-1]) for row in cursor.fetchall())

        self.assertIn("task_trigger_lookup_idx", task_plan)
        self.assertNotIn("TEMP B-TREE", task_plan)
        self.assertIn("topicmat_active_topic_idx", relation_plan)

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

    def test_material_annotations_support_current_topic_and_all_topics(self):
        other_topic = Topic.objects.create(title="数据库查询")
        TopicMaterial.objects.create(topic=other_topic, material=self.material)
        current_highlight = self.client.post(
            f"/api/topics/{self.topic.id}/highlights/",
            {
                "material": self.material.id,
                "start_offset": 0,
                "end_offset": 6,
                "user_note": "当前话题",
            },
            format="json",
        )
        other_highlight = self.client.post(
            f"/api/topics/{other_topic.id}/highlights/",
            {
                "material": self.material.id,
                "start_offset": 14,
                "end_offset": 22,
                "user_note": "其他话题",
            },
            format="json",
        )
        self.assertEqual(current_highlight.status_code, 201)
        self.assertEqual(other_highlight.status_code, 201)

        all_response = self.client.get(
            f"/api/materials/{self.material.id}/annotations/"
        )
        current_response = self.client.get(
            f"/api/materials/{self.material.id}/annotations/",
            {"topic": self.topic.id},
        )

        self.assertEqual(all_response.status_code, 200)
        self.assertEqual(len(all_response.data["highlights"]), 2)
        self.assertEqual(len(current_response.data["highlights"]), 1)
        locator = current_response.data["highlights"][0]["locators"][0]
        self.assertEqual(locator["topic"], self.topic.id)
        self.assertEqual(locator["topic_title"], self.topic.title)

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
        self.assertNotIn("topic", discussion.data)
        self.topic.refresh_from_db()
        session_id = self.topic.session_id
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
        self.assertEqual(response.data["material"]["status"], "pending")
        self.assertEqual(response.data["material"]["status_display"], "待处理")
        self.assertEqual(material.media_meta["subtitle_uri"], "materials/subtitle.srt")
        self.assertEqual(save.call_count, 2)

    @patch("api.tasks.BaseTask._call_llm")
    @patch(
        "api.video_service._probe_video",
        return_value={
            "duration": 3.0,
            "format": "mp4",
            "has_embedded_subtitle": False,
        },
    )
    def test_video_learning_pipeline_reaches_timed_locator(self, _probe, call_llm):
        call_llm.side_effect = [
            "Alpha beta\n\nGamma",
            "核心内容摘要",
        ]
        subtitle = (
            "1\n00:00:00,000 --> 00:00:01,000\nAlpha\n\n"
            "2\n00:00:01,000 --> 00:00:02,000\nbeta\n\n"
            "3\n00:00:02,000 --> 00:00:03,000\nGamma\n"
        )

        with TemporaryDirectory() as media_root, self.settings(MEDIA_ROOT=media_root):
            upload = self.client.post(
                "/api/materials/upload-video/",
                {
                    "topic": self.topic.id,
                    "title": "完整视频学习路径",
                    "video": SimpleUploadedFile(
                        "course.mp4", b"fake video", "video/mp4"
                    ),
                    "subtitle": SimpleUploadedFile(
                        "course.srt", subtitle.encode(), "application/x-subrip"
                    ),
                },
                format="multipart",
            )
            self.assertEqual(upload.status_code, 202)
            material = Material.objects.get(pk=upload.data["material"]["id"])

            for task_type in ("asr", "clean_text", "briefing", "edge_tts"):
                task = AITask.objects.get(
                    task_type=task_type,
                    trigger_type="Material",
                    trigger_id=material.id,
                )
                TaskRegistry.get_task_class(task_type)(
                    task_id=task.id,
                    task_data=task.task_data,
                    trigger_type=task.trigger_type,
                    trigger_id=task.trigger_id,
                    model=task.model,
                ).run()

            material.refresh_from_db()
            self.assertEqual(material.status, "ready")
            self.assertEqual(material.clean_text, "Alpha beta\n\nGamma")
            self.assertEqual(material.digest, "核心内容摘要")
            self.assertEqual(material.media_meta["transcript_source"], "subtitle")
            self.assertTrue(material.media_meta["subtitle_uri"].endswith(".srt"))
            self.assertEqual(
                list(material.chunks.values_list("start_time", "end_time")),
                [(0.0, 2.0), (2.0, 3.0)],
            )

            start = material.clean_text.index("beta")
            annotation = self.client.post(
                f"/api/topics/{self.topic.id}/highlights/",
                {
                    "material": material.id,
                    "start_offset": start,
                    "end_offset": start + len("beta"),
                    "user_note": "验证视频划词定位",
                },
                format="json",
            )

        self.assertEqual(annotation.status_code, 201)
        locator = MaterialTextLocator.objects.get(
            entity_type="highlight",
            entity_id=annotation.data["id"],
        )
        self.assertEqual(locator.source_text, "beta")
        self.assertEqual(locator.time_start_offset, 0.0)
        self.assertEqual(locator.time_end_offset, 2.0)

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
                    "relevance_score": 0.82,
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
    @patch("api.supplement_service.crawl")
    @patch("api.supplement_service.search")
    def test_supplement_skips_excluded_domains(self, search, crawl, call_llm):
        call_llm.return_value = json.dumps({"queries": ["Django ORM"]})
        search.return_value = [
            {
                "title": "维基百科",
                "url": "https://zh.wikipedia.org/wiki/Django",
                "snippet": "",
                "engine": "test",
            }
        ]
        task, _ = enqueue_or_reuse(
            "supplement_search",
            trigger_type="Topic",
            trigger_id=self.topic.id,
            task_data={
                "topic_id": self.topic.id,
                "relevance_threshold": 0.85,
                "excluded_domains": "wikipedia.org",
            },
        )

        task_cls = TaskRegistry.get_task_class(task.task_type)
        result = task_cls(
            task_id=task.id,
            task_data=task.task_data,
            trigger_type=task.trigger_type,
            trigger_id=task.trigger_id,
            model=task.model,
        ).run()

        self.assertEqual(result["searched_count"], 0)
        self.assertEqual(result["recommended_count"], 0)
        crawl.assert_not_called()

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

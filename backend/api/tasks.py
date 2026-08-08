import abc
import json
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple, Type

from django.db import transaction

from .ai_gateway import AIGateway


def _supplement_context(task):
    from .models import MaterialTextLocator, Topic

    topic_id = task.task_data.get("topic_id")
    if not isinstance(topic_id, int):
        raise ValueError("补料任务缺少主题。")
    try:
        topic = Topic.objects.get(pk=topic_id)
    except Topic.DoesNotExist as error:
        raise ValueError("补料主题不存在。") from error

    trigger_type = task.trigger_type
    task_obj = TaskRegistry.get_task_class(task.task_type)(
        task.id, task.task_data, task.trigger_type, task.trigger_id, task.model
    )
    trigger = task_obj._get_trigger()
    if not trigger:
        raise ValueError("任务触发对象不存在。")

    if trigger_type == "Topic":
        context = f"主题：{topic.title}\n学习目标：{topic.goal or '未设置'}"
    elif trigger_type == "Concept":
        if trigger.topic_id != topic.id:
            raise ValueError("概念不属于补料主题。")
        context = f"概念：{trigger.title}\n定义：{trigger.definition or '待补充'}"
    elif trigger_type == "Question":
        locator = MaterialTextLocator.objects.filter(
            entity_type="question", entity_id=trigger.id, topic=topic
        ).first()
        context = (
            f"问题：{trigger.question_text}\n"
            f"材料片段：{locator.source_text if locator else '未绑定特定片段'}"
        )
    elif trigger_type == "Highlight":
        locator = MaterialTextLocator.objects.filter(
            entity_type="highlight", entity_id=trigger.id, topic=topic
        ).first()
        if locator is None:
            raise ValueError("高亮不属于补料主题。")
        context = f"高亮片段：{locator.source_text}\n备注：{trigger.user_note or '无'}"
    elif trigger_type == "SessionMessage":
        if trigger.session_id != topic.session_id:
            raise ValueError("会话消息不属于补料主题。")
        context = f"话题讨论中识别的材料缺口：{trigger.msg_content}"
    else:
        raise ValueError("不支持的补料触发方。")
    return topic, context


def _update_task_progress(task, result):
    from .models import AITask

    AITask.objects.filter(pk=task.id, status="running").update(result_json=result)


def _normalize_alignment_text(text):
    return "".join(character.lower() for character in text if character.isalnum())


def _video_paragraph_times(paragraphs, segments):
    normalized_segments = [
        _normalize_alignment_text(segment.get("text", "")) for segment in segments
    ]
    normalized_paragraphs = [
        _normalize_alignment_text(paragraph) for paragraph in paragraphs
    ]
    source_text = "".join(normalized_segments)
    cleaned_text = "".join(normalized_paragraphs)
    if not source_text or not cleaned_text:
        return [(None, None)] * len(paragraphs)

    source_boundaries = []
    position = 0
    for segment_text in normalized_segments:
        source_boundaries.append((position, position + len(segment_text)))
        position += len(segment_text)

    paragraph_boundaries = []
    position = 0
    for paragraph_text in normalized_paragraphs:
        paragraph_boundaries.append((position, position + len(paragraph_text)))
        position += len(paragraph_text)

    matching_blocks = SequenceMatcher(
        None,
        source_text,
        cleaned_text,
        autojunk=False,
    ).get_matching_blocks()
    times = []
    for paragraph_start, paragraph_end in paragraph_boundaries:
        source_matches = []
        for source_start, cleaned_start, size in matching_blocks:
            overlap_start = max(paragraph_start, cleaned_start)
            overlap_end = min(paragraph_end, cleaned_start + size)
            if overlap_start < overlap_end:
                source_matches.append(
                    (
                        source_start + overlap_start - cleaned_start,
                        source_start + overlap_end - cleaned_start,
                    )
                )

        if not source_matches:
            times.append((None, None))
            continue

        matched_start = min(match[0] for match in source_matches)
        matched_end = max(match[1] for match in source_matches)
        first_segment = next(
            (
                index
                for index, (_, end) in enumerate(source_boundaries)
                if matched_start < end
            ),
            None,
        )
        last_segment = next(
            (
                index
                for index in range(len(source_boundaries) - 1, -1, -1)
                if matched_end > source_boundaries[index][0]
            ),
            None,
        )
        if first_segment is None or last_segment is None:
            times.append((None, None))
            continue
        times.append(
            (
                segments[first_segment].get("start"),
                segments[last_segment].get("end"),
            )
        )
    return times


def _create_material_chunks(material):
    from .models import MaterialChunk

    text = material.clean_text
    if not text:
        return

    chunks = []
    offset = 0
    paragraphs = [
        paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()
    ]
    paragraph_times = (
        _video_paragraph_times(paragraphs, material.media_meta.get("segments", []))
        if material.media_type == "video"
        else [(None, None)] * len(paragraphs)
    )
    for index, paragraph in enumerate(paragraphs):
        content = paragraph
        start = text.find(content, offset)
        end = start + len(content)
        start_time, end_time = paragraph_times[index]

        chunks.append(
            MaterialChunk(
                material=material,
                chunk_index=index,
                content=content,
                start_offset=start,
                end_offset=end,
                start_time=start_time,
                end_time=end_time,
            )
        )
        offset = end
    MaterialChunk.objects.bulk_create(chunks)


def _assessment_result(score):
    if score >= 85:
        return "strong", 7
    if score >= 60:
        return "pass", 3
    return "weak", 1


def _review_interval_days(score):
    if score >= 85:
        return 14
    if score >= 60:
        return 7
    return 2


class TaskRegistry(type):
    """元类，用于自动注册任务类"""

    _registry: Dict[str, Type["BaseTask"]] = {}

    def __new__(mcs, name, bases, attrs):
        cls = super().__new__(mcs, name, bases, attrs)
        if not attrs.get("__abstract__"):
            task_type = attrs.get("task_type")
            if task_type:
                mcs._registry[task_type] = cls
        return cls

    @classmethod
    def get_task_class(mcs, task_type: str) -> Type["BaseTask"]:
        if task_type not in mcs._registry:
            raise ValueError(f"未注册的任务类型: {task_type}")
        return mcs._registry[task_type]

    @classmethod
    def get_choices(mcs) -> List[Tuple[str, str]]:
        """获取所有已注册任务类型的 choices 列表"""
        return [
            (task_type, getattr(cls, "verbose_name", task_type))
            for task_type, cls in mcs._registry.items()
        ]


class BaseTask(metaclass=TaskRegistry):
    __abstract__ = True
    task_type: str = ""

    def __init__(
        self,
        task_id: int,
        task_data: Dict[str, Any],
        trigger_type: Optional[str] = None,
        trigger_id: Optional[int] = None,
        model: Optional[str] = None,
    ):
        self.task_id = task_id
        self.task_data = task_data
        self.trigger_type = trigger_type
        self.trigger_id = trigger_id
        self.model = model
        self._messages: List[Dict[str, str]] = []

    @abc.abstractmethod
    def run(self) -> Dict[str, Any]:
        """执行任务的核心逻辑"""
        pass

    def _get_trigger(self):
        """获取触发对象"""
        if not self.trigger_type or self.trigger_id is None:
            return None

        from .models import (
            Concept,
            Exam,
            Highlight,
            Material,
            Question,
            ReviewRecord,
            SessionMessage,
            Topic,
        )

        model_map = {
            "Concept": Concept,
            "Exam": Exam,
            "Highlight": Highlight,
            "Material": Material,
            "Question": Question,
            "ReviewRecord": ReviewRecord,
            "SessionMessage": SessionMessage,
            "Topic": Topic,
        }

        model_cls = model_map.get(self.trigger_type)
        if not model_cls:
            return None
        return model_cls.objects.filter(pk=self.trigger_id).first()

    def _call_llm(
        self,
        messages: List[Dict[str, str]],
        response_format: Optional[Dict[str, str]] = None,
        model: Optional[str] = None,
    ) -> str:
        """调用 LLM 并记录上下文"""
        provider = AIGateway.get_provider(model or self.model)
        response = provider.generate_response(messages, response_format=response_format)

        # 记录上下文
        self._append_context(messages)
        return response

    def _append_context(self, messages: List[Dict[str, str]]):
        """将 LLM 交互记录到 AITask 的 full_context 中"""
        from .models import AITask

        context_str = "\n\n".join(
            [f"[{m['role'].upper()}]\n{m['content']}" for m in messages]
        )

        task = AITask.objects.get(pk=self.task_id)
        if task.full_context:
            task.full_context += f"\n\n--- Next LLM Call ---\n\n{context_str}"
        else:
            task.full_context = context_str
        task.save(update_fields=["full_context"])

    def _parse_json(self, content: str, key: Optional[str] = None) -> Any:
        """解析 JSON 响应"""
        try:
            # 简单清理 markdown 标记
            clean_content = content.strip()
            if clean_content.startswith("```json"):
                clean_content = clean_content[7:]
            if clean_content.endswith("```"):
                clean_content = clean_content[:-3]

            data = json.loads(clean_content.strip())
            return data.get(key) if key else data
        except (json.JSONDecodeError, AttributeError) as e:
            raise ValueError(f"解析 AI 响应失败: {str(e)}")


class BriefingTask(BaseTask):
    task_type = "briefing"
    verbose_name = "阅读前导"

    def run(self) -> Dict[str, Any]:
        material = self._get_trigger()
        if not material:
            raise ValueError("找不到触发任务的材料。")

        from .task_service import enqueue_or_reuse

        # 如果摘要已存在，跳过执行
        if material.digest:
            material.status = "generating_audio"
            material.save(update_fields=["status", "updated_at"])
            enqueue_or_reuse(
                "edge_tts",
                trigger_type="Material",
                trigger_id=material.id,
                model="edge-tts",
            )
            return {"material_id": material.id, "skipped": True}

        material.status = "summarizing"
        material.save(update_fields=["status"])

        if not material.clean_text:
            raise ValueError("材料正文不存在，无法生成阅读前导。")

        messages = [
            {
                "role": "system",
                "content": "你是一个专业的学习助手。请为这份学习材料生成一份快速熟悉指南，包含核心问题、关键词和阅读建议。请务必覆盖整份材料的核心要点，不要遗漏重要信息。",
            },
            {
                "role": "user",
                "content": f"学习材料内容（已清洗）：\n{material.clean_text[:15000]}",
            },
        ]

        digest = self._call_llm(messages)
        material.digest = digest
        material.status = "generating_audio"
        material.save(update_fields=["digest", "status", "updated_at"])
        enqueue_or_reuse(
            "edge_tts",
            trigger_type="Material",
            trigger_id=material.id,
            model="edge-tts",
        )
        return {"material_id": material.id, "digest": digest}


class EdgeTTSTask(BaseTask):
    task_type = "edge_tts"
    verbose_name = "生成朗读音频"

    def run(self) -> Dict[str, Any]:
        material = self._get_trigger()
        if not material:
            raise ValueError("找不到触发任务的材料。")
        if material.media_type not in {"text", "web_page"}:
            material.status = "ready"
            material.save(update_fields=["status", "updated_at"])
            return {"material_id": material.id, "skipped": True}

        from .tts_service import synthesize_material

        material.status = "generating_audio"
        material.save(update_fields=["status", "updated_at"])
        tts_meta, successful = synthesize_material(
            material, force=bool(self.task_data.get("force"))
        )
        if successful == 0:
            raise RuntimeError("所有配置音色均生成失败。")

        material.status = "ready"
        material.error = ""
        material.save(update_fields=["status", "error", "updated_at"])
        return {
            "material_id": material.id,
            "successful": successful,
            "voices": tts_meta["voices"],
        }


class ProcessTask(BaseTask):
    task_type = "process"
    verbose_name = "网页抓取与预处理"

    def run(self) -> Dict[str, Any]:
        material = self._get_trigger()
        if not material:
            raise ValueError("找不到触发任务的材料。")

        from .services import MaterialService
        from .task_service import enqueue_or_reuse

        # 自检：如果已经有 clean_text 且 status 为 ready，说明已经 process 过
        # 但为了流转，如果 clean_text 已存在，我们还是可以走一遍 process 逻辑，或者直接跳过
        should_skip = bool(material.clean_text and material.status == "ready")
        result = {"material_id": material.id, "skipped": should_skip}

        if not should_skip:
            material.status = "importing"
            material.save(update_fields=["status"])
            MaterialService.process_material(material)
            result["status"] = material.status
            if material.status == "failed":
                result["error"] = material.error

        # 无论是否跳过，只要没报错到抛出异常，就进入下一步：clean_text
        # 注意：MaterialService.process_material 内部可能会把 status 设为 ready，
        # 我们在流水线中应保持其为 processing 直到最后一步。
        if material.status != "failed":
            enqueue_or_reuse(
                "clean_text", trigger_type="Material", trigger_id=material.id
            )

        return result


class CleanTextTask(BaseTask):
    task_type = "clean_text"
    verbose_name = "AI 正文清洗"

    def run(self) -> Dict[str, Any]:
        material = self._get_trigger()
        if not material:
            raise ValueError("找不到触发任务的材料。")

        from .task_service import enqueue_or_reuse

        # 逻辑：如果 clean_text 已存在且不等于 raw_text（说明已清洗过），则跳过执行，直接进入下一环节
        # 如果 raw_text 为空（如网页导入失败），则不能清洗，也尝试跳过看下一环节
        should_skip = bool(
            material.clean_text and material.clean_text != material.raw_text
        )
        result = {"material_id": material.id, "skipped": should_skip}

        if not should_skip:
            material.status = "cleaning"
            material.save(update_fields=["status"])

            source_text = material.raw_text or material.clean_text

            if not source_text and material.media_type == "web_page":
                import trafilatura

                downloaded = trafilatura.fetch_url(material.media_uri)
                source_text = (
                    trafilatura.extract(downloaded, include_comments=False)
                    if downloaded
                    else ""
                )

            if not source_text:
                result["error"] = "没有可用的文本内容进行清洗"
            else:
                # 改进的分段逻辑：按段落分组，避免重叠导致的内容重复
                max_chunk_size = 8000
                paragraphs = source_text.split("\n")
                text_chunks = []
                current_chunk = []
                current_length = 0

                for para in paragraphs:
                    para = para.strip()
                    if not para:
                        continue

                    # 如果单段超长（极少见），强制切断，但不做重叠
                    if len(para) > max_chunk_size:
                        if current_chunk:
                            text_chunks.append("\n\n".join(current_chunk))
                            current_chunk = []
                            current_length = 0

                        # 强行切分超长段落
                        sub_start = 0
                        while sub_start < len(para):
                            sub_end = sub_start + max_chunk_size
                            text_chunks.append(para[sub_start:sub_end])
                            sub_start = sub_end
                        continue

                    if current_length + len(para) > max_chunk_size:
                        text_chunks.append("\n\n".join(current_chunk))
                        current_chunk = [para]
                        current_length = len(para)
                    else:
                        current_chunk.append(para)
                        current_length += len(para) + 2  # 加上换行符长度

                if current_chunk:
                    text_chunks.append("\n\n".join(current_chunk))

                clean_parts = []
                for i, chunk in enumerate(text_chunks):
                    # 构建上下文参考窗口
                    context_prev = (
                        clean_parts[-1][-1000:] if clean_parts else "这是文档的开头"
                    )
                    context_next = (
                        text_chunks[i + 1][:1000]
                        if i + 1 < len(text_chunks)
                        else "这是文档的结尾"
                    )

                    messages = [
                        {
                            "role": "system",
                            "content": (
                                "你是一个专业的文档处理助手。请将【目标文本】转换为整洁、易读的 Markdown 格式。\n"
                                "要求：\n"
                                "1. 去除噪音，保留核心内容、标题层级和段落结构。\n"
                                "2. 对于视频转录稿，修正 ASR 错误，添加标点，按逻辑分段。\n"
                                "3. 重要：我会提供【上文参考】和【下文参考】以帮助你理解上下文，防止断章取义。\n"
                                "4. 禁令：仅输出【目标文本】清洗后的结果，严禁包含参考信息的内容，严禁包含任何解释或开场白。"
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"【上文参考（已清洗）】：\n...{context_prev}\n\n"
                                f"【目标文本（待清洗，第 {i + 1}/{len(text_chunks)} 段）】：\n{chunk}\n\n"
                                f"【下文参考（待清洗）】：\n{context_next}..."
                            ),
                        },
                    ]

                    part_content = self._call_llm(messages)
                    clean_parts.append(part_content.strip())

                # 合并清洗后的结果，尝试去重重叠部分（简单合并或交给 AI 处理合并，这里采用简单换行合并）
                clean_content = "\n\n".join(clean_parts)

                with transaction.atomic():
                    material.clean_text = clean_content
                    material.save(update_fields=["clean_text", "updated_at"])

                    # 重新分块
                    from .models import MaterialChunk

                    MaterialChunk.objects.filter(material=material).delete()
                    _create_material_chunks(material)

                result["clean_text_length"] = len(clean_content)
                result["processed_chunks"] = len(text_chunks)

        # 无论是否执行了清洗，都触发摘要任务
        enqueue_or_reuse("briefing", trigger_type="Material", trigger_id=material.id)
        return result


class AnswerQuestionTask(BaseTask):
    task_type = "answer_question"
    verbose_name = "回答问题"

    def run(self) -> Dict[str, Any]:
        from .models import MaterialTextLocator, Question, SessionMessage

        trigger = self._get_trigger()
        if self.trigger_type == "SessionMessage":
            user_message = trigger
            if user_message is None or user_message.msg_from != "user":
                raise ValueError("问答消息不存在。")
            question = Question.objects.filter(
                pk=self.task_data.get("question_id"),
                session=user_message.session,
            ).first()
        else:
            # 兼容升级前已入队、以 Question 为触发方的任务。
            question = trigger
            user_message = None
        if question is None:
            raise ValueError("问题不存在。")

        session = question.session
        context = (
            session.context_material.clean_text if session.context_material else ""
        ) or self.task_data.get("context", "")
        if not context:
            raise ValueError("问题缺少材料上下文。")

        locator = MaterialTextLocator.objects.filter(
            entity_type="question", entity_id=question.id
        ).first()
        source_text = (
            locator.source_text
            if locator
            else self.task_data.get("source_text")
            or self.task_data.get("selected_text")
            or "未选择特定片段"
        )
        history = list(session.messages.order_by("-id")[:20])
        history.reverse()

        messages = [
            {
                "role": "system",
                "content": (
                    "你是一个专业的学习助手。请基于提供的材料和对话历史回答"
                    "用户最新的问题。如果材料中没有相关信息，请明确说明，不要编造。\n\n"
                    f"学习材料：\n{context}\n\n"
                    f"用户最初选中的原文：\n{source_text}"
                ),
            },
        ]
        messages.extend(
            {
                "role": "user" if item.msg_from == "user" else "assistant",
                "content": item.msg_content,
            }
            for item in history
        )
        if not history:
            messages.append({"role": "user", "content": question.question_text})

        content = self._call_llm(messages)

        SessionMessage.objects.create(
            session=session,
            msg_from="ai",
            msg_content=content,
        )
        session.model = self.model
        session.save(update_fields=["model", "updated_at"])
        question.conclusion = content
        question.save(update_fields=["conclusion"])
        return {"question_id": question.id, "content": content}


class ConceptDraftTask(BaseTask):
    task_type = "concept_draft"
    verbose_name = "概念草稿"

    def run(self) -> Dict[str, Any]:
        concept = self._get_trigger()
        source_text = str(self.task_data.get("source_text", "")).strip()
        context = str(self.task_data.get("context", "")).strip()
        if not source_text or not context:
            raise ValueError("概念草稿缺少来源文本或材料上下文。")

        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习概念卡片助手。只输出合法 JSON，不要 Markdown。"
                    "仅根据给定来源文本与上下文补全概念，不能虚构材料中未支持的事实。"
                    '输出格式为 {"definition":"定义","principle":"原理",'
                    '"pitfalls":"易错点","applications":"适用场景"}。'
                    "每个字段都必须是可编辑的简洁文本；不确定时明确标注需要确认。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"概念名称：{concept.title}\n"
                    f"来源文本：{source_text}\n\n"
                    f"材料上下文：{context}"
                ),
            },
        ]

        raw_response = self._call_llm(messages, response_format={"type": "json_object"})
        draft = self._parse_json(raw_response)

        required_fields = ("definition", "principle", "pitfalls", "applications")
        if not isinstance(draft, dict) or any(
            not str(draft.get(f, "")).strip() for f in required_fields
        ):
            raise ValueError("AI 概念草稿结果格式不正确")

        concept.definition = draft["definition"]
        concept.principle = draft["principle"]
        concept.pitfalls = draft["pitfalls"]
        concept.applications = draft["applications"]
        concept.status = "draft"
        concept.save(
            update_fields=[
                "definition",
                "principle",
                "pitfalls",
                "applications",
                "status",
                "updated_at",
            ]
        )
        return {"concept_id": concept.id, **draft}


class DiscussionReplyTask(BaseTask):
    task_type = "discussion_reply"
    verbose_name = "话题对话"

    def run(self) -> Dict[str, Any]:
        user_message = self._get_trigger()
        from .models import SessionMessage, Topic

        if user_message is None:
            raise ValueError("话题对话消息不存在。")
        topic = Topic.objects.filter(session=user_message.session).first()
        if topic is None:
            raise ValueError("讨论消息不属于学习主题。")

        material_lines = []
        links = topic.topic_materials.filter(removed_at__isnull=True).select_related(
            "material"
        )
        for link in links:
            material = link.material
            summary = material.digest.strip() or material.clean_text[:800].strip()
            material_lines.append(
                (
                    f"- 《{material.title}》；分类：{link.get_category_display()}；"
                    f"状态：{material.get_status_display()}；摘要：{summary or '暂无摘要'}"
                )
            )
        recommendation_lines = [
            f"- {item.title}：{item.reason}"
            for item in topic.material_recommendations.filter(status="pending")[:10]
        ]
        topic_context = (
            f"话题标题：{topic.title}\n"
            f"学习目标：{topic.goal or '未设置'}\n"
            f"学习范围：{topic.scope or '未设置'}\n"
            f"已有材料：\n{chr(10).join(material_lines) or '暂无材料'}\n"
            f"待处理材料推荐：\n{chr(10).join(recommendation_lines) or '暂无'}"
        )
        history = list(user_message.session.messages.order_by("-id")[:20])
        history.reverse()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是中文学习助手，围绕当前学习话题与用户自然讨论。"
                    "先直接回应用户，不使用固定三段式，不连续追问，一次最多提出一个问题。"
                    "严格区分已有材料支持的事实与推测，不虚构链接或用户背景。"
                    "当现有材料不足以回答关键问题时，可以提出材料检索建议；"
                    "已有材料足够时不要为了推荐而推荐。只输出合法 JSON："
                    '{"reply":"自然语言回复","material_search":'
                    '{"queries":["1到3条中文检索词"],"reason":"为什么需要补充材料"}或null}。'
                ),
            },
            {
                "role": "user",
                "content": f"以下是本次对话的学习上下文：\n{topic_context}",
            },
        ]
        messages.extend(
            {
                "role": "user" if item.msg_from == "user" else "assistant",
                "content": item.msg_content,
            }
            for item in history
        )

        raw_response = self._call_llm(messages, response_format={"type": "json_object"})
        try:
            response = self._parse_json(raw_response)
            reply = str(response.get("reply", "")).strip()
        except (AttributeError, ValueError):
            response = {}
            reply = raw_response.strip()
        if not reply:
            raise ValueError("话题对话未生成有效回复。")

        message = SessionMessage.objects.create(
            session=user_message.session,
            msg_from="ai",
            msg_content=reply,
        )
        user_message.session.model = self.model
        user_message.session.save(update_fields=["model", "updated_at"])

        supplement_task_id = None
        search_request = response.get("material_search")
        if isinstance(search_request, dict):
            queries = [
                str(query).strip()
                for query in search_request.get("queries", [])
                if str(query).strip()
            ][:3]
            if queries:
                from .task_service import enqueue_or_reuse

                supplement_task, _ = enqueue_or_reuse(
                    "supplement_search",
                    trigger_type="SessionMessage",
                    trigger_id=message.id,
                    task_data={
                        "topic_id": topic.id,
                        "suggested_queries": queries,
                        "recommendation_message_id": message.id,
                        "recommendation_reason": str(
                            search_request.get("reason", "")
                        ).strip(),
                    },
                )
                supplement_task_id = supplement_task.id

        return {
            "session_message_id": message.id,
            "topic_id": topic.id,
            "supplement_task_id": supplement_task_id,
        }


class ManagementAssistantTask(BaseTask):
    task_type = "management_assistant"
    verbose_name = "管理助手"

    def run(self) -> Dict[str, Any]:
        from .models import SessionMessage, Topic

        user_message = self._get_trigger()
        if (
            user_message is None
            or user_message.session.session_scene != "management_assistant"
        ):
            raise ValueError("管理助手消息不存在或会话类型无效。")

        topics = list(
            Topic.objects.order_by("-updated_at").values(
                "id", "title", "goal", "scope", "status", "mastery_level"
            )
        )
        inventory = "\n".join(
            (
                f"- ID {topic['id']} | 话题：{topic['title']} | "
                f"学习目标：{topic['goal'] or '未设置'} | "
                f"学习范围：{topic['scope'] or '未设置'} | "
                f"状态：{topic['status']} | 掌握程度：{topic['mastery_level']}"
            )
            for topic in topics
        )
        history = list(user_message.session.messages.order_by("-id")[:20])
        history.reverse()
        scope_sections = self._scope_sections(history)
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 AI Learning Lab 的全站管理助手，使用简洁自然的中文。"
                    "你可以进行简单沟通、根据系统提供的话题数据回答问题，以及批量创建或更新学习话题。"
                    "不得声称执行未提供的能力，不得编造数据。只输出合法 JSON，不要 Markdown 代码块。"
                    '格式为 {"reply":"回复","action":'
                    '"chat|list_topics|draft_topic|manage_topics",'
                    '"topic_draft":{"title":"","goal":"","scope":""}或null,'
                    '"topic_changes":[{"operation":"update|create","topic_id":现有ID或null,'
                    '"title":"新值或null","goal":"新值或null","scope":"新值或null"}]}。'
                    "用户要求列出全部话题、学习目标或学习范围时使用 list_topics，"
                    "具体列表将由系统生成。用户明确要创建话题，且标题、学习目标、学习范围"
                    "都已经明确时使用 draft_topic；缺少任一项时用 chat 追问缺少的信息，"
                    "一次集中询问所有缺失项。draft_topic 只生成待确认草稿，不声称已经创建。"
                    "用户要求比较、批量管理、直接操作、修改或更新话题时使用 manage_topics。"
                    "更新必须填写实时数据中对应的 topic_id；只输出用户明确要求改变的字段，"
                    "其他字段用 null。创建项即使缺字段也要保留，由系统标记待补充，"
                    "不能因为一个创建项缺字段而丢弃其他可执行更新。"
                    "话题名称有空格、连接符差异或同义表达时，结合内容判断是否为已有话题；"
                    "能明确对应时必须使用 update，不能重复创建。"
                    "用户提供的标题、目标、范围原文必须原样保留，不要润色、概括或重新排序。"
                    "始终以实时数据为准，忽略历史助手关于数据是否已修改的说法。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"当前系统共有 {len(topics)} 个话题。以下是实时数据：\n"
                    f"{inventory or '暂无话题。'}"
                ),
            },
        ]
        messages.extend(
            {
                "role": "user" if item.msg_from == "user" else "assistant",
                "content": item.msg_content,
            }
            for item in history
        )

        raw_response = self._call_llm(messages, response_format={"type": "json_object"})
        response = self._parse_json(raw_response)
        if not isinstance(response, dict):
            raise ValueError("管理助手未生成有效响应。")

        action = str(response.get("action", "chat")).strip()
        if action not in {"chat", "list_topics", "draft_topic", "manage_topics"}:
            action = "chat"
        reply = str(response.get("reply", "")).strip()
        result: Dict[str, Any] = {"action": action}

        if action == "list_topics":
            reply = self._topic_table(topics)
            result["topic_count"] = len(topics)
        elif action == "draft_topic":
            raw_draft = response.get("topic_draft")
            draft = raw_draft if isinstance(raw_draft, dict) else {}
            normalized_draft = {
                "title": str(draft.get("title", "")).strip()[:255],
                "goal": str(draft.get("goal", "")).strip(),
                "scope": str(draft.get("scope", "")).strip(),
            }
            if not all(normalized_draft.values()):
                action = "chat"
                result = {"action": action}
                reply = "创建话题还需要明确话题名称、学习目标和学习范围。请一次告诉我这三项。"
            else:
                result["draft"] = normalized_draft
                reply = reply or "我已整理好话题草稿，请确认后创建。"
        elif action == "manage_topics":
            plan = self._topic_change_plan(
                response.get("topic_changes"),
                topics,
                scope_sections,
            )
            executable_count = len(plan["updates"]) + len(plan["creates"])
            if not executable_count and not plan["blocked"]:
                action = "chat"
                result = {"action": action}
                reply = reply or "没有发现需要执行的话题变更。"
            else:
                result["plan"] = plan
                summary = (
                    f"已整理出 {len(plan['updates'])} 项更新和 "
                    f"{len(plan['creates'])} 项新建，请确认后执行。"
                )
                if plan["blocked"]:
                    summary += (
                        f"另有 {len(plan['blocked'])} 项缺少信息，不会阻塞其他变更。"
                    )
                reply = summary
        if not reply:
            reply = "我可以帮你查询现有话题，或快速创建新的学习话题。"

        message = SessionMessage.objects.create(
            session=user_message.session,
            msg_from="ai",
            msg_content=reply,
        )
        user_message.session.model = self.model
        user_message.session.save(update_fields=["model", "updated_at"])
        result["message_id"] = message.id
        return result

    @staticmethod
    def _topic_change_plan(raw_changes, topics, scope_sections):
        topic_by_id = {topic["id"]: topic for topic in topics}
        plan = {"updates": [], "creates": [], "blocked": []}
        if not isinstance(raw_changes, list):
            return plan

        for raw_change in raw_changes[:50]:
            if not isinstance(raw_change, dict):
                continue
            operation = str(raw_change.get("operation", "")).strip()
            if operation == "update":
                try:
                    topic_id = int(raw_change.get("topic_id"))
                except (TypeError, ValueError):
                    topic_id = 0
                topic = topic_by_id.get(topic_id)
                if topic is None:
                    plan["blocked"].append(
                        {
                            "operation": "update",
                            "title": str(raw_change.get("title", "")).strip()
                            or "未知话题",
                            "reason": "未找到对应的现有话题",
                        }
                    )
                    continue

                changes = {}
                before = {}
                for field in ("title", "goal", "scope"):
                    value = raw_change.get(field)
                    if value is None:
                        continue
                    normalized = str(value).strip()
                    if field == "title":
                        normalized = normalized[:255]
                    elif field == "scope":
                        normalized = ManagementAssistantTask._restore_scope_text(
                            normalized,
                            scope_sections,
                        )
                    if normalized != topic[field]:
                        changes[field] = normalized
                        before[field] = topic[field]
                if changes:
                    plan["updates"].append(
                        {
                            "topic_id": topic_id,
                            "current_title": topic["title"],
                            "before": before,
                            "changes": changes,
                        }
                    )
            elif operation == "create":
                draft = {
                    "title": str(raw_change.get("title", "") or "").strip()[:255],
                    "goal": str(raw_change.get("goal", "") or "").strip(),
                    "scope": ManagementAssistantTask._restore_scope_text(
                        str(raw_change.get("scope", "") or "").strip(),
                        scope_sections,
                    ),
                }
                missing_fields = [field for field, value in draft.items() if not value]
                if missing_fields:
                    plan["blocked"].append(
                        {
                            "operation": "create",
                            **draft,
                            "missing_fields": missing_fields,
                            "reason": "缺少"
                            + "、".join(
                                {
                                    "title": "话题名称",
                                    "goal": "学习目标",
                                    "scope": "学习范围",
                                }[field]
                                for field in missing_fields
                            ),
                        }
                    )
                else:
                    plan["creates"].append(draft)
        return plan

    @staticmethod
    def _scope_sections(history):
        sections = []
        for message in history:
            if message.msg_from != "user":
                continue
            lines = message.msg_content.splitlines()
            index = 0
            while index + 1 < len(lines):
                heading = lines[index].strip()
                next_line = lines[index + 1].strip()
                if (
                    heading
                    and not heading.startswith("《")
                    and next_line.startswith("《")
                ):
                    section_lines = []
                    index += 1
                    while index < len(lines) and lines[index].strip():
                        section_lines.append(lines[index].strip())
                        index += 1
                    if section_lines:
                        sections.append(
                            {
                                "heading": heading,
                                "scope": "\n".join(section_lines),
                            }
                        )
                else:
                    index += 1
        return sections

    @staticmethod
    def _restore_scope_text(proposed, scope_sections):
        normalized_proposed = _normalize_alignment_text(proposed)
        if not normalized_proposed:
            return proposed
        best_scope = proposed
        best_ratio = 0.0
        for section in scope_sections:
            candidate = section["scope"]
            normalized_candidate = _normalize_alignment_text(candidate)
            if not normalized_candidate:
                continue
            ratio = SequenceMatcher(
                None,
                normalized_proposed,
                normalized_candidate,
                autojunk=False,
            ).ratio()
            if ratio > best_ratio:
                best_scope = candidate
                best_ratio = ratio
        return best_scope if best_ratio >= 0.9 else proposed

    @staticmethod
    def _topic_table(topics):
        if not topics:
            return "当前还没有学习话题。"

        def escape(value):
            return str(value or "未设置").replace("|", "\\|").replace("\n", "；")

        rows = [
            "| 话题 | 学习目标 | 学习范围 |",
            "| --- | --- | --- |",
        ]
        rows.extend(
            f"| {escape(topic['title'])} | {escape(topic['goal'])} | {escape(topic['scope'])} |"
            for topic in topics
        )
        return "\n".join(rows)


class GenerateExamTask(BaseTask):
    task_type = "generate_exam"
    verbose_name = "生成考题"

    def run(self) -> Dict[str, Any]:
        topic = self._get_trigger()
        context = self.task_data.get("context", "")
        if not context:
            raise ValueError("学习主题没有可用于出题的材料。")

        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习评估设计师。只输出合法 JSON，不要 Markdown。"
                    "基于材料设计 3 道开放式迁移题：必须将知识放入不同于原文的新场景，"
                    "不能要求背诵原文。输出格式为 "
                    '{"questions":[{"scenario":"新场景","question_text":"题目",'
                    '"rubric":{"key_points":["要点"],"common_mistakes":["常见错误"]}}]}。'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"学习主题：{topic.title}\n学习目标：{topic.goal or '未提供'}\n"
                    f"学习材料：\n{context}"
                ),
            },
        ]

        raw_response = self._call_llm(messages, response_format={"type": "json_object"})
        generated_questions = self._parse_json(raw_response, "questions")

        from django.db import transaction

        from .models import Exam, ExamQuestion

        with transaction.atomic():
            exam = Exam.objects.create(topic=topic)
            for generated in generated_questions[:5]:
                question_text = str(generated.get("question_text", "")).strip()
                if not question_text:
                    raise ValueError("AI 生成的题目缺少题干。")
                rubric = generated.get("rubric", {})
                ExamQuestion.objects.create(
                    exam=exam,
                    question_type="transfer",
                    scenario=str(generated.get("scenario", "")).strip(),
                    question_text=question_text,
                    rubric_json=rubric if isinstance(rubric, dict) else {},
                )
            topic.status = "exam_ready"
            topic.save(update_fields=["status", "updated_at"])
        return {"exam_id": exam.id, "topic_id": topic.id}


class GradeExamTask(BaseTask):
    task_type = "grade_exam"
    verbose_name = "阅卷评分"

    def run(self) -> Dict[str, Any]:
        exam = self._get_trigger()
        questions = list(exam.questions.all())
        payload = [
            {
                "id": question.id,
                "scenario": question.scenario,
                "question_text": question.question_text,
                "rubric": question.rubric_json,
                "answer_text": question.answer_text,
            }
            for question in questions
        ]

        messages = [
            {
                "role": "system",
                "content": (
                    "你是严格但有帮助的学习评估员。只输出合法 JSON，不要 Markdown。"
                    "逐题依据 rubric 评分，不能因文笔而给分。输出格式为 "
                    '{"questions":[{"id":1,"score":0,"feedback":"反馈"}],'
                    '"overall_feedback":"总体反馈"}。score 取 0 到 100 的整数。'
                ),
            },
            {
                "role": "user",
                "content": f"学习主题：{exam.topic.title}\n考试数据：\n{json.dumps(payload, ensure_ascii=False)}",
            },
        ]

        raw_response = self._call_llm(messages, response_format={"type": "json_object"})
        grading = self._parse_json(raw_response)

        grades_by_id = {
            item.get("id"): item
            for item in grading["questions"]
            if isinstance(item, dict)
            and item.get("id") in {question.id for question in questions}
        }
        if len(grades_by_id) != len(questions):
            raise ValueError("AI 阅卷未返回全部题目的结果。")

        from datetime import timedelta

        from django.db import transaction
        from django.utils import timezone

        from .models import ReviewRecord

        with transaction.atomic():
            scores = []
            for question in questions:
                result = grades_by_id[question.id]
                score = int(result.get("score"))
                if not 0 <= score <= 100:
                    raise ValueError("AI 返回了无效分数。")
                question.score = score
                question.feedback = str(result.get("feedback", "")).strip()
                question.save(update_fields=["score", "feedback"])
                scores.append(score)

            exam.score = round(sum(scores) / len(scores))
            exam.feedback = str(grading.get("overall_feedback", "")).strip()
            exam.status = "graded"
            exam.submitted_at = timezone.now()
            exam.save(update_fields=["score", "feedback", "status", "submitted_at"])

            mastery_level, review_after_days = _assessment_result(exam.score)
            topic = exam.topic
            topic.mastery_level = mastery_level
            topic.status = "reviewing"
            topic.save(update_fields=["mastery_level", "status", "updated_at"])
            ReviewRecord.objects.filter(topic=topic, exam=exam).delete()
            ReviewRecord.objects.create(
                topic=topic,
                exam=exam,
                due_at=timezone.now() + timedelta(days=review_after_days),
            )
        return {"exam_id": exam.id, "score": exam.score}


class ReviewPromptTask(BaseTask):
    task_type = "review_prompt"
    verbose_name = "复习提示"

    def run(self) -> Dict[str, Any]:
        review = self._get_trigger()
        topic = review.topic
        context = str(self.task_data.get("context", "")).strip()
        if not context:
            raise ValueError("复习记录缺少可用的学习上下文。")

        exam_feedback = review.exam.feedback if review.exam else ""
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习复习助手。基于给定学习上下文，生成简洁的 Markdown "
                    "复习提示，帮助用户先主动回忆再回看材料。包含 3 个不直接给出"
                    "答案的回忆或迁移问题、需要重点复盘的概念，以及一个可执行的"
                    "微应用建议。不要虚构材料中不存在的事实，不要提供标准答案。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"学习主题：{topic.title}\n学习目标：{topic.goal or '未提供'}\n"
                    f"最近测验反馈：{exam_feedback or '暂无'}\n"
                    f"学习上下文：\n{context}"
                ),
            },
        ]

        content = self._call_llm(messages).strip()
        if not content:
            raise ValueError("AI 未生成复习提示。")

        from django.utils import timezone

        from .models import ReviewRecord

        generated_at = timezone.now()
        updated = ReviewRecord.objects.filter(pk=review.id, result="pending").update(
            review_prompt=content,
            review_prompt_generated_at=generated_at,
        )
        if not updated:
            raise ValueError("复习记录已完成，无法写入新的复习提示。")
        return {"review_id": review.id, "content": content}


class GradeReviewTask(BaseTask):
    task_type = "grade_review"
    verbose_name = "复盘反馈"

    def run(self) -> Dict[str, Any]:
        review = self._get_trigger()
        context = str(self.task_data.get("context", "")).strip()
        response_text = str(self.task_data.get("response_text", "")).strip()
        if not context or not response_text:
            raise ValueError("复盘反馈缺少学习上下文或用户回答。")

        messages = [
            {
                "role": "system",
                "content": (
                    "你是严格但有帮助的复习教练。只输出合法 JSON，不要 Markdown。"
                    "根据学习上下文评价用户的主动回忆与应用回答，不能因为文笔而给分。"
                    '输出格式为 {"score":0,"feedback":"具体反馈"}。'
                    "score 为 0 到 100 的整数；feedback 要指出掌握点、缺口和下一步复盘重点。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"学习主题：{review.topic.title}\n学习上下文：\n{context}\n\n"
                    f"用户复盘回答：\n{response_text}"
                ),
            },
        ]

        raw_response = self._call_llm(messages, response_format={"type": "json_object"})
        grading = self._parse_json(raw_response)

        from datetime import timedelta

        from django.db import transaction
        from django.utils import timezone

        from .models import ReviewRecord

        completed_at = timezone.now()
        with transaction.atomic():
            review = ReviewRecord.objects.select_for_update().get(pk=review.id)
            if review.result == "completed":
                raise ValueError("该复习记录已经完成。")
            interval_days = _review_interval_days(grading["score"])
            next_due_at = completed_at + timedelta(days=interval_days)
            review.response_text = response_text
            review.feedback = grading["feedback"]
            review.score = grading["score"]
            review.result = "completed"
            review.completed_at = completed_at
            review.graded_at = completed_at
            review.next_due_at = next_due_at
            review.save(
                update_fields=[
                    "response_text",
                    "feedback",
                    "score",
                    "result",
                    "completed_at",
                    "graded_at",
                    "next_due_at",
                ]
            )
            next_review, created = ReviewRecord.objects.get_or_create(
                previous_review=review,
                defaults={
                    "topic": review.topic,
                    "exam": review.exam,
                    "due_at": next_due_at,
                },
            )
            if not created and next_review.due_at != next_due_at:
                next_review.due_at = next_due_at
                next_review.save(update_fields=["due_at"])

        return {
            "review_id": review.id,
            "score": grading["score"],
            "next_review_id": next_review.id,
            "next_due_at": next_due_at.isoformat(),
        }


class ASRTask(BaseTask):
    task_type = "asr"
    verbose_name = "视频转录"

    def run(self) -> Dict[str, Any]:
        from .video_service import process_video

        material = self._get_trigger()

        material.status = "importing"
        material.save(update_fields=["status"])

        result = process_video(material, self.model)

        # 视频转录后，触发 AI 清洗以优化排版和修正 ASR 错误
        from .task_service import enqueue_or_reuse

        enqueue_or_reuse("clean_text", trigger_type="Material", trigger_id=material.id)

        return result


class SupplementSearchTask(BaseTask):
    task_type = "supplement_search"
    verbose_name = "补充资料检索"

    def run(self) -> Dict[str, Any]:
        from .models import AITask, MaterialRecommendation, SessionMessage
        from .supplement_service import content_md5, crawl, is_excluded_url, search

        task_instance = AITask.objects.get(pk=self.task_id)

        topic, trigger_context = _supplement_context(task_instance)
        queries = self.task_data.get("suggested_queries")
        if not isinstance(queries, list) or not queries:
            messages = [
                {
                    "role": "system",
                    "content": (
                        "你是学习资料检索助手。只输出合法 JSON，不要 Markdown。"
                        '输出 {"queries":["查询词"]}，生成 1 到 3 条高质量网页检索词。'
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"学习主题：{topic.title}\n"
                        f"学习目标：{topic.goal or '未提供'}\n"
                        f"学习范围：{topic.scope or '未提供'}\n"
                        f"触发上下文：{trigger_context}"
                    ),
                },
            ]
            raw_queries = self._call_llm(
                messages,
                response_format={"type": "json_object"},
                model=AIGateway.get_model_for_task("supplement_query"),
            )
            queries = self._parse_json(raw_queries, "queries")
        queries = [str(query).strip() for query in queries if str(query).strip()][:3]

        result = {
            "stage": "searching",
            "queries": queries,
            "searched_count": 0,
            "candidates": [],
            "recommendation_ids": [],
        }
        _update_task_progress(task_instance, result)

        candidates_by_url = {}
        excluded_domains = {
            domain.strip().lower().lstrip(".")
            for domain in str(self.task_data.get("excluded_domains", ""))
            .replace("\n", ",")
            .split(",")
            if domain.strip()
        }
        for query in queries:
            for candidate in search(query):
                if is_excluded_url(candidate["url"], excluded_domains):
                    continue
                candidates_by_url.setdefault(candidate["url"], candidate)

        result.update(stage="crawling", searched_count=len(candidates_by_url))
        _update_task_progress(task_instance, result)

        threshold = max(0.85, float(self.task_data.get("relevance_threshold", 0.85)))
        max_recommendations = min(int(self.task_data.get("max_recommendations", 5)), 5)
        message = SessionMessage.objects.filter(
            pk=self.task_data.get("recommendation_message_id")
        ).first()

        for candidate in list(candidates_by_url.values())[:20]:
            record = {
                "title": candidate["title"],
                "url": candidate["url"],
                "status": "pending",
            }
            try:
                result["stage"] = "crawling"
                _update_task_progress(task_instance, result)
                content = crawl(candidate["url"])
                if len(content) < 300:
                    record.update(status="filtered", reason="正文过短")
                    result["candidates"].append(record)
                    continue

                result["stage"] = "evaluating"
                _update_task_progress(task_instance, result)

                eval_messages = [
                    {
                        "role": "system",
                        "content": (
                            "你是严格的学习资料筛选器。只输出合法 JSON，不要 Markdown。"
                            '输出 {"relevance_score":0.0,"category":"exam_material 或 '
                            'recommended_reading","import_reason":"简洁理由"}。'
                            "relevance_score 必须是 0 到 1；除非资料直接支撑学习目标，"
                            "不要给高分。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"学习主题：{topic.title}\n学习目标：{topic.goal or '未提供'}\n"
                            f"触发上下文：{trigger_context}\n资料标题：{candidate['title']}\n"
                            f"资料正文：{content[:6000]}"
                        ),
                    },
                ]

                raw_eval = self._call_llm(
                    eval_messages, response_format={"type": "json_object"}
                )
                assessment = self._parse_json(raw_eval)

                record.update(**assessment)
                if assessment["relevance_score"] < threshold:
                    record.update(status="filtered", reason="相关度低于阈值")
                    result["candidates"].append(record)
                    continue
                if len(result["recommendation_ids"]) >= max_recommendations:
                    record.update(status="filtered", reason="已达到单次推荐上限")
                    result["candidates"].append(record)
                    continue

                recommendation, created = MaterialRecommendation.objects.get_or_create(
                    topic=topic,
                    url=candidate["url"],
                    defaults={
                        "message": message,
                        "source_task": task_instance,
                        "title": candidate["title"] or candidate["url"],
                        "content_snapshot": content,
                        "content_md5": content_md5(content),
                        "category": assessment["category"],
                        "relevance_score": assessment["relevance_score"],
                        "reason": assessment["import_reason"],
                    },
                )
                if not created and recommendation.status == "pending":
                    recommendation.message = message or recommendation.message
                    recommendation.source_task = task_instance
                    recommendation.title = candidate["title"] or candidate["url"]
                    recommendation.content_snapshot = content
                    recommendation.content_md5 = content_md5(content)
                    recommendation.category = assessment["category"]
                    recommendation.relevance_score = assessment["relevance_score"]
                    recommendation.reason = assessment["import_reason"]
                    recommendation.save(
                        update_fields=[
                            "message",
                            "source_task",
                            "title",
                            "content_snapshot",
                            "content_md5",
                            "category",
                            "relevance_score",
                            "reason",
                        ]
                    )
                record.update(
                    status=(
                        "recommended"
                        if recommendation.status == "pending"
                        else recommendation.status
                    ),
                    recommendation_id=recommendation.id,
                )
                if recommendation.status == "pending":
                    result["recommendation_ids"].append(recommendation.id)
            except Exception as error:
                record.update(status="failed", reason=str(error)[:300])
            result["candidates"].append(record)

        result["stage"] = "completed"
        result["recommended_count"] = len(result["recommendation_ids"])
        if not result["recommendation_ids"]:
            result["message"] = "没有找到达到相关度阈值的补充资料。"
        return result

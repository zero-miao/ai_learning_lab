import json
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

PROMPT_VERSION = "v1"


class LLMProvider(ABC):
    @abstractmethod
    def generate_response(self, messages: List[Dict[str, str]], **kwargs) -> str:
        pass


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, base_url: str, model: str):
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model

    def generate_response(self, messages: List[Dict[str, str]], **kwargs) -> str:
        response = self.client.chat.completions.create(
            model=self.model, messages=messages, **kwargs
        )
        return response.choices[0].message.content


class AIGateway:
    _provider: Optional[LLMProvider] = None

    @classmethod
    def get_provider(cls) -> LLMProvider:
        if cls._provider is None:
            provider_type = os.getenv("LLM_PROVIDER_TYPE", "openai").lower()

            if provider_type == "ollama":
                api_key = os.getenv("LLM_API_KEY", "ollama")
                base_url = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
                model = os.getenv("LLM_MODEL", "llama3")
            else:
                api_key = os.getenv("LLM_API_KEY")
                base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
                model = os.getenv("LLM_MODEL", "gpt-4o")

                if not api_key:
                    raise ValueError("LLM_API_KEY not found in environment variables.")

            cls._provider = OpenAIProvider(api_key, base_url, model)
        return cls._provider

    @classmethod
    def ask_question(cls, context: str, question: str) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": "你是一个专业的学习助手。请基于提供的材料回答用户的问题。如果材料中没有相关信息，请明确说明。",
            },
            {"role": "user", "content": f"学习材料：\n{context}\n\n问题：{question}"},
        ]
        return provider.generate_response(messages)

    @classmethod
    def generate_briefing(cls, material_content: str) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": "你是一个专业的学习助手。请为这份学习材料生成一份快速熟悉指南，包含核心问题、关键词和阅读建议。",
            },
            {"role": "user", "content": f"学习材料内容：\n{material_content}"},
        ]
        return provider.generate_response(messages)

    @classmethod
    def generate_discussion_opening(cls, topic_title: str, goal: str) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习决策助手。帮助用户判断一个话题是否值得现在系统学习。"
                    "先说明该话题的核心价值和潜在适用范围，再提出一个开放问题了解用户动机。"
                    "不要虚构用户已有知识或外部资料。保持简洁、可继续对话。"
                ),
            },
            {
                "role": "user",
                "content": f"讨论话题：{topic_title}\n学习目标：{goal or '未提供'}",
            },
        ]
        return provider.generate_response(messages)

    @classmethod
    def assess_discussion_material(
        cls, topic_title: str, goal: str, material_context: str
    ) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习决策助手。基于给定材料进行快速评估："
                    "1. 用简洁语言概括材料；2. 判断它对当前学习目标的关联度（高/中/低）并说明理由；"
                    "3. 指出投入系统学习前应澄清的一个问题。"
                    "不要假装知道用户未提供的背景，也不要推荐外部链接。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"讨论话题：{topic_title}\n学习目标：{goal or '未提供'}\n"
                    f"材料：\n{material_context}"
                ),
            },
        ]
        return provider.generate_response(messages)

    @classmethod
    def reply_to_discussion(
        cls,
        topic_title: str,
        goal: str,
        material_context: str,
        history: str,
        user_message: str,
    ) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习决策助手。讨论始终围绕“是否应该学、为什么现在学、如何开始”推进。"
                    "结合提供的材料和对话回应用户；区分材料事实与建议，不要把讨论直接扩写成课程。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"讨论话题：{topic_title}\n学习目标：{goal or '未提供'}\n"
                    f"材料上下文：{material_context or '暂无材料'}\n"
                    f"最近对话：\n{history or '暂无'}\n\n用户新消息：{user_message}"
                ),
            },
        ]
        return provider.generate_response(messages)

    @classmethod
    def generate_learning_path(
        cls, topic_title: str, goal: str, material_context: str, history: str
    ) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习规划助手。为已经决定学习的话题给出一个可执行的起步路线："
                    "包含 3 到 5 个递进步骤、每步要解决的问题、优先阅读的现有材料（如有）"
                    "以及一个第一天可完成的小行动。不要虚构外部链接或资料。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"话题：{topic_title}\n学习目标：{goal or '未提供'}\n"
                    f"现有材料：{material_context or '暂无'}\n"
                    f"讨论上下文：\n{history or '暂无'}"
                ),
            },
        ]
        return provider.generate_response(messages)

    @classmethod
    def generate_concept_draft(
        cls, concept_title: str, source_text: str, context: str
    ) -> dict[str, str]:
        provider = cls.get_provider()
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
                    f"概念名称：{concept_title}\n"
                    f"来源文本：{source_text}\n\n"
                    f"材料上下文：{context}"
                ),
            },
        ]
        content = provider.generate_response(
            messages, response_format={"type": "json_object"}
        )
        parsed = json.loads(content)
        required_fields = ("definition", "principle", "pitfalls", "applications")
        if not isinstance(parsed, dict) or any(
            not str(parsed.get(field, "")).strip() for field in required_fields
        ):
            raise ValueError("AI 概念草稿结果格式不正确")
        return {field: str(parsed[field]).strip() for field in required_fields}

    @classmethod
    def generate_note_draft(
        cls, topic_title: str, goal: str, context: str, instructions: str = ""
    ) -> str:
        provider = cls.get_provider()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习笔记助手。基于给定材料生成简洁、可编辑的 Markdown "
                    "结构化笔记。必须区分材料明确陈述的内容和需要继续确认的推断，"
                    "避免虚构材料中没有的事实。建议包含：核心结论、关键概念与关系、"
                    "适用边界、待确认问题。不要添加标题。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"学习主题：{topic_title}\n学习目标：{goal or '未提供'}\n"
                    f"学习材料：\n{context}\n\n"
                    f"用户的额外要求：{instructions or '无'}"
                ),
            },
        ]
        return provider.generate_response(messages)

    @classmethod
    def generate_exam(
        cls, topic_title: str, goal: str, context: str
    ) -> list[dict[str, Any]]:
        provider = cls.get_provider()
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
                    f"学习主题：{topic_title}\n学习目标：{goal or '未提供'}\n"
                    f"学习材料：\n{context}"
                ),
            },
        ]
        content = provider.generate_response(
            messages, response_format={"type": "json_object"}
        )
        return cls._parse_json(content, "questions")

    @classmethod
    def generate_review_prompt(
        cls, topic_title: str, goal: str, context: str, exam_feedback: str
    ) -> str:
        provider = cls.get_provider()
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
                    f"学习主题：{topic_title}\n学习目标：{goal or '未提供'}\n"
                    f"最近测验反馈：{exam_feedback or '暂无'}\n"
                    f"学习上下文：\n{context}"
                ),
            },
        ]
        return provider.generate_response(messages)

    @classmethod
    def grade_review(
        cls, topic_title: str, context: str, response_text: str
    ) -> dict[str, Any]:
        provider = cls.get_provider()
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
                    f"学习主题：{topic_title}\n学习上下文：\n{context}\n\n"
                    f"用户复盘回答：\n{response_text}"
                ),
            },
        ]
        content = provider.generate_response(
            messages, response_format={"type": "json_object"}
        )
        parsed = json.loads(content)
        try:
            score = int(parsed["score"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("AI 复盘反馈结果格式不正确") from error
        feedback = str(parsed.get("feedback", "")).strip()
        if not 0 <= score <= 100 or not feedback:
            raise ValueError("AI 复盘反馈结果格式不正确")
        return {"score": score, "feedback": feedback}

    @classmethod
    def grade_exam(
        cls,
        topic_title: str,
        questions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        provider = cls.get_provider()
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
                "content": f"学习主题：{topic_title}\n考试数据：\n{json.dumps(questions, ensure_ascii=False)}",
            },
        ]
        content = provider.generate_response(
            messages, response_format={"type": "json_object"}
        )
        parsed = json.loads(content)
        if not isinstance(parsed, dict) or not isinstance(
            parsed.get("questions"), list
        ):
            raise ValueError("AI 阅卷结果格式不正确")
        return parsed

    @staticmethod
    def _parse_json(content: str, field: str) -> list[dict[str, Any]]:
        parsed = json.loads(content)
        items = parsed.get(field) if isinstance(parsed, dict) else None
        if not isinstance(items, list) or not items:
            raise ValueError("AI 出题结果格式不正确")
        return items

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

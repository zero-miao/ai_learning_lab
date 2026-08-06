import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


class LLMProvider(ABC):
    @abstractmethod
    def generate_response(self, messages: List[Dict[str, str]], **kwargs) -> str:
        pass


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str, base_url: str, model: str):
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model

    def generate_response(self, messages: List[Dict[str, str]], **kwargs) -> str:
        if os.getenv("LLM_PROVIDER_TYPE", "openai").lower() == "ollama":
            keep_alive = os.getenv("OLLAMA_KEEP_ALIVE", "").strip()
            if keep_alive:
                kwargs["extra_body"] = {
                    **kwargs.pop("extra_body", {}),
                    "keep_alive": keep_alive,
                }
        response = self.client.chat.completions.create(
            model=self.model, messages=messages, **kwargs
        )
        return response.choices[0].message.content


class AIGateway:
    _providers: Dict[str, LLMProvider] = {}

    @classmethod
    def get_default_model(cls) -> str:
        provider_type = os.getenv("LLM_PROVIDER_TYPE", "openai").lower()
        return os.getenv(
            "LLM_MODEL", "llama3" if provider_type == "ollama" else "gpt-4o"
        )

    @classmethod
    def get_model_for_task(cls, task_type: str) -> str:
        override = os.getenv(f"LLM_MODEL_{task_type.upper()}", "").strip()
        return override or cls.get_default_model()

    @classmethod
    def get_provider(cls, model: Optional[str] = None) -> LLMProvider:
        selected_model = model or cls.get_default_model()
        if selected_model not in cls._providers:
            provider_type = os.getenv("LLM_PROVIDER_TYPE", "openai").lower()

            if provider_type == "ollama":
                api_key = os.getenv("LLM_API_KEY", "ollama")
                base_url = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
            else:
                api_key = os.getenv("LLM_API_KEY")
                base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")

                if not api_key:
                    raise ValueError("LLM_API_KEY not found in environment variables.")

            cls._providers[selected_model] = OpenAIProvider(
                api_key, base_url, selected_model
            )
        return cls._providers[selected_model]

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from dotenv import load_dotenv
from openai import OpenAI

from .system_config import FIELD_ENV_DEFAULTS, get_config_value

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
        if get_config_value("llm_provider_type").lower() == "ollama":
            keep_alive = get_config_value("ollama_keep_alive").strip()
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
    _providers: Dict[Tuple[str, str, str, str], LLMProvider] = {}
    _task_model_aliases = {
        "discussion_reply": "TOPIC_CHAT",
        "supplement_search": "SUPPLEMENT_EVALUATE",
    }

    @classmethod
    def get_default_model(cls) -> str:
        return get_config_value("llm_model")

    @classmethod
    def get_model_for_task(cls, task_type: str) -> str:
        model_key = cls._task_model_aliases.get(task_type, task_type.upper())
        field = f"llm_model_{model_key.lower()}"
        if field not in FIELD_ENV_DEFAULTS:
            return cls.get_default_model()
        return get_config_value(field).strip() or cls.get_default_model()

    @classmethod
    def get_provider(cls, model: Optional[str] = None) -> LLMProvider:
        selected_model = model or cls.get_default_model()
        provider_type = get_config_value("llm_provider_type").lower()
        api_key = get_config_value("llm_api_key")
        base_url = get_config_value("llm_base_url")
        cache_key = (provider_type, base_url, api_key, selected_model)
        if cache_key not in cls._providers:
            if provider_type != "ollama" and not api_key:
                raise ValueError("系统设置中未配置 LLM API Key。")

            cls._providers[cache_key] = OpenAIProvider(
                api_key, base_url, selected_model
            )
        return cls._providers[cache_key]

    @classmethod
    def reset_providers(cls):
        cls._providers.clear()

    @staticmethod
    def discover_models(provider_type: str, base_url: str, api_key: str) -> List[str]:
        if provider_type != "ollama" and not api_key:
            raise ValueError("OpenAI 兼容服务需要 API Key。")
        client = OpenAI(
            api_key=api_key or "ollama",
            base_url=base_url,
            max_retries=0,
            timeout=10.0,
        )
        response = client.models.list()
        models = {
            str(getattr(item, "id", "")).strip()
            for item in response.data
            if str(getattr(item, "id", "")).strip()
        }
        return sorted(models, key=str.casefold)

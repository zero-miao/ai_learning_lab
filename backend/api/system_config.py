import os

from django.db import OperationalError, ProgrammingError

FIELD_ENV_DEFAULTS = {
    "llm_provider_type": ("LLM_PROVIDER_TYPE", "ollama"),
    "llm_base_url": ("LLM_BASE_URL", "http://localhost:11434/v1"),
    "llm_api_key": ("LLM_API_KEY", "ollama"),
    "llm_model": ("LLM_MODEL", "qwen3.6:35b-a3b"),
    "llm_model_topic_chat": ("LLM_MODEL_TOPIC_CHAT", "qwen3:30b-a3b"),
    "llm_model_supplement_query": (
        "LLM_MODEL_SUPPLEMENT_QUERY",
        "qwen3:30b-a3b",
    ),
    "llm_model_supplement_evaluate": (
        "LLM_MODEL_SUPPLEMENT_EVALUATE",
        "qwen3.6:35b-a3b",
    ),
    "llm_model_briefing": ("LLM_MODEL_BRIEFING", "qwen3:30b-a3b"),
    "llm_model_clean_text": ("LLM_MODEL_CLEAN_TEXT", "qwen3.6:35b-a3b"),
    "llm_model_answer_question": (
        "LLM_MODEL_ANSWER_QUESTION",
        "qwen3.6:35b-a3b",
    ),
    "llm_model_concept_draft": (
        "LLM_MODEL_CONCEPT_DRAFT",
        "qwen3.6:35b-a3b",
    ),
    "llm_model_generate_exam": (
        "LLM_MODEL_GENERATE_EXAM",
        "qwen3.6:35b-a3b",
    ),
    "llm_model_grade_exam": ("LLM_MODEL_GRADE_EXAM", "qwen3.6:35b-a3b"),
    "llm_model_review_prompt": ("LLM_MODEL_REVIEW_PROMPT", "qwen3:30b-a3b"),
    "llm_model_grade_review": (
        "LLM_MODEL_GRADE_REVIEW",
        "qwen3.6:35b-a3b",
    ),
    "ollama_keep_alive": ("OLLAMA_KEEP_ALIVE", "2m"),
    "asr_model": ("ASR_MODEL", "small"),
    "tts_voices": (
        "TTS_VOICES",
        "zh-CN-XiaoxiaoNeural|晓晓,zh-CN-YunxiNeural|云希",
    ),
    "searxng_base_url": ("SEARXNG_BASE_URL", "http://127.0.0.1:8080"),
    "crawl4ai_base_url": ("CRAWL4AI_BASE_URL", "http://127.0.0.1:11235"),
    "supplement_relevance_threshold": ("SUPPLEMENT_RELEVANCE_THRESHOLD", "0.8"),
    "default_site_theme": ("VITE_DEFAULT_SITE_THEME", "paper"),
    "default_reader_font": ("VITE_DEFAULT_READER_FONT", "system"),
    "api_timeout_ms": ("VITE_API_TIMEOUT_MS", "10000"),
}

FLOAT_FIELDS = {"supplement_relevance_threshold"}
INTEGER_FIELDS = {"api_timeout_ms"}


def default_configuration_values():
    values = {}
    for field, (env_name, fallback) in FIELD_ENV_DEFAULTS.items():
        value = os.getenv(env_name, fallback)
        if field in FLOAT_FIELDS:
            value = float(value)
        elif field in INTEGER_FIELDS:
            value = int(value)
        values[field] = value
    return values


def get_system_configuration():
    from .models import SystemConfiguration

    try:
        return SystemConfiguration.load()
    except (OperationalError, ProgrammingError):
        return None


def get_config_value(field):
    configuration = get_system_configuration()
    if configuration is not None:
        return getattr(configuration, field)
    return default_configuration_values()[field]

import hashlib
import re
from html.parser import HTMLParser
from pathlib import Path

import edge_tts
from django.conf import settings
from markdown_it import MarkdownIt

from .system_config import get_config_value

DEFAULT_VOICES = (
    ("zh-CN-XiaoxiaoNeural", "晓晓"),
    ("zh-CN-YunxiNeural", "云希"),
)


class _TextExtractor(HTMLParser):
    BLOCK_TAGS = {
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "p",
        "pre",
        "td",
        "th",
        "tr",
    }

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)

    def text(self):
        value = "".join(self.parts)
        value = re.sub(r"[ \t]+", " ", value)
        value = re.sub(r"\n{2,}", "\n", value)
        return value.strip()


def configured_voices():
    raw = get_config_value("tts_voices").strip()
    if not raw:
        return DEFAULT_VOICES

    voices = []
    for item in raw.split(","):
        voice, separator, label = item.strip().partition("|")
        if voice:
            voices.append(
                (voice, label.strip() if separator and label.strip() else voice)
            )
    return tuple(voices) or DEFAULT_VOICES


def markdown_to_speech_text(markdown):
    renderer = MarkdownIt("commonmark", {"html": False})
    extractor = _TextExtractor()
    extractor.feed(renderer.render(markdown))
    return extractor.text()


def _safe_voice_filename(voice):
    return re.sub(r"[^A-Za-z0-9._-]", "_", voice)


def synthesize_material(material, *, force=False):
    speech_text = markdown_to_speech_text(material.clean_text)
    if not speech_text:
        raise ValueError("材料正文为空，无法生成朗读音频。")

    text_sha256 = hashlib.sha256(speech_text.encode("utf-8")).hexdigest()
    current_tts = material.media_meta.get("tts", {})
    current_voices = current_tts.get("voices", {})
    output_dir = Path(settings.MEDIA_ROOT) / "materials" / "tts" / str(material.id)
    output_dir.mkdir(parents=True, exist_ok=True)

    assets = {}
    successful = 0
    for voice, label in configured_voices():
        relative_path = (
            Path("materials")
            / "tts"
            / str(material.id)
            / f"{_safe_voice_filename(voice)}.mp3"
        )
        output_path = Path(settings.MEDIA_ROOT) / relative_path
        existing = current_voices.get(voice, {})
        if (
            not force
            and current_tts.get("text_sha256") == text_sha256
            and existing.get("status") == "ready"
            and output_path.is_file()
        ):
            assets[voice] = existing
            successful += 1
            continue

        temporary_path = output_path.with_suffix(".mp3.part")
        temporary_path.unlink(missing_ok=True)
        try:
            edge_tts.Communicate(speech_text, voice).save_sync(str(temporary_path))
            temporary_path.replace(output_path)
            assets[voice] = {
                "voice": voice,
                "label": label,
                "path": relative_path.as_posix(),
                "status": "ready",
                "size": output_path.stat().st_size,
                "error": "",
            }
            successful += 1
        except Exception as error:
            temporary_path.unlink(missing_ok=True)
            assets[voice] = {
                "voice": voice,
                "label": label,
                "path": relative_path.as_posix(),
                "status": "failed",
                "size": 0,
                "error": str(error)[:500],
            }

    tts_meta = {
        "provider": "edge_tts",
        "text_sha256": text_sha256,
        "voices": assets,
    }
    material.media_meta = {**material.media_meta, "tts": tts_meta}
    material.save(update_fields=["media_meta", "updated_at"])
    return tts_meta, successful

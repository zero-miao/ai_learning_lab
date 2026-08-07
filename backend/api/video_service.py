import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from django.conf import settings

from .models import MaterialChunk

TIMESTAMP_PATTERN = re.compile(
    r"(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+"
    r"(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{3})"
)


def _timestamp_to_seconds(value):
    hours, minutes, seconds = value.replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _parse_subtitle(content):
    segments = []
    lines = iter(content.replace("\r\n", "\n").split("\n"))
    for line in lines:
        match = TIMESTAMP_PATTERN.search(line)
        if not match:
            continue
        text_lines = []
        for text_line in lines:
            if not text_line.strip():
                break
            text_lines.append(re.sub(r"<[^>]+>", "", text_line).strip())
        text = " ".join(line for line in text_lines if line).strip()
        if text:
            segments.append(
                {
                    "start": _timestamp_to_seconds(match.group("start")),
                    "end": _timestamp_to_seconds(match.group("end")),
                    "text": text,
                }
            )
    return segments


def _media_path(media_uri):
    root = Path(settings.MEDIA_ROOT).resolve()
    path = (root / media_uri).resolve()
    if root not in path.parents:
        raise ValueError("视频文件路径无效。")
    if not path.is_file():
        raise ValueError("视频文件不存在，可能已被移动或删除。")
    return path


def _probe_video(path):
    if shutil.which("ffprobe") is None:
        raise ValueError("未找到 ffprobe，请安装 ffmpeg 后重试视频解析。")
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name",
            "-show_streams",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise ValueError(f"无法解析视频文件：{result.stderr.strip()[:300]}")
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    return {
        "duration": float(payload.get("format", {}).get("duration") or 0),
        "format": payload.get("format", {}).get("format_name", ""),
        "has_embedded_subtitle": any(
            stream.get("codec_type") == "subtitle" for stream in streams
        ),
    }


def _file_md5(path):
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _transcribe(path, model_name):
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise ValueError(
            "未安装 faster-whisper，执行 pip install -r requirements.txt 后重试。"
        ) from error

    model = WhisperModel(model_name)
    segments, _ = model.transcribe(str(path), vad_filter=True)
    return [
        {
            "start": float(segment.start),
            "end": float(segment.end),
            "text": segment.text.strip(),
        }
        for segment in segments
        if segment.text.strip()
    ]


def process_video(material, model_name):
    if material.media_type != "video":
        raise ValueError("只有视频材料可以执行转录。")

    video_path = _media_path(material.media_uri)
    metadata = {**material.media_meta, **_probe_video(video_path)}
    metadata["md5"] = _file_md5(video_path)
    subtitle_uri = material.media_meta.get("subtitle_uri", "")
    segments = []
    source = "asr"
    if subtitle_uri:
        subtitle_path = _media_path(subtitle_uri)
        segments = _parse_subtitle(subtitle_path.read_text(encoding="utf-8-sig"))
        source = "subtitle"
        if not segments:
            raise ValueError("字幕文件中没有可用的时间轴文本。")
    else:
        segments = _transcribe(video_path, model_name)
        if not segments:
            raise ValueError("未能从视频中生成有效转录稿。")

    clean_text = "\n\n".join(segment["text"] for segment in segments)
    MaterialChunk.objects.filter(material=material).delete()
    offset = 0
    chunks = []
    for index, segment in enumerate(segments):
        content = segment["text"]
        end_offset = offset + len(content)
        chunks.append(
            MaterialChunk(
                material=material,
                chunk_index=index,
                content=content,
                start_offset=offset,
                end_offset=end_offset,
                start_time=segment["start"],
                end_time=segment["end"],
            )
        )
        offset = end_offset + 2
    MaterialChunk.objects.bulk_create(chunks)

    metadata["transcript_source"] = source
    metadata["segments"] = segments  # 保存原始时间戳段落，供后续清洗后恢复使用
    material.raw_text = clean_text
    material.clean_text = clean_text
    material.media_meta = metadata
    material.status = "importing"
    material.error = ""
    material.save(
        update_fields=[
            "raw_text",
            "clean_text",
            "media_meta",
            "status",
            "error",
            "updated_at",
        ]
    )
    return {
        "material_id": material.id,
        "chunk_count": len(chunks),
        "duration": metadata["duration"],
        "transcript_source": source,
    }

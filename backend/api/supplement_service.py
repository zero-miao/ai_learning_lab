import hashlib
import json
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import trafilatura

from .system_config import get_config_value


def _json_request(url, *, method="GET", payload=None, timeout=20):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url,
        data=data,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ValueError(f"本地服务请求失败：{error}") from error


def search(query, limit=10):
    base_url = get_config_value("searxng_base_url").rstrip("/")
    payload = _json_request(
        f"{base_url}/search?{urlencode({'q': query, 'format': 'json', 'categories': 'general'})}"
    )
    results = []
    for item in payload.get("results", [])[:limit]:
        url = str(item.get("url", "")).strip()
        if url:
            results.append(
                {
                    "url": url,
                    "title": str(item.get("title", "")).strip(),
                    "snippet": str(item.get("content", "")).strip(),
                    "engine": str(item.get("engine", "")).strip(),
                }
            )
    return results


def crawl(url):
    base_url = get_config_value("crawl4ai_base_url").rstrip("/")
    try:
        payload = _json_request(
            f"{base_url}/crawl",
            method="POST",
            payload={"urls": [url]},
            timeout=45,
        )
        result = (payload.get("results") or [payload])[0]
        content = str(
            result.get("markdown")
            or result.get("fit_markdown")
            or result.get("cleaned_html")
            or ""
        ).strip()
        if result.get("success", True) and content:
            return content
    except ValueError:
        pass

    downloaded = trafilatura.fetch_url(url)
    content = (
        trafilatura.extract(downloaded, include_comments=False) if downloaded else ""
    )
    if not content:
        raise ValueError("抓取失败或正文为空。")
    return content


def content_md5(content):
    return hashlib.md5(content.encode("utf-8")).hexdigest()


def crawl_metadata(url, content):
    return {
        "source_url": url,
        "md5": content_md5(content),
        "crawled_at": datetime.now(timezone.utc).isoformat(),
    }

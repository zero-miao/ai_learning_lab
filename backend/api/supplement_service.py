import hashlib
import json
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .services import extract_web_text
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


def search(query, limit=10, timeout=20):
    base_url = get_config_value("searxng_base_url").rstrip("/")
    payload = _json_request(
        f"{base_url}/search?{urlencode({'q': query, 'format': 'json', 'categories': 'general'})}",
        timeout=timeout,
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


def is_excluded_url(url, excluded_domains):
    hostname = (urlparse(url).hostname or "").lower().rstrip(".")
    return any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in excluded_domains
    )


def parse_excluded_domains(value):
    return {
        domain.strip().lower().lstrip(".")
        for domain in str(value).replace("\n", ",").split(",")
        if domain.strip()
    }


def search_with_exclusions(query, *, limit=10, excluded_domains=(), timeout=20):
    return [
        candidate
        for candidate in search(query, limit=limit, timeout=timeout)
        if not is_excluded_url(candidate["url"], excluded_domains)
    ]


def crawl(url):
    content = extract_web_text(url).strip()
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

import mimetypes
import re
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.http import FileResponse, Http404, StreamingHttpResponse
from django.utils._os import safe_join
from django.utils.http import content_disposition_header


RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")
CHUNK_SIZE = 64 * 1024


def _read_range(path: Path, start: int, length: int):
    file = path.open("rb")
    try:
        file.seek(start)
        remaining = length
        while remaining > 0:
            chunk = file.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        file.close()


def serve_media(request, path):
    try:
        file_path = Path(safe_join(settings.MEDIA_ROOT, path))
    except (SuspiciousFileOperation, ValueError) as exc:
        raise Http404 from exc
    if not file_path.is_file():
        raise Http404

    size = file_path.stat().st_size
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    range_header = request.headers.get("Range")

    if not range_header:
        response = FileResponse(file_path.open("rb"), content_type=content_type)
        response["Accept-Ranges"] = "bytes"
        response["Content-Length"] = size
        return response

    match = RANGE_PATTERN.fullmatch(range_header.strip())
    if not match:
        response = StreamingHttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        return response

    start_text, end_text = match.groups()
    if not start_text:
        suffix_length = int(end_text)
        start = max(size - suffix_length, 0)
        end = size - 1
    else:
        start = int(start_text)
        end = min(int(end_text), size - 1) if end_text else size - 1

    if start >= size or start > end:
        response = StreamingHttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        return response

    length = end - start + 1
    response = StreamingHttpResponse(
        _read_range(file_path, start, length),
        status=206,
        content_type=content_type,
    )
    response["Accept-Ranges"] = "bytes"
    response["Content-Range"] = f"bytes {start}-{end}/{size}"
    response["Content-Length"] = length
    response["Content-Disposition"] = content_disposition_header(
        as_attachment=False,
        filename=file_path.name,
    )
    return response

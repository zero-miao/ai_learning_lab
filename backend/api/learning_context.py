import re

DEFAULT_CONTEXT_CHARS = 18000
SUMMARY_CHUNK_CHARS = 12000


def split_text(text, max_chars=SUMMARY_CHUNK_CHARS):
    paragraphs = [item.strip() for item in text.split("\n\n") if item.strip()]
    chunks = []
    current = []
    current_length = 0
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append("\n\n".join(current))
                current = []
                current_length = 0
            chunks.extend(
                paragraph[start : start + max_chars]
                for start in range(0, len(paragraph), max_chars)
            )
            continue
        next_length = current_length + len(paragraph) + (2 if current else 0)
        if current and next_length > max_chars:
            chunks.append("\n\n".join(current))
            current = [paragraph]
            current_length = len(paragraph)
        else:
            current.append(paragraph)
            current_length = next_length
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _terms(value):
    normalized = re.sub(r"\s+", "", value.lower())
    latin = set(re.findall(r"[a-z0-9_]{2,}", normalized))
    chinese = {
        normalized[index : index + 2]
        for index in range(max(0, len(normalized) - 1))
        if "\u4e00" <= normalized[index] <= "\u9fff"
    }
    return latin | chinese


def select_material_context(
    material, query, selected_text="", max_chars=DEFAULT_CONTEXT_CHARS
):
    chunks = list(material.chunks.all())
    if not chunks:
        return material.clean_text[:max_chars]

    query_terms = _terms(f"{query}\n{selected_text}")
    selected_start = material.clean_text.find(selected_text) if selected_text else -1
    selected_indexes = {
        index
        for index, chunk in enumerate(chunks)
        if selected_start >= 0
        and chunk.start_offset <= selected_start < chunk.end_offset
    }
    neighbor_indexes = {
        neighbor
        for index in selected_indexes
        for neighbor in range(max(0, index - 1), min(len(chunks), index + 2))
    }

    ranked = []
    for index, chunk in enumerate(chunks):
        overlap = len(query_terms & _terms(chunk.content))
        priority = 10000 if index in neighbor_indexes else 0
        ranked.append((priority + overlap, -index, index, chunk))
    ranked.sort(reverse=True)

    selected = []
    used = 0
    for _, _, index, chunk in ranked:
        section = f"[片段 {index + 1}]\n{chunk.content}"
        if selected and used + len(section) + 2 > max_chars:
            continue
        selected.append((index, section))
        used += len(section) + 2
        if used >= max_chars:
            break
    selected.sort()
    return "\n\n".join(section for _, section in selected)


def _representative_text(material, budget):
    if len(material.clean_text) <= budget:
        return material.clean_text
    chunks = list(material.chunks.all())
    if not chunks:
        third = max(1, budget // 3)
        middle = len(material.clean_text) // 2
        return "\n\n".join(
            [
                material.clean_text[:third],
                material.clean_text[middle : middle + third],
                material.clean_text[-third:],
            ]
        )[:budget]

    indexes = sorted({0, len(chunks) // 2, len(chunks) - 1})
    chosen = []
    remaining = budget
    for index in indexes:
        content = chunks[index].content
        allowance = max(1, remaining // (len(indexes) - len(chosen)))
        chosen.append(content[:allowance])
        remaining -= min(len(content), allowance)
    return "\n\n".join(chosen)[:budget]


def build_topic_context(topic, max_chars=DEFAULT_CONTEXT_CHARS):
    links = list(
        topic.topic_materials.filter(
            removed_at__isnull=True,
            material__status="ready",
        )
        .select_related("material")
        .prefetch_related("material__chunks")
        .order_by("import_at")
    )
    links = [link for link in links if link.material.clean_text]
    if not links:
        return ""

    per_material = max(1200, max_chars // len(links))
    sections = []
    for link in links:
        material = link.material
        digest = material.digest.strip()
        digest_budget = min(len(digest), per_material // 3)
        body_budget = max(400, per_material - digest_budget - len(material.title) - 20)
        body = _representative_text(material, body_budget)
        summary = f"\n摘要：{digest[:digest_budget]}" if digest_budget else ""
        sections.append(f"材料：{material.title}{summary}\n正文摘录：\n{body}")
    return "\n\n".join(sections)[:max_chars]

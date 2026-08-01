import hashlib
import json


def build_note_source(topic):
    materials = [
        {
            "id": material.id,
            "title": material.title,
            "content": material.clean_text,
        }
        for material in topic.materials.filter(import_status="success").order_by("id")
        if material.clean_text
    ]
    context = "\n\n".join(
        f"材料：{material['title']}\n{material['content']}" for material in materials
    )
    fingerprint = hashlib.sha256(
        json.dumps(materials, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    return context, fingerprint

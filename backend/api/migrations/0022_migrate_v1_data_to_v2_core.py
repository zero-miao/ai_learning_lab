import json

from django.db import migrations


def migrate_v1_data(apps, schema_editor):
    AITask = apps.get_model("api", "AITask")
    ConceptAnchor = apps.get_model("api", "ConceptAnchor")
    ConceptRelation = apps.get_model("api", "ConceptRelation")
    DiscussionMessage = apps.get_model("api", "DiscussionMessage")
    Highlight = apps.get_model("api", "Highlight")
    Material = apps.get_model("api", "Material")
    MaterialTextLocator = apps.get_model("api", "MaterialTextLocator")
    Question = apps.get_model("api", "Question")
    Session = apps.get_model("api", "Session")
    SessionMessage = apps.get_model("api", "SessionMessage")
    TopicMaterial = apps.get_model("api", "TopicMaterial")

    status_map = {"pending": "pending", "success": "ready", "failed": "failed"}
    media_type_map = {"url": "web_page", "text": "text"}

    for material in Material.objects.all().iterator():
        Material.objects.filter(pk=material.pk).update(
            media_type=media_type_map.get(material.type, "text"),
            media_uri=material.source_url or "",
            status=status_map.get(material.import_status, "pending"),
            error=material.import_error or "",
            created_by=material.source_type or "manual",
            media_meta={},
        )
        TopicMaterial.objects.get_or_create(
            topic_id=material.topic_id,
            material_id=material.pk,
            defaults={
                "import_by": material.source_type or "manual",
                "category": "recommended_reading",
                "import_reason": "从 V1-alpha 材料迁移",
            },
        )
        TopicMaterial.objects.filter(
            topic_id=material.topic_id, material_id=material.pk
        ).update(import_at=material.created_at)

    for anchor in ConceptAnchor.objects.all().iterator():
        MaterialTextLocator.objects.get_or_create(
            entity_type="concept",
            entity_id=anchor.concept_id,
            material_id=anchor.material_id,
            start_offset=anchor.start_offset,
            end_offset=anchor.end_offset,
            defaults={
                "topic_id": anchor.concept.topic_id,
                "chunk_id": anchor.chunk_id,
                "source_text": anchor.source_text,
            },
        )

    for highlight in Highlight.objects.exclude(material_id__isnull=True).iterator():
        MaterialTextLocator.objects.get_or_create(
            entity_type="highlight",
            entity_id=highlight.pk,
            material_id=highlight.material_id,
            start_offset=highlight.start_offset,
            end_offset=highlight.end_offset,
            defaults={
                "topic_id": highlight.topic_id,
                "chunk_id": highlight.chunk_id,
                "source_text": highlight.source_text,
            },
        )

    question_sessions = {}
    for question in Question.objects.exclude(material_id__isnull=True).iterator():
        session = question_sessions.get(question.topic_id)
        if session is None:
            session, _ = Session.objects.get_or_create(
                session_scene="legacy_questions",
                context_material_id=question.material_id,
                defaults={"context_msg": "从 V1-alpha 阅读问答迁移"},
            )
            question_sessions[question.topic_id] = session
        Question.objects.filter(pk=question.pk).update(session_id=session.pk)
        if question.start_offset is None or question.end_offset is None:
            continue
        MaterialTextLocator.objects.get_or_create(
            entity_type="question",
            entity_id=question.pk,
            material_id=question.material_id,
            start_offset=question.start_offset,
            end_offset=question.end_offset,
            defaults={
                "topic_id": question.topic_id,
                "chunk_id": question.chunk_id,
                "source_text": question.selected_text,
            },
        )

    discussion_sessions = {}
    for message in DiscussionMessage.objects.select_related("topic").iterator():
        session = discussion_sessions.get(message.topic_id)
        if session is None:
            session = Session.objects.create(
                session_scene="discussion",
                context_msg=json.dumps(
                    message.topic.discussion_context, ensure_ascii=False
                ),
            )
            discussion_sessions[message.topic_id] = session
            message.topic.session_id = session.pk
            message.topic.save(update_fields=["session"])
        session_message = SessionMessage.objects.create(
            session_id=session.pk,
            msg_from="user" if message.role == "user" else "ai",
            msg_content=message.content,
        )
        SessionMessage.objects.filter(pk=session_message.pk).update(
            msg_at=message.created_at
        )

    for relation in ConceptRelation.objects.select_related(
        "from_concept", "to_concept"
    ).iterator():
        ConceptRelation.objects.filter(pk=relation.pk).update(
            from_topic_id=relation.from_concept.topic_id,
            to_topic_id=relation.to_concept.topic_id,
        )

    trigger_fields = (
        ("discussion_message_id", "DiscussionMessage"),
        ("question_id", "Question"),
        ("concept_id", "Concept"),
        ("material_id", "Material"),
        ("topic_id", "Topic"),
        ("exam_id", "Exam"),
        ("review_id", "ReviewRecord"),
    )
    for task in AITask.objects.all().iterator():
        for field, trigger_type in trigger_fields:
            trigger_id = getattr(task, field)
            if trigger_id is not None:
                AITask.objects.filter(pk=task.pk).update(
                    trigger_type=trigger_type, trigger_id=trigger_id
                )
                break


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0021_v2_core_foundation"),
    ]

    operations = [
        migrations.RunPython(migrate_v1_data, migrations.RunPython.noop),
    ]

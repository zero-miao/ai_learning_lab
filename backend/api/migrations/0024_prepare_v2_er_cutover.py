from django.db import migrations


def prepare_v2_er_cutover(apps, schema_editor):
    AIResponse = apps.get_model("api", "AIResponse")
    Question = apps.get_model("api", "Question")
    Session = apps.get_model("api", "Session")
    SessionMessage = apps.get_model("api", "SessionMessage")

    for response in AIResponse.objects.order_by("created_at", "id").iterator():
        if response.task_type == "briefing" and response.material_id:
            material = response.material
            if not material.digest:
                material.digest = response.content
                material.save(update_fields=["digest"])
            continue

        if response.task_type != "answer_question" or not response.question_id:
            continue
        question = response.question
        if question.session_id is None:
            session = Session.objects.create(
                session_scene="reading_question",
                context_material_id=question.material_id,
                context_msg="从 V1-alpha 问答迁移",
                model=response.model,
            )
            Question.objects.filter(pk=question.pk).update(session_id=session.pk)
            question.session_id = session.pk
        if not SessionMessage.objects.filter(
            session_id=question.session_id,
            msg_from="ai",
            msg_content=response.content,
        ).exists():
            message = SessionMessage.objects.create(
                session_id=question.session_id,
                msg_from="ai",
                msg_content=response.content,
            )
            SessionMessage.objects.filter(pk=message.pk).update(
                msg_at=response.created_at
            )

    for question in Question.objects.filter(session_id__isnull=True).iterator():
        session = Session.objects.create(
            session_scene="reading_question",
            context_material_id=question.material_id,
            context_msg="从 V1-alpha 问题迁移",
        )
        Question.objects.filter(pk=question.pk).update(session_id=session.pk)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0023_add_video_material_type"),
    ]

    operations = [
        migrations.RunPython(prepare_v2_er_cutover, migrations.RunPython.noop),
    ]

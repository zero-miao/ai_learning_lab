import django.db.models.deletion
from django.db import migrations, models


def migrate_locator_ownership(apps, schema_editor):
    Locator = apps.get_model("api", "MaterialTextLocator")
    Concept = apps.get_model("api", "Concept")
    Highlight = apps.get_model("api", "Highlight")
    Question = apps.get_model("api", "Question")
    Session = apps.get_model("api", "Session")
    Topic = apps.get_model("api", "Topic")

    entity_models = {
        "concept": (Concept, "concept_id"),
        "highlight": (Highlight, "highlight_id"),
        "question": (Question, "question_id"),
    }
    for locator in Locator.objects.all().iterator():
        mapping = entity_models.get(locator.entity_type)
        if mapping is None:
            locator.delete()
            continue
        model, field = mapping
        if not model.objects.filter(pk=locator.entity_id).exists():
            locator.delete()
            continue
        setattr(locator, field, locator.entity_id)
        locator.save(update_fields=[field])
        if locator.entity_type in {"highlight", "question"}:
            model.objects.filter(pk=locator.entity_id, topic_id__isnull=True).update(
                topic_id=locator.topic_id
            )

    orphan_question_sessions = list(
        Question.objects.filter(topic_id__isnull=True).values_list(
            "session_id", flat=True
        )
    )
    Question.objects.filter(topic_id__isnull=True).delete()
    Highlight.objects.filter(topic_id__isnull=True).delete()

    referenced_session_ids = set(
        Topic.objects.exclude(session_id__isnull=True).values_list(
            "session_id", flat=True
        )
    )
    referenced_session_ids.update(Question.objects.values_list("session_id", flat=True))
    Session.objects.filter(pk__in=orphan_question_sessions).exclude(
        pk__in=referenced_session_ids
    ).delete()
    Session.objects.exclude(pk__in=referenced_session_ids).exclude(
        session_scene="management_assistant"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0040_add_dedao_to_excluded_domains"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="systemconfiguration",
            name="crawl4ai_base_url",
        ),
        migrations.RemoveField(
            model_name="systemconfiguration",
            name="default_reader_font",
        ),
        migrations.RemoveField(
            model_name="systemconfiguration",
            name="default_site_theme",
        ),
        migrations.RemoveField(
            model_name="systemconfiguration",
            name="default_speech_rate",
        ),
        migrations.RemoveField(
            model_name="systemconfiguration",
            name="default_tts_voice",
        ),
        migrations.RemoveField(
            model_name="session",
            name="context_msg",
        ),
        migrations.RemoveField(
            model_name="session",
            name="system_prompt",
        ),
        migrations.AddField(
            model_name="highlight",
            name="topic",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="highlights",
                to="api.topic",
                verbose_name="所属主题",
            ),
        ),
        migrations.AddField(
            model_name="question",
            name="topic",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="questions",
                to="api.topic",
                verbose_name="所属主题",
            ),
        ),
        migrations.AddField(
            model_name="materialtextlocator",
            name="concept",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="locators",
                to="api.concept",
                verbose_name="关联概念",
            ),
        ),
        migrations.AddField(
            model_name="materialtextlocator",
            name="highlight",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="locators",
                to="api.highlight",
                verbose_name="关联高亮",
            ),
        ),
        migrations.AddField(
            model_name="materialtextlocator",
            name="question",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="locators",
                to="api.question",
                verbose_name="关联问题",
            ),
        ),
        migrations.RunPython(migrate_locator_ownership, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="materialtextlocator",
            name="locator_entity_idx",
        ),
        migrations.RemoveField(
            model_name="materialtextlocator",
            name="entity_id",
        ),
        migrations.RemoveField(
            model_name="materialtextlocator",
            name="entity_type",
        ),
        migrations.AlterField(
            model_name="highlight",
            name="topic",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="highlights",
                to="api.topic",
                verbose_name="所属主题",
            ),
        ),
        migrations.AlterField(
            model_name="question",
            name="topic",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="questions",
                to="api.topic",
                verbose_name="所属主题",
            ),
        ),
        migrations.AlterField(
            model_name="material",
            name="media_type",
            field=models.CharField(
                choices=[
                    ("text", "纯文本"),
                    ("web_page", "网页"),
                    ("video", "视频"),
                ],
                db_index=True,
                default="text",
                max_length=20,
                verbose_name="媒体类型",
            ),
        ),
        migrations.AddIndex(
            model_name="materialtextlocator",
            index=models.Index(fields=["concept"], name="locator_concept_idx"),
        ),
        migrations.AddIndex(
            model_name="materialtextlocator",
            index=models.Index(fields=["highlight"], name="locator_highlight_idx"),
        ),
        migrations.AddIndex(
            model_name="materialtextlocator",
            index=models.Index(fields=["question"], name="locator_question_idx"),
        ),
        migrations.AddConstraint(
            model_name="materialtextlocator",
            constraint=models.CheckConstraint(
                check=(
                    models.Q(
                        concept__isnull=False,
                        highlight__isnull=True,
                        question__isnull=True,
                    )
                    | models.Q(
                        concept__isnull=True,
                        highlight__isnull=False,
                        question__isnull=True,
                    )
                    | models.Q(
                        concept__isnull=True,
                        highlight__isnull=True,
                        question__isnull=False,
                    )
                ),
                name="locator_exactly_one_entity",
            ),
        ),
    ]

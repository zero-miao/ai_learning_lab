from django.db import migrations, models


def add_dedao_domain(apps, schema_editor):
    configuration = apps.get_model("api", "SystemConfiguration")
    for item in configuration.objects.all():
        domains = [
            domain.strip()
            for domain in item.supplement_excluded_domains.split(",")
            if domain.strip()
        ]
        if "dedao.cn" not in domains:
            domains.append("dedao.cn")
            item.supplement_excluded_domains = ",".join(domains)
            item.save(update_fields=["supplement_excluded_domains"])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0040_material_draft_versions"),
    ]

    operations = [
        migrations.AlterField(
            model_name="systemconfiguration",
            name="supplement_excluded_domains",
            field=models.TextField(
                default="wikipedia.org,weread.qq.com,douban.com,dedao.cn"
            ),
        ),
        migrations.RunPython(add_dedao_domain, migrations.RunPython.noop),
    ]

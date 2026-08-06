from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0027_remove_aitask_input_json_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="material",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "待处理"),
                    ("importing", "导入中"),
                    ("cleaning", "清洗中"),
                    ("summarizing", "摘要中"),
                    ("generating_audio", "生成朗读音频"),
                    ("ready", "已就绪"),
                    ("failed", "失败"),
                ],
                db_index=True,
                default="pending",
                max_length=20,
                verbose_name="V2处理状态",
            ),
        ),
    ]

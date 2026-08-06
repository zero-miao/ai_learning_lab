from django.core.management.base import BaseCommand

from api.models import Material
from api.task_service import enqueue_or_reuse


class Command(BaseCommand):
    help = "为已有文本和网页材料排队生成 Edge TTS 音频"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="忽略正文指纹缓存并重新生成所有配置音色",
        )

    def handle(self, *args, **options):
        materials = Material.objects.filter(
            media_type__in=("text", "web_page"),
        ).exclude(clean_text="")
        created_count = 0
        reused_count = 0
        for material in materials.iterator():
            task, created = enqueue_or_reuse(
                "edge_tts",
                trigger_type="Material",
                trigger_id=material.id,
                task_data={"force": options["force"]},
                model="edge-tts",
            )
            if created:
                created_count += 1
                Material.objects.filter(pk=material.id).update(
                    status="generating_audio",
                    error="",
                )
            else:
                reused_count += 1
            self.stdout.write(
                f"Material #{material.id}: Task #{task.id} "
                f"({'created' if created else 'reused'})"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"已排队 {created_count} 个任务，复用 {reused_count} 个运行中任务。"
            )
        )

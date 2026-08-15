from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import (
    Concept,
    Highlight,
    Material,
    MaterialChunk,
    MaterialTextLocator,
    ReviewRecord,
    SystemConfiguration,
    Topic,
    TopicMaterial,
)


class Command(BaseCommand):
    help = "为隔离的浏览器回归数据库写入确定性数据。"

    def handle(self, *args, **options):
        SystemConfiguration.load()
        topic = Topic.objects.create(
            title="浏览器回归：长材料学习",
            goal="验证桌面与手机端的完整阅读入口",
            scope="长材料、标注、任务、复习与设置页面",
            status="learning",
        )
        paragraphs = [
            (
                f"## 第 {index} 节：长材料上下文 {index}\n\n"
                f"这是第 {index} 节的正文，用于验证长材料渲染、目录、滚动和上下文选择。"
                "每一节都包含独立主题，确保内容超过单次摘要预算后仍能覆盖后段信息。"
            )
            for index in range(1, 81)
        ]
        clean_text = "\n\n".join(paragraphs)
        material = Material.objects.create(
            title="可重复回归长材料",
            media_type="text",
            raw_text=clean_text,
            clean_text=clean_text,
            digest="覆盖全部八十节的回归摘要。",
            status="ready",
        )
        TopicMaterial.objects.create(topic=topic, material=material)

        offset = 0
        chunks = []
        for index, paragraph in enumerate(paragraphs):
            start = clean_text.index(paragraph, offset)
            end = start + len(paragraph)
            chunks.append(
                MaterialChunk(
                    material=material,
                    chunk_index=index,
                    content=paragraph,
                    start_offset=start,
                    end_offset=end,
                )
            )
            offset = end
        MaterialChunk.objects.bulk_create(chunks)

        concept = Concept.objects.create(
            topic=topic,
            title="长材料上下文",
            definition="在有限模型上下文中选择并整合长文档信息。",
            status="confirmed",
        )
        highlight = Highlight.objects.create(topic=topic, user_note="回归高亮备注")
        source_text = "长材料上下文"
        start = clean_text.index(source_text)
        locator_defaults = {
            "topic": topic,
            "material": material,
            "chunk": chunks[0],
            "source_text": source_text,
            "start_offset": start,
            "end_offset": start + len(source_text),
        }
        MaterialTextLocator.objects.create(concept=concept, **locator_defaults)
        MaterialTextLocator.objects.create(highlight=highlight, **locator_defaults)
        ReviewRecord.objects.create(topic=topic, due_at=timezone.now())
        self.stdout.write(
            self.style.SUCCESS(f"Seeded topic={topic.id}, material={material.id}.")
        )

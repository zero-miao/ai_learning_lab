import trafilatura

from .models import MaterialChunk


class MaterialService:
    @staticmethod
    def process_material(material):
        try:
            MaterialChunk.objects.filter(material=material).delete()
            material.clean_text = ""
            material.error = ""
            material.save(update_fields=["clean_text", "error", "updated_at"])

            if material.media_type == "web_page":
                downloaded = trafilatura.fetch_url(material.media_uri)
                material.raw_text = (
                    trafilatura.extract(downloaded, include_comments=False)
                    if downloaded
                    else ""
                )
            elif material.media_type == "text":
                # 对于文本类型，raw_text 已经在创建时由用户提供了
                pass

            # 如果没有提取到任何内容，标记为失败
            content = material.raw_text
            if not content:
                material.status = "failed"
                material.error = "未能从材料中提取到可阅读的正文。"
                material.save(update_fields=["status", "error", "updated_at"])
                return

            # 只保存 raw_text，不进行分块。分块将由后续的 clean_text AI 任务完成。
            material.save(update_fields=["raw_text", "updated_at"])
        except Exception as error:
            material.status = "failed"
            material.error = f"导入时发生错误：{str(error)[:300]}"
            material.save(update_fields=["status", "error", "updated_at"])

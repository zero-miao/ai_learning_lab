import trafilatura

from .models import Material, MaterialChunk


class MaterialService:
    @staticmethod
    def process_material(material: Material):
        try:
            MaterialChunk.objects.filter(material=material).delete()
            material.clean_text = ""
            material.import_error = ""
            material.import_status = "pending"
            material.save(update_fields=["clean_text", "import_error", "import_status"])
            if material.type == "url":
                downloaded = trafilatura.fetch_url(material.source_url)
                if downloaded:
                    material.clean_text = trafilatura.extract(
                        downloaded, include_comments=False
                    )
                else:
                    material.import_status = "failed"
                    material.import_error = "无法获取网页内容，请检查链接是否可访问。"
                    material.save(update_fields=["import_status", "import_error"])
                    return
            else:
                material.clean_text = material.raw_text

            if not material.clean_text:
                material.import_status = "failed"
                material.import_error = "未能从材料中提取到可阅读的正文。"
                material.save(update_fields=["import_status", "import_error"])
                return

            material.import_status = "success"
            material.save(update_fields=["clean_text", "import_status", "import_error"])

            paragraphs = material.clean_text.split("\n\n")
            offset = 0
            for i, para in enumerate(paragraphs):
                para = para.strip()
                if not para:
                    continue

                start_offset = material.clean_text.find(para, offset)
                end_offset = start_offset + len(para)

                MaterialChunk.objects.create(
                    material=material,
                    chunk_index=i,
                    content=para,
                    start_offset=start_offset,
                    end_offset=end_offset,
                )
                offset = end_offset

        except Exception as error:
            material.import_status = "failed"
            material.import_error = f"导入时发生错误：{str(error)[:300]}"
            material.save(update_fields=["import_status", "import_error"])

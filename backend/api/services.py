import trafilatura

from .models import Material, MaterialChunk


class MaterialService:
    @staticmethod
    def process_material(material: Material):
        # ... existing logic ...
        try:
            # ... existing scraper logic ...
            if material.type == "url":
                downloaded = trafilatura.fetch_url(material.source_url)
                if downloaded:
                    material.clean_text = trafilatura.extract(
                        downloaded, include_comments=False
                    )
                else:
                    material.import_status = "failed"
                    material.save()
                    return
            else:
                material.clean_text = material.raw_text

            if not material.clean_text:
                material.import_status = "failed"
                material.save()
                return

            material.import_status = "success"
            material.save()

            # Simple chunking logic: split by paragraphs
            # ... rest of chunking logic ...
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

        except Exception as e:
            print(f"Error processing material: {e}")
            material.import_status = "failed"
            material.save()

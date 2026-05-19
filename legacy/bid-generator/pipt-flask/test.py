import docx
import sys
doc = docx.Document("test.docx")
for rId, rel in doc.part.rels.items():
    if "image" in rel.reltype:
        print(rId, rel.target_part.partname)

import docx
doc = docx.Document()
doc.add_paragraph("Hello world")
doc.save("test.docx")
print("Saved")

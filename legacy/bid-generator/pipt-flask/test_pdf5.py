from xhtml2pdf import pisa
import io
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

pdfmetrics.registerFont(TTFont('SimSun', '/home/haisuchen/.local/share/fonts/simsun.ttc', subfontIndex=0))

long_text = "这是一段非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的没有空格的中文测试文本它应该被自动折行才对否则就会撑破表格和页面边缘。"
# Insert <wbr> after every character
long_text = "".join(c + "<wbr/>" if '\u4e00' <= c <= '\u9fa5' else c for c in long_text)

html = f"""
<html><head>
<style>
@font-face {{ font-family: 'SimSun'; src: url('/home/haisuchen/.local/share/fonts/simsun.ttc'); }}
body {{ font-family: 'SimSun'; font-size: 14pt; }}
table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
td {{ border: 1px solid black; }}
</style>
</head>
<body>
<table>
  <tr>
    <td style="width: 20%;">测试</td>
    <td style="width: 80%;">{long_text}</td>
  </tr>
</table>
</body>
</html>
"""

pdf = io.BytesIO()
pisa.CreatePDF(html, dest=pdf)
with open("test5.pdf", "wb") as f:
    f.write(pdf.getvalue())

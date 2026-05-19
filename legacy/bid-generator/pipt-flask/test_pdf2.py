from xhtml2pdf import pisa
import io
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

pdfmetrics.registerFont(TTFont('SimSun', '/home/haisuchen/.local/share/fonts/simsun.ttc', subfontIndex=0))

html = """
<html><head>
<style>
@font-face { font-family: 'SimSun'; src: url('/home/haisuchen/.local/share/fonts/simsun.ttc'); }
body { font-family: 'SimSun'; font-size: 14pt; }
.my-table { width: 100%; border-collapse: collapse; }
.my-table td { border: 1px solid black; pdf-word-wrap: CJK; word-wrap: cjk; }
</style>
</head>
<body>
<table class="my-table">
  <tr>
    <td style="width: 20%;">测试</td>
    <td style="width: 80%;">这是一段非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的没有空格的中文测试文本它应该被自动折行才对否则就会撑破表格和页面边缘。</td>
  </tr>
</table>
</body>
</html>
"""

pdf = io.BytesIO()
pisa.CreatePDF(html, dest=pdf)
with open("test2.pdf", "wb") as f:
    f.write(pdf.getvalue())

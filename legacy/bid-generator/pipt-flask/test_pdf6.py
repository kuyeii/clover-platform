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
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td { border: 1px solid black; }
p { word-wrap: cjk; pdf-word-wrap: CJK; word-break: break-all; margin:0;}
</style>
</head>
<body>
<table>
  <tr>
    <td style="width: 20%;"><p>测试</p></td>
    <td style="width: 80%;"><p>这是一段非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的没有空格的中文测试文本它应该被自动折行才对否则就会撑破表格和页面边缘。</p></td>
  </tr>
</table>
</body>
</html>
"""

pdf = io.BytesIO()
pisa.CreatePDF(html, dest=pdf)
with open("test6.pdf", "wb") as f:
    f.write(pdf.getvalue())

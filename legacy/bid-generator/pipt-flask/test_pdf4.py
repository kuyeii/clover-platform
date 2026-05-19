from xhtml2pdf import pisa
import io
import re
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

pdfmetrics.registerFont(TTFont('SimSun', '/home/haisuchen/.local/share/fonts/simsun.ttc', subfontIndex=0))

def inject_zwsp(text):
    # 中文/日文/韩文之间插入零宽空格 \u200b
    # 用于强制 reportlab 对每一个全角字符进行断字评估
    return "".join(c + '\u200b' if '\u4e00' <= c <= '\u9fa5' or '\u3000' <= c <= '\u303f' or '\uff00' <= c <= '\uffef' else c for c in text)

long_text = inject_zwsp("这是一段非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的没有空格的中文测试文本它应该被自动折行才对否则就会撑破表格和页面边缘。")

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
    <td style="width: 20%;">{inject_zwsp('测试测试')}</td>
    <td style="width: 80%;">{long_text}</td>
  </tr>
</table>
</body>
</html>
"""

pdf = io.BytesIO()
pisa.CreatePDF(html, dest=pdf)
with open("test4.pdf", "wb") as f:
    f.write(pdf.getvalue())

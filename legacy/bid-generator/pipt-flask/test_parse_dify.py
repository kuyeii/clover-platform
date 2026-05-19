import re
import json

raw = """<think>
首先，用户要求我作为标书评审和润色专家，对AI生成的标书大纲进行质量审核、润色和修正。
[...]
现在，输出修正后的JSON。
</think>{
  "outline": [
    {
      "id": "chap_1",
      "title": "一、项目背景与需求理解"
    }
  ]
}"""

# 修复前的逻辑
raw_old = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL)
print("Old logic parsing:", raw_old.strip()[:50])

print("Old logic starts with <think>:", raw.startswith("<think>"))

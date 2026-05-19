"""
附件模板渲染 — 使用 Jinja2 生成标书常见附件正文
支持的附件类型（attachment_type）：
  - application_letter  投标申请书
  - authorization       授权委托书
  - no_violation        无违规记录声明
  - integrity_pledge    廉洁承诺书
"""

TEMPLATES: dict[str, str] = {

# ─── 投标申请书 ─────────────────────────────────────────
"application_letter": """\
**投标申请书**

{{ recipient }}：

我方 {{ org_name }} 现就贵方组织的《{{ project_name }}》项目采购（招标编号：{{ bid_no | default('（未知）') }}）正式申请参与投标。

我方已仔细阅读招标文件全部内容，充分理解并接受其中各项要求，自愿遵守相关规定。

特此申请。

投标单位（盖章）：{{ org_name }}
法定代表人（签字）：{{ legal_rep }}
日期：{{ doc_date }}
""",

# ─── 授权委托书 ─────────────────────────────────────────
"authorization": """\
**授权委托书**

本授权委托书声明：我 {{ legal_rep }}，系 {{ org_name }}（以下简称"我公司"）的法定代表人，现授权 {{ agent_name }}（身份证号：{{ agent_id | default('___________') }}）为我公司投标代理人，以我公司名义参加《{{ project_name }}》项目的投标活动，并代表我公司签署相关文件。

授权期限：自本授权委托书签署之日起至本次投标活动结束之日止。

委托人（法定代表人）：{{ legal_rep }}（签字）
被委托人：{{ agent_name }}（签字）
投标单位（盖章）：{{ org_name }}
日期：{{ doc_date }}
""",

# ─── 无违规记录声明 ──────────────────────────────────────
"no_violation": """\
**无违规记录声明**

致：{{ recipient }}

我方 {{ org_name }} 郑重声明：

在过去三年内，我方未被工商行政管理部门或其他主管机关列入黑名单，未遭受过重大行政处罚，未有重大法律纠纷未了结，未有严重违约记录，具备参与本次招标活动的合法资格。

上述声明内容如有不实，我方愿承担一切法律责任。

声明单位（盖章）：{{ org_name }}
法定代表人（签字）：{{ legal_rep }}
日期：{{ doc_date }}
""",

# ─── 廉洁承诺书 ─────────────────────────────────────────
"integrity_pledge": """\
**廉洁承诺书**

致：{{ recipient }}

我方 {{ org_name }} 在参与《{{ project_name }}》项目采购活动过程中，郑重承诺：

1. 严格遵守法律法规及采购纪律，不行贿受贿，不以任何方式影响评标结果；
2. 不与其他投标人串通报价，确保竞争公平；
3. 所提交的投标文件资料真实、准确、完整，不提供虚假材料；
4. 如违反上述承诺，愿接受取消投标资格、列入黑名单等处理。

承诺单位（盖章）：{{ org_name }}
法定代表人（签字）：{{ legal_rep }}
日期：{{ doc_date }}
""",
}

# 人性化名称映射
ATTACHMENT_LABELS: dict[str, str] = {
    "application_letter": "投标申请书",
    "authorization":      "授权委托书",
    "no_violation":       "无违规记录声明",
    "integrity_pledge":   "廉洁承诺书",
}

def render_attachment(attachment_type: str, context: dict) -> str:
    """
    使用 Jinja2 渲染指定附件类型，返回 Markdown 字符串。
    context 中的字段优先级高于默认值。
    """
    from jinja2 import Environment, Undefined

    if attachment_type not in TEMPLATES:
        raise ValueError(f"未知附件类型: {attachment_type}，可选: {list(TEMPLATES.keys())}")

    env = Environment(undefined=Undefined)
    tmpl = env.from_string(TEMPLATES[attachment_type])
    return tmpl.render(**context)

"""PIPT 本地识别规则门禁：正则优先，NER 走上下文与词典过滤。"""
from __future__ import annotations

import re
from typing import Any


GENERIC_TERMS = {
    "项目名称", "项目编号", "采购编号", "招标编号", "公司名称", "单位名称", "供应商",
    "投标人", "响应人", "采购人", "招标人", "代理机构", "联系人", "联系方式",
    "法定代表人", "授权代表", "负责人", "经办人", "签字", "盖章", "日期",
    "技术方案", "商务条款", "服务方案", "响应文件", "投标文件", "招标文件",
}

ORG_SUFFIXES = (
    "有限公司", "股份有限公司", "有限责任公司", "集团", "公司", "企业", "银行", "大学",
    "学院", "学校", "医院", "委员会", "管理局", "公安局", "财政局", "住建局",
    "事务所", "协会", "合作社", "研究院", "设计院", "工程院", "厂",
)

ORG_ABBR_ALLOWLIST = {
    "人社局", "医保局", "发改委", "国资委", "公安局", "教育局", "住建局", "工信部",
    "科技部", "财政部", "商务部", "卫健委", "审计署", "国家电网", "南方电网",
    "中国移动", "中国电信", "中国联通", "中石油", "中石化", "中海油", "工商银行",
    "建设银行", "农业银行", "中国银行", "交通银行", "邮储银行", "招商银行",
    "华为", "腾讯", "阿里", "百度", "字节", "平安",
}

ORG_NEGATIVE_SUFFIXES = (
    "部门", "小组", "方案", "平台", "系统", "模块", "功能", "服务", "流程", "阶段",
    "能力", "场景", "项目", "文件", "资料", "数据", "接口", "页面",
)
ORG_ACTION_FRAGMENTS = (
    "组织召开", "会议成立", "成立了", "组织召开了", "委托方", "授奖部", "全部",
)
ORG_BAD_CHARS_RE = re.compile(r"[扌恪]")
ORG_LEFT_TRUNCATION_RE = re.compile(r"^(?:州市|市|县|区).*(?:局|委员会|管理局)$")

NAME_NEGATIVE_CONTEXT = ("项目名称", "公司名称", "单位名称", "联系人", "负责人", "签字", "盖章")
CN_NAME_RE = re.compile(r"^[\u4e00-\u9fa5]{2,4}$")
ADDR_HINT_RE = re.compile(r"(省|市|区|县|镇|乡|街道|路|号|园区|大厦|楼|室)")
CREDIT_CODE_CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY"
CREDIT_CODE_WEIGHTS = (1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28)
ORG_ROLE_LINE_RE = re.compile(
    r"(?:采购人|招标人|采购单位|招标单位|投标人|供应商|中标人|成交供应商|代理机构|招标代理机构|采购代理机构)"
    r"\s*(?:名称)?\s*[:：]\s*([^\n\r，,；;。]{4,80})"
)
NAME_ROLE_LINE_RE = re.compile(
    r"(?:联系人|项目负责人|负责人|法定代表人|授权代表|委托代理人|经办人)"
    r"\s*(?:姓名|名称)?\s*[:：]\s*([^\n\r，,；;。]{2,20})"
)
ADDR_ROLE_LINE_RE = re.compile(
    r"(?:联系地址|通讯地址|通信地址|办公地址|注册地址|地址|地点)"
    r"\s*[:：]\s*([^\n\r，,；;。]{4,120})"
)


def context_window(text: str, start: int, end: int, size: int = 24) -> str:
    return str(text or "")[max(0, start - size): min(len(text or ""), end + size)]


def apply_entity_rules(text: str, entities: list[Any]) -> list[Any]:
    """对识别候选做本地规则门禁，并保留命中原因。"""
    kept: list[Any] = []
    for entity in entities:
        decision = _evaluate_entity(text, entity)
        if not decision["keep"]:
            continue
        _apply_decision(entity, decision)
        kept.append(entity)
    kept.extend(_extract_rule_entities(text, kept))
    return _dedupe_rule_entities(kept)


def _evaluate_entity(text: str, entity: Any) -> dict[str, Any]:
    value = str(getattr(entity, "text", "") or "").strip()
    entity_type = str(getattr(entity, "entity_type", "") or "").strip().lower()
    source = str(getattr(entity, "source", "") or "")
    confidence = float(getattr(entity, "confidence", 0.0) or 0.0)
    if not value:
        return {"keep": False, "reason": "empty_entity"}
    if value in GENERIC_TERMS:
        return {"keep": False, "reason": "generic_term"}
    if entity_type == "credit_code":
        return _evaluate_credit_code(value, confidence)
    if source == "regex":
        return {"keep": True, "confidence": max(confidence, 0.96), "reason": getattr(entity, "reason", "") or f"{entity_type}_regex"}

    if entity_type == "name":
        return _evaluate_name(text, entity, value, confidence)
    if entity_type == "org":
        if _has_left_truncated_org_boundary(text, entity, value):
            return {"keep": False, "reason": "org_left_truncated_boundary"}
        return _evaluate_org(value, confidence)
    if entity_type == "addr":
        return _evaluate_addr(value, confidence)
    return {"keep": True, "confidence": confidence or 0.7, "reason": getattr(entity, "reason", "") or "rule_default_keep"}


def _evaluate_name(text: str, entity: Any, value: str, confidence: float) -> dict[str, Any]:
    if not CN_NAME_RE.fullmatch(value):
        return {"keep": False, "reason": "name_not_cn_2_4"}
    if any(marker in value for marker in ("公司", "项目", "文件", "方案", "系统", "单位")):
        return {"keep": False, "reason": "name_contains_non_person_marker"}
    window = context_window(text, int(getattr(entity, "start", 0)), int(getattr(entity, "end", 0)))
    if any(term in window for term in NAME_NEGATIVE_CONTEXT):
        return {"keep": True, "confidence": max(confidence, 0.86), "reason": "name_context_role_label"}
    return {"keep": True, "confidence": max(confidence, 0.78), "reason": "name_cn_shape"}


def _evaluate_org(value: str, confidence: float) -> dict[str, Any]:
    value = str(value or "").strip(" \t\r\n，,；;。.:：")
    if _is_bad_org_candidate(value):
        return {"keep": False, "reason": "org_bad_fragment"}
    if value in ORG_ABBR_ALLOWLIST:
        return {"keep": True, "confidence": max(confidence, 0.9), "reason": "org_allowlist"}
    if len(value) <= 3:
        return {"keep": False, "reason": "org_too_short"}
    if value.endswith(ORG_NEGATIVE_SUFFIXES):
        return {"keep": False, "reason": "org_negative_suffix"}
    if value.endswith(ORG_SUFFIXES):
        return {"keep": True, "confidence": max(confidence, 0.88), "reason": "org_valid_suffix"}
    return {"keep": False, "reason": "org_missing_valid_suffix"}


def _is_bad_org_candidate(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if ORG_BAD_CHARS_RE.search(text):
        return True
    if any(fragment in text for fragment in ORG_ACTION_FRAGMENTS):
        return True
    if text.endswith(("重点企业", "等重点企业", "全部")):
        return True
    return False


def _has_left_truncated_org_boundary(text: str, entity: Any, value: str) -> bool:
    raw_text = str(text or "")
    start = int(getattr(entity, "start", 0) or 0)
    candidate = str(value or "").strip()
    if start <= 0 or not candidate or not ORG_LEFT_TRUNCATION_RE.match(candidate):
        return False
    previous = raw_text[start - 1:start]
    if not re.fullmatch(r"[\u4e00-\u9fa5]", previous):
        return False
    return previous not in {"与", "由", "和", "及", "对", "如", "等", "在", "向", "为"}

def _evaluate_addr(value: str, confidence: float) -> dict[str, Any]:
    if len(value) < 4:
        return {"keep": False, "reason": "addr_too_short"}
    if not ADDR_HINT_RE.search(value):
        return {"keep": False, "reason": "addr_missing_location_hint"}
    return {"keep": True, "confidence": max(confidence, 0.76), "reason": "addr_location_hint"}


def _evaluate_credit_code(value: str, confidence: float) -> dict[str, Any]:
    code = str(value or "").strip().upper()
    if len(code) != 18:
        return {"keep": False, "reason": "credit_code_length"}
    if any(ch not in CREDIT_CODE_CHARSET for ch in code):
        return {"keep": False, "reason": "credit_code_charset"}
    total = sum(CREDIT_CODE_CHARSET.index(ch) * weight for ch, weight in zip(code[:17], CREDIT_CODE_WEIGHTS))
    expected = CREDIT_CODE_CHARSET[(31 - total % 31) % 31]
    if code[-1] != expected:
        return {"keep": False, "reason": "credit_code_checksum"}
    return {"keep": True, "confidence": max(confidence, 0.97), "reason": "credit_code_checksum"}


def _apply_decision(entity: Any, decision: dict[str, Any]) -> None:
    if "confidence" in decision:
        entity.confidence = min(1.0, max(0.0, float(decision["confidence"])))
    reason = str(decision.get("reason") or "")
    if reason:
        previous = str(getattr(entity, "reason", "") or "")
        entity.reason = reason if not previous else f"{previous}|{reason}"


def _extract_rule_entities(text: str, existing_entities: list[Any]) -> list[Any]:
    additions: list[Any] = []
    raw_text = str(text or "")
    occupied = {(int(getattr(item, "start", -1)), int(getattr(item, "end", -1))) for item in existing_entities}
    for match in ORG_ROLE_LINE_RE.finditer(raw_text):
        raw_value, offset = _clean_role_value(match.group(1))
        if not raw_value:
            continue
        start = match.start(1) + offset
        end = start + len(raw_value)
        if (start, end) in occupied:
            continue
        decision = _evaluate_org(raw_value, 0.0)
        if not decision["keep"]:
            continue
        additions.append(_make_rule_entity(raw_value, "org", start, end, "org_role_label", decision["confidence"]))
    for match in NAME_ROLE_LINE_RE.finditer(raw_text):
        raw_value, offset = _clean_name_role_value(match.group(1))
        if not raw_value:
            continue
        start = match.start(1) + offset
        end = start + len(raw_value)
        if (start, end) in occupied:
            continue
        candidate = _make_rule_entity(raw_value, "name", start, end, "name_role_label", 0.0)
        decision = _evaluate_name(raw_text, candidate, raw_value, 0.0)
        if not decision["keep"]:
            continue
        _apply_decision(candidate, decision)
        additions.append(candidate)
    for match in ADDR_ROLE_LINE_RE.finditer(raw_text):
        raw_value, offset = _clean_addr_role_value(match.group(1))
        if not raw_value:
            continue
        start = match.start(1) + offset
        end = start + len(raw_value)
        if (start, end) in occupied:
            continue
        decision = _evaluate_addr(raw_value, 0.0)
        if not decision["keep"]:
            continue
        additions.append(_make_rule_entity(raw_value, "addr", start, end, "addr_role_label", decision["confidence"]))
    return additions


def _clean_role_value(value: str) -> tuple[str, int]:
    raw = str(value or "")
    leading = len(raw) - len(raw.lstrip())
    cleaned = raw.strip()
    cleaned = re.split(r"\s{2,}|[（(]?(?:统一社会信用代码|联系人|联系电话|电话|地址|法定代表人)[：:）)]?", cleaned, maxsplit=1)[0]
    cleaned = cleaned.strip(" \t，,；;。.")
    return cleaned, leading


def _clean_name_role_value(value: str) -> tuple[str, int]:
    raw = str(value or "")
    leading = len(raw) - len(raw.lstrip())
    cleaned = raw.strip()
    cleaned = re.split(
        r"\s{2,}|[（(]?(?:联系电话|电话|手机|身份证|职务|地址|邮箱|电子邮箱)[：:）)]?",
        cleaned,
        maxsplit=1,
    )[0]
    cleaned = cleaned.strip(" \t，,；;。.")
    return cleaned, leading


def _clean_addr_role_value(value: str) -> tuple[str, int]:
    raw = str(value or "")
    leading = len(raw) - len(raw.lstrip())
    cleaned = raw.strip()
    cleaned = re.split(
        r"\s{2,}|[（(]?(?:邮编|邮政编码|联系人|联系电话|电话|手机|邮箱|电子邮箱)[：:）)]?",
        cleaned,
        maxsplit=1,
    )[0]
    cleaned = cleaned.strip(" \t，,；;。.")
    return cleaned, leading


def _make_rule_entity(text_value: str, entity_type: str, start: int, end: int, reason: str, confidence: float) -> Any:
    try:
        from .schemas import EntityItem

        return EntityItem(
            text=text_value,
            entity_type=entity_type,
            start=start,
            end=end,
            source="rule",
            confidence=confidence,
            reason=reason,
        )
    except Exception:
        from types import SimpleNamespace

        return SimpleNamespace(
            text=text_value,
            entity_type=entity_type,
            start=start,
            end=end,
            source="rule",
            confidence=confidence,
            reason=reason,
        )


def _dedupe_rule_entities(entities: list[Any]) -> list[Any]:
    selected: list[Any] = []
    occupied: list[tuple[int, int]] = []
    for entity in sorted(entities, key=lambda item: (int(getattr(item, "start", 0)), -(int(getattr(item, "end", 0)) - int(getattr(item, "start", 0))))):
        start = int(getattr(entity, "start", -1))
        end = int(getattr(entity, "end", -1))
        if start < 0 or end <= start:
            continue
        if any(start < used_end and end > used_start for used_start, used_end in occupied):
            continue
        selected.append(entity)
        occupied.append((start, end))
    return selected

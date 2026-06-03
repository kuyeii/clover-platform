# -*- coding: utf-8 -*-
"""
pipt-lite 脱敏引擎
封装正则识别 + NER 识别 + 脱敏处理的核心逻辑

直接复用 pipt_task 中已有的正则表达式、mask 方法等，
但将其从 Celery 任务/Pandas DataFrame 模式解耦为纯文本处理。
"""

import logging
import hashlib
import os
import re
from pathlib import Path
from typing import Optional

from app.core.config import get_api_settings

from .schemas import EntityItem, DesensitizeResponse
from .pipt_protocol import (
    build_placeholder_manifest,
    build_placeholder_policy,
    make_stable_strong_pipt_token,
)
from .recognition_rules import apply_entity_rules

logger = logging.getLogger(__name__)

DEFAULT_TARGET_ENTITIES = ["name", "phone", "id_number", "email", "addr", "bank", "car_id", "ip", "org", "credit_code"]
FALLBACK_IDENTIFY_INFO_TO_CHINESE = {
    "name": "姓名",
    "phone": "手机号",
    "id_number": "身份证号",
    "email": "邮箱",
    "addr": "地址",
    "bank": "银行卡号",
    "car_id": "车牌号",
    "ip": "IP 地址",
    "org": "机构名称",
    "credit_code": "统一社会信用代码",
}


def _default_assets_dir() -> Path:
    """返回可选 NER 资产目录；大模型资产不复制进 apps/api，仅按路径复用外部资源。"""
    configured = os.environ.get("PIPT_ASSETS_DIR")
    if configured:
        return Path(configured)
    return get_api_settings().repo_root / "legacy" / "bid-generator" / "pipt-flask" / "app" / "extension" / "celery_task" / "pipt_task" / "assets"
FALLBACK_REGEX_PATTERNS = {
    "phone": r"(?<!\d)1[3-9]\d{9}(?!\d)",
    "email": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    "id_number": r"(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])",
    "ip": r"(?<!\d)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d)",
    "car_id": r"[\u4e00-\u9fa5][A-Z][A-Z0-9]{5,6}",
    "bank": r"(?<!\d)(?:\d[ -]?){16,19}(?!\d)",
    "org": r"[\u4e00-\u9fa5A-Za-z0-9（）()]{4,80}(?:有限公司|股份有限公司|有限责任公司|集团|公司|银行|大学|学院|医院|委员会|管理局|事务所|协会|研究院|设计院)",
    "credit_code": r"(?<![0-9A-Z])(?:[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})(?![0-9A-Z])",
}


def _fallback_mask_email(email: str, desensitize_symbol: str) -> str:
    local, _, domain = str(email or "").partition("@")
    if not domain:
        return _fallback_default_mask(email, desensitize_symbol)
    keep = local[: max(1, min(3, len(local)))]
    return f"{keep}{desensitize_symbol * max(1, len(local) - len(keep))}@{domain}"


def _fallback_mask_phone(phone_number: str, desensitize_symbol: str) -> str:
    value = str(phone_number or "")
    if len(value) < 8:
        return _fallback_default_mask(value, desensitize_symbol)
    return value[:-8] + desensitize_symbol * 4 + value[-4:]


def _fallback_mask_id(id_number: str, desensitize_symbol: str) -> str:
    value = str(id_number or "")
    if len(value) != 18:
        return _fallback_default_mask(value, desensitize_symbol)
    return value[:3] + desensitize_symbol * 11 + value[14:16] + desensitize_symbol * 2


def _fallback_mask_ip(ip_address: str, desensitize_symbol: str) -> str:
    parts = str(ip_address or "").split(".")
    if len(parts) != 4:
        return _fallback_default_mask(ip_address, desensitize_symbol)
    return f"{parts[0]}.{desensitize_symbol * 3}.{desensitize_symbol * 3}.{desensitize_symbol * 3}"


def _fallback_mask_car(car_id: str, desensitize_symbol: str) -> str:
    value = str(car_id or "")
    if len(value) < 5:
        return _fallback_default_mask(value, desensitize_symbol)
    return value[:-5] + desensitize_symbol * 5


def _fallback_mask_name(name: str, desensitize_symbol: str) -> str:
    value = str(name or "")
    if len(value) <= 1:
        return desensitize_symbol * len(value)
    if len(value) == 4:
        return value[:2] + desensitize_symbol * 2
    return value[0] + desensitize_symbol * (len(value) - 1)


def _fallback_default_mask(record: str, desensitize_symbol: str) -> str:
    return desensitize_symbol * len(str(record or ""))


def _fallback_mask_keep_tail(record: str, desensitize_symbol: str, keep: int = 4) -> str:
    value = str(record or "")
    if len(value) <= keep:
        return _fallback_default_mask(value, desensitize_symbol)
    return desensitize_symbol * (len(value) - keep) + value[-keep:]


class DesensitizeEngine:
    """
    脱敏引擎

    整合正则匹配和 NER 模型，提供文本级别的敏感信息识别和脱敏。
    相比原 pipt-flask 的 Celery Task + DataFrame 模式，
    本引擎面向纯文本输入/输出。
    """

    def __init__(self):
        """初始化正则规则和 mask 方法"""
        regex_sources = dict(FALLBACK_REGEX_PATTERNS)
        identify_info_to_chinese = dict(FALLBACK_IDENTIFY_INFO_TO_CHINESE)
        mask_name = _fallback_mask_name
        mask_phone = _fallback_mask_phone
        mask_id = _fallback_mask_id
        mask_email = _fallback_mask_email
        mask_ip = _fallback_mask_ip
        mask_car = _fallback_mask_car
        mask_bank = _fallback_mask_keep_tail
        default_mask = _fallback_default_mask

        # 正则规则映射：实体类型 → 编译后的正则
        # org 必须走 NER/角色行规则；legacy org_regex 过宽，会把“合作单位包括嘉兴银行”这类上下文吞进实体。
        regex_sources.pop("org", None)
        self.regex_patterns = {
            entity_type: re.compile(pattern)
            for entity_type, pattern in regex_sources.items()
            if pattern
        }

        # mask 方法映射：实体类型 → mask 函数
        self.mask_functions = {
            "name": mask_name,
            "phone": mask_phone,
            "id_number": mask_id,
            "email": mask_email,
            "ip": mask_ip,
            "car_id": mask_car,
            "bank": mask_bank,
            "credit_code": _fallback_mask_keep_tail,
        }
        self.default_mask = default_mask

        self.entity_names = identify_info_to_chinese

        # NER 模型（可选，需要模型文件）
        self._ner_model = None

        # 占位符全局计数器
        self._placeholder_counter: dict[str, int] = {}

        logger.info(f"脱敏引擎初始化完成: 正则规则 {len(self.regex_patterns)} 种, mask 方法 {len(self.mask_functions)} 种")

    def _try_load_ner_model(self):
        """尝试加载 NER 模型（用于姓名、地址、机构等无正则规则的实体）"""
        if self._ner_model is not None:
            return

        try:
            import hanlp

            # 优先使用 PIPT_ASSETS_DIR；未配置时只按文件路径复用旧资产目录，不导入 legacy 包。
            assets_dir = _default_assets_dir()
            ner_model_dir = str((assets_dir / "ner_model").resolve())
            tok_model_dir = str((assets_dir / "tok_model").resolve())

            loaded_local = False
            if Path(ner_model_dir).exists() and Path(tok_model_dir).exists():
                logger.info(f"正在从本地离线目录加载模型: {ner_model_dir}")
                self._ner_model = {
                    "tok": hanlp.load(tok_model_dir),
                    "ner": hanlp.load(ner_model_dir),
                }
                loaded_local = True

            if not loaded_local:
                logger.info("未检测到本地 models/ 目录的文件，正在从远程加载/缓存 HanLP 预训练模型(默认使用 GPU 提取)...")
                # 当您跑过第一次后，hanlp 会自动把它缓存在 ~/.hanlp 下面，以后也就是离线秒开了。
                self._ner_model = {
                    "tok": hanlp.load(hanlp.pretrained.tok.COARSE_ELECTRA_SMALL_ZH),
                    "ner": hanlp.load(hanlp.pretrained.ner.MSRA_NER_ELECTRA_SMALL_ZH),
                }

            logger.info("NER 模型加载成功，正准备通过 PyTorch/GPU 推理。")

        except ImportError:
            logger.warning("hanlp 未安装，仅使用正则识别。请执行 pip install hanlp>=2.1")
        except Exception as e:
            logger.warning(f"NER 模型加载失败: {e}，仅使用正则识别")

    def recognize(
        self,
        text: str,
        target_entities: list[str],
        llm_mode_override: Optional[str] = None,
    ) -> list[EntityItem]:
        """
        对文本进行命名实体识别

        根据 PIPT_LLM_MODE 环境变量（可被 llm_mode 参数覆盖），运行三种识别管道：
        - verify_only: 正则 + NER → LLM 校验（快，适合实时流程）
        - augment:    正则 + NER → LLM 校验 → LLM 主动挖掘 → LLM 二次核验（慢，适合后台 KB 同步）
        - full:       直接 LLM 端到端识别（跳过 NER）
        """
        import os
        llm_enabled = os.environ.get("PIPT_LLM_VERIFY_ENABLED", "false").lower() == "true"
        llm_mode = (llm_mode_override or os.environ.get("PIPT_LLM_MODE", "verify_only")).lower()

        # full 模式：完全由 LLM 承担识别，跳过 NER
        if llm_enabled and llm_mode == "full":
            entities = self._full_llm_recognize(text, target_entities)
            entities = apply_entity_rules(text, entities)
            entities = self._deduplicate_entities(entities)
            logger.info(f"[full] 识别完成: {len(entities)} 个实体")
            return entities

        # 正则识别（所有模式共用）
        entities = []
        for entity_type, pattern in self.regex_patterns.items():
            if entity_type not in target_entities:
                continue
            for match in pattern.finditer(text):
                entities.append(EntityItem(
                    text=match.group(),
                    entity_type=entity_type,
                    start=match.start(),
                    end=match.end(),
                    source="regex",
                    confidence=0.98,
                    reason=f"{entity_type}_regex",
                ))

        # NER 模型识别（姓名、地址、机构）
        ner_types = {"name", "addr", "org"} & set(target_entities)
        if ner_types:
            self._try_load_ner_model()
            if self._ner_model is not None:
                try:
                    ner_entities = self._ner_recognize(text, ner_types)
                    ner_entities = self._verify_org_entities_by_ner_consistency(ner_entities, ner_types)
                    entities.extend(ner_entities)
                except Exception as e:
                    logger.warning(f"NER 模型识别出错: {e}")

        before_rules = len(entities)
        entities = apply_entity_rules(text, entities)
        if len(entities) != before_rules:
            logger.info("PIPT 本地规则过滤: %s -> %s", before_rules, len(entities))
        entities = self._deduplicate_entities(entities)

        if not llm_enabled:
            logger.info(f"识别完成（纯NER）: {len(entities)} 个实体")
            return entities

        # Phase 1：LLM 校验 NER 候选（verify_only / augment 共用）
        entities = self._verify_entities_with_llm(text, entities)
        entities = apply_entity_rules(text, entities)

        # Phase 2 & 3：augment 模式下主动挖掘 + 二次核验
        if llm_mode == "augment":
            extra = self._augment_entities_with_llm(text, entities, target_entities)
            if extra:
                extra = self._verify_extra_entities(text, extra)
                all_entities = entities + extra
                all_entities = apply_entity_rules(text, all_entities)
                entities = self._deduplicate_entities(all_entities)
                logger.info(f"[augment] Phase2 挖掘到 {len(extra)} 个额外实体，合并后共 {len(entities)} 个")

        logger.info(f"识别完成 [{llm_mode}]: {len(entities)} 个实体")
        return entities

    # ──────────────────────────────────────────────────────────────────────────
    # LLM 辅助方法
    # ──────────────────────────────────────────────────────────────────────────

    def _call_llm(self, prompt: str, timeout: int = 600) -> Optional[str]:
        """
        统一的本地 LLM 调用封装（同步 block）。
        自动检测 Ollama 原生接口（端口 11434）→ 走 /api/chat + think=false 彻底关闭推理链。
        其他接口走 OpenAI 兼容 /v1/chat/completions。
        返回 content 字符串，失败返回 None。
        """
        import os
        import requests

        api_url = os.environ.get("PIPT_LLM_VERIFY_API_URL", "http://localhost:8000/v1/chat/completions")
        model = os.environ.get("PIPT_LLM_VERIFY_MODEL", "qwen-chat")
        api_key = os.environ.get("PIPT_LLM_VERIFY_API_KEY", "EMPTY")

        def _extract_text_from_openai_json(data: dict) -> str:
            """
            兼容不同 OpenAI-like 网关返回结构，尽可能提取可用文本。
            """
            # 1) 标准 choices[0].message.content
            choices = data.get("choices") or []
            if choices:
                msg = (choices[0] or {}).get("message") or {}
                content = msg.get("content")
                if isinstance(content, str) and content.strip():
                    return content
                if isinstance(content, list):
                    parts = []
                    for seg in content:
                        if isinstance(seg, dict):
                            txt = seg.get("text") or seg.get("content")
                            if isinstance(txt, str) and txt.strip():
                                parts.append(txt)
                        elif isinstance(seg, str) and seg.strip():
                            parts.append(seg)
                    if parts:
                        return "\n".join(parts)

                # 2) 一些网关把正文放在 reasoning_content / reasoning
                for k in ("reasoning_content", "reasoning", "output_text"):
                    v = msg.get(k)
                    if isinstance(v, str) and v.strip():
                        return v

                # 3) 兼容流式拼接格式（偶发）
                delta = (choices[0] or {}).get("delta") or {}
                delta_content = delta.get("content")
                if isinstance(delta_content, str) and delta_content.strip():
                    return delta_content

            # 4) 某些供应商直接给顶层 output_text
            top_output = data.get("output_text")
            if isinstance(top_output, str) and top_output.strip():
                return top_output

            # 5) 自定义网关：assistant_response / response
            for key in ("assistant_response", "response"):
                v = data.get(key)
                if isinstance(v, str) and v.strip():
                    return v

            return ""

        headers = {"Content-Type": "application/json"}
        if api_key and api_key != "EMPTY":
            headers["Authorization"] = f"Bearer {api_key}"

        # 检测 Ollama 原生接口（端口 11434），走 /api/chat 以支持 think=false
        is_ollama = ":11434" in api_url
        if is_ollama:
            # 将 /v1/chat/completions 替换为 /api/chat
            base_url = api_url.split("/v1/")[0] if "/v1/" in api_url else api_url.rstrip("/")
            native_url = f"{base_url}/api/chat"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "think": False,  # Ollama 原生参数，彻底关闭思考链
                "options": {"temperature": 0.1},
            }
            try:
                resp = requests.post(native_url, json=payload, headers=headers, timeout=timeout)
                if resp.status_code == 200:
                    body = resp.json()
                    content = (
                        (body.get("message") or {}).get("content", "")
                        or body.get("assistant_response", "")
                        or body.get("response", "")
                        or body.get("output_text", "")
                    )
                    if not content or not content.strip():
                        logger.warning("Ollama 返回空内容")
                        return None
                    return content
                logger.warning(f"Ollama API 返回非 200: {resp.status_code} {resp.text[:150]}")
            except Exception as e:
                logger.warning(f"Ollama 请求异常: {e}")
            return None

        # 非 Ollama：走 OpenAI 兼容接口
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "/no_think"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "stream": False,
        }
        try:
            resp = requests.post(api_url, json=payload, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                body = resp.json()
                content = _extract_text_from_openai_json(body)
                if not content or not content.strip():
                    logger.warning(f"LLM API 返回空内容（model={model}, url={api_url}）")
                    return None
                return content
            logger.warning(f"LLM API 返回非 200: {resp.status_code} {resp.text[:150]}")
        except Exception as e:
            logger.warning(f"LLM 请求异常: {e}")
        return None



    @staticmethod
    def _parse_llm_json(content: str):
        """从 LLM 输出中提取 JSON（兼容 markdown 包裹、思考链标签）"""
        import json
        import re
        # 剥离 Qwen3 思考链标签 <think>...</think>
        content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
        # 剥离 ```json ... ``` 包裹
        fence = re.search(r'```(?:json)?\s*(.*?)```', content, re.DOTALL)
        raw = fence.group(1).strip() if fence else content
        # 找最外层 { } 或 [ ]
        for pattern in (r'\{.*\}', r'\[.*\]'):
            m = re.search(pattern, raw, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    continue
        logger.warning(f"[_parse_llm_json] 未找到合法 JSON，原始内容: {content[:200]}")
        return None

    def _verify_entities_with_llm(self, text: str, entities: list[EntityItem]) -> list[EntityItem]:
        """Phase 1：对 NER 候选实体进行 LLM 上下文校验（keep / discard / correct）"""
        if not entities:
            return entities

        items_data = []
        for i, ent in enumerate(entities):
            start_idx = max(0, ent.start - 30)
            end_idx = min(len(text), ent.end + 30)
            context = text[start_idx:end_idx].replace('\n', ' ')
            items_data.append(
                f"[{i}] 类型: {ent.entity_type}, 实体: '{ent.text}', 上下文: '...{context}...'"
            )

        prompt = (
            "你是一个敏感信息实体校验专家。以下是自动化程序从文档文本中提取的实体候选列表。\n"
            "请逐条判断每个实体是否确实是一个【真实的人名或机构名】，给出 keep / discard / correct：\n\n"
            "**discard 的情况（必须丢弃）：**\n"
            "- 内部部门名（如'开发部'、'集群部'、'数据中台'）\n"
            "- 明显是词语截断碎片（如'大模型推理部'实际是'部署'被截断、'提供部'实际是'提供部署工具'被截断）\n"
            "- 通用技术术语而非实体（如'K8s'、'Ray'）\n\n"
            "**correct 的情况：**\n"
            "- 实体确实存在但边界不准确时，corrected_text 填写【修正后的实体名称】（几个字），不要填上下文原文\n\n"
            '输出格式：严格 JSON 对象 {"results": [{"index": 0, "action": "keep|discard|correct", "corrected_text": "..."}]}\n\n'
            "示例输出：\n"
            '{"results": [{"index": 0, "action": "discard"}, {"index": 1, "action": "keep"}, {"index": 2, "action": "correct", "corrected_text": "华为技术有限公司"}]}\n\n'
            f"待校验实体：\n{chr(10).join(items_data)}\n\n"
            "只输出合法 JSON，不要 markdown 代码块标记，不要多余文字。"
        )

        logger.info(f"[Phase1-verify] 发起校验请求: {len(entities)} 个实体")
        content = self._call_llm(prompt)
        if content is None:
            return entities

        res_json = self._parse_llm_json(content)
        # 兼容 LLM 返回数组格式（应为 {"results": [...]}, 但模型可能直接返回 [...]）
        if isinstance(res_json, list):
            res_json = {"results": res_json}
        if not isinstance(res_json, dict):
            logger.warning(f"[Phase1-verify] LLM 返回格式异常，跳过校验: {content[:120]}")
            return entities

        action_map = {item.get("index"): item for item in res_json.get("results", [])}
        verified = []
        for i, ent in enumerate(entities):
            info = action_map.get(i, {})
            action = info.get("action", "keep")
            if action == "discard":
                continue
            if action == "correct":
                corrected = info.get("corrected_text", ent.text)
                window = text[max(0, ent.start - 5): min(len(text), ent.end + 5)]
                if corrected and corrected in window:
                    ent.text = corrected
            verified.append(ent)

        logger.info(f"[Phase1-verify] 校验完成: {len(entities)} → {len(verified)}")
        return verified

    def _augment_entities_with_llm(
        self, text: str, known_entities: list[EntityItem], target_entities: list[str]
    ) -> list[EntityItem]:
        """
        Phase 2：LLM 主动挖掘——在原文中搜索 NER 漏掉的敏感实体。
        已知实体作为参照，仅返回额外新实体；分块处理防止上下文溢出。
        """
        chunk_size = 800
        extra_entities: list[EntityItem] = []
        known_texts = {e.text for e in known_entities}

        # LLM 主动挖掘只补正则无法覆盖的人名和机构名，其他类型正则召回率已足够
        llm_augment_types = {"name", "org"} & set(target_entities)
        if not llm_augment_types:
            return []

        entity_type_zh = {"name": "人名", "org": "机构/公司名"}
        target_zh = "、".join(entity_type_zh.get(t, t) for t in llm_augment_types)

        for chunk_start in range(0, len(text), chunk_size):
            chunk = text[chunk_start: chunk_start + chunk_size]
            if not chunk.strip():
                continue

            known_hint = "、".join(f"'{t}'" for t in known_texts) if known_texts else "（无）"
            prompt = (
                f"以下是一段文档文本，请从中识别所有【{target_zh}】（不包含电话、邮箱、银行卡等，只找人名和机构名）。\n"
                "要求：\n"
                "1. 只返回确实可信的实体，不要捕风捉影\n"
                f"2. 以下实体已被识别，请跳过（不要重复）：{known_hint}\n"
                '3. 输出格式：严格 JSON 对象，包含 entities 数组，每个元素：{"text": "实体文本", "type": "name|org"}\n\n'
                f"文本段落：\n{chunk}\n\n"
                "只输出合法 JSON，不要 markdown 代码块标记，不要多余文字。"
            )

            logger.debug(f"[Phase2-augment] 处理文本块 offset={chunk_start}")
            content = self._call_llm(prompt, timeout=600)
            if content is None:
                continue

            res_json = self._parse_llm_json(content)
            if not isinstance(res_json, dict):
                logger.debug(f"[Phase2-augment] 返回格式异常，跳过该块: {content[:80]}")
                continue

            for item in res_json.get("entities", []):
                ent_text = item.get("text", "").strip()
                ent_type = item.get("type", "")
                # 只接受本模式关注的类型，并且不与已知实体重复
                if not ent_text or ent_type not in llm_augment_types or ent_text in known_texts:
                    continue
                pos = chunk.find(ent_text)
                if pos < 0:
                    continue  # 找不到位置视为幻觉，丢弃
                abs_start = chunk_start + pos
                extra_entities.append(EntityItem(
                    text=ent_text,
                    entity_type=ent_type,
                    start=abs_start,
                    end=abs_start + len(ent_text),
                    source="llm",
                    confidence=0.72,
                    reason="llm_augment",
                ))
                known_texts.add(ent_text)  # 防跨块重复

        logger.info(f"[Phase2-augment] 挖掘到 {len(extra_entities)} 个额外候选实体")
        return extra_entities

    def _verify_extra_entities(self, text: str, entities: list[EntityItem]) -> list[EntityItem]:
        """
        Phase 3：对 LLM 自主挖掘出的实体进行二次上下文核验。
        2b 小模型存在幻觉风险，为必要的质量门禁。
        保守策略：宁可放过 false negative，不可误杀 false positive。
        """
        if not entities:
            return []

        items_data = []
        for i, ent in enumerate(entities):
            start_idx = max(0, ent.start - 40)
            end_idx = min(len(text), ent.end + 40)
            context = text[start_idx:end_idx].replace('\n', ' ')
            items_data.append(
                f"[{i}] 类型: {ent.entity_type}, 实体: '{ent.text}', 上下文: '...{context}...'"
            )

        prompt = (
            "你是严格的敏感信息核验员。以下实体由 AI 从文档中主动挖掘，可能包含误识别。\n"
            "请结合上下文判断每个实体是否确实属于所标注的敏感信息类别：\n"
            "- 若确实代表该类型的敏感信息 → keep\n"
            "- 若是普通词汇或误识别 → discard\n"
            "- 宁可放过，不可误杀\n\n"
            '输出格式：严格 JSON 对象，包含 results 数组，每个元素：{"index": <序号>, "action": "keep|discard"}\n\n'
            f"待核验实体：\n{chr(10).join(items_data)}\n\n"
            "只输出合法 JSON，不要 markdown 代码块标记，不要多余文字。"
        )

        logger.info(f"[Phase3-verify-extra] 发起二次核验: {len(entities)} 个挖掘实体")
        content = self._call_llm(prompt)
        if content is None:
            return entities

        res_json = self._parse_llm_json(content)
        if not isinstance(res_json, dict):
            logger.warning("[Phase3-verify-extra] 格式异常，保守返回所有挖掘实体")
            return entities

        action_map = {item.get("index"): item.get("action", "keep") for item in res_json.get("results", [])}
        confirmed = [ent for i, ent in enumerate(entities) if action_map.get(i, "keep") != "discard"]
        logger.info(f"[Phase3-verify-extra] 核验完成: {len(entities)} → {len(confirmed)}")
        return confirmed

    def _full_mode_quality_filter(self, entities: list[EntityItem]) -> list[EntityItem]:
        """
        full 模式下的强规则过滤，优先提升精度（宁可少报）。
        """
        if not entities:
            return entities

        generic_terms = {
            "项目名称", "项目编号", "采购编号", "公司名称", "单位名称", "响应单位", "响应人名称",
            "响应人代表", "授权代表", "被授权人", "法定代表人", "负责人", "联系人", "盖章",
            "格式文件", "技术方案", "商务条款", "技术条款", "偏离表", "投标响应", "招标要求",
            "磋商文件", "采购人", "供应商",
        }
        valid_org_suffixes = (
            "公司", "有限公司", "集团", "研究院", "大学", "学院", "学校", "银行",
            "委员会", "合作社", "事务所", "医院", "中心", "院",
        )
        special_org_abbr = {
            "人社局", "医保局", "发改委", "国资委", "公安局", "教育局", "住建局",
            "工信部", "科技部", "财政部", "商务部", "卫健委", "统计局", "审计署",
            "税务总局", "市场监管总局", "中石油", "中石化", "中海油", "国家电网",
            "南方电网", "中国移动", "中国电信", "中国联通", "华为", "腾讯", "阿里", "百度",
        }
        cn_name_re = re.compile(r"^[\u4e00-\u9fa5]{2,4}$")

        out: list[EntityItem] = []
        for ent in entities:
            t = (ent.text or "").strip().rstrip("：:;；，,。. ")
            if not t or t in generic_terms:
                continue

            if ent.entity_type == "name":
                if not cn_name_re.match(t):
                    continue
                if any(k in t for k in ("公司", "集团", "项目", "文件", "代表", "单位", "名称")):
                    continue
            elif ent.entity_type == "org":
                if len(t) <= 2 or t in generic_terms:
                    continue
                if not (t.endswith(valid_org_suffixes) or t in special_org_abbr):
                    if not ("中国" in t or "科技" in t or "数据" in t):
                        continue
            else:
                continue

            out.append(EntityItem(
                text=t,
                entity_type=ent.entity_type,
                start=ent.start,
                end=ent.start + len(t),
                source=ent.source or "llm",
                confidence=ent.confidence or 0.7,
                reason=ent.reason or "full_mode_quality_filter",
            ))
        return self._deduplicate_entities(out)

    def _full_llm_recognize(self, text: str, target_entities: list[str]) -> list[EntityItem]:
        """
        full 模式：完全由 LLM 端到端识别，跳过 NER。
        适合知识库批处理等对延迟不敏感的场景，每块 1200 字符。
        """
        # full 模式仅让 LLM 识别人名和机构名，其他类型由正则负责
        llm_full_types = {"name", "org"} & set(target_entities)
        if not llm_full_types:
            return []

        entity_type_zh = {"name": "人名", "org": "机构/公司名"}
        target_zh = "、".join(entity_type_zh.get(t, t) for t in llm_full_types)
        chunk_size = 1200
        all_entities: list[EntityItem] = []
        seen_texts: set[str] = set()

        def _clean_chunk_for_llm(raw: str) -> str:
            """
            清理明显噪声，减少表格空行、分隔符、模板空位对识别的干扰。
            """
            import re
            lines = []
            for line in raw.splitlines():
                s = line.strip()
                if not s:
                    continue
                # 纯 markdown 表格分隔/空占位行
                if re.fullmatch(r"[|\-\s:]+", s):
                    continue
                # 主要由符号组成的噪声行
                if re.fullmatch(r"[·\.\-_=\s]{6,}", s):
                    continue
                # 常见空白占位（如“年 月 日”一类）
                s = re.sub(r"\s{2,}", " ", s)
                if len(s) <= 1:
                    continue
                lines.append(s)
            merged = "\n".join(lines)
            # 限制连续重复空白
            merged = re.sub(r"\n{3,}", "\n\n", merged).strip()
            return merged or raw

        for chunk_start in range(0, len(text), chunk_size):
            chunk = text[chunk_start: chunk_start + chunk_size]
            if not chunk.strip():
                continue
            cleaned_chunk = _clean_chunk_for_llm(chunk)

            prompt = (
                "你是招投标文档的实体抽取器，只提取真实实体，不做推理解释。\n"
                f"任务：从文本中识别【{target_zh}】。\n"
                "强约束：\n"
                "1) 只输出 JSON 对象，顶层必须是 {\"entities\": [...]}。\n"
                "2) entities 仅包含对象数组，元素格式严格为 {\"text\":\"...\",\"type\":\"name|org\"}。\n"
                "3) 禁止输出数组顶层、禁止 markdown、禁止额外字段、禁止解释文字。\n"
                "4) 若未识别到实体，必须输出 {\"entities\":[]}。\n"
                "5) 丢弃占位项/空白项/通用词（如“项目名称”“公司名称”“法定代表人”）。\n\n"
                f"待处理文本：\n{cleaned_chunk}\n\n"
                "请仅返回 JSON。"
            )

            content = self._call_llm(prompt, timeout=600)
            if content is None:
                continue

            res_json = self._parse_llm_json(content)
            if isinstance(res_json, list):
                # 兼容模型违约输出数组顶层
                entities_payload = res_json
            elif isinstance(res_json, dict):
                entities_payload = res_json.get("entities", [])
            else:
                continue

            for item in entities_payload:
                ent_text = item.get("text", "").strip()
                ent_type = item.get("type", "")
                if not ent_text or ent_type not in llm_full_types or ent_text in seen_texts:
                    continue
                pos = chunk.find(ent_text)
                if pos < 0:
                    continue  # 防幻觉
                abs_start = chunk_start + pos
                all_entities.append(EntityItem(
                    text=ent_text,
                    entity_type=ent_type,
                    start=abs_start,
                    end=abs_start + len(ent_text),
                    source="llm",
                    confidence=0.68,
                    reason="llm_full",
                ))
                seen_texts.add(ent_text)

        all_entities = self._full_mode_quality_filter(all_entities)
        import os
        full_verify = os.environ.get("PIPT_LLM_FULL_VERIFY", "true").lower() == "true"
        if full_verify and all_entities:
            all_entities = self._verify_extra_entities(text, all_entities)

        logger.info(f"[full] LLM 端到端识别完成: {len(all_entities)} 个实体")
        return all_entities



    def _ner_recognize(self, text: str, target_types: set[str]) -> list[EntityItem]:
        """使用 NER 模型识别实体"""
        if self._ner_model is None:
            return []

        entities = []

        # NER 实体类型映射
        ner_type_map = {
            "PERSON": "name",         # 人名
            "LOCATION": "addr",       # 地点
            "ORGANIZATION": "org",    # 机构
            "PER": "name",            # 兼容其他可能的人名标签
            "LOC": "addr",            # 兼容地点
            "ORG": "org",             # 兼容机构
        }

        # 机构白名单后缀，用于排除类似“数据中台”等非实体的系统/项目名
        # 移除如“部”、“处”、“中心”、“实验室”等易导致内部部门/非主权机构被误判的后缀
        VALID_ORG_SUFFIXES = (
            '公司', '企业', '厂', '局', '委员会',
            '集团', '院',  '大学', '学校', '银行', 
            '网点', '协会', '合作社'
        )
        
        # 常见机构/央国企专有简写白名单（豁免长度和后缀拦截）
        SPECIAL_ORG_ABBR = {
            '人社局', '医保局', '发改委', '国资委', '公安局', '教育局', '住建局',
            '工信部', '科技部', '财政部', '商务部', '卫健委', '统计局', '审计署',
            '税务总局', '市场监管总局', '水利部', '农业部', '交通部', '司法部',
            '中石油', '中石化', '中海油', '国家电网', '南方电网', '中国移动',
            '中国电信', '中国联通', '中建', '中交', '中铁', '工商银行', '建设银行',
            '农业银行', '中国银行', '交通银行', '邮储银行', '招商银行', '阿里', 
            '腾讯', '百度', '字节', '华为', '平安', '清华', '北大', '上交', '复旦'
        }

        try:
            # TODO: 暂时简单粗暴地按最大 1024 字符分块，避免长文本 OOM
            # 为了防止把实体切断在块边缘，理想情况应该按段落/换行切分，但这里先用固定长度+重叠的策略解决燃眉之急
            chunk_size = 1000
            overlap = 50
            
            for i in range(0, len(text), chunk_size - overlap):
                chunk_text = text[i:i + chunk_size]
                if not chunk_text.strip():
                    continue
                    
                for entity_text, mapped_type, ner_label in self._raw_ner_items(chunk_text, ner_type_map):
                    if not mapped_type:
                        continue
                        
                    # org 类型过滤策略：当 LLM 开启且放宽模式时跳过后缀/长度校验，决策权交给 LLM。
                    # 之后仍会做多模板 NER 自一致性校验，避免原句上下文造成的机构长片段误报。
                    if mapped_type == "org":
                        import os
                        llm_enabled = os.environ.get("PIPT_LLM_VERIFY_ENABLED", "false").lower() == "true"
                        ner_relaxed = os.environ.get("PIPT_LLM_NER_RELAXED", "false").lower() == "true"
                        if not (llm_enabled and ner_relaxed):
                            # 保守模式：仍做后缀/长度过滤
                            if entity_text in SPECIAL_ORG_ABBR:
                                pass  # 白名单内直接放行
                            else:
                                if not entity_text.endswith(VALID_ORG_SUFFIXES):
                                    continue
                                if len(entity_text) <= 3:
                                    continue

                    if mapped_type in target_types:
                        # 查找该实体在这个 chunk 中的相对位置
                        chunk_start = chunk_text.find(entity_text)
                        if chunk_start >= 0:
                            # 计算在原始大文本中的绝对位置
                            abs_start = i + chunk_start
                            entities.append(EntityItem(
                                text=entity_text,
                                entity_type=mapped_type,
                                start=abs_start,
                                end=abs_start + len(entity_text),
                                source="ner",
                                confidence=0.82,
                                reason=f"hanlp_{ner_label}",
                            ))
        except Exception as e:
            logger.warning(f"NER 解析错误: {e}")

        return entities

    def _raw_ner_items(self, text: str, ner_type_map: dict[str, str]) -> list[tuple[str, str, str]]:
        if self._ner_model is None or not str(text or "").strip():
            return []
        tokens = self._ner_model["tok"](text)
        ner_results = self._ner_model["ner"](tokens)
        items: list[tuple[str, str, str]] = []
        for item in ner_results:
            if len(item) < 2:
                continue
            entity_text = item[0] if isinstance(item[0], str) else str(item[0])
            ner_label = item[1] if isinstance(item[1], str) else str(item[1])
            mapped_type = ner_type_map.get(ner_label, "")
            if entity_text:
                items.append((entity_text, mapped_type, ner_label))
        return items

    def _verify_org_entities_by_ner_consistency(
        self,
        entities: list[EntityItem],
        target_types: set[str],
    ) -> list[EntityItem]:
        """用多条中性句重跑 NER，过滤依赖原句上下文才成立的机构误识别。"""
        if "org" not in target_types or self._ner_model is None:
            return entities

        ner_type_map = {
            "ORGANIZATION": "org",
            "ORG": "org",
        }
        templates = (
            "本项目涉及{org}。",
            "{org}参与了项目论证。",
            "相关单位包括{org}。",
        )
        verified: list[EntityItem] = []
        cache: dict[str, bool] = {}
        for entity in entities:
            if entity.entity_type != "org" or entity.source != "ner":
                verified.append(entity)
                continue
            candidate = str(entity.text or "").strip()
            if candidate not in cache:
                hits = 0
                for template in templates:
                    sentence = template.format(org=candidate)
                    try:
                        raw_items = self._raw_ner_items(sentence, ner_type_map)
                    except Exception as exc:
                        logger.debug("机构 NER 自一致性校验失败，保留候选: %s", exc)
                        hits = len(templates)
                        break
                    if any(text_value == candidate and mapped_type == "org" for text_value, mapped_type, _label in raw_items):
                        hits += 1
                cache[candidate] = hits >= 2
            if cache[candidate]:
                entity.reason = f"{entity.reason}|org_ner_consistency"
                verified.append(entity)
            else:
                logger.info("PIPT 机构 NER 自一致性过滤: %s", candidate)
        return verified

    def _deduplicate_entities(self, entities: list[EntityItem]) -> list[EntityItem]:
        """去除无效或重叠实体，避免短实体覆盖长实体导致错映射。"""
        if len(entities) <= 1:
            return [
                entity for entity in entities
                if entity.text and entity.start >= 0 and entity.end > entity.start
            ]

        valid_entities = [
            entity for entity in entities
            if entity.text and entity.start >= 0 and entity.end > entity.start
        ]
        if len(valid_entities) <= 1:
            return valid_entities

        # 长实体优先保留；再按位置输出，避免同一区间内短词被误替换。
        by_priority = sorted(valid_entities, key=lambda e: (-(e.end - e.start), e.start, e.entity_type))
        selected: list[EntityItem] = []
        occupied: list[tuple[int, int]] = []
        seen = set()
        for entity in by_priority:
            key = (entity.start, entity.end, entity.entity_type, entity.text)
            if key in seen:
                continue
            seen.add(key)
            if any(entity.start < end and entity.end > start for start, end in occupied):
                continue
            selected.append(entity)
            occupied.append((entity.start, entity.end))

        return sorted(selected, key=lambda e: (e.start, e.end))

    def desensitize(
        self,
        text: str,
        target_entities: list[str],
        method: str = "mask",
        placeholder_format: str = "{{__PIPT_{type}_{index}__}}",
        placeholder_protocol: str = "legacy",
        db_session=None,
        llm_mode: Optional[str] = None,
        audit_context: Optional[dict] = None,
    ) -> DesensitizeResponse:
        """
        Args:
            llm_mode: 覆盖环境变量 PIPT_LLM_MODE（"verify_only" / "augment" / "full"）
                      实时文档流程不传（默认 verify_only），KB sync 传 "augment"
        """
        # 识别实体（透传 llm_mode 覆盖）
        entities = self.recognize(text, target_entities, llm_mode_override=llm_mode)

        audit_context = audit_context or {}
        audit_source = str(audit_context.get("source") or "engine.desensitize")
        audit_session_id = audit_context.get("session_id")
        audit_project_id = audit_context.get("project_id")
        audit_task_id = audit_context.get("task_id")

        if not entities:
            _ = (db_session, audit_source, audit_session_id, audit_project_id, audit_task_id)
            return DesensitizeResponse(
                desensitized_text=text,
                mapping_table={},
                entities=[],
                entity_count=0,
                placeholder_manifest={},
                placeholder_policy=build_placeholder_policy(),
            )

        # 按位置从后往前替换（避免位置偏移）
        sorted_entities = sorted(entities, key=lambda e: e.start, reverse=True)
        mapping_table = {}
        manifest_entity_types: dict[str, str] = {}
        manifest_entity_contexts: dict[str, dict[str, str]] = {}
        result_text = text
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        stateless_placeholders: dict[str, str] = {}
        stateless_legacy_indices: dict[str, int] = {}
        _ = (db_session, audit_source, audit_session_id, audit_project_id, audit_task_id)

        for entity in sorted_entities:
            original = entity.text
            entity_type = entity.entity_type
            current_slice = text[entity.start:entity.end]
            if current_slice != original:
                logger.warning(
                    "跳过位置不一致的 PIPT 实体: type=%s start=%s end=%s expected_len=%s actual_len=%s",
                    entity_type,
                    entity.start,
                    entity.end,
                    len(original),
                    len(current_slice),
                )
                continue

            # ── 占位符分配 ────────────────────────────────────────────────────
            ekey = hashlib.sha256(f"{original}|{entity_type}".encode("utf-8")).hexdigest()
            if str(placeholder_protocol or "").strip().lower() == "strong":
                placeholder = stateless_placeholders.get(ekey)
                if not placeholder:
                    placeholder = make_stable_strong_pipt_token(
                        ekey,
                        entity_type,
                        text_hash=text_hash,
                        salt=str(audit_session_id or audit_project_id or audit_task_id or ""),
                    )
                    stateless_placeholders[ekey] = placeholder
            else:
                counter = stateless_legacy_indices.get(ekey)
                if counter is None:
                    counter = self._placeholder_counter.get(entity_type, 0) + 1
                    self._placeholder_counter[entity_type] = counter
                    stateless_legacy_indices[ekey] = counter
                placeholder = placeholder_format.replace("{type}", entity_type).replace("{index}", str(counter))

            # ── 替换执行 ──────────────────────────────────────────────────────
            if method == "mask":
                mask_fn = self.mask_functions.get(entity_type, self.default_mask)
                try:
                    replacement = mask_fn(original, "*")
                except Exception:
                    replacement = "*" * len(original)
            elif method == "placeholder":
                replacement = placeholder
            else:
                replacement = "*" * len(original)

            # 始终以占位符作为 mapping_table 的 key（mask 模式也记录，用于还原）
            mapping_table[placeholder] = original
            manifest_entity_types[placeholder] = entity_type
            context_start = max(0, int(entity.start) - 80)
            context_end = min(len(text), int(entity.end) + 80)
            source_context = text[context_start:context_end].strip()
            source_context_with_token = (
                text[context_start:entity.start]
                + placeholder
                + text[entity.end:context_end]
            ).strip()
            manifest_entity_contexts[placeholder] = {
                "original": original,
                "source_context": source_context,
                "source_context_with_token": source_context_with_token,
            }
            result_text = result_text[:entity.start] + replacement + result_text[entity.end:]
        return DesensitizeResponse(
            desensitized_text=result_text,
            mapping_table=mapping_table,
            entities=entities,
            entity_count=len(entities),
            placeholder_manifest=build_placeholder_manifest(
                mapping_table,
                manifest_entity_types,
                manifest_entity_contexts,
            ),
            placeholder_policy=build_placeholder_policy(),
        )


    def reset_counter(self):
        """重置占位符计数器（每次新任务时调用）"""
        self._placeholder_counter.clear()

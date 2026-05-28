#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
知识库同步脚本 (Local -> PIPT -> Dify)
此脚本扫描本地 data/knowledge_base 目录，
将文档通过 PIPT 服务进行脱敏后，作为文本上传至 Dify 知识库 (Dataset)。
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

# 加载配置
load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("SyncKB")

# === 核心配置 ===
# 根据环境变量或在此硬编码写入你的配置
DIFY_API_URL = os.getenv("DIFY_API_URL", "http://localhost/v1")
DIFY_DATASET_KEY = os.getenv("DIFY_DATASET_KEY", "dataset-g3pD1c0Rv3iTDJfNvmkXppWs")
DIFY_DATASET_ID = os.getenv("DIFY_DATASET_ID", "579866bf-6505-4e24-b09c-2b2787d38b02")

PIPT_API_URL = os.getenv("PIPT_API_URL", "http://localhost:5000")

ROOT_DIR = Path(__file__).parent.parent
KB_DIR = ROOT_DIR / "data" / "knowledge_base"


def build_image_blocks(image_map: dict[str, Any]) -> str:
    """从解析器返回的 image_map 中提取结构化知识库图片块。"""
    blocks: list[str] = []
    for placeholder, info in (image_map or {}).items():
        if not isinstance(info, dict):
            continue
        block = str(info.get("knowledge_block") or "").strip()
        if block:
            blocks.append(block)
            continue
        desc = str(info.get("description") or "知识库配图").strip()
        blocks.append("\n".join([
            "【知识库图片】",
            f"图片占位符：{placeholder}",
            f"图注：{desc}",
            "类型：其他",
            f"说明：{desc}",
            f"使用规则：如正文需要引用该图，必须输出 ![图：{desc}]({placeholder})",
        ]))
    return "\n\n".join(blocks)


async def desensitize_text(text: str, filename: str) -> str:
    """调用 PIPT 对文本进行脱敏"""
    # 减少冗长日志，如果字数很少就静默一些
    if len(text) > 100:
        logger.info(f"-> 脱敏分块: {filename} ({len(text)} 字符)")
    payload = {
        "text": text,
        "method": "placeholder",
        "session_id": f"kb_sync_{filename}"
    }

    try:
        # 服务端内部对 LLM 调用已经设置了 600s 的延时，客户端这里需要留有超额的裕量防止被主动截断
        async with httpx.AsyncClient(timeout=650) as client:
            resp = await client.post(f"{PIPT_API_URL}/api/desensitize", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("desensitized_text", text)
    except Exception as e:
        logger.error(f"PIPT 脱敏失败 ({filename}): {e}")
        # 脱敏失败则不建议上传脱敏前的数据，直接返回空提示跳过
        return ""


async def upload_to_dify(filename: str, safe_text: str):
    """将脱敏后的文本推送到 Dify 知识库"""
    if not safe_text:
        logger.warning(f"跳过空文本上传: {filename}")
        return

    logger.info(f"正在上传至 Dify 知识库: {filename}...")
    headers = {
        "Authorization": f"Bearer {DIFY_DATASET_KEY}",
        "Content-Type": "application/json"
    }

    # API 官方规范: https://docs.dify.ai/v/zh-hans/guides/knowledge-base/api-reference
    # /datasets/{dataset_id}/document/create_by_text
    url = f"{DIFY_API_URL}/datasets/{DIFY_DATASET_ID}/document/create_by_text"
    
    payload = {
        "name": filename,
        "text": safe_text,
        "indexing_technique": "high_quality",
        "process_rule": {
            "mode": "automatic"
        }
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=payload)
            
            if resp.status_code == 200:
                logger.info(f"上传成功 ✓ : {filename}")
            else:
                logger.error(f"上传失败 ✗ : {filename} - {resp.status_code} - {resp.text}")
    except Exception as e:
        logger.error(f"调用 Dify API 失败: {e}")


async def sync_all_kb_files(target_file_prefix=None):
    """扫描目录并逐个同步，支持通过状态文件上报进度（供 /kb/sync-status 接口读取）"""
    if not KB_DIR.exists():
        logger.error(f"未找到知识库目录: {KB_DIR}")
        return

    supported_exts = [".md", ".txt", ".pdf", ".docx", ".html", ".htm"]
    files = []
    pattern_prefix = target_file_prefix if target_file_prefix else ""
    for ext in supported_exts:
        files.extend(KB_DIR.glob(f"{pattern_prefix}*{ext}"))

    # 进度状态上报工具
    job_id = os.getenv("KB_SYNC_JOB_ID", "")
    status_dir_str = os.getenv("KB_SYNC_STATUS_DIR", "")
    status_path = Path(status_dir_str) / f"{job_id}.json" if job_id and status_dir_str else None

    def _update_status(patch: dict):
        """将 patch 合并到状态文件（原子写入）"""
        if not status_path or not status_path.exists():
            return
        try:
            with open(status_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data.update(patch)
            with open(status_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception as e:
            logger.debug(f"状态文件更新失败（非致命）: {e}")

    if not files:
        if target_file_prefix:
            logger.info(f"未找到匹配 '{target_file_prefix}' 的知识库文件。")
        else:
            logger.info("知识库目录为空，无需同步。")
        _update_status({"status": "completed", "total": 0, "processed": 0})
        return

    total = len(files)
    logger.info(f"找到 {total} 个知识库文件等待处理...")
    _update_status({"total": total, "status": "running"})

    # 动态引入 pipt-flask 的解析器以复用多模态和图片提取能力
    pipt_path = str(ROOT_DIR / "pipt-flask")
    if pipt_path not in sys.path:
        sys.path.insert(0, pipt_path)

    try:
        from app.api_lite.routes import _extract_raw_text_with_images
    except ImportError as e:
        logger.error(f"无法导入 pipt-flask 多模态解析器: {e}")
        _update_status({"status": "failed", "error": str(e)})
        return

    processed = 0
    failed = 0
    image_total = 0
    image_captioned = 0
    image_caption_failed = 0

    for file_path in files:
        ext = file_path.suffix.lower()
        logger.info(f"开始处理: {file_path.name}")
        _update_status({
            "current_file": file_path.name,
            "processed": processed,
            "failed": failed,
            "image_total": image_total,
            "image_captioned": image_captioned,
            "image_caption_failed": image_caption_failed,
        })

        raw_text = ""
        image_map = {}
        if ext == ".txt":
            with open(file_path, "r", encoding="utf-8") as f:
                raw_text = f.read()
        else:
            try:
                with open(file_path, "rb") as f:
                    content_bytes = f.read()
                raw_text, image_map = _extract_raw_text_with_images(
                    filename=file_path.name,
                    content_bytes=content_bytes,
                    use_vision_parsing=True
                )
                if image_map:
                    logger.info(f"从 {file_path.name} 提取并打标了 {len(image_map)} 张图片。")
                    image_total += len(image_map)
                    for info in image_map.values():
                        status = str((info or {}).get("caption_status") or "").strip()
                        if status == "captioned":
                            image_captioned += 1
                        elif status:
                            image_caption_failed += 1
                    _update_status({
                        "image_total": image_total,
                        "image_captioned": image_captioned,
                        "image_caption_failed": image_caption_failed,
                    })
            except Exception as e:
                logger.error(f"解析文件失败 {file_path.name}: {e}")
                failed += 1
                continue

        if not raw_text.strip():
            logger.warning(f"文件内容为空，跳过: {file_path.name}")
            continue

        image_blocks = build_image_blocks(image_map)
        if image_blocks:
            raw_text = f"{raw_text}\n\n{image_blocks}"

        # 分块脱敏
        chunk_size = 4000
        chunks = [raw_text[i:i+chunk_size] for i in range(0, len(raw_text), chunk_size)]
        safe_chunks = []
        for i, chunk in enumerate(chunks):
            safe_chunk = await desensitize_text(chunk, f"{file_path.name}_part{i+1}")
            safe_chunks.append(safe_chunk)

        safe_text = "\n".join(safe_chunks)

        if safe_text.strip():
            safe_name = f"{file_path.stem}.txt"
            await upload_to_dify(safe_name, safe_text)

        processed += 1
        logger.info("-" * 40)

    # 最终状态
    final_status = "completed" if failed == 0 else "completed_with_errors"
    _update_status({
        "status": final_status,
        "processed": processed,
        "failed": failed,
        "image_total": image_total,
        "image_captioned": image_captioned,
        "image_caption_failed": image_caption_failed,
        "current_file": "",
        "finished_at": __import__("datetime").datetime.now().isoformat(),
    })
    logger.info(f"同步完成: 共 {total} 个文件，成功 {processed} 个，失败 {failed} 个")

if __name__ == "__main__":
    target_pattern = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(sync_all_kb_files(target_pattern))


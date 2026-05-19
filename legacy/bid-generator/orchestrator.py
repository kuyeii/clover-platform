#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ProEngine 全流程编排器 (基于子进程解耦架构)
串联 gateway-in → pipt-flask → prompt-forge → dify-bridge → gateway-out
"""

import argparse
import asyncio
import json
import logging
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
import yaml

ROOT_DIR = Path(__file__).parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ProEngine")

def load_config(config_path: str) -> dict:
    path = Path(config_path)
    if not path.exists():
        logger.error(f"配置文件不存在: {config_path}")
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def run_sub_process(cmd: list, cwd: Path) -> str:
    """运行子进程并返回标准输出内容"""
    try:
        result = subprocess.run(
            cmd, cwd=cwd, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        logger.error(f"====== 子模块执行失败: {' '.join(cmd)} ======")
        logger.error(f"--- STDOUT ---\n{e.stdout}")
        logger.error(f"--- STDERR ---\n{e.stderr}")
        logger.error("=========================================")
        raise RuntimeError(f"子模块执行异常, 查看上方日志。")
# ==================== 阶段 1: 入口网关 ====================
def step_1_parse_input(config: dict, input_path: str, tier: Optional[int]) -> dict:
    logger.info(f"[阶段 1] 运行 gateway-in: 解析输入文件 {input_path}")
    cwd = ROOT_DIR / "gateway-in"
    
    # 我们通过修改 gateway-in 的 main.py 支持 --json-output 或者在这里直接从控制台截取结果 (之前没写CLI完整输出)
    # 临时直接在本项目用 Python patch 调用，规避 import 错误
    
    # 实际上由于之前各子工作区只写了核心类，缺少完整的 CLI 返回 JSON，这边我们直接写一个 runner 脚本动态执行
    runner_script = f"""
import sys, json
sys.path.insert(0, "{cwd}")
from src.config import GatewayInConfig
from src.main import process_file
import dataclasses

class EnhancedJSONEncoder(json.JSONEncoder):
    def default(self, o):
        if dataclasses.is_dataclass(o):
            return dataclasses.asdict(o)
        if hasattr(o, 'to_markdown'):
            return o.to_markdown()
        return super().default(o)

config = GatewayInConfig.from_yaml("{ROOT_DIR / config.get('_config_path', 'config.yaml')}")
result = process_file("{input_path}", {repr(tier)}, config)
print("===JSON_START===")
print(json.dumps(result, cls=EnhancedJSONEncoder, ensure_ascii=False))
"""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(runner_script)
        temp_path = f.name
        
    try:
        stdout = run_sub_process([sys.executable, temp_path], cwd=cwd)
        json_str = stdout.split("===JSON_START===")[-1].strip()
        parsed_data = json.loads(json_str)
        logger.info(f"[阶段 1] 完成 ✓ — Tier {parsed_data.get('tier')}")
        return parsed_data
    finally:
        Path(temp_path).unlink()

# ==================== 阶段 2: 前置全量脱敏 (PIPT Initialization) ====================
async def step_2_desensitize(config: dict, parsed_data: dict) -> dict:
    if parsed_data.get("tier") == 1:
        logger.info("[阶段 2] Tier 1 文件，跳过脱敏 ✓")
        parsed_data["safe_text"] = parsed_data.get("raw_text", "")
        return parsed_data

    logger.info("[阶段 2] 运行 pipt-flask: 进行前置全量数据脱敏...")
    pipt_config = config.get("pipt", {})
    pipt_url = pipt_config.get("base_url", "http://localhost:5000")
    
    payload = {
        "text": parsed_data.get("raw_text", ""),
        # 根据文件的所属领域决定 profile。这里可以做成可配置的映射，目前简单认为只要过 PIPT 的默认就是 default，如果是从 tender 目录读取的可以设为 tender
        # 我们根据输入文件的来源或者默认设置来决定 profile。这里我们传 "tender" 因为工作流主要涉及招标文件。
        "profile": "tender",
        "session_id": config.get("_session_name", "") # 从上游获取
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{pipt_url}/api/desensitize", json=payload)
        response.raise_for_status()
        result = response.json()

    # 这里的 mapping_table 缓存在 pipt-lite 中台，我们只需要拿到安全的 safe_text
    parsed_data["safe_text"] = result["desensitized_text"]
    logger.info(f"[阶段 2] 完成 ✓ — 识别敏感实体 {result.get('entity_count', 0)} 个")
    return parsed_data

# ==================== 阶段 3: 全局蓝图规划 (Blueprint Generation) ====================
def step_3_generate_blueprint(config: dict, parsed_data: dict) -> str:
    logger.info("[阶段 3] 运行 prompt-forge: 生成全局技术蓝图 (Blueprint)...")
    cwd = ROOT_DIR / "prompt-forge"
    
    bid_info_dict = parsed_data.get("bid_info", {})
    payload = {
        "project_name": bid_info_dict.get("project_name", ""),
        "bid_number": bid_info_dict.get("bid_number", ""),
        "budget": bid_info_dict.get("budget", ""),
        "technical_requirements": bid_info_dict.get("technical_requirements", []),
        "scoring_criteria": bid_info_dict.get("scoring_criteria", []),
        "structured_template": parsed_data.get("structured_template", ""),
    }
    
    payload_file = cwd / ".tmp_payload_bp.json"
    prompt_file = cwd / ".tmp_prompt_bp.txt"
    with open(payload_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        
    runner_script = f"""
import sys, json
sys.path.insert(0, "{cwd}")
from src.builder import PromptBuilder

builder = PromptBuilder(templates_dir="{ROOT_DIR / 'data/templates/parse'}")
with open("{payload_file}", "r", encoding="utf-8") as f:
    data = json.load(f)
prompt = builder.build_blueprint_prompt(data)
with open("{prompt_file}", "w", encoding="utf-8") as f:
    f.write(prompt)
"""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(runner_script)
        temp_path = f.name
        
    try:
        run_sub_process([sys.executable, temp_path], cwd=cwd)
        with open(prompt_file, "r", encoding="utf-8") as f:
            blueprint_prompt = f.read().strip()
            
        logger.info(f"  [子步骤] 调用 Dify 智能中枢生成蓝图...")
        # 调用 Dify 生成蓝图
        cwd_dify = ROOT_DIR / "dify-bridge"
        query = bid_info_dict.get("project_name", "标书项目蓝图规划")
        data_str = parsed_data.get("safe_text", "")
        
        prompt_file_df = cwd_dify / ".tmp_bp_prompt.txt"
        data_file_df = cwd_dify / ".tmp_bp_data.txt"
        out_file_df = cwd_dify / ".tmp_bp_out.md"
        with open(prompt_file_df, "w", encoding="utf-8") as f: f.write(blueprint_prompt)
        with open(data_file_df, "w", encoding="utf-8") as f: f.write(data_str)
        
        runner_dify = f"""
import sys, asyncio
sys.path.insert(0, "{cwd_dify}")
from src.config import DifyConfig
from src.workflow import WorkflowManager
def main():
    config = DifyConfig.from_yaml("{ROOT_DIR / config.get('_config_path', 'config.yaml')}")
    manager = WorkflowManager(config)
    with open("{prompt_file_df}", "r", encoding="utf-8") as f: prompt_str = f.read()
    with open("{data_file_df}", "r", encoding="utf-8") as f: data_str = f.read()
    res = asyncio.run(manager.run_bid_generation(prompt_str, data_str, "{query}", "false"))
    with open("{out_file_df}", "w", encoding="utf-8") as f: f.write(res)
if __name__ == '__main__': main()
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f2:
            f2.write(runner_dify)
            temp_path_dify = f2.name
            
        run_sub_process([sys.executable, temp_path_dify], cwd=cwd_dify)
        with open(out_file_df, "r", encoding="utf-8") as f:
            blueprint = f.read().strip()
            
        # 额外保存蓝图到 output 目录
        output_dir = Path(config.get("workspace", {}).get("output_dir", "./output"))
        if not output_dir.is_absolute():
            output_dir = ROOT_DIR / output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        session_name = config.get("_session_name", "default_session")
        blueprint_file = output_dir / f"blueprint_{session_name}_{datetime.now().strftime('%H%M%S')}.md"
        with open(blueprint_file, "w", encoding="utf-8") as f:
            f.write(blueprint)
        logger.info(f"  [子步骤] 已保存全局蓝图至: {blueprint_file}")
            
        logger.info(f"[阶段 3] 完成 ✓ — 全局蓝图长度 {len(blueprint)} 字符")
        return blueprint
    except subprocess.CalledProcessError as e:
        logger.error(f"生成蓝图失败: {e}")
        return ""
    finally:
        Path(temp_path).unlink(missing_ok=True)
        payload_file.unlink(missing_ok=True)
        prompt_file.unlink(missing_ok=True)
        try:
            Path(temp_path_dify).unlink(missing_ok=True)
            prompt_file_df.unlink(missing_ok=True)
            data_file_df.unlink(missing_ok=True)
            out_file_df.unlink(missing_ok=True)
        except Exception:
            pass

async def step_3_5_generate_structure(config: dict, parsed_data: dict, blueprint: str) -> dict:
    template_type = config.get("_template_type", "auto")
    if template_type not in ("auto", "", None) and template_type != "standard.yaml":
        logger.info(f"[阶段 3.5] 已指定大纲模板 {template_type}，跳过 AI 动态生成。")
        return {}
        
    logger.info("[阶段 3.5] 运行 pipt-flask 接口进行动态架构生成...")
    pipt_config = config.get("pipt", {})
    pipt_url = pipt_config.get("base_url", "http://localhost:5000")
    
    bid_info = parsed_data.get("bid_info", {})
    payload = {
        "project_name": bid_info.get("project_name", "未命名项目"),
        "blueprint": blueprint,
        "structured_data": parsed_data.get("safe_text", "")
    }
    
    import httpx
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{pipt_url}/api/config/template/generate", json=payload)
            resp.raise_for_status()
            res_json = resp.json()
            structure_dict = res_json.get("structure_dict", {})
            
        logger.info(f"[阶段 3.5] 完成 ✓ — 动态大纲节点数: {len(structure_dict.get('blocks', []))}")
        
        # 保存结构并指定给下游
        output_dir = Path(config.get("workspace", {}).get("output_dir", "./output"))
        if not output_dir.is_absolute():
            output_dir = ROOT_DIR / output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        session_name = config.get("_session_name", "default_session")
        timestamp = datetime.now().strftime("%H%M%S")
        
        struct_file = output_dir / f"structure_{session_name}_{timestamp}.yaml"
        with open(struct_file, "w", encoding="utf-8") as f:
            yaml.dump(structure_dict, f, allow_unicode=True, sort_keys=False)
            
        config["_dynamic_struct_file"] = str(struct_file.absolute())
        return structure_dict
        
    except Exception as e:
        logger.error(f"[阶段 3.5] 动态生成架构失败，将回退到默认: {e}")
        return {}

# ==================== 阶段 4: 前后文迭代式轮式生成 (Iterative Loop) ====================
async def step_4_iterative_generation(config: dict, parsed_data: dict, blueprint: str, dynamic_struct: dict = None) -> list:
    logger.info("[阶段 4] 开始各章节轮式生成 (Iterative Loop)...")
    cwd_forge = ROOT_DIR / "prompt-forge"
    cwd_dify = ROOT_DIR / "dify-bridge"
    
    structure_id = config.get("_template_type", "auto")
    if structure_id == "auto" or not structure_id:
        structure_config = dynamic_struct or {}
        if not structure_config.get("blocks"):
            # fallback
            structure_id = "standard.yaml"
    
    if not dynamic_struct or not dynamic_struct.get("blocks"):
        runner_get_struct = f"""
import sys, json
sys.path.insert(0, "{cwd_forge}")
from src.builder import PromptBuilder
builder = PromptBuilder(templates_dir="{ROOT_DIR / 'data/templates/parse'}")
struct = builder.get_structure_config("{structure_id}")
print("===JSON_START===")
print(json.dumps(struct, ensure_ascii=False))
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(runner_get_struct)
            temp_path = f.name
            
        try:
            stdout = run_sub_process([sys.executable, temp_path], cwd=cwd_forge)
            struct_json = stdout.split("===JSON_START===")[-1].strip()
            structure_config = json.loads(struct_json)
        finally:
            Path(temp_path).unlink(missing_ok=True)
        
    sections = structure_config.get("blocks", structure_config.get("sections", []))
    logger.info(f"  [分析] 获取到结构模板 '{structure_config.get('name')}'，共切分为 {len(sections)} 个任务节点。")
    
    bid_info_dict = parsed_data.get("bid_info", {})
    payload_base = {
        "project_name": bid_info_dict.get("project_name", ""),
        "bid_number": bid_info_dict.get("bid_number", ""),
        "budget": bid_info_dict.get("budget", ""),
        "technical_requirements": bid_info_dict.get("technical_requirements", []),
        "scoring_criteria": bid_info_dict.get("scoring_criteria", []),
        "structured_template": parsed_data.get("safe_text", ""), # Dify的原始素材使用脱敏后的文本
        "preferred_template_id": config.get("_template_type", "auto"),
        "user_extra_requirements": config.get("_extra_req", ""),
    }
    
    generated_sections = []
    previous_summary = ""
    
    for idx, sec in enumerate(sections):
        logger.info(f"  [生成] ({idx+1}/{len(sections)}) 开始撰写: {sec['title']} ...")
        
        # 4.1 生成单一章节的 Prompt
        payload_file = cwd_forge / f".tmp_payload_sec_{idx}.json"
        prompt_file = cwd_forge / f".tmp_prompt_sec_{idx}.txt"
        bp_file = cwd_forge / f".tmp_bp_{idx}.txt"
        prev_file = cwd_forge / f".tmp_prev_{idx}.txt"
        sec_file = cwd_forge / f".tmp_sec_{idx}.json"
        
        with open(payload_file, "w", encoding="utf-8") as f: json.dump(payload_base, f, ensure_ascii=False)
        with open(bp_file, "w", encoding="utf-8") as f: f.write(blueprint)
        with open(prev_file, "w", encoding="utf-8") as f: f.write(previous_summary)
        with open(sec_file, "w", encoding="utf-8") as f: json.dump(sec, f, ensure_ascii=False)
            
        runner_sec_prompt = f"""
import sys, json
sys.path.insert(0, "{cwd_forge}")
from src.builder import PromptBuilder
builder = PromptBuilder(templates_dir="{ROOT_DIR / 'data/templates/parse'}")
with open("{payload_file}", "r", encoding="utf-8") as f: data = json.load(f)
with open("{sec_file}", "r", encoding="utf-8") as f: sec = json.load(f)
with open("{bp_file}", "r", encoding="utf-8") as f: bp = f.read()
with open("{prev_file}", "r", encoding="utf-8") as f: prev = f.read()

prompt = builder.build_section_prompt(data, sec, bp, prev)
with open("{prompt_file}", "w", encoding="utf-8") as f: f.write(prompt)
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(runner_sec_prompt)
            temp_path_forge = f.name
            
        run_sub_process([sys.executable, temp_path_forge], cwd=cwd_forge)
        with open(prompt_file, "r", encoding="utf-8") as f:
            section_prompt = f.read().strip()
            
        # 4.2 丢给 Dify 生成
        prompt_file_df = cwd_dify / f".tmp_sec_prompt_{idx}.txt"
        data_file_df = cwd_dify / f".tmp_sec_data_{idx}.txt"
        out_file_df = cwd_dify / f".tmp_sec_out_{idx}.md"
        with open(prompt_file_df, "w", encoding="utf-8") as f: f.write(section_prompt)
        with open(data_file_df, "w", encoding="utf-8") as f: f.write(parsed_data.get("safe_text", ""))
        
        runner_dify = f"""
import sys, asyncio
sys.path.insert(0, "{cwd_dify}")
from src.config import DifyConfig
from src.workflow import WorkflowManager
def main():
    config = DifyConfig.from_yaml("{ROOT_DIR / config.get('_config_path', 'config.yaml')}")
    manager = WorkflowManager(config)
    with open("{prompt_file_df}", "r", encoding="utf-8") as f: prompt_str = f.read()
    with open("{data_file_df}", "r", encoding="utf-8") as f: data_str = f.read()
    
    # 获取此章节是否需要检索
    requires_search = "{str(sec.get('requires_search', True)).lower()}"
    
    res = asyncio.run(manager.run_bid_generation(
        system_prompt=prompt_str, 
        structured_data=data_str, 
        knowledge_query="{payload_base['project_name']} - {sec['title']}",
        requires_search=requires_search
    ))
    with open("{out_file_df}", "w", encoding="utf-8") as f: f.write(res)
if __name__ == '__main__': main()
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f2:
            f2.write(runner_dify)
            temp_path_dify = f2.name
            
        run_sub_process([sys.executable, temp_path_dify], cwd=cwd_dify)
        with open(out_file_df, "r", encoding="utf-8") as f:
            section_draft = f.read().strip()
            
        generated_sections.append({
            "title": sec["title"],
            "content": f"# {sec['title']}\n\n{section_draft}"
        })
        
        # 4.3 摘要提取作为上文
        # 这里为了演示简单，直接截取上一章的开头和结尾作为简单摘要，也可调小模型
        summary = section_draft[:300] + "\n...\n" + section_draft[-300:] if len(section_draft) > 600 else section_draft
        previous_summary = f"【上一章: {sec['title']} 摘要】\n{summary}"
        
        # 清除临时文件
        try:
            Path(temp_path_forge).unlink(missing_ok=True)
            Path(temp_path_dify).unlink(missing_ok=True)
            payload_file.unlink(missing_ok=True)
            prompt_file.unlink(missing_ok=True)
            bp_file.unlink(missing_ok=True)
            prev_file.unlink(missing_ok=True)
            sec_file.unlink(missing_ok=True)
            prompt_file_df.unlink(missing_ok=True)
            data_file_df.unlink(missing_ok=True)
            out_file_df.unlink(missing_ok=True)
        except Exception:
            pass

    logger.info("[阶段 4] 完成 ✓ — 全部章节生成完毕")
    return generated_sections

# ==================== 阶段 4.5: 局部判定型审查 (AI Review) ====================
async def step_4_5_ai_review(config: dict, blueprint: str, sections: list) -> str:
    logger.info("[阶段 4.5] 运行 Review AI 局部审查与一致性校验...")
    cwd_forge = ROOT_DIR / "prompt-forge"
    cwd_dify = ROOT_DIR / "dify-bridge"
    
    final_markdown_parts = []
    
    for idx, sec in enumerate(sections):
        logger.info(f"  [审查] 校验章节: {sec['title']}")
        
        # 生成审稿 Prompt
        bp_file = cwd_forge / f".tmp_rev_bp_{idx}.txt"
        title_file = cwd_forge / f".tmp_rev_rt_{idx}.txt"
        draft_file = cwd_forge / f".tmp_rev_rd_{idx}.txt"
        prompt_file = cwd_forge / f".tmp_rev_rp_{idx}.txt"
        
        with open(bp_file, "w", encoding="utf-8") as f: f.write(blueprint)
        with open(title_file, "w", encoding="utf-8") as f: f.write(sec['title'])
        with open(draft_file, "w", encoding="utf-8") as f: f.write(sec['content'])
        
        runner_forge = f"""
import sys
sys.path.insert(0, "{cwd_forge}")
from src.builder import PromptBuilder
builder = PromptBuilder(templates_dir="{ROOT_DIR / 'data/templates/parse'}")
with open("{bp_file}", "r", encoding="utf-8") as f: bp = f.read()
with open("{title_file}", "r", encoding="utf-8") as f: t = f.read()
with open("{draft_file}", "r", encoding="utf-8") as f: d = f.read()
prompt = builder.build_review_prompt(bp, t, d)
with open("{prompt_file}", "w", encoding="utf-8") as f: f.write(prompt)
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(runner_forge)
            temp_path_forge = f.name
            
        run_sub_process([sys.executable, temp_path_forge], cwd=cwd_forge)
        with open(prompt_file, "r", encoding="utf-8") as f:
            review_prompt = f.read().strip()
            
        # 丢给 Dify 审稿（Review 模型）
        prompt_file_df = cwd_dify / f".tmp_rev_prompt_{idx}.txt"
        out_file_df = cwd_dify / f".tmp_rev_out_{idx}.txt"
        # 这里的 input_data 传空，因为 review_prompt 已经包含了草稿
        with open(prompt_file_df, "w", encoding="utf-8") as f: f.write(review_prompt)
        
        runner_dify = f"""
import sys, asyncio, json
sys.path.insert(0, "{cwd_dify}")
from src.config import DifyConfig
from src.workflow import WorkflowManager
def main():
    config = DifyConfig.from_yaml("{ROOT_DIR / config.get('_config_path', 'config.yaml')}")
    manager = WorkflowManager(config)
    with open("{prompt_file_df}", "r", encoding="utf-8") as f: prompt_str = f.read()
    # 强制让Dify当作普通单轮对话即可，暂借用run_bid_generation，并关闭搜索
    res = asyncio.run(manager.run_bid_generation(
        system_prompt=prompt_str,
        structured_data="请按JSON格式输出审查结果。",
        knowledge_query=f"审稿: {sec['title']}",
        requires_search="false"
    ))
    with open("{out_file_df}", "w", encoding="utf-8") as f: f.write(res)
if __name__ == '__main__': main()
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f2:
            f2.write(runner_dify)
            temp_path_dify = f2.name
            
        run_sub_process([sys.executable, temp_path_dify], cwd=cwd_dify)
        with open(out_file_df, "r", encoding="utf-8") as f:
            review_out = f.read().strip()
            
        try:
            # 尝试解析 JSON
            review_out_clean = review_out.strip()
            if review_out_clean.startswith("```json"): review_out_clean = review_out_clean[7:]
            if review_out_clean.endswith("```"): review_out_clean = review_out_clean[:-3]
            review_json = json.loads(review_out_clean)
            
            if review_json.get("requires_rewrite") and review_json.get("improved_draft"):
                logger.info(f"    -> 发现问题，执行局部重写润色。")
                for comment in review_json.get("critic_comments", []):
                    logger.info(f"       Critic: {comment}")
                final_markdown_parts.append(review_json["improved_draft"])
            else:
                logger.info(f"    -> 校验通过，保持原样。")
                final_markdown_parts.append(sec['content'])
                
        except json.JSONDecodeError:
            logger.warning(f"    -> Review AI 返回非合法JSON，兜底使用原稿件。返回内容为:{review_out[:100]}...")
            final_markdown_parts.append(sec['content'])
            
        finally:
            try:
                Path(temp_path_forge).unlink(missing_ok=True)
                Path(temp_path_dify).unlink(missing_ok=True)
                bp_file.unlink(missing_ok=True)
                title_file.unlink(missing_ok=True)
                draft_file.unlink(missing_ok=True)
                prompt_file.unlink(missing_ok=True)
                prompt_file_df.unlink(missing_ok=True)
                out_file_df.unlink(missing_ok=True)
            except Exception:
                pass
                
    full_completed_markdown = "\n\n".join(final_markdown_parts)
    logger.info("[阶段 4.5] 完成 ✓ — Markdown 组装与审改完成")
    return full_completed_markdown

# ==================== 阶段 5: 后方中台还原脱敏占位符 & 生成 Word ====================
async def step_5_generate_docx(config: dict, markdown: str, project_name: str, session_name: str, timestamp: str) -> str:
    logger.info("[阶段 5] 运行 PIpt 还原与 Gateway-out 排版...")
    cwd = ROOT_DIR / "gateway-out"
    
    # ------ 1. PIPT 中台执行脱敏映射还原 (PIPT Restoration) ------
    if session_name:
        logger.info(f"  [后置还原] 请求 pipt-lite 中台按 session_id={session_name} 执行文本映射恢复...")
        pipt_url = config.get("pipt", {}).get("base_url", "http://localhost:5000")
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(f"{pipt_url}/api/restore", json={
                    "text": markdown,
                    "session_id": session_name
                })
                resp.raise_for_status()
                result = resp.json()
                markdown = result.get("restored_text", markdown)
                logger.info(f"  [后置还原] 恢复完成，成功替换了 {result.get('restored_count', 0)} 处敏感数据。")
        except Exception as e:
            logger.error(f"  [后置还原] 中台复原失败，将采用未修改前的文本进行应急打印: {e}")
            
    # ------ 2. Gateway-out 将全真数据转换为最终的 Docx ------
    workspace_cfg = config.get("workspace", {})
    output_dir = Path(workspace_cfg.get("output_dir", "./output"))
    if not output_dir.is_absolute():
        output_dir = ROOT_DIR / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    
    safe_project_name = project_name.replace("/", "_").replace("\\", "_") if project_name else "未命名项目"
    filename = f"投标技术方案_{safe_project_name}_{session_name}_{timestamp}.docx" if session_name else f"投标技术方案_{safe_project_name}_{timestamp}.docx"
    out_path = output_dir / filename
    
    md_file = cwd / ".tmp_go_md.md"
    map_file = cwd / ".tmp_go_map.json"
    res_file = cwd / ".tmp_go_res.txt"
    
    with open(md_file, "w", encoding="utf-8") as f:
        f.write(markdown)
    with open(map_file, "w", encoding="utf-8") as f:
        json.dump({}, f) # 不再依赖内部 mapping，已被中台接管
    
    runner_script = f"""
import sys, json
sys.path.insert(0, "{cwd}")
from src.main import process_output

with open("{md_file}", "r", encoding="utf-8") as f:
    md_str = f.read()
with open("{map_file}", "r", encoding="utf-8") as f:
    mapping = json.load(f)

result_path = process_output(
    markdown_text=md_str,
    mapping_table=mapping,
    output_path="{out_path.resolve()}",
    template_path="{config.get('output', {}).get('word_template', '')}"
)

with open("{res_file}", "w", encoding="utf-8") as f:
    f.write(str(result_path))
"""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(runner_script)
        temp_path = f.name
        
    try:
        run_sub_process([sys.executable, temp_path], cwd=cwd)
        with open(res_file, "r", encoding="utf-8") as f:
            real_path = f.read().strip()
        logger.info(f"[阶段 5] 完成 ✓ → {real_path}")
        return real_path
    finally:
        Path(temp_path).unlink(missing_ok=True)
        md_file.unlink(missing_ok=True)
        map_file.unlink(missing_ok=True)
        res_file.unlink(missing_ok=True)

# ==================== 主入口 ====================
async def run_pipeline(args):
    session_name = args.session_name or "default_session"
    config = load_config(args.config)
    config["_config_path"] = args.config
    config["_session_name"] = session_name
    config["_template_type"] = args.template
    config["_extra_req"] = args.extra_req

    timestamp = datetime.now().strftime("%H%M%S")
    
    workspace_cfg = config.get("workspace", {})
    logs_dir = Path(workspace_cfg.get("logs_dir", "./logs"))
    if not logs_dir.is_absolute():
        logs_dir = ROOT_DIR / logs_dir
    date_str = datetime.now().strftime("%Y%m%d")
    log_path = logs_dir / date_str
    log_path.mkdir(parents=True, exist_ok=True)
    
    log_filename = f"{timestamp}_{session_name}.log"
    log_file = log_path / log_filename
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    logger.addHandler(file_handler)

    logger.info("=" * 60)
    logger.info(f"ProEngine Agentic 迭代替代生成系统 启动 (记录于 {log_file.name})")
    logger.info("=" * 60)

    input_abspath = str(Path(args.input).resolve())
    
    try:
        # 阶段 0: 知识库预热同步
        logger.info("[阶段 0] 开始扫描并同步本地知识库 (通过 sync_kb.py)...")
        try:
            run_sub_process([sys.executable, str(ROOT_DIR / "scripts" / "sync_kb.py")], cwd=ROOT_DIR)
            logger.info("[阶段 0] 知识库同步完成 ✓")
        except Exception as e:
            logger.warning(f"[阶段 0] 知识库同步发生非致命错误: {e}")

        # 阶段 1: 解析招标原始文档
        parsed_data = step_1_parse_input(config, input_abspath, args.tier)
        
        # 阶段 2: 前置全量脱敏
        parsed_data = await step_2_desensitize(config, parsed_data)
        
        # 阶段 3: 蓝图规划生成
        blueprint = step_3_generate_blueprint(config, parsed_data)

        # 阶段 3.5: 动态结构生成
        structure_dict = await step_3_5_generate_structure(config, parsed_data, blueprint)
        
        # 阶段 4: 前后文迭代生成各章节
        generated_sections = await step_4_iterative_generation(config, parsed_data, blueprint, structure_dict)
        
        # 阶段 4.5: 全局归集与 AI Review
        reviewed_markdown = await step_4_5_ai_review(config, blueprint, generated_sections)
        
        # 阶段 5: 后端统一还原敏感脱敏项 并 生成最终排版文件
        project_name = parsed_data.get("bid_info", {}).get("project_name", "") if isinstance(parsed_data.get("bid_info"), dict) else getattr(parsed_data.get("bid_info"), "project_name", "")
        output_path = await step_5_generate_docx(config, reviewed_markdown, project_name, session_name, timestamp)
        
        logger.info("=" * 60)
        logger.info(f"全流程迭代完成！最终高质量定稿: {output_path}")
        logger.info("=" * 60)
        return output_path
    except Exception as e:
        logger.error(f"系统运行崩溃: {str(e)}", exc_info=True)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="ProEngine — 基于多智能体迭代架构的企业级标书生成系统")
    parser.add_argument("--config", type=str, default="config.yaml")
    parser.add_argument("--input", type=str, required=True)
    parser.add_argument("--tier", type=int, choices=[1, 2], default=None, help="强制指定安全等级（不传则读取配置）")
    parser.add_argument("--session-name", type=str, default="", help="脱敏会话唯一追踪标识")
    parser.add_argument("--template", type=str, default="auto", help="结构化大纲ID，例如 standard_bid_structure")
    parser.add_argument("--extra-req", type=str, default="", help="用户补充的定制要求/技术偏好")
    args = parser.parse_args()
    asyncio.run(run_pipeline(args))

if __name__ == "__main__":
    main()

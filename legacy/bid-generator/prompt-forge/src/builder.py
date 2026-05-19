from typing import Optional
# -*- coding: utf-8 -*-
"""
提示词构建器
基于 Jinja2 模板引擎，将结构化招标信息组装为高质量系统提示词
"""

import json
import logging
from pathlib import Path
from typing import Optional

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger(__name__)

# 模板目录
TEMPLATES_DIR = Path(__file__).parent.parent.parent / "data" / "templates" / "parse"
TEMPLATE_CONFIG_FILE = TEMPLATES_DIR / "prompt_templates.yaml"


class PromptBuilder:
    """
    提示词构建器

    从结构化招标信息中组装系统提示词，支持多种模板策略：
    - base_system: 基础系统提示词（角色定义、约束、输出格式）
    - technical: 技术方案章节提示词
    - scoring: 评分导向提示词（根据评分标准调整内容权重）
    """

    def __init__(self, templates_dir: Optional[str] = None):
        """
        初始化提示词构建器

        Args:
            templates_dir: 自定义模板目录路径，为 None 时使用默认模板目录
        """
        template_path = Path(templates_dir) if templates_dir else TEMPLATES_DIR
        self.env = Environment(
            loader=FileSystemLoader(str(template_path)),
            autoescape=select_autoescape(disabled_extensions=["md.j2"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        self.template_config = self._load_template_config(template_path)
        logger.info(f"提示词模板目录: {template_path}, 载入配置项: {len(self.template_config)} 个")

    def _load_template_config(self, template_path: Path) -> list:
        config_file = template_path / "prompt_templates.yaml"
        if config_file.exists():
            with open(config_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                return data.get("templates", [])
        return []

    def guess_best_template(self, bid_data: dict) -> dict:
        """启发式猜测最匹配的模板"""
        project_name = bid_data.get("project_name", "")
        tech_reqs = str(bid_data.get("technical_requirements", []))
        
        combined_text = f"{project_name} {tech_reqs}".lower()
        
        best_match = None
        max_hits = 0
        default_template = None
        
        for tpl in self.template_config:
            if tpl["id"] == "default":
                default_template = tpl
                
            hits = sum(1 for kw in tpl.get("keywords", []) if kw.lower() in combined_text)
            if hits > max_hits:
                max_hits = hits
                best_match = tpl
                
        if best_match and max_hits > 0:
            logger.info(f"启发式推荐模板: {best_match['id']} (命中关键字 {max_hits} 个)")
            return best_match
            
        logger.info("未启发命中，回退到默认模板")
        return default_template or {"files": {"technical": "technical.md.j2", "scoring": "scoring.md.j2"}}

    def build(self, bid_data: dict, template_name: str = "base_system.md.j2") -> str:
        """
        构建单个系统提示词片段

        Args:
            bid_data: 结构化招标信息（来自 gateway-in 的输出）
                {
                    "project_name": str,
                    "technical_requirements": list[dict],
                    "scoring_criteria": list[dict],
                    "structured_template": str,
                    ...
                }
            template_name: 使用的模板文件名

        Returns:
            str: 组装后的系统提示词
        """
        template = self.env.get_template(template_name)
        prompt = template.render(**bid_data)
        return prompt

    def get_structure_config(self, structure_id: str = "standard_bid_structure") -> dict:
        """读取指定的标书大纲结构 YAML"""
        # 默认结构文件路径
        structures_dir = Path(__file__).parent.parent.parent / "data" / "templates" / "structures"
        # 尝试通过 ID 查找匹配的 YAML，或者直接使用 standard.yaml
        yaml_file = structures_dir / f"{structure_id.replace('_bid_structure', '')}.yaml"
        if not yaml_file.exists():
            yaml_file = structures_dir / "standard.yaml"
            
        if yaml_file.exists():
            with open(yaml_file, 'r', encoding='utf-8') as f:
                return yaml.safe_load(f)
        return {
            "id": "standard_bid_structure",
            "sections": [
                {"id": "sec_overview", "title": "总体技术方案", "instruction": "请撰写项目总体方案。"}
            ]
        }

    def build_blueprint_prompt(self, bid_data: dict) -> str:
        """
        构建全局蓝图 (Blueprint) 提示词
        用于在循环生成具体章节前，定下技术基调。
        """
        template = self.env.get_template("blueprint_system.md.j2")
        return template.render(**bid_data)

    def build_section_prompt(
        self, 
        bid_data: dict, 
        section_config: dict, 
        blueprint_context: str = "", 
        previous_summary: str = ""
    ) -> str:
        """
        构建针对特定单一章节的生成提示词
        
        Args:
            bid_data: 提取的招标信息
            section_config: YAML中定义的当前章节配置项(title, instruction 等)
            blueprint_context: 全局蓝图文本，用于统一技术主轴
            previous_summary: 上一章节的摘要，用于上下文承接
        """
        parts = []
        
        # 将 section 信息和上下文合并到上下文中供基础模板使用
        context_data = bid_data.copy()
        context_data["section_title"] = section_config.get("title", "未命名章节")
        context_data["section_instruction"] = section_config.get("instruction", "请按招标要求撰写本章节。")
        context_data["expected_word_count"] = section_config.get("expected_word_count")
        context_data["blueprint_context"] = blueprint_context if section_config.get("requires_blueprint", True) else ""
        context_data["previous_summary"] = previous_summary
        
        # 1. 基础系统提示词 (角色定调 + 局部章节指令)
        parts.append(self.build(context_data, "base_system.md.j2"))
        
        # 确定使用的专业分类模板 (software, hardware 等)
        # 这里的逻辑主要是为核心技术响应和评分标准提供行业特有的提示
        preferred_template = bid_data.get("preferred_template_id", "auto")
        selected_tpl = None
        
        if preferred_template and preferred_template != "auto":
            selected_tpl = next((t for t in self.template_config if t["id"] == preferred_template), None)
            
        if not selected_tpl:
            selected_tpl = self.guess_best_template(bid_data)
            
        tpl_files = selected_tpl.get("files", {})

        # 如果这个章节需要深入分析技术点（通常是技术响应章节），则补充专业技术模板
        if section_config.get("id") == "sec_technical_response":
            if bid_data.get("technical_requirements"):
                tech_file = tpl_files.get("technical", "technical.md.j2")
                parts.append(self.build(bid_data, tech_file))
                
            if bid_data.get("scoring_criteria"):
                score_file = tpl_files.get("scoring", "scoring.md.j2")
                parts.append(self.build(bid_data, score_file))

        full_prompt = "\n\n---\n\n".join(parts)
        logger.info(f"章节 [{context_data['section_title']}] 提示词构建完成: {len(full_prompt)} 字符")
        return full_prompt
        
    def build_review_prompt(self, blueprint_context: str, section_title: str, draft_content: str) -> str:
        """
        构建局部审查 (Review/Critic) 提示词
        """
        template = self.env.get_template("reviewer_system.md.j2")
        context = {
            "blueprint_context": blueprint_context,
            "current_section_title": section_title,
            "current_section_draft": draft_content
        }
        return template.render(**context)

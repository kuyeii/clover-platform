# -*- coding: utf-8 -*-
"""
pipt-lite 请求/响应数据模型
"""

from typing import Optional
from pydantic import BaseModel, Field


# ─── PDF 溯源引用 ─────────────────────────────────────────────────
class SourcePageRef(BaseModel):
    """在原招标文件中的溯源引用（页码 + 原文片段）"""
    page: int = Field(..., description="对应的 PDF 页码（0-indexed）")
    excerpt: str = Field(default="", description="在原文中的精确引用片段")
    bbox: Optional[list[float]] = Field(default=None, description="文字在页面中的边界框坐标 [x0, y0, x1, y1]，可选")


class RecognizeRequest(BaseModel):
    """NER 识别请求"""
    text: str = Field(..., description="待识别的文本内容")
    target_entities: list[str] = Field(
        default=[
            "name", "phone", "id_number", "email",
            "addr", "bank", "car_id", "ip", "org"
        ],
        description="目标识别实体类型",
    )


class EntityItem(BaseModel):
    """识别到的实体"""
    text: str = Field(..., description="实体原文")
    entity_type: str = Field(..., description="实体类型（如 name, phone 等）")
    start: int = Field(..., description="起始位置")
    end: int = Field(..., description="结束位置")


class RecognizeResponse(BaseModel):
    """NER 识别响应"""
    entities: list[EntityItem] = Field(default_factory=list, description="识别到的实体列表")
    entity_count: int = Field(0, description="实体总数")


class DesensitizeRequest(BaseModel):
    """脱敏请求"""
    text: str = Field(..., description="待脱敏的文本内容")
    target_entities: Optional[list[str]] = Field(
        default=None,
        description="目标识别实体类型。如果为空，将根据 profile 自动填充",
    )
    method: Optional[str] = Field(
        default=None,
        description="脱敏方法: mask / placeholder。如果为空，将根据 profile 自动填充",
    )
    placeholder_format: str = Field(
        default="{{__PIPT_{type}_{index}__}}",
        description="占位符格式模板",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="工作流会话唯一标识",
    )
    profile: str = Field(
        default="default",
        description="脱敏强度/配置方案 (如 default: 知识库严苛脱敏, tender: 招标文件常规脱敏)",
    )
    llm_mode: Optional[str] = Field(
        default=None,
        description="LLM 模式覆盖（verify_only / augment / full）。不传则使用 PIPT_LLM_MODE 环境变量。"
                    "实时文档流程不传（默认 verify_only），KB sync 传 augment",
    )


class DesensitizeResponse(BaseModel):
    """脱敏响应"""
    desensitized_text: str = Field(..., description="脱敏后的文本")
    mapping_table: dict[str, str] = Field(
        default_factory=dict,
        description="占位符映射表（占位符 → 原文）",
    )
    entities: list[EntityItem] = Field(default_factory=list, description="识别到的实体列表")
    entity_count: int = Field(0, description="实体总数")


class BatchDesensitizeRequest(BaseModel):
    """批量脱敏请求"""
    texts: list[str] = Field(..., description="待脱敏的文本列表")
    target_entities: Optional[list[str]] = Field(
        default=None,
        description="目标识别实体类型。如果为空，将根据 profile 自动填充",
    )
    method: Optional[str] = Field(
        default=None,
        description="脱敏方法",
    )
    placeholder_format: str = Field(
        default="{{__PIPT_{type}_{index}__}}",
        description="占位符格式模板",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="工作流会话唯一标识",
    )
    profile: str = Field(
        default="default",
        description="脱敏强度/配置方案 (如 default: 知识库严苛脱敏, tender: 招标文件常规脱敏)",
    )
    llm_mode: Optional[str] = Field(
        default=None,
        description="LLM 模式覆盖（verify_only / augment / full）。KB sync 传 augment",
    )


class BatchDesensitizeResponse(BaseModel):
    """批量脱敏响应"""
    results: list[DesensitizeResponse] = Field(default_factory=list)
    total_entity_count: int = Field(0, description="所有文本中的实体总数")


class RestoreRequest(BaseModel):
    """文本还原请求 (需对接 PostgreSQL 映射表)"""
    session_id: str = Field(..., description="当时脱敏时使用的会话 ID")
    text: str = Field(..., description="含有占位符的脱敏文本")

class RestoreResponse(BaseModel):
    """文本还原响应"""
    restored_text: str = Field(..., description="复原后的明文")
    restored_count: int = Field(0, description="成功替换的占位符数量")

class TemplateConfigResponse(BaseModel):
    """大纲模板及系统配置查询响应"""
    config_dict: dict = Field(..., description="config.yaml 内容")
    template_dict: dict = Field(..., description="指定 yaml 的内容")
    available_templates: list[str] = Field(default_factory=list, description="所有可用的模板文件名称")
    current_template: str = Field(default="", description="当前查询的模板文件名称")

class UpdateTemplateRequest(BaseModel):
    """更新模板请求"""
    template_name: Optional[str] = Field(default="", description="要保存的具体模板名称，如 xxx.yaml")
    template_dict: dict = Field(..., description="新的配置内容")

class UpdateConfigRequest(BaseModel):
    """更新配置请求"""
    config_dict: dict = Field(..., description="新的 config.yaml 配置内容")

class GenerateStructureRequest(BaseModel):
    """请求生成项目专属结构"""
    project_name: str = Field(..., description="项目名称")
    blueprint: str = Field(default="", description="前期规划的技术蓝图内容")
    structured_data: str = Field(..., description="包括采购需求、评分标准等序列化字符串")

class GenerateStructureResponse(BaseModel):
    """返回动态生成的结构 YAML 字典"""
    structure_dict: dict = Field(..., description="结构配置字典")

class ReExtractRequirementsRequest(BaseModel):
    """请求基于已缓存的脱敏文本重新提取需求"""
    project_id: str = Field(default="", description="项目 ID（用于后端读取缓存原文）")
    project_name: str = Field(..., description="项目名称")
    raw_document: str = Field(default="", description="兼容旧版：可选透传原文本")

class AnalysisNode(BaseModel):
    """结构化解析节点（对应预设框架每个节点）"""
    id: str = Field(..., description="节点 ID")
    label: str = Field(..., description="框架标签，如'资质要求'")
    content: str = Field(default="", description="从招标文件提取的对应内容")
    parent_id: Optional[str] = Field(default=None, description="父节点 ID（根节点为 None）")
    children: list["AnalysisNode"] = Field(default_factory=list, description="子节点列表")

# 允许自引用
AnalysisNode.model_rebuild()


class AnalysisScoreItem(BaseModel):
    """评分项结构化结果"""
    id: str = Field(..., description="评分项 ID")
    name: str = Field(..., description="评分项名称")
    max_score: int = Field(default=0, description="该项最高分")
    criteria: str = Field(default="", description="评分规则原文")
    score_tag: str = Field(default="mixed", description="评分标签：tech | biz | mixed")
    is_response_item: Optional[bool] = Field(default=None, description="是否属于响应情况特例评分项（可选）")
    response_reason: str = Field(default="", description="判定为响应特例的原因说明（可选）")


class AnalysisProjectInfo(BaseModel):
    """项目信息汇总"""
    overview: str = Field(default="", description="项目解读")
    basic_info: dict = Field(default_factory=dict, description="项目基础信息键值对")
    scoring_items: list[AnalysisScoreItem] = Field(default_factory=list, description="评分项列表")
    scoring_total: int = Field(default=0, description="评分总分")


class AnalysisTargetNode(BaseModel):
    """技术目标解析节点"""
    id: str = Field(..., description="节点 ID")
    label: str = Field(..., description="节点标签")
    content: str = Field(default="", description="节点内容")


class AnalysisStructureHeading(BaseModel):
    """招标书结构 heading 节点"""
    id: str = Field(..., description="heading 节点 ID")
    title: str = Field(..., description="heading 标题")
    level: int = Field(..., description="heading 级别，1/2/3")
    category: str = Field(default="generic", description="attachments | technical | business | objective")
    source: str = Field(default="derived", description="llm | score_item | system | manual")
    source_node_id: str = Field(default="", description="来源解析节点 ID")
    source_title: str = Field(default="", description="源标题")
    score_tag: str = Field(default="", description="评分标签")
    score_item_id: str = Field(default="", description="关联评分项 ID")
    max_score: int = Field(default=0, description="评分项分值")
    criteria: str = Field(default="", description="评分规则原文")
    criteria_excerpt: str = Field(default="", description="评分规则摘要")
    related_target_ids: list[str] = Field(default_factory=list, description="关联技术目标节点 ID 列表")
    priority_weight: float = Field(default=0.0, description="章节优先权重")
    generation_strategy: str = Field(default="general", description="章节生成策略：general/response_special/objective_special")
    generation_mode: str = Field(default="derived", description="生成模式：llm/derived/system")
    response_candidate: bool = Field(default=False, description="是否命中响应情况候选")
    generates_from_self: bool = Field(default=False, description="是否由当前 heading 自身直接生成正文（无子节点也可生成）")
    start_block_id: str = Field(default="", description="起始块 ID")
    end_block_id: str = Field(default="", description="结束块 ID")
    start_locator: str = Field(default="", description="起始定位符")
    end_locator: str = Field(default="", description="结束定位符")
    anchor_confidence: float = Field(default=0.0, description="锚点置信度 0-1")
    editable_ops: list[str] = Field(default_factory=list, description="允许的交互：rename/delete")
    deleted: bool = Field(default=False, description="是否标记删除")
    children: list["AnalysisStructureHeading"] = Field(default_factory=list, description="子 heading")


class AnalysisBidStructure(BaseModel):
    """招标书结构汇总"""
    attachments: list[AnalysisStructureHeading] = Field(default_factory=list, description="附件 heading 列表")
    technical_sections: list[AnalysisStructureHeading] = Field(default_factory=list, description="技术部分 heading 列表")
    business_sections: list[AnalysisStructureHeading] = Field(default_factory=list, description="商务部分 heading 列表")


class AnalysisV2(BaseModel):
    """新版本解析报告主结构"""
    schema_version: int = Field(default=3, description="结构版本号")
    project_info: AnalysisProjectInfo = Field(default_factory=AnalysisProjectInfo, description="项目信息")
    technical_targets: list[AnalysisTargetNode] = Field(default_factory=list, description="项目技术目标")
    enable_response_branch: bool = Field(default=False, description="是否启用响应情况专用分支")
    technical_h2_bindings: list[dict] = Field(default_factory=list, description="技术 H2 绑定信息")
    bid_structure: AnalysisBidStructure = Field(default_factory=AnalysisBidStructure, description="招标书结构")


AnalysisStructureHeading.model_rebuild()


class ExtractRequirementItem(BaseModel):
    """提取的单条需求"""
    type: str = Field(..., description="tech|biz|score")
    content: str = Field(..., description="需求内容")
    points: Optional[int] = Field(default=None, description="分值")
    # 溯源字段：大模型提取的原文片段 + 后端匹配出的页码
    source_excerpt: str = Field(default="", description="在招标文件中的原文摘录（精确引用）")
    source_pages: list[SourcePageRef] = Field(default_factory=list, description="原文所在的 PDF 页码与坐标列表")

class ExtractRequirementsResponse(BaseModel):
    """需求提取结果响应"""
    bid_type: str = Field(..., description="标书分类")
    project_summary: str = Field(..., description="项目概述")
    requirements: list[ExtractRequirementItem] = Field(default_factory=list, description="提取的需求列表")
    # 结构化解析报告（新增，按预设框架拆解）
    analysis_report: list[AnalysisNode] = Field(default_factory=list, description="按预设框架拆解的结构化解析报告")
    analysis_v2: AnalysisV2 = Field(default_factory=AnalysisV2, description="V2 解析主结构")
    # 脱敏映射表
    mapping_table: dict = Field(default_factory=dict, description="脱敏占位符 → 原值映射表（本地保存，不上传）")
    entity_count: int = Field(default=0, description="脱敏识别实体数量")
    # 图片占位符映射表
    image_map: dict = Field(default_factory=dict, description="图片占位符 → 本地绝对路径映射表（只在后端生效）")
    # 招标文件要求提交的动态附件清单
    required_attachments: list[dict] = Field(default_factory=list, description="招标文件要求的附件清单 [{id, name, type, description}]")
    # 招标文件自带的评分表结构，若提取成功则优先使用该结构构建自评评分表
    scoring_table_template: list[dict] = Field(default_factory=list, description="从招标文件提取的评分表结构 [{indicator, max_score, criteria}]")
    # 脱敏后的原文本缓存（供前端重试提取使用）
    raw_document: str = Field(default="", description="脱敏后的原文本缓存")
    # PDF 预览 URL（前端 PDF 面板加载用，DOC/DOCX 文件由后端转换后生成）
    pdf_url: str = Field(default="", description="已缓存 PDF 文件的访问 URL（供前端预览，支持 DOC/DOCX/PDF）")
    # AI 智能评估：技术方案合理规模（用于预填配置弹窗）
    expected_word_count: Optional[int] = Field(default=None, description="AI 评估的技术方案合理总字数")
    expected_chapter_count: Optional[int] = Field(default=None, description="AI 评估的技术方案合理一级章节数")

class OutlineThirdLevel(BaseModel):
    """大纲三级标题 — 实际内容生成单元"""
    id: str = Field(..., description="三级节 ID，如 sec_arch_1_1")
    title: str = Field(..., description="三级节标题，如 系统架构设计")
    wordCount: int = Field(default=500, description="该节预计字数")
    writingHint: str = Field(default="", description="AI 写作引导提示词")
    keywords: list[str] = Field(default_factory=list, description="核心关键词组")
    headingLevel: int = Field(default=3, description="heading 级别")

class OutlineSubSection(BaseModel):
    """大纲二级标题 — 内容生成单元（可含三级子节点）"""
    id: str = Field(..., description="二级节 ID，如 sec_arch_1")
    title: str = Field(..., description="二级节标题，如 项目背景与需求理解")
    wordCount: int = Field(..., description="预计字数")
    writingHint: str = Field(default="", description="AI 写作引导提示词（小节，建议 250-300 字）")
    keywords: list[str] = Field(default_factory=list, description="本子章节的核心关键词组")
    children: list[OutlineThirdLevel] = Field(default_factory=list, description="三级标题列表（可选）")
    needDiagram: bool = Field(default=False, description="该小节是否需要生成图表")
    diagramBrief: str = Field(default="", description="图表描述（用于图表生成工作流输入）")
    diagramPlan: dict = Field(default_factory=dict, description="结构化图表参数 {enabled,brief,typeHint,priority}")
    headingLevel: int = Field(default=2, description="heading 级别")

class OutlineSection(BaseModel):
    """大纲一级标题 — 结构容器，不直接生成内容"""
    id: str = Field(..., description="一级章节 ID，如 sec_overview")
    title: str = Field(..., description="一级章节标题，如 总体技术方案")
    wordCount: int = Field(..., description="本章预计总字数（等于所有子标题字数之和）")
    writingHint: str = Field(default="", description="AI 写作引导提示词（章节级，建议 250-300 字）")
    keywords: list[str] = Field(default_factory=list, description="本章节的核心关键词组")
    needDiagram: bool = Field(default=False, description="该章节是否需要生成图表")
    diagramBrief: str = Field(default="", description="图表描述（用于图表生成工作流输入）")
    diagramPlan: dict = Field(default_factory=dict, description="结构化图表参数 {enabled,brief,typeHint,priority}")
    children: list[OutlineSubSection] = Field(default_factory=list, description="二级标题列表")
    headingLevel: int = Field(default=2, description="heading 级别")

class GenerateOutlineRequest(BaseModel):
    """AI 生成大纲请求"""
    requirements: list[dict] = Field(default_factory=list, description="核对后的需求列表")
    bid_type: str = Field(default="tech", description="标书类型")
    dify_api_key: Optional[str] = Field(default=None, description="大纲生成工作流的 Dify API Key")
    use_knowledge: bool = Field(default=False, description="是否开启知识库辅助")
    # 动态权重分配参数
    expected_total_words: int = Field(default=0, description="用户预期的技术方案总字数（0=由 AI 自行决定）")
    enable_diagrams: bool = Field(default=False, description="是否在后续内容生成阶段启用图表（当前禁用）")
    max_diagrams: int = Field(default=0, description="项目级图表总上限（当前禁用）")
    # 评分细则：直接传入结构化 JSON 字符串（来自 scoring_details 节点）
    scoring_details_json: str = Field(default="", description="评分细则 JSON 字符串，{total, items:[{name,max_score,criteria}]}，用于精准权重分配")
    # 解析报告上下文（结构化摘要）
    analysis_context: str = Field(default="", description="招标文件解析报告摘要，含评分标准、技术要求、废标项等关键节点")
    structure_heading_seed_json: str = Field(default="", description="招标书结构中的技术 heading 种子 JSON")
    technical_h2_bindings_json: str = Field(default="", description="技术 H2 绑定 JSON（评分项+技术目标关联）")
    technical_targets_json: str = Field(default="", description="项目技术目标 JSON（供响应情况专用分支）")


class GenerateOutlineResponse(BaseModel):
    """AI 大纲生成响应"""
    sections: list[OutlineSection] = Field(default_factory=list, description="生成的一级大纲章节列表（含子级）")

# ─── 全局蓝图 (Blueprint) ─────────────────────────────────────────────────────────
class BlueprintData(BaseModel):
    """全局投标蓝图结构"""
    positioning: str = Field(..., description="项目核心定位句（1句话总结我方优势和主旋律）")
    strategy: str = Field(..., description="整体投标策略说明")
    highlights: list[str] = Field(default_factory=list, description="差异化亮点（2-3条）")
    writing_style: str = Field(default="正式、专业、数据驱动", description="全文写作语体基调")

class GenerateBlueprintRequest(BaseModel):
    """生成全局蓝图请求"""
    project_id: str
    bid_type: str = Field(..., description="标书类别（tech|biz）")
    project_summary: str = Field(..., description="项目概况摘要")
    requirements: list[dict] = Field(default_factory=list, description="核对后的需求列表")
    outline: list[dict] = Field(default_factory=list, description="确认后的大纲章节列表")

class GenerateBlueprintResponse(BaseModel):
    """全局蓝图响应"""
    blueprint: BlueprintData


# ───────────── 内容生成 ─────────────

class GenerateContentRequest(BaseModel):
    """章节内容生成请求（对应 content_writer 工作流）"""
    project_id: str = Field(default="", description="项目 ID（用于图表额度控制与并发调度）")
    section_id: str = Field(..., description="章节 ID，用于前端绑定结果")
    section_title: str = Field(..., description="章节标题，如 '第二章：总体技术方案'")
    writing_hint: str = Field(default="", description="用户可编辑的核心写作意图；服务端会补齐默认规则")
    keywords: str = Field(default="", description="本章节核心关键词，来自大纲提取环节（逗号分隔字符串）")
    expected_words: int = Field(default=1500, description="目标字数")
    project_summary: str = Field(default="", description="项目概要（来自需求提取阶段），用作临时蓝图上下文")
    global_outline: str = Field(default="", description="整体架构的文本树，提供给大模型防止错乱自编一二三级标题")
    section_outline_slice: str = Field(
        default="",
        description="当前章节在大纲中的层级路径（父级→本级），服务端据此重建默认规则",
    )
    requires_search: bool = Field(default=False, description="是否开启 SearXNG 联网搜索")
    # 占位符提示：告知 LLM 文中存在脱敏占位符，保持原样不修改
    placeholder_hint: str = Field(default="", description="脱敏占位符说明，注入到 Dify 工作流")
    # 解析报告上下文（与本章节相关的招标文件解析摘要）
    analysis_context: str = Field(default="", description="招标文件解析报告中与本章节相关的关键要求摘要")
    generation_strategy: str = Field(default="general", description="章节生成策略：general/response_special/objective_special")
    # 图表计划（来自大纲结构化输出）
    enable_diagrams: bool = Field(default=False, description="项目级图表开关（当前禁用）")
    max_diagrams: int = Field(default=0, description="项目级图表上限（当前禁用）")
    need_diagram: bool = Field(default=False, description="该章节是否需要图表")
    diagram_brief: str = Field(default="", description="该章节图表描述")
    diagram_type_hint: str = Field(default="architecture", description="图表类型提示")
    diagram_priority: int = Field(default=0, description="图表优先级")
    mapping_table: dict[str, str] = Field(default_factory=dict, description="占位符映射表（主要用于 BIDDER 与补充兜底还原）")

class GenerateContentResponse(BaseModel):
    """章节内容生成响应"""
    section_id: str
    content: str = Field(..., description="生成的章节正文（Markdown 格式）")
    word_count: int = Field(default=0, description="实际字数（估算）")
    quality_score: Optional[int] = Field(default=None, description="大模型评审节点给出的内容质量打分 (0-10)")
    feedback: Optional[str] = Field(default=None, description="大模型评审节点给出的修改建议或评语")


class GenerateAttachmentRequest(BaseModel):
    """附件生成请求"""
    attachment_type: str = Field(..., description="附件类型标识，如 application_letter / authorization / no_violation / integrity_pledge 或动态 ID")
    attachment_name: str = Field(default="", description="动态附件的展示名称（仅动态生成时有效）")
    attachment_desc: str = Field(default="", description="动态附件的描述或要素要求（仅动态生成时有效）")
    project_id: str = Field(default="", description="项目 ID，用于获取项目上下文以更精准生成（可选）")
    # 投标人信息（来自前端 localStorage，不经过服务器存储）
    org_name: str = Field(default="", description="投标单位全称")
    legal_rep: str = Field(default="", description="法定代表人")
    project_lead: str = Field(default="", description="项目负责人")
    phone: str = Field(default="", description="联系电话")
    doc_date: str = Field(default="", description="文件编制日期")
    # 项目信息
    project_name: str = Field(default="", description="项目名称（来自项目基本信息）")
    recipient: str = Field(default="采购人", description="收件方（招标人名称，默认'采购人'）")
    bid_no: str = Field(default="", description="招标编号（可选）")
    # 委托书专用
    agent_name: str = Field(default="", description="被委托人姓名（授权委托书专用）")
    agent_id: str = Field(default="", description="被委托人身份证号（授权委托书专用，可留空）")


class GenerateAttachmentResponse(BaseModel):
    """附件生成响应"""
    attachment_type: str
    label: str = Field(..., description="附件中文名称")
    content: str = Field(..., description="渲染后的附件正文（Markdown 格式）")


# ─── 自评评分表 ─────────────────────────────────────────────────────────
class ScoringRowItem(BaseModel):
    """评分表单行"""
    id: str = Field(..., description="行 ID（来自 requirement ID 或 scoring_template ID）")
    indicator: str = Field(..., description="评分指标名称")
    max_score: int = Field(default=10, description="最高分值")
    criteria: str = Field(default="", description="评分标准说明")
    # 投标人填写
    self_response: str = Field(default="", description="full（响应）/ partial（部分响应）/ none（不响应）")
    self_comment: str = Field(default="", description="自评说明")
    # 证明材料：文件路径列表（占位符，gateway-forge 负责引入实体文件）
    evidence_refs: list[str] = Field(default_factory=list, description="证明材料文件路径占位符列表")


class BuildScoringTableRequest(BaseModel):
    """构建评分表请求（基于项目 requirements 中 score 类型条目）"""
    project_id: str
    score_requirements: list[dict] = Field(..., description="score 类型 requirements 列表 [{type, content, points}]")
    # 若 Dify 已提取出结构化评分表模板则优先使用
    scoring_table_template: list[dict] = Field(default_factory=list, description="已提取的结构化评分表（空则 fallback）")


class BuildScoringTableResponse(BaseModel):
    """构建评分表响应"""
    rows: list[ScoringRowItem]


class FillScoringRowRequest(BaseModel):
    """AI 自动填写单行评分"""
    row_id: str
    indicator: str
    max_score: int
    criteria: str = ""
    project_summary: str = ""            # 项目概要（临时蓝图上下文）
    requirements_context: str = ""       # 其他 requirements 摘要


class FillScoringRowResponse(BaseModel):
    """AI 自动填写单行评分结果"""
    row_id: str
    self_response: str = Field(..., description="full / partial")  # 尽量不返回 none
    self_comment: str
    evidence_refs: list[str] = Field(default_factory=list)


class ExportScoringTableRequest(BaseModel):
    """导出评分表为 Excel"""
    project_name: str
    rows: list[ScoringRowItem]

# ==========================================
# 阶段六：知识库管理 (Knowledge Base)
# ==========================================
class KnowledgeDocument(BaseModel):
    id: str = Field(..., description="Dify 中的文档ID")
    name: str = Field(..., description="文档名称")
    size: str = Field(default="-", description="文件大小估值")
    uploadTime: str = Field(..., description="上传或创建的时间")
    status: str = Field(default="success", description="状态: success/indexing/failed")
    chunks: int = Field(default=0, description="向量拆分的段落数")

class KnowledgeListResponse(BaseModel):
    dataset_info: dict = Field(default_factory=dict, description="远端数据集状态")
    documents: list[KnowledgeDocument] = Field(default_factory=list, description="文档列表")

class KnowledgeSyncResponse(BaseModel):
    message: str = Field(..., description="操作反馈")
    status: str = Field(default="success")
    task_id: Optional[str] = Field(default=None, description="后台任务 ID，可用于轮询状态")

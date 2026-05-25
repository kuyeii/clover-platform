import api from './api';

export interface TemplateBlock {
    id: string;
    title: string;
    instruction: string;
    expected_word_count?: number;
    requires_search: boolean;
    requires_blueprint?: boolean;
    keywords?: string[];
    need_diagram?: boolean;
    diagram_brief?: string;
    diagram_plan?: {
        enabled: boolean;
        brief: string;
        typeHint?: 'architecture' | 'flowchart' | 'org-chart' | 'data-flow' | 'logic';
        priority?: number;
    };
    children?: TemplateBlock[];
    is_chapter_intro?: boolean; // 一级标题章节概述标记
    block_kind?: 'group' | 'content';
    heading_level?: number;
    parent_heading_id?: string;
    parent_heading_title?: string;
    generation_strategy?: 'general' | 'response_special' | 'objective_special' | string;
    generates_from_self?: boolean;
}

export interface StandardYaml {
    id: string;
    name: string;
    description: string;
    blocks: TemplateBlock[];
}

export interface ConfigYaml {
    security: {
        default_tier: number;
        tier_mapping: Record<string, number>;
    };
    pipt: {
        profiles: Record<string, any>;
    };
    dify: {
        base_url: string;
        knowledge_base_id: string;
    };
    [key: string]: any; // 通用配置字段
}

export interface TemplateConfigResponse {
    config_dict: ConfigYaml;
    template_dict: StandardYaml;
    available_templates: string[];
    current_template: string;
}

export const configService = {
    /**
     * 获取全局系统配置与大纲模板
     */
    getTemplateAndConfig: (templateName?: string): Promise<TemplateConfigResponse> => {
        return api.get('/config/template', {
            params: templateName ? { template_name: templateName } : {}
        });
    },

    /**
     * 保存修改后的大纲模板 (standard.yaml)
     * @param template_name 文件名
     * @param template_dict 模板内容
     */
    updateTemplate: (template_name: string, template_dict: StandardYaml): Promise<{ status: string; message: string }> => {
        return api.put('/config/template', { template_name, template_dict });
    },

    /**
     * 删除大纲模板
     * @param template_name 文件名
     */
    deleteTemplate: (template_name: string): Promise<{ status: string; message: string }> => {
        return api.delete('/config/template', { params: { template_name } });
    },

    /**
     * 保存修改后的全局配置 (config.yaml)
     * @param config_dict
     */
    updateConfig: (config_dict: ConfigYaml): Promise<{ status: string; message: string }> => {
        return api.put('/config/global', { config_dict });
    },
};

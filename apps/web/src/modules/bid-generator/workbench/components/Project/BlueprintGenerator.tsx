import { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, ChevronRight, AlertCircle, RefreshCw, Target, Map, Award, FileText } from 'lucide-react';
import type { Project, BlueprintData } from '../../services/projectService';
import { projectService } from '../../services/projectService';

interface Props {
    project: Project;
    onConfirm: () => void;
}

export function BlueprintGenerator({ project, onConfirm }: Props) {
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [blueprint, setBlueprint] = useState<BlueprintData | null>(project.blueprint || null);
    const [editing, setEditing] = useState(false);

    const [formState, setFormState] = useState<BlueprintData | null>(null);

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            const bp = await projectService.generateBlueprint(project);
            projectService.update(project.id, { blueprint: bp });
            setBlueprint(bp);
        } catch (err: any) {
            setError(err?.response?.data?.detail || '生成失败');
        } finally {
            setGenerating(false);
        }
    };

    const toggleEdit = () => {
        if (!editing) setFormState(blueprint);
        setEditing(!editing);
    };

    const handleSave = () => {
        if (formState) {
            projectService.update(project.id, { blueprint: formState });
            setBlueprint(formState);
        }
        setEditing(false);
    };

    return (
        <div className="h-full flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="max-w-3xl w-full bg-white rounded-2xl border border-gray-200 shadow-none p-8">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-brand-50 rounded-xl">
                        <Map className="w-8 h-8 text-brand-600" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">全局投标蓝图 (Blueprint)</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            在大纲确立后，为全局提炼主旋律、差异化亮点与整体写作策略。
                        </p>
                    </div>
                </div>

                {!blueprint && !generating && (
                    <div className="text-center py-12">
                        <Sparkles className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <button
                            onClick={handleGenerate}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-colors shadow-none"
                        >
                            <Sparkles className="w-4 h-4" /> AI 生成蓝图
                        </button>
                    </div>
                )}

                {generating && (
                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                        <p className="text-sm text-gray-500">正在综合大纲与需求，生成投标蓝图...</p>
                    </div>
                )}

                {error && (
                    <div className="mt-4 flex items-center gap-2 px-4 py-3 bg-[var(--color-danger-bg)] text-danger rounded-lg text-sm border border-[var(--color-danger-border)]">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="flex-1">{error}</span>
                        <button onClick={handleGenerate} className="flex items-center gap-1 text-danger hover:text-danger font-medium">
                            <RefreshCw className="w-4 h-4" /> 重试
                        </button>
                    </div>
                )}

                {blueprint && !generating && (
                    <div className="space-y-6">
                        {!editing ? (
                            <>
                                {/* Positioning */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-2">
                                        <Target className="w-4 h-4 text-brand-500" /> 项目核心定位
                                    </h3>
                                    <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-700 leading-relaxed border border-gray-100">
                                        {blueprint.positioning}
                                    </div>
                                </div>
                                {/* Strategy */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-2">
                                        <Map className="w-4 h-4 text-brand-500" /> 整体投标策略
                                    </h3>
                                    <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-700 leading-relaxed border border-gray-100 whitespace-pre-wrap">
                                        {blueprint.strategy}
                                    </div>
                                </div>
                                {/* Highlights */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-2">
                                        <Award className="w-4 h-4 text-success" /> 差异化亮点
                                    </h3>
                                    <ul className="list-disc leading-relaxed text-sm text-gray-700 ml-6 space-y-1">
                                        {blueprint.highlights.map((h, i) => <li key={i}>{h}</li>)}
                                    </ul>
                                </div>
                                {/* Style */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-2">
                                        <FileText className="w-4 h-4 text-warning" /> 写作语体基调
                                    </h3>
                                    <div className="px-3 py-1.5 bg-gray-50 rounded-md border border-gray-100 text-xs text-gray-600 inline-block font-medium">
                                        {blueprint.writing_style}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-bold text-gray-800 mb-1 block">项目核心定位</label>
                                    <textarea value={formState?.positioning} onChange={e => setFormState({ ...formState!, positioning: e.target.value })}
                                        className="w-full text-sm p-3 border border-gray-200 rounded-lg resize-y focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200" rows={2} />
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-gray-800 mb-1 block">整体投标策略</label>
                                    <textarea value={formState?.strategy} onChange={e => setFormState({ ...formState!, strategy: e.target.value })}
                                        className="w-full text-sm p-3 border border-gray-200 rounded-lg resize-y focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200" rows={4} />
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-gray-800 mb-1 block">差异化亮点 (换行分隔)</label>
                                    <textarea value={formState?.highlights.join('\n')} onChange={e => setFormState({ ...formState!, highlights: e.target.value.split('\n') })}
                                        className="w-full text-sm p-3 border border-gray-200 rounded-lg resize-y focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200" rows={3} />
                                </div>
                                <div>
                                    <label className="text-sm font-bold text-gray-800 mb-1 block">写作语体基调</label>
                                    <input value={formState?.writing_style} onChange={e => setFormState({ ...formState!, writing_style: e.target.value })}
                                        className="w-full text-sm p-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200" />
                                </div>
                            </div>
                        )}

                        <div className="pt-6 mt-6 border-t border-gray-100 flex items-center justify-between">
                            <div className="flex gap-3">
                                <button onClick={handleGenerate} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5">
                                    <RefreshCw className="w-3.5 h-3.5" /> 重新生成
                                </button>
                                {editing ? (
                                    <button onClick={handleSave} className="px-4 py-2 bg-brand-50 hover:bg-brand-100 text-brand-600 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5">
                                        保存修改
                                    </button>
                                ) : (
                                    <button onClick={toggleEdit} className="px-4 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5">
                                        修改蓝图
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={onConfirm}
                                className="flex items-center gap-1.5 px-6 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-lg shadow-none transition-colors"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                确认蓝图，开始写作
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

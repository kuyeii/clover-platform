import { useState, useCallback } from 'react';
import {
    BarChart3, Sparkles, Download, Loader2, AlertCircle,
    CheckCircle2, MinusCircle, RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import type { Project, ScoringRow } from '../../services/projectService';
import { projectService } from '../../services/projectService';

interface Props {
    project: Project;
    onRowsUpdated: (rows: ScoringRow[]) => void;
}

const RESPONSE_CONFIG = {
    full: { label: '响应', color: 'bg-green-100 text-green-700 border-green-200' },
    partial: { label: '部分响应', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    none: { label: '不响应', color: 'bg-red-100 text-red-500 border-red-200' },
    '': { label: '未填写', color: 'bg-gray-100 text-gray-400 border-gray-200' },
};

export function ScoringTable({ project, onRowsUpdated }: Props) {
    const [rows, setRows] = useState<ScoringRow[]>(project.scoringRows ?? []);
    const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set());
    const [fillingAll, setFillingAll] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [initialized, setInitialized] = useState((project.scoringRows?.length ?? 0) > 0);
    const [initializing, setInitializing] = useState(false);

    // 从 score requirements 初始化评分表
    const handleInitialize = async () => {
        setInitializing(true);
        try {
            const scoreReqs = (project.requirements ?? [])
                .filter(r => r.type === 'score')
                .map((r, i) => ({ id: `score_${i}`, content: r.content, points: r.points ?? 10 }));
            const res: any = await api.post('/projects/build-scoring-table', {
                project_id: project.id,
                score_requirements: scoreReqs,
                scoring_table_template: project.scoringTableTemplate || [],
            });
            const newRows: ScoringRow[] = (res.rows ?? []).map((r: any) => ({
                id: r.id,
                indicator: r.indicator,
                maxScore: r.max_score,
                criteria: r.criteria ?? '',
                selfResponse: '',
                selfComment: '',
                evidenceRefs: [],
            }));
            setRows(newRows);
            setInitialized(true);
            persistRows(newRows);
        } catch (e: any) {
            setErrors({ _init: e?.response?.data?.detail || '初始化失败' });
        } finally { setInitializing(false); }
    };

    const persistRows = (updated: ScoringRow[]) => {
        projectService.update(project.id, { scoringRows: updated });
        onRowsUpdated(updated);
    };

    // 更新单行本地状态
    const patchRow = (id: string, patch: Partial<ScoringRow>) => {
        setRows(prev => {
            const next = prev.map(r => r.id === id ? { ...r, ...patch } : r);
            persistRows(next);
            return next;
        });
    };

    // AI 填写单行
    const fillRow = useCallback(async (row: ScoringRow) => {
        setLoadingRows(prev => new Set(prev).add(row.id));
        setErrors(prev => ({ ...prev, [row.id]: '' }));
        try {
            const reqsContext = (project.requirements ?? [])
                .map(r => `[${r.type}] ${r.content}`)
                .join('\n').substring(0, 800);
            const res: any = await api.post('/projects/fill-scoring-row', {
                row_id: row.id,
                indicator: row.indicator,
                max_score: row.maxScore,
                criteria: row.criteria,
                project_summary: project.summary ?? '',
                requirements_context: reqsContext,
            });
            patchRow(row.id, {
                selfResponse: res.self_response as 'full' | 'partial',
                selfComment: res.self_comment ?? '',
                evidenceRefs: res.evidence_refs ?? [],
            });
        } catch (e: any) {
            setErrors(prev => ({ ...prev, [row.id]: e?.response?.data?.detail || 'AI 填写失败' }));
        } finally {
            setLoadingRows(prev => { const s = new Set(prev); s.delete(row.id); return s; });
        }
    }, [project]);

    // 一键 AI 填写全表
    const fillAll = async () => {
        setFillingAll(true);
        for (const row of rows) {
            if (!row.selfComment) await fillRow(row);
        }
        setFillingAll(false);
    };

    // 导出 Excel
    const handleExport = async () => {
        setExporting(true);
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/projects/export-scoring-table`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_name: project.name,
                    rows: rows.map(r => ({
                        id: r.id, indicator: r.indicator, max_score: r.maxScore,
                        criteria: r.criteria, self_response: r.selfResponse,
                        self_comment: r.selfComment, evidence_refs: r.evidenceRefs,
                    })),
                }),
            });
            if (!res.ok) throw new Error('导出失败');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${project.name}_自评评分表.xlsx`;
            a.click(); URL.revokeObjectURL(url);
        } catch (e: any) {
            setErrors({ _export: e.message || '导出失败' });
        } finally { setExporting(false); }
    };

    const totalMax = rows.reduce((s, r) => s + r.maxScore, 0);
    const filledCount = rows.filter(r => r.selfResponse !== '').length;

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-6">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                    <h2 className="text-base font-bold text-gray-900">自评评分表</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {initialized ? `共 ${rows.length} 项 · 已填写 ${filledCount}/${rows.length} · 总分上限 ${totalMax} 分` : '基于招标文件 score 类型需求构建'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {initialized && (
                        <>
                            <button onClick={fillAll} disabled={fillingAll || rows.length === 0}
                                className={clsx('flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors',
                                    fillingAll ? 'bg-purple-100 text-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm')}>
                                {fillingAll ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />AI 填写中…</> : <><Sparkles className="w-3.5 h-3.5" />AI 全表填写</>}
                            </button>
                            <button onClick={handleExport} disabled={exporting}
                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-50">
                                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                导出 Excel
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* 错误提示 */}
            {(errors._init || errors._export) && (
                <div className="mx-6 my-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-2.5 rounded-lg">
                    <AlertCircle className="w-4 h-4 shrink-0" />{errors._init || errors._export}
                </div>
            )}

            {/* 未初始化 */}
            {!initialized ? (
                <div className="flex flex-col items-center justify-center py-14 gap-4">
                    <BarChart3 className="w-12 h-12 text-gray-200" />
                    <p className="text-sm text-gray-500">基于招标文件中的评分项自动构建表格</p>
                    <button onClick={handleInitialize} disabled={initializing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-50">
                        {initializing ? <><Loader2 className="w-4 h-4 animate-spin" />初始化中…</> : '构建评分表'}
                    </button>
                    {(project.requirements ?? []).filter(r => r.type === 'score').length === 0 && (
                        <p className="text-xs text-amber-600">⚠ 当前项目尚无 score 类型需求，请先完成需求提取</p>
                    )}
                </div>
            ) : (
                /* 评分表 */
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                {['评分指标', '最高分', '自评情况', '自评说明', '证明材料', 'AI'].map(h => (
                                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {rows.map(row => {
                                const loading = loadingRows.has(row.id);
                                return (
                                    <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                                        {/* 指标 */}
                                        <td className="px-4 py-3 font-medium text-gray-800 align-top max-w-[200px]">
                                            <p className="leading-snug">{row.indicator}</p>
                                            {row.criteria && <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{row.criteria}</p>}
                                        </td>
                                        {/* 最高分 */}
                                        <td className="px-4 py-3 align-top text-center">
                                            <span className="font-bold text-gray-700">{row.maxScore}</span>
                                            <span className="text-xs text-gray-400">分</span>
                                        </td>
                                        {/* 自评情况 */}
                                        <td className="px-4 py-3 align-top">
                                            <div className="flex flex-col gap-1">
                                                {(['full', 'partial'] as const).map(val => (
                                                    <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                                                        <input type="radio" name={`resp_${row.id}`} value={val}
                                                            checked={row.selfResponse === val}
                                                            onChange={() => patchRow(row.id, { selfResponse: val })}
                                                            className="accent-emerald-600 w-3.5 h-3.5" />
                                                        <span className={clsx('text-xs px-1.5 py-0.5 rounded border font-medium', RESPONSE_CONFIG[val].color)}>
                                                            {RESPONSE_CONFIG[val].label}
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                        </td>
                                        {/* 自评说明 */}
                                        <td className="px-4 py-3 align-top min-w-[220px]">
                                            <textarea value={row.selfComment}
                                                onChange={e => patchRow(row.id, { selfComment: e.target.value })}
                                                placeholder="自评情况说明…"
                                                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 resize-none leading-relaxed"
                                                rows={3} />
                                        </td>
                                        {/* 证明材料（文件路径占位符）*/}
                                        <td className="px-4 py-3 align-top min-w-[160px]">
                                            {row.evidenceRefs.length > 0 ? (
                                                <ul className="space-y-1">
                                                    {row.evidenceRefs.map((ref, i) => (
                                                        <li key={i} className="text-xs text-blue-600 font-mono bg-blue-50 px-2 py-1 rounded break-all">
                                                            {ref}
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <span className="text-xs text-gray-300">AI 填写后显示</span>
                                            )}
                                        </td>
                                        {/* AI 按钮 */}
                                        <td className="px-4 py-3 align-top">
                                            <button onClick={() => fillRow(row)} disabled={loading || fillingAll}
                                                className={clsx('flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
                                                    loading ? 'bg-purple-50 text-purple-300 cursor-not-allowed'
                                                        : row.selfComment ? 'border border-purple-200 text-purple-600 hover:bg-purple-50'
                                                            : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm')}>
                                                {loading
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : row.selfComment
                                                        ? <RefreshCw className="w-3.5 h-3.5" />
                                                        : <Sparkles className="w-3.5 h-3.5" />
                                                }
                                                {loading ? '' : row.selfComment ? '重填' : 'AI'}
                                            </button>
                                            {errors[row.id] && (
                                                <p className="text-xs text-red-500 mt-1 max-w-[80px] break-words">{errors[row.id]}</p>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        {/* 合计行 */}
                        <tfoot className="border-t border-gray-200 bg-gray-50">
                            <tr>
                                <td className="px-4 py-3 font-bold text-gray-700" colSpan={1}>合计</td>
                                <td className="px-4 py-3 font-bold text-gray-700 text-center">{totalMax} 分</td>
                                <td className="px-4 py-3 text-xs text-gray-500" colSpan={4}>
                                    {filledCount === rows.length && rows.length > 0
                                        ? <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-4 h-4" />全部已填写，可导出</span>
                                        : <span className="flex items-center gap-1 text-amber-500"><MinusCircle className="w-4 h-4" />已填 {filledCount}/{rows.length} 项</span>
                                    }
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* TODO 提醒 */}
            <div className="px-6 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
                📌 <b>TODO</b>：知识库证明材料引用为文件路径占位符，gateway-forge 阶段将替换为实际文件附件。
                导出 Excel 为临时格式，后续整合为 Word 中的表格形式。
            </div>
        </div>
    );
}

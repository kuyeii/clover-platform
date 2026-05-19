import { useState } from 'react';
import {
    FileText, ChevronDown, ChevronRight, Download, RefreshCw,
    CheckCircle2, AlertCircle, Loader2, Copy, Paperclip
} from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import type { Project } from '../../services/projectService';

// ─── 附件类型定义 ───────────────────────────────────────
interface AttachmentType {
    key: string;
    label: string;
    desc: string;
    typeHint?: string;
    extraFields?: { key: string; label: string; placeholder: string }[];
}

const ATTACHMENT_TYPES: AttachmentType[] = [
    { key: 'application_letter', label: '投标申请书', desc: '表达参与投标意愿的正式申请函' },
    {
        key: 'authorization', label: '授权委托书', desc: '法定代表人授权投标代理人参与投标',
        extraFields: [
            { key: 'agent_name', label: '被委托人姓名', placeholder: '王五' },
            { key: 'agent_id', label: '被委托人身份证号', placeholder: '110101199001010001（可选）' },
        ]
    },
    { key: 'no_violation', label: '无违规记录声明', desc: '声明近三年无重大违规处罚记录' },
    { key: 'integrity_pledge', label: '廉洁承诺书', desc: '承诺遵守廉洁纪律、不行贿受贿' },
];

interface AttachmentResult { label: string; content: string; copiedAt?: number; }

interface Props {
    project: Project;
}

export function AttachmentFiller({ project }: Props) {
    const bidder = project.bidderInfo;

    // 收件方 & 招标编号（可手动覆盖）
    const [recipient, setRecipient] = useState('采购人');
    const [bidNo, setBidNo] = useState('');

    // 委托书额外字段
    const [agentName, setAgentName] = useState('');
    const [agentId, setAgentId] = useState('');

    // 每个附件的生成状态
    const [loadingKey, setLoadingKey] = useState<string | null>(null);
    const [results, setResults] = useState<Record<string, AttachmentResult>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});

    // 已展开的附件预览
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    const handleGenerate = async (type: AttachmentType) => {
        setLoadingKey(type.key);
        setErrors(prev => ({ ...prev, [type.key]: '' }));
        try {
            const res: any = await api.post('/projects/generate-attachment', {
                attachment_type: type.key,
                attachment_name: type.label,
                attachment_desc: type.desc,
                project_id: project.id,
                org_name: bidder?.orgName || '',
                legal_rep: bidder?.legalRep || '',
                project_lead: bidder?.projectLead || '',
                phone: bidder?.phone || '',
                doc_date: bidder?.docDate || '',
                project_name: project.name,
                recipient,
                bid_no: bidNo,
                agent_name: agentName,
                agent_id: agentId,
            });
            setResults(prev => ({ ...prev, [type.key]: { label: res.label, content: res.content } }));
            setExpandedKey(type.key);
        } catch (e: any) {
            setErrors(prev => ({ ...prev, [type.key]: e?.response?.data?.detail || '生成失败' }));
        } finally {
            setLoadingKey(null);
        }
    };

    const handleCopy = (key: string, content: string) => {
        navigator.clipboard.writeText(content);
        setResults(prev => ({ ...prev, [key]: { ...prev[key], copiedAt: Date.now() } }));
    };

    const handleDownload = (label: string, content: string) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${label}.md`;
        a.click(); URL.revokeObjectURL(url);
    };

    const bidderConfigured = !!(bidder?.orgName || bidder?.legalRep);

    // 从项目中读取招标文件提取的附件要求
    const requiredAttachments = project.requiredAttachments ?? [];

    // 如果 Dify 提取了专属附件清单，则转换为渲染对象展示；否则展示系统预置的 4 种基础常规模板
    const visibleTypes: AttachmentType[] = requiredAttachments.length > 0
        ? requiredAttachments.map(req => ({
            key: req.id || req.name,
            label: req.name,
            desc: req.description || '',
            typeHint: req.type
        }))
        : ATTACHMENT_TYPES;

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* ── Header ── */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                    <Paperclip className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                    <h2 className="text-base font-bold text-gray-900">附件填写工作台</h2>
                    <p className="text-xs text-gray-500 mt-0.5">生成标书常见标准附件，一键预览 / 复制 / 下载</p>
                </div>
            </div>

            {/* ── 公共字段 ── */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40">
                {!bidderConfigured && (
                    <div className="mb-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        侧边栏"投标人信息"尚未配置，附件将以占位符填充，建议先完善。
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">招标人（收件方）</label>
                        <input value={recipient} onChange={e => setRecipient(e.target.value)}
                            placeholder="采购人" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">招标编号（可选）</label>
                        <input value={bidNo} onChange={e => setBidNo(e.target.value)}
                            placeholder="如：ZBTB-2025-001" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">被委托人（委托书专用）</label>
                        <input value={agentName} onChange={e => setAgentName(e.target.value)}
                            placeholder="王五" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">被委托人身份证号（可选）</label>
                        <input value={agentId} onChange={e => setAgentId(e.target.value)}
                            placeholder="留空则生成下划线占位" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400" />
                    </div>
                </div>
                {/* 预填的投标人信息摘要 */}
                {bidderConfigured && (
                    <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                        {bidder?.orgName && <span>单位：<b className="text-gray-700">{bidder.orgName}</b></span>}
                        {bidder?.legalRep && <span>法代：<b className="text-gray-700">{bidder.legalRep}</b></span>}
                        {bidder?.projectLead && <span>负责人：<b className="text-gray-700">{bidder.projectLead}</b></span>}
                        {bidder?.docDate && <span>日期：<b className="text-gray-700">{bidder.docDate}</b></span>}
                    </div>
                )}
            </div>

            {/* ── 附件列表 ── */}
            <div className="divide-y divide-gray-100">
                {visibleTypes.map(type => {
                    const result = results[type.key];
                    const err = errors[type.key];
                    const loading = loadingKey === type.key;
                    const isExp = expandedKey === type.key;
                    const copied = result?.copiedAt && Date.now() - result.copiedAt < 2500;

                    return (
                        <div key={type.key}>
                            {/* 行头 */}
                            <div className="px-6 py-3.5 flex items-center gap-4">
                                <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                                    result ? 'bg-green-100' : 'bg-gray-100')}>
                                    {result
                                        ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                                        : <FileText className="w-4 h-4 text-gray-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-800">{type.label}</p>
                                    <p className="text-xs text-gray-400 truncate">{type.desc}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {result && (
                                        <>
                                            <button onClick={() => handleCopy(type.key, result.content)}
                                                className={clsx('flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                                    copied ? 'bg-green-100 text-green-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-600')}>
                                                <Copy className="w-3.5 h-3.5" />
                                                {copied ? '已复制' : '复制'}
                                            </button>
                                            <button onClick={() => handleDownload(type.label, result.content)}
                                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                                                <Download className="w-3.5 h-3.5" />下载
                                            </button>
                                            <button onClick={() => setExpandedKey(isExp ? null : type.key)}
                                                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                                                {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                            </button>
                                        </>
                                    )}
                                    <button onClick={() => handleGenerate(type)} disabled={loading}
                                        className={clsx('flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                                            loading ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                                                : result ? 'bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50'
                                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm')}>
                                        {loading
                                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />生成中</>
                                            : result
                                                ? <><RefreshCw className="w-3.5 h-3.5" />重新生成</>
                                                : <>生成此附件</>}
                                    </button>
                                </div>
                            </div>

                            {/* 错误行 */}
                            {err && (
                                <div className="mx-6 mb-3 text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg flex items-center gap-2">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{err}
                                </div>
                            )}

                            {/* 展开预览 */}
                            {isExp && result && (
                                <div className="mx-6 mb-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
                                    <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
                                        {result.content}
                                    </pre>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

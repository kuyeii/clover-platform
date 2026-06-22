import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, X } from 'lucide-react';
import clsx from 'clsx';
import type { BidderInfo } from '../services/projectService';

const EMPTY_BIDDER: BidderInfo = { orgName: '', legalRep: '', projectLead: '', phone: '', docDate: '' };

const BIDDER_FIELDS: { key: keyof BidderInfo; label: string; placeholder: string; type?: string; required?: boolean }[] = [
    { key: 'orgName', label: '投标单位全称', placeholder: 'XX科技有限公司', required: true },
    { key: 'legalRep', label: '法定代表人', placeholder: '张三', required: true },
    { key: 'projectLead', label: '项目负责人', placeholder: '李四', required: true },
    { key: 'phone', label: '联系电话', placeholder: '138-0000-0000', required: true },
    { key: 'docDate', label: '文件编制日期', placeholder: '2025-03-01', type: 'date' },
];

interface BidderInfoDialogProps {
    visible: boolean;
    title?: string;
    subtitle?: string;
    initialValue?: BidderInfo;
    submitLabel?: string;
    hasGeneratedContent?: boolean;
    onCancel: () => void;
    onConfirm: (bidderInfo: BidderInfo) => void;
}

function normalizeBidder(info?: BidderInfo): BidderInfo {
    return { ...EMPTY_BIDDER, ...(info || {}) };
}

function bidderEquals(left: BidderInfo, right: BidderInfo): boolean {
    return BIDDER_FIELDS.every((field) => String(left[field.key] || '') === String(right[field.key] || ''));
}

export function BidderInfoDialog({
    visible,
    title = '投标人信息配置',
    subtitle = '正文生成会使用这些信息填充投标人相关内容',
    initialValue,
    submitLabel = '保存配置',
    hasGeneratedContent = false,
    onCancel,
    onConfirm,
}: BidderInfoDialogProps) {
    const initialBidder = useMemo(() => normalizeBidder(initialValue), [initialValue]);
    const [draft, setDraft] = useState<BidderInfo>(initialBidder);

    useEffect(() => {
        if (!visible) return;
        setDraft(initialBidder);
    }, [visible, initialBidder]);

    if (!visible) return null;

    const missingRequired = BIDDER_FIELDS
        .filter((field) => field.required && !String(draft[field.key] || '').trim())
        .map((field) => field.label);
    const changed = !bidderEquals(draft, initialBidder);
    const showGeneratedWarning = hasGeneratedContent && changed;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[520px] bg-white rounded-2xl shadow-panel overflow-hidden">
                <div className="bg-brand-500 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-base leading-tight">{title}</h2>
                            <p className="text-white/75 text-xs mt-0.5">{subtitle}</p>
                        </div>
                    </div>
                    <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-3">
                    {BIDDER_FIELDS.map((field) => (
                        <div key={field.key}>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {field.label}
                                {field.required ? <span className="ml-1 text-danger">*</span> : null}
                            </label>
                            <input
                                type={field.type || 'text'}
                                value={(draft[field.key] as string) || ''}
                                onChange={(event) => setDraft(prev => ({ ...prev, [field.key]: event.target.value }))}
                                placeholder={field.placeholder}
                                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 bg-white outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-200"
                            />
                        </div>
                    ))}

                    {missingRequired.length > 0 ? (
                        <div className="bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] rounded-xl px-4 py-3 text-xs text-warning">
                            需补全：{missingRequired.join('、')}
                        </div>
                    ) : null}

                    {showGeneratedWarning ? (
                        <div className="flex items-start gap-2 bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] rounded-xl px-4 py-3 text-xs text-warning">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>已生成正文，更新投标人信息后需要重新生成。</span>
                        </div>
                    ) : null}
                </div>

                <div className="px-6 pb-6 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
                    >
                        取消
                    </button>
                    <button
                        onClick={() => onConfirm(draft)}
                        disabled={missingRequired.length > 0}
                        className={clsx(
                            'flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
                            missingRequired.length === 0
                                ? 'bg-brand-500 hover:bg-brand-600 text-white'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        )}
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        {submitLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

import { useState, useEffect } from 'react';
import { FileText, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import type { TechProposalConfig } from '../services/projectService';

interface TechProposalGateProps {
    visible: boolean;
    onCancel: () => void;
    onConfirm: (config: TechProposalConfig) => void;
    /** 可选：传入旧配置（或 AI 预估值）作为各字段初始值 */
    initialConfig?: TechProposalConfig;
    /** 运行中禁用提交，避免重复发起任务 */
    disabled?: boolean;
}

const MAX_TOTAL_WORDS = 1000000;

/** 通用「手动 | 自动」Tab 组件 */
function ModeTab({ auto, onChange, disabled }: { auto: boolean; onChange: (auto: boolean) => void; disabled?: boolean }) {
    return (
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button
                disabled={disabled}
                onClick={() => onChange(false)}
                className={clsx(
                    'px-3 py-1 font-medium transition-colors',
                    !auto ? 'bg-sky-600 text-white' : 'text-gray-500 hover:bg-gray-50',
                    disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
            >
                手动设置
            </button>
            <button
                disabled={disabled}
                onClick={() => onChange(true)}
                className={clsx(
                    'px-3 py-1 font-medium transition-colors',
                    auto ? 'bg-sky-600 text-white' : 'text-gray-500 hover:bg-gray-50',
                    disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
            >
                AI 自动
            </button>
        </div>
    );
}

/**
 * 技术方案入口弹窗
 * - 移除了「预期总页数」输入（已废弃）
 * - 当 initialConfig 含有 AI 预估值时，默认展示该值（手动模式），而非切换为"AI 自动"
 * - 用户仍可切换为"AI 自动"或自行修改数字
 */
export function TechProposalGate({ visible, onCancel, onConfirm, initialConfig, disabled = false }: TechProposalGateProps) {
    const [wordInput, setWordInput] = useState(String(initialConfig?.totalWords ?? 20000));

    // 有 AI 预估值时默认为手动（让用户直接看到具体数字）；无预估值时默认 AI 自动
    const [autoWords, setAutoWords] = useState(initialConfig?.totalWords === undefined);

    // 每次弹窗重新打开时回填最新配置
    useEffect(() => {
        if (!visible) return;
        const words = initialConfig?.totalWords;
        setWordInput(String(words ?? 20000));
        // 有 AI 预估具体数值时使用手动模式展示；否则回到 AI 自动
        setAutoWords(words === undefined);
    }, [visible, initialConfig?.totalWords]);

    if (!visible) return null;

    const parsedWords = Number(wordInput);
    const hasWordInput = wordInput.trim().length > 0;
    const manualWordsValid = hasWordInput && Number.isInteger(parsedWords) && parsedWords > 0 && parsedWords <= MAX_TOTAL_WORDS;
    const wordError = !autoWords && hasWordInput && !manualWordsValid
        ? (parsedWords > MAX_TOTAL_WORDS ? '字数超出可用范围' : '请输入有效字数')
        : '';

    const handleConfirm = () => {
        if (!autoWords && !manualWordsValid) return;
        onConfirm({
            totalWords: autoWords ? undefined : parsedWords,
            enableDiagrams: false,
            maxDiagrams: 0,
        });
    };

    const canConfirm = autoWords || manualWordsValid;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[480px] bg-white rounded-2xl shadow-2xl overflow-hidden">
                {/* 标题栏 */}
                <div className="bg-gradient-to-r from-sky-500 to-blue-500 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
                            <FileText className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-base leading-tight">进入技术方案制作</h2>
                            <p className="text-white/75 text-xs mt-0.5">请确认文件规模，AI 将按权重自动分配各章节字数</p>
                        </div>
                    </div>
                    <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* 内容区 */}
                <div className="px-6 py-5 space-y-5">

                    {/* 预期总字数 */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-semibold text-gray-700">
                                预期总字数
                                <span className="ml-2 text-xs text-gray-400 font-normal">AI 将据此分配各章节目标字数</span>
                            </label>
                            <ModeTab auto={autoWords} onChange={setAutoWords} disabled={disabled} />
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                value={autoWords ? '' : wordInput}
                                disabled={autoWords || disabled}
                                onChange={e => setWordInput(e.target.value)}
                                placeholder={autoWords ? 'AI 自动决定' : '自定义字数'}
                                min={1000}
                                max={MAX_TOTAL_WORDS}
                                aria-invalid={Boolean(wordError)}
                                className={clsx(
                                    'w-full text-sm border rounded-lg pl-3 pr-10 py-2.5 outline-none transition-colors',
                                    autoWords
                                        ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                                        : wordError
                                            ? 'border-red-300 focus:border-red-400 focus:ring-1 focus:ring-red-400'
                                            : 'border-gray-300 focus:border-sky-400 focus:ring-1 focus:ring-sky-400'
                                )}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                                {autoWords ? '自动' : '字'}
                            </span>
                        </div>
                        {wordError && <p className="mt-2 text-xs text-red-500">{wordError}</p>}
                    </div>

                    <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3 text-xs text-sky-700">
                        <strong className="font-semibold">自动权重分配说明：</strong>按评分权重与章节复杂度自动分配篇幅。
                    </div>
                </div>

                {/* 操作按钮 */}
                <div className="px-6 pb-6 flex gap-3">
                    <button
                        onClick={onCancel}
                        disabled={disabled}
                        className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canConfirm || disabled}
                        className={clsx(
                            'flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
                            canConfirm && !disabled
                                ? 'bg-sky-600 hover:bg-sky-700 text-white'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        )}
                    >
                        <Sparkles className="w-4 h-4" />
                        {disabled ? '生成中...' : '开始生成大纲'}
                    </button>
                </div>
            </div>
        </div>
    );
}

import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, Loader2, CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import type { Project } from '../../services/projectService';
import { projectService } from '../../services/projectService';

// 与后端 SSE 推送的步骤对齐
const STEPS = [
    { label: '解析文档结构' },
    { label: '隐私脱敏处理' },
    { label: '提取关键信息' },
];

interface ProjectCreatorProps {
    onProjectCreated: (project: Project) => void;
}

export function ProjectCreator({ onProjectCreated }: ProjectCreatorProps) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);

    // 实时进度（来自后端 SSE）
    const [progress, setProgress] = useState(0);
    const [currentStep, setCurrentStep] = useState(0);
    const [stepLabel, setStepLabel] = useState('准备中...');

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) setSelectedFile(file);
    };
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) setSelectedFile(file);
    };

    // 目标进度（SSE 推送）和显示进度（缓增插值）分离
    const targetProgressRef = useRef(0);
    const animFrameRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /** 启动缓增插值定时器 */
    const startProgressAnim = useCallback(() => {
        if (animFrameRef.current) return;
        animFrameRef.current = setInterval(() => {
            setProgress(prev => {
                const target = targetProgressRef.current;
                if (prev >= target) return prev;
                // 每帧最多步进 0.8%，越接近目标越慢（模拟 easeOut）
                const step = Math.max(0.3, (target - prev) * 0.06);
                const next = Math.min(prev + step, target);
                if (next >= 100) {
                    clearInterval(animFrameRef.current!);
                    animFrameRef.current = null;
                }
                return Math.round(next * 10) / 10; // 保留一位小数
            });
        }, 50);
    }, []);

    /** 调度解析（使用 SSE 实时进度） */
    const handleStart = useCallback(async () => {
        if (!selectedFile) return;
        setIsProcessing(true);
        setProgress(0);
        targetProgressRef.current = 0;
        setCurrentStep(0);
        setStepLabel('准备中...');
        setParseError(null);

        // 清理上次定时器
        if (animFrameRef.current) {
            clearInterval(animFrameRef.current);
            animFrameRef.current = null;
        }

        const project = projectService.create(selectedFile);

        try {
            const updatedProject = await projectService.extractRequirementsStream(
                project.id,
                selectedFile,
                {
                    onProgress: (data) => {
                        // 节点完成：直接跳到节点值，缓增只用于节点间的空档期
                        targetProgressRef.current = data.percent;
                        setProgress(data.percent);
                        setCurrentStep(data.step);
                        setStepLabel(data.label);
                        startProgressAnim();
                    },
                    onError: (data) => {
                        setParseError(data.message);
                    },
                }
            );

            // 确保进度跑满后再跳转
            targetProgressRef.current = 100;
            startProgressAnim();
            await new Promise<void>(res => setTimeout(res, 800));

            if (updatedProject) {
                onProjectCreated(updatedProject);
            }
        } catch (error: any) {
            console.error("解析异常", error);
            const errorMessage = error.response?.data?.detail || error.message || "未知错误";
            if (!parseError) setParseError(errorMessage);
        }
    }, [selectedFile, onProjectCreated, parseError, startProgressAnim]);

    return (
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 p-10">
            <div className="w-full max-w-2xl">
                {/* 标题区 */}
                <div className="text-center mb-10">
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">新建投标项目</h1>
                    <p className="text-gray-500 text-sm">导入招标文件，ProEngine 将自动解析并提取关键需求</p>
                </div>

                {/* 未开始：上传区 */}
                {!isProcessing ? (
                    <div className="space-y-6">
                        <label
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={clsx(
                                'block border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
                                isDragging
                                    ? 'border-sky-400 bg-sky-50'
                                    : selectedFile
                                        ? 'border-sky-300 bg-sky-50/40'
                                        : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100/50'
                            )}
                        >
                            <input type="file" className="hidden" accept=".docx,.pdf,.md,.doc" onChange={handleFileSelect} />
                            {selectedFile ? (
                                <div className="space-y-3">
                                    <div className="w-14 h-14 bg-sky-100 rounded-xl flex items-center justify-center mx-auto">
                                        <FileText className="w-7 h-7 text-sky-600" />
                                    </div>
                                    <p className="text-base font-semibold text-sky-700">{selectedFile.name}</p>
                                    <p className="text-sm text-gray-500">
                                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 点击可重新选择
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center mx-auto shadow-sm">
                                        <Upload className="w-7 h-7 text-gray-400" />
                                    </div>
                                    <p className="text-base font-semibold text-gray-700">拖拽文件至此或点击导入</p>
                                    <p className="text-sm text-gray-400">支持 .docx · .pdf · .md 格式，单文件不超过 50MB</p>
                                </div>
                            )}
                        </label>

                        <button
                            onClick={handleStart}
                            disabled={!selectedFile}
                            className={clsx(
                                'w-full flex items-center justify-center gap-2 px-6 py-4 text-base font-semibold rounded-xl transition-all',
                                selectedFile
                                    ? 'bg-sky-600 text-white hover:bg-sky-700 shadow-md hover:shadow-lg'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            )}
                        >
                            开始解析招标文件
                            {selectedFile && <ChevronRight className="w-5 h-5" />}
                        </button>
                    </div>
                ) : parseError ? (
                    /* 解析失败 */
                    <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertCircle className="w-6 h-6 text-red-500" />
                            <div>
                                <p className="font-semibold text-gray-900">解析失败</p>
                                <p className="text-sm text-gray-500 truncate max-w-sm">{selectedFile?.name}</p>
                            </div>
                        </div>
                        <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm mb-6 whitespace-pre-wrap">
                            {parseError}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setParseError(null); setIsProcessing(false); setTimeout(handleStart, 50); }}
                                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
                            >
                                重新解析
                            </button>
                            <button
                                onClick={() => { setIsProcessing(false); setParseError(null); setSelectedFile(null); }}
                                className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-all"
                            >
                                返回重新选择
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
                        {/* 文件信息 */}
                        <div className="flex items-center gap-3 mb-8">
                            <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5 text-sky-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900 truncate">{selectedFile?.name}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{stepLabel}</p>
                            </div>
                        </div>

                        {/* 步骤指示（水平排列，放大） */}
                        <div className="flex items-center gap-8 justify-center">
                            {STEPS.map((step, idx) => {
                                const done = idx < currentStep || progress >= 100;
                                const active = idx === currentStep && progress < 100;
                                return (
                                    <div key={idx} className="flex items-center gap-2">
                                        {done ? (
                                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                                        ) : active ? (
                                            <Loader2 className="w-5 h-5 text-sky-500 animate-spin shrink-0" />
                                        ) : (
                                            <div className="w-5 h-5 rounded-full border-2 border-gray-200 shrink-0" />
                                        )}
                                        <span className={clsx(
                                            'text-sm',
                                            done ? 'text-emerald-600 font-semibold'
                                                : active ? 'text-sky-600 font-semibold animate-pulse'
                                                : 'text-gray-400'
                                        )}>
                                            {step.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

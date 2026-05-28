import { useState, useEffect, useRef } from 'react';
import { FileText, ZoomIn, ZoomOut, RotateCcw, X, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { ProtectedIframe } from './ProtectedIframe';

interface PdfPreviewProps {
    /** 后端返回的 PDF URL（如 /api/projects/pdf/{id}），空则显示空状态 */
    pdfUrl?: string;
    /** 原始文件名，用于底部标注 */
    fileName?: string;
    /** 是否以折叠面板方式嵌入（false = 全宽盒子） */
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

/**
 * PDF 预览面板
 * 通过 <iframe> 加载后端缓存的 PDF 文件。
 * 后端对 DOC/DOCX 已转换为 PDF，前端无需关心格式。
 */
export function PdfPreview({ pdfUrl, fileName, collapsed, onToggleCollapse }: PdfPreviewProps) {
    const [zoom, setZoom] = useState(100); // 百分比
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (pdfUrl) {
            setLoading(true);
            setError(false);
        }
    }, [pdfUrl]);

    const handleIframeLoad = () => setLoading(false);
    const handleIframeError = () => { setLoading(false); setError(true); };

    // 构建完整的 PDF 访问 URL（加上后端 base）
    const fullUrl = pdfUrl
        ? `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
        : '';

    return (
        <div className={clsx(
            'flex flex-col bg-white border-l border-gray-200 overflow-hidden transition-all duration-300',
            collapsed ? 'w-10' : 'w-[340px]'
        )}>
            {/* 顶栏 */}
            <div className="h-10 bg-gray-50 border-b border-gray-200 flex items-center px-2 shrink-0 gap-1.5">
                <button
                    onClick={onToggleCollapse}
                    className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                    title={collapsed ? '展开预览' : '收起预览'}
                >
                    {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>

                {!collapsed && (
                    <>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-600 truncate">
                                {fileName || '招标文件预览'}
                            </p>
                        </div>
                        {/* 缩放控件 */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setZoom(v => Math.max(50, v - 10))}
                                className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                                title="缩小"
                            >
                                <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-sm text-gray-500 w-9 text-center">{zoom}%</span>
                            <button
                                onClick={() => setZoom(v => Math.min(200, v + 10))}
                                className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                                title="放大"
                            >
                                <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => setZoom(100)}
                                className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                                title="重置缩放"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* 预览内容区 */}
            {!collapsed && (
                <div className="flex-1 overflow-hidden relative">
                    {!pdfUrl ? (
                        // 空状态
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
                            <FileText className="w-10 h-10 opacity-30" />
                            <p className="text-sm text-gray-400">上传招标文件后<br />在此预览原文</p>
                        </div>
                    ) : error ? (
                        // 错误状态
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
                            <X className="w-8 h-8 text-danger/50" />
                            <p className="text-sm text-center px-4">
                                PDF 预览加载失败<br />
                                <span className="text-gray-400">可能是 DOCX 转换尚未完成</span>
                            </p>
                            <button
                                onClick={() => { setError(false); setLoading(true); if (iframeRef.current) iframeRef.current.src = fullUrl; }}
                                className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors border border-gray-200"
                            >
                                重新加载
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* 加载遮罩 */}
                            {loading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                                    <div className="w-6 h-6 border-2 border-gray-300 border-t-sky-500 rounded-full animate-spin" />
                                </div>
                            )}
                            <ProtectedIframe
                                ref={iframeRef}
                                src={fullUrl}
                                onLoad={handleIframeLoad}
                                onError={handleIframeError}
                                className="w-full h-full border-0 origin-top-left"
                                style={{
                                    transform: `scale(${zoom / 100})`,
                                    transformOrigin: 'top center',
                                    width: zoom > 100 ? `${(100 / zoom) * 100}%` : '100%',
                                    height: zoom > 100 ? `${(100 / zoom) * 100}%` : '100%',
                                }}
                                title="招标文件 PDF 预览"
                            />
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

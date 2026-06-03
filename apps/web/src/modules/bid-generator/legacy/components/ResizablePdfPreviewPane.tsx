import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, PanelRightClose, PanelRightOpen } from 'lucide-react';
import clsx from 'clsx';
import { ProtectedIframe } from './ProtectedIframe';

interface ResizablePdfPreviewPaneProps {
    pdfUrl: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title?: string;
}

const COLLAPSED_WIDTH = 32;
const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;

export function ResizablePdfPreviewPane({
    pdfUrl,
    open,
    onOpenChange,
    title = '招标文件预览',
}: ResizablePdfPreviewPaneProps) {
    const [width, setWidth] = useState(DEFAULT_WIDTH);
    const [dragging, setDragging] = useState(false);
    const dragStateRef = useRef({ startWidth: DEFAULT_WIDTH });
    const cleanupResizeRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        return () => {
            cleanupResizeRef.current?.();
        };
    }, []);

    const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        cleanupResizeRef.current?.();
        const startX = event.clientX;
        dragStateRef.current = { startWidth: width };
        setDragging(true);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStateRef.current.startWidth - deltaX));
            setWidth(nextWidth);
        };

        const finishResize = () => {
            setDragging(false);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', finishResize);
            window.removeEventListener('pointercancel', finishResize);
            window.removeEventListener('mouseup', finishResize);
            window.removeEventListener('blur', finishResize);
            cleanupResizeRef.current = null;
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', finishResize);
        window.addEventListener('pointercancel', finishResize);
        window.addEventListener('mouseup', finishResize);
        window.addEventListener('blur', finishResize);
        cleanupResizeRef.current = finishResize;
    }, [open, width]);

    const handleToggle = () => {
        onOpenChange(!open);
    };

    return (
        <div
            className={clsx(
                'flex shrink-0 border-l border-gray-200 bg-white',
                dragging ? 'transition-none' : 'transition-[width] duration-200',
            )}
            style={{ width: open ? width : COLLAPSED_WIDTH }}
        >
            {open ? (
                <div
                    onPointerDown={handleResizePointerDown}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整招标文件原文宽度"
                    title="拖动调整宽度"
                    className={clsx(
                        'group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center border-r border-gray-200 bg-white transition-colors',
                        dragging && 'bg-brand-50',
                    )}
                >
                    <div
                        className={clsx(
                            'flex h-12 w-1 items-center justify-center rounded-full transition-colors',
                            dragging ? 'bg-brand-100 text-brand-500' : 'text-gray-300 group-hover:bg-brand-50 group-hover:text-brand-500',
                        )}
                    >
                        <GripVertical className="h-3.5 w-3.5" />
                    </div>
                </div>
            ) : null}

            <div
                onClick={handleToggle}
                role="button"
                tabIndex={0}
                aria-label={open ? '收起原文' : '展开查看原始招标文件'}
                title={open ? '收起原文' : '展开查看原始招标文件'}
                className={clsx(
                    'relative w-8 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-2 transition-colors group select-none',
                    'cursor-pointer hover:bg-brand-50',
                )}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenChange(!open);
                    }
                }}
            >
                {open ? (
                    <PanelRightClose className="w-3.5 h-3.5 text-gray-400 group-hover:text-brand-600" />
                ) : (
                    <PanelRightOpen className="w-3.5 h-3.5 text-gray-400 group-hover:text-brand-600" />
                )}
                <span
                    className="text-xs text-gray-400 group-hover:text-brand-600"
                    style={{ writingMode: 'vertical-rl', letterSpacing: '0.05em' }}
                >
                    招标文件原文
                </span>
            </div>

            {open ? (
                <div className="flex-1 bg-gray-100 flex flex-col min-w-0">
                    <div className="px-3 py-2 bg-white border-b border-gray-200 shrink-0">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">原始招标文件</p>
                    </div>
                    <ProtectedIframe
                        src={`${pdfUrl}#pagemode=none`}
                        className={clsx('flex-1 w-full border-0', dragging && 'pointer-events-none')}
                        title={title}
                    />
                </div>
            ) : null}
        </div>
    );
}

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { DocBlockItem } from '../services/projectService';

export interface AttachmentMaskRange {
    moduleId: string;
    label: string;
    startBlockId: string;
    endBlockId: string;
    startIndex: number;
    endIndex: number;
    active: boolean;
}

interface Props {
    blocks: DocBlockItem[];
    blocksLoading: boolean;
    ranges: AttachmentMaskRange[];
    activeRange: { startBlockId: string; endBlockId: string } | null;
    focusBlockId?: string | null;
    focusRequestKey?: string;
    isLocked?: boolean;
    onSelectModule: (moduleId: string) => void;
    onRangeChange: (range: { startBlockId: string; endBlockId: string }) => void;
    onRangeCommit: (range: { startBlockId: string; endBlockId: string }) => void;
}

type DragEdge = 'start' | 'end';

type BlockLayout = {
    top: number;
    bottom: number;
    height: number;
};

type DragListeners = {
    move: (event: PointerEvent) => void;
    up: () => void;
};

type EdgeZone = 'top' | 'bottom' | 'none';

function parseTableBlock(text: string): string[][] | null {
    const lines = String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return null;
    if (!lines.every((line) => line.startsWith('|') && line.endsWith('|'))) return null;
    const rows = lines
        .filter((line, idx) => idx !== 1 || !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(line))
        .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
    return rows.length > 0 ? rows : null;
}

function rangesEqual(
    left: { startBlockId: string; endBlockId: string } | null,
    right: { startBlockId: string; endBlockId: string } | null,
): boolean {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.startBlockId === right.startBlockId && left.endBlockId === right.endBlockId;
}

function layoutsEqual(left: Record<string, BlockLayout>, right: Record<string, BlockLayout>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
        const a = left[key];
        const b = right[key];
        if (!b) return false;
        if (a.top !== b.top || a.bottom !== b.bottom || a.height !== b.height) return false;
    }
    return true;
}

export function AttachmentAnchorCanvas({
    blocks,
    blocksLoading,
    ranges,
    activeRange,
    focusBlockId,
    focusRequestKey,
    isLocked = false,
    onSelectModule,
    onRangeChange,
    onRangeCommit,
}: Props) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const layoutsRef = useRef<Record<string, BlockLayout>>({});
    const measureFrameRef = useRef<number | null>(null);
    const autoScrollFrameRef = useRef<number | null>(null);
    const pointerYRef = useRef(0);
    const lastPointerYRef = useRef(0);
    const dragEdgeRef = useRef<DragEdge | null>(null);
    const dragListenersRef = useRef<DragListeners | null>(null);
    const activeRangeRef = useRef<{ startBlockId: string; endBlockId: string } | null>(null);
    const rangesRef = useRef<AttachmentMaskRange[]>(ranges);
    const stepAutoScrollRef = useRef<() => void>(() => undefined);
    const suppressFocusJumpOnceRef = useRef(false);
    const dragStartedRef = useRef(false);
    const edgeScrollArmedRef = useRef(false);
    const edgeZoneRef = useRef<EdgeZone>('none');

    const [layoutVersion, setLayoutVersion] = useState(0);
    const [draggingEdge, setDraggingEdge] = useState<DragEdge | null>(null);
    const [layouts, setLayouts] = useState<Record<string, BlockLayout>>({});

    const blockIndexMap = useMemo(() => {
        const map = new Map<string, number>();
        blocks.forEach((block, idx) => map.set(block.block_id, idx));
        return map;
    }, [blocks]);
    const blockIndexMapRef = useRef(blockIndexMap);

    const normalizedActiveRange = useMemo(() => {
        if (!activeRange?.startBlockId || !activeRange?.endBlockId) return null;
        const startIndex = blockIndexMap.get(activeRange.startBlockId);
        const endIndex = blockIndexMap.get(activeRange.endBlockId);
        if (startIndex === undefined || endIndex === undefined) return null;
        return startIndex <= endIndex
            ? activeRange
            : {
                startBlockId: activeRange.endBlockId,
                endBlockId: activeRange.startBlockId,
            };
    }, [activeRange, blockIndexMap]);

    useEffect(() => {
        activeRangeRef.current = normalizedActiveRange;
    }, [normalizedActiveRange]);

    useEffect(() => {
        rangesRef.current = ranges;
    }, [ranges]);

    useEffect(() => {
        blockIndexMapRef.current = blockIndexMap;
    }, [blockIndexMap]);

    const scheduleMeasure = useCallback(() => {
        if (measureFrameRef.current !== null) return;
        measureFrameRef.current = window.requestAnimationFrame(() => {
            measureFrameRef.current = null;
            const nextLayouts: Record<string, BlockLayout> = {};
            for (const block of blocks) {
                const row = rowRefs.current[block.block_id];
                if (!row) continue;
                const top = row.offsetTop;
                const height = row.offsetHeight;
                nextLayouts[block.block_id] = {
                    top,
                    bottom: top + height,
                    height,
                };
            }
            if (!layoutsEqual(layoutsRef.current, nextLayouts)) {
                layoutsRef.current = nextLayouts;
                setLayouts(nextLayouts);
                setLayoutVersion((value) => value + 1);
            }
        });
    }, [blocks]);

    useEffect(() => {
        scheduleMeasure();
    }, [scheduleMeasure, blocks, ranges, normalizedActiveRange]);

    useEffect(() => {
        const handleResize = () => scheduleMeasure();
        window.addEventListener('resize', handleResize);
        const container = scrollRef.current;
        const observer = typeof ResizeObserver !== 'undefined' && container
            ? new ResizeObserver(() => scheduleMeasure())
            : null;
        if (observer && container) observer.observe(container);
        return () => {
            window.removeEventListener('resize', handleResize);
            observer?.disconnect();
        };
    }, [scheduleMeasure]);

    useEffect(() => {
        // Dragging updates start/end anchors continuously; avoid auto-jump while handles are moving.
        if (!focusBlockId || dragEdgeRef.current) return;
        if (suppressFocusJumpOnceRef.current) {
            suppressFocusJumpOnceRef.current = false;
            return;
        }
        const container = scrollRef.current;
        const row = rowRefs.current[focusBlockId];
        if (!container || !row) return;
        const nextTop = Math.max(0, row.offsetTop - 16);
        container.scrollTo({ top: nextTop, behavior: 'smooth' });
    }, [focusBlockId, focusRequestKey, draggingEdge]);

    const stopDrag = useCallback(() => {
        if (autoScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(autoScrollFrameRef.current);
            autoScrollFrameRef.current = null;
        }
        const listeners = dragListenersRef.current;
        if (listeners) {
            window.removeEventListener('pointermove', listeners.move);
            window.removeEventListener('pointerup', listeners.up);
            dragListenersRef.current = null;
        }
        dragEdgeRef.current = null;
        dragStartedRef.current = false;
        edgeScrollArmedRef.current = false;
        edgeZoneRef.current = 'none';
        setDraggingEdge(null);
    }, []);

    useEffect(() => stopDrag, [stopDrag]);

    const findNearestBlockId = useCallback((clientY: number): string | null => {
        const container = scrollRef.current;
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        const contentY = clientY - rect.top + container.scrollTop;
        let hitId: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const block of blocks) {
            const layout = layoutsRef.current[block.block_id];
            if (!layout) continue;
            if (contentY >= layout.top && contentY <= layout.bottom) return block.block_id;
            const center = (layout.top + layout.bottom) / 2;
            const distance = Math.abs(contentY - center);
            if (distance < bestDistance) {
                bestDistance = distance;
                hitId = block.block_id;
            }
        }
        return hitId;
    }, [blocks]);

    const applyRangeByEdge = useCallback((edge: DragEdge, blockId: string) => {
        const currentRange = activeRangeRef.current;
        if (!currentRange) return;
        const currentStartIndex = blockIndexMapRef.current.get(currentRange.startBlockId);
        const currentEndIndex = blockIndexMapRef.current.get(currentRange.endBlockId);
        if (currentStartIndex === undefined || currentEndIndex === undefined) return;

        const activeMask = rangesRef.current.find((item) => item.active);
        const activeId = activeMask?.moduleId;
        const neighbors = rangesRef.current
            .filter((item) => item.moduleId !== activeId)
            .map((item) => ({
                startIndex: Math.min(item.startIndex, item.endIndex),
                endIndex: Math.max(item.startIndex, item.endIndex),
            }))
            .sort((left, right) => left.startIndex - right.startIndex);
        let prevEndBoundary = -1;
        let nextStartBoundary = Number.POSITIVE_INFINITY;
        for (const neighbor of neighbors) {
            if (neighbor.endIndex < currentStartIndex) {
                prevEndBoundary = Math.max(prevEndBoundary, neighbor.endIndex);
            }
            if (neighbor.startIndex > currentEndIndex) {
                nextStartBoundary = Math.min(nextStartBoundary, neighbor.startIndex);
            }
        }

        const anchorBlockId = edge === 'start'
            ? currentRange.endBlockId
            : currentRange.startBlockId;
        const anchorIndex = blockIndexMapRef.current.get(anchorBlockId);
        const rawNextIndex = blockIndexMapRef.current.get(blockId);
        if (anchorIndex === undefined || rawNextIndex === undefined) return;

        let nextIndex = rawNextIndex;
        if (edge === 'start') {
            const minStart = prevEndBoundary + 1;
            const maxStart = currentEndIndex;
            nextIndex = Math.max(minStart, Math.min(maxStart, rawNextIndex));
        } else {
            const minEnd = currentStartIndex;
            const maxEnd = Number.isFinite(nextStartBoundary) ? nextStartBoundary - 1 : Number.POSITIVE_INFINITY;
            nextIndex = Math.max(minEnd, Math.min(maxEnd, rawNextIndex));
        }

        let nextRange: { startBlockId: string; endBlockId: string };
        if (nextIndex <= anchorIndex) {
            const startBlockId = blocks[nextIndex]?.block_id || blockId;
            nextRange = { startBlockId, endBlockId: anchorBlockId };
        } else {
            const endBlockId = blocks[nextIndex]?.block_id || blockId;
            nextRange = { startBlockId: anchorBlockId, endBlockId };
        }
        if (!rangesEqual(currentRange, nextRange)) {
            onRangeChange(nextRange);
        }
    }, [blocks, onRangeChange]);

    const updateDragRangeFromPointer = useCallback((clientY: number) => {
        const edge = dragEdgeRef.current;
        if (!edge) return;
        const nextBlockId = findNearestBlockId(clientY);
        if (!nextBlockId) return;
        applyRangeByEdge(edge, nextBlockId);
    }, [applyRangeByEdge, findNearestBlockId]);

    const resolveEdgeZone = useCallback((clientY: number): EdgeZone => {
        const container = scrollRef.current;
        if (!container) return 'none';
        const rect = container.getBoundingClientRect();
        const triggerSize = 24;
        if (clientY <= rect.top + triggerSize) return 'top';
        if (clientY >= rect.bottom - triggerSize) return 'bottom';
        return 'none';
    }, []);

    const stepAutoScroll = useCallback(() => {
        const container = scrollRef.current;
        if (!container || !dragEdgeRef.current || !edgeScrollArmedRef.current) return;
        const rect = container.getBoundingClientRect();
        const triggerSize = 24;
        let delta = 0;
        const zone = resolveEdgeZone(pointerYRef.current);
        if (zone === 'top') {
            const distance = Math.max(0, rect.top + triggerSize - pointerYRef.current);
            delta = -Math.min(8, Math.max(2, Math.round(distance / 8)));
        } else if (zone === 'bottom') {
            const distance = Math.max(0, pointerYRef.current - (rect.bottom - triggerSize));
            delta = Math.min(8, Math.max(2, Math.round(distance / 8)));
        }
        if (delta !== 0) {
            const nextScrollTop = Math.max(0, Math.min(
                container.scrollTop + delta,
                container.scrollHeight - container.clientHeight,
            ));
            if (nextScrollTop === container.scrollTop) {
                edgeScrollArmedRef.current = false;
                autoScrollFrameRef.current = null;
                return;
            }
            container.scrollTop = nextScrollTop;
            scheduleMeasure();
            updateDragRangeFromPointer(pointerYRef.current);
        } else {
            edgeScrollArmedRef.current = false;
            autoScrollFrameRef.current = null;
            return;
        }
        if (edgeScrollArmedRef.current) {
            autoScrollFrameRef.current = window.requestAnimationFrame(stepAutoScrollRef.current);
        } else {
            autoScrollFrameRef.current = null;
        }
    }, [resolveEdgeZone, scheduleMeasure, updateDragRangeFromPointer]);

    useEffect(() => {
        stepAutoScrollRef.current = stepAutoScroll;
    }, [stepAutoScroll]);

    const handleDragPointerDown = useCallback((edge: DragEdge, event: ReactPointerEvent<HTMLButtonElement>) => {
        if (isLocked || !activeRangeRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        stopDrag();
        dragEdgeRef.current = edge;
        pointerYRef.current = event.clientY;
        lastPointerYRef.current = event.clientY;
        dragStartedRef.current = false;
        edgeScrollArmedRef.current = false;
        edgeZoneRef.current = 'none';
        setDraggingEdge(edge);

        const move = (nativeEvent: PointerEvent) => {
            const deltaY = nativeEvent.clientY - lastPointerYRef.current;
            lastPointerYRef.current = nativeEvent.clientY;
            pointerYRef.current = nativeEvent.clientY;
            if (!dragStartedRef.current && Math.abs(deltaY) >= 2) {
                dragStartedRef.current = true;
            }
            const zone = resolveEdgeZone(nativeEvent.clientY);
            edgeZoneRef.current = zone;
            const movingTowardEdge =
                (zone === 'top' && deltaY < 0) ||
                (zone === 'bottom' && deltaY > 0);
            if (dragStartedRef.current && zone !== 'none' && movingTowardEdge) {
                edgeScrollArmedRef.current = true;
                if (autoScrollFrameRef.current === null) {
                    autoScrollFrameRef.current = window.requestAnimationFrame(stepAutoScrollRef.current);
                }
            } else if (zone === 'none') {
                edgeScrollArmedRef.current = false;
                if (autoScrollFrameRef.current !== null) {
                    window.cancelAnimationFrame(autoScrollFrameRef.current);
                    autoScrollFrameRef.current = null;
                }
            }
            updateDragRangeFromPointer(nativeEvent.clientY);
        };
        const up = () => {
            const committedRange = activeRangeRef.current;
            suppressFocusJumpOnceRef.current = true;
            stopDrag();
            if (committedRange) {
                onRangeCommit(committedRange);
            }
        };

        dragListenersRef.current = { move, up };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
    }, [isLocked, onRangeCommit, resolveEdgeZone, stopDrag, updateDragRangeFromPointer]);

    const visibleRanges = useMemo(() => {
        void layoutVersion;
        return [...ranges]
            .map((range) => {
                const startLayout = layouts[range.startBlockId];
                const endLayout = layouts[range.endBlockId];
                if (!startLayout || !endLayout) return null;
                const top = Math.min(startLayout.top, endLayout.top);
                const bottom = Math.max(startLayout.bottom, endLayout.bottom);
                return {
                    ...range,
                    top,
                    height: Math.max(0, bottom - top),
                };
            })
            .filter((range): range is NonNullable<typeof range> => Boolean(range))
            .sort((left, right) => Number(left.active) - Number(right.active));
    }, [layoutVersion, layouts, ranges]);

    return (
        <div
            ref={scrollRef}
            className="h-full min-h-0 overflow-y-auto rounded-xl border border-gray-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]"
        >
            {blocksLoading ? (
                <div className="px-4 py-4 text-sm text-gray-500">正在加载文档切片…</div>
            ) : blocks.length === 0 ? (
                <div className="px-4 py-4 text-sm text-gray-500">DOCX 定位缓存尚不可用。</div>
            ) : (
                <div className="relative px-3 py-4">
                    <div className="space-y-3">
                        {blocks.map((block) => {
                            const tableRows = block.type === 'table' ? parseTableBlock(block.text) : null;
                            return (
                                <div
                                    key={block.block_id}
                                    ref={(element) => {
                                        rowRefs.current[block.block_id] = element;
                                        if (element) scheduleMeasure();
                                    }}
                                    className="relative flex h-11 items-center rounded-lg border border-gray-200 bg-white/90 px-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                                >
                                    {tableRows ? (
                                        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-sm text-gray-600">
                                            <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">[表格]</span>
                                            <span className="min-w-0 truncate whitespace-nowrap text-xs text-gray-400">
                                                {tableRows[0]?.filter(Boolean).join(' / ') || '表格切片'}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="min-w-0 truncate text-sm text-gray-700">
                                            {block.text || '(空白切片)'}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="pointer-events-none absolute inset-0">
                        {visibleRanges.map((range) => (
                            <div
                                key={range.moduleId}
                                className="absolute"
                                style={{
                                    top: range.top - 4,
                                    left: 4,
                                    right: 4,
                                    height: range.height + 8,
                                    zIndex: range.active ? 20 : 10,
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => onSelectModule(range.moduleId)}
                                    className={clsx(
                                        'pointer-events-auto absolute inset-0 rounded-lg border text-left transition-colors',
                                        range.active
                                            ? 'border-sky-300 bg-sky-200/35 shadow-[0_0_0_1px_rgba(56,189,248,0.16)]'
                                            : 'border-gray-300/80 bg-gray-300/25 hover:bg-gray-300/45',
                                    )}
                                    aria-label={`选中 ${range.label}`}
                                />
                                <div className="pointer-events-none absolute right-4 top-2 flex max-w-[calc(100%-1rem)] justify-end">
                                    <span
                                        className={clsx(
                                            'truncate rounded-md px-2 py-1 text-xs text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]',
                                            range.active ? 'bg-sky-600/95' : 'bg-gray-400/85',
                                        )}
                                        title={range.label}
                                    >
                                        {range.label}
                                    </span>
                                </div>
                                {range.active ? (
                                    <>
                                        <button
                                            type="button"
                                            onPointerDown={(event) => handleDragPointerDown('start', event)}
                                            className={clsx(
                                                'pointer-events-auto absolute left-1/2 top-0 flex h-4 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-sky-300/80 bg-white text-sky-700 shadow-[0_2px_6px_rgba(2,132,199,0.22)]',
                                                isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-row-resize',
                                            )}
                                            aria-label="调整起点"
                                        >
                                            <span className="h-0.5 w-7 rounded-full bg-sky-500" />
                                        </button>
                                        <button
                                            type="button"
                                            onPointerDown={(event) => handleDragPointerDown('end', event)}
                                            className={clsx(
                                                'pointer-events-auto absolute bottom-0 left-1/2 flex h-4 w-14 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-md border border-sky-300/80 bg-white text-sky-700 shadow-[0_2px_6px_rgba(2,132,199,0.22)]',
                                                isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-row-resize',
                                            )}
                                            aria-label="调整终点"
                                        >
                                            <span className="h-0.5 w-7 rounded-full bg-sky-500" />
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        ))}
                    </div>

                    {draggingEdge ? (
                        <div className="pointer-events-none sticky bottom-3 mt-3 flex justify-center">
                            <div className="rounded-full bg-sky-900/88 px-3 py-1 text-xs font-medium text-white shadow-lg">
                                正在调整{draggingEdge === 'start' ? '起点' : '终点'}，松手后刷新右侧样式预览
                            </div>
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

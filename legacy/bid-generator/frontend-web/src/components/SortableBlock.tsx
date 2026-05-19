import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

interface SortableBlockProps {
    id: string;
    children: React.ReactNode;
    containerClassName?: string;
    handleClassName?: string;
    contentClassName?: string;
}

export function SortableBlock({
    id,
    children,
    containerClassName,
    handleClassName,
    contentClassName,
}: SortableBlockProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 1,
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`relative group flex bg-white border border-gray-100 rounded-lg mb-1 shadow-sm hover:border-gray-300 transition-colors overflow-hidden ${isDragging ? 'ring-2 ring-sky-500 border-transparent shadow-lg' : ''
                } ${containerClassName || ''}`}
        >
            {/* 拖拽把手区 */}
            <div
                {...attributes}
                {...listeners}
                className={`w-6 flex items-center justify-center border-r border-gray-50 bg-gray-50/50 rounded-l-lg cursor-grab hover:bg-gray-100/80 transition-colors shrink-0 ${handleClassName || ''}`}
            >
                <GripVertical className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
            </div>

            {/* 内容展示区 */}
            <div className={`flex-1 min-w-0 px-2.5 py-2 ${contentClassName || ''}`}>
                {children}
            </div>
        </div>
    );
}

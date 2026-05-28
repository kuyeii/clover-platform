import { Loader2 } from 'lucide-react';

interface TaskLoadingStateProps {
    title: string;
    className?: string;
}

export function TaskLoadingState({ title, className = '' }: TaskLoadingStateProps) {
    return (
        <div className={`flex flex-1 flex-col items-center justify-center gap-4 p-8 text-gray-300 ${className}`.trim()}>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
                <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
            </div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
        </div>
    );
}

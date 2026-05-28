import { FileText } from 'lucide-react';

/**
 * 结果查看器 — 生成完成后的最终文档预览组件
 * 当前为骨架占位，待后端联调后接入实际 Markdown/Word 内容
 */
export function ResultViewer() {
    return (
        <div className="bg-white rounded-xl shadow-none border border-gray-100 p-6 w-full mt-6 h-[850px] flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">结果查看器</h3>
            <p className="text-sm text-gray-500 text-center max-w-md">
                生成任务完成后，最终的标书文档预览将在此处展示。支持 Markdown 渲染与 Word 导出。
            </p>
        </div>
    );
}

import type { TemplateBlock } from '../services/configService';

interface BlockItemProps {
    block: TemplateBlock;
    onChange: (updatedBlock: TemplateBlock) => void;
}

export function BlockItem({ block, onChange }: BlockItemProps) {
    const handleChange = (field: keyof TemplateBlock, value: any) => {
        onChange({ ...block, [field]: value });
    };

    return (
        <div className="flex flex-col gap-3">
            {/* 头部：标题与 ID */}
            <div className="flex items-center justify-between">
                <input
                    type="text"
                    value={block.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    className="font-semibold text-gray-800 text-lg bg-transparent border-b border-transparent hover:border-gray-200 focus:border-brand-500 focus:outline-none transition-colors w-1/2"
                    placeholder="章节标题"
                />
                <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-400 font-medium whitespace-nowrap">ID:</span>
                    <input
                        type="text"
                        value={block.id}
                        onChange={(e) => handleChange('id', e.target.value)}
                        className="text-sm font-mono text-gray-500 bg-gray-50 border border-gray-200 px-2 py-1 rounded w-40 focus:border-brand-500 focus:bg-white focus:outline-none transition-colors"
                        placeholder="block_id"
                        title="用于匹配后端映射的标识符，如需修改请同步调整代码逻辑"
                    />
                </div>
            </div>

            {/* 指令说明 */}
            <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                    生成指令
                </label>
                <textarea
                    value={block.instruction}
                    onChange={(e) => handleChange('instruction', e.target.value)}
                    rows={5}
                    className="w-full text-sm text-gray-700 bg-gray-50 border border-transparent rounded-md p-3 hover:border-gray-200 focus:border-brand-500 focus:bg-white focus:outline-none transition-all resize-y"
                    placeholder="输入给大模型的具体要求..."
                />
            </div>

            {/* 预计字数 */}
            <div className="mt-1">
                <label className="block text-sm font-medium text-gray-500 mb-1">
                    预计字数
                </label>
                <div className="relative max-w-[180px]">
                    <input
                        type="number"
                        value={block.expected_word_count || ''}
                        onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            handleChange('expected_word_count', isNaN(val) ? undefined : val);
                        }}
                        placeholder="例如: 1500"
                        className="w-full text-sm border-gray-200 rounded-md p-2 pr-8 bg-gray-50 hover:border-gray-300 focus:border-brand-500 focus:bg-white focus:outline-none transition-colors"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <span className="text-gray-400 text-sm">字</span>
                    </div>
                </div>
            </div>

            {/* 开关设置项 */}
            <div className="flex items-center gap-6 mt-1">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={block.requires_blueprint}
                        onChange={(e) => handleChange('requires_blueprint', e.target.checked)}
                        className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-200 cursor-pointer"
                    />
                    <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                        强制依赖全局蓝图 (Blueprint)
                    </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={block.requires_search}
                        onChange={(e) => handleChange('requires_search', e.target.checked)}
                        className="w-4 h-4 text-brand-600 rounded border-gray-300 focus:ring-brand-200 cursor-pointer"
                    />
                    <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                        允许大模型搜索补充 (Search)
                    </span>
                </label>
            </div>
        </div>
    );
}

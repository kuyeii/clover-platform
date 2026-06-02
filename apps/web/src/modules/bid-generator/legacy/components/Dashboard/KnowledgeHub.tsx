import { useState, useEffect, useCallback } from 'react';
import { Database, RefreshCw, FileText, CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { projectService, type KnowledgeDocumentInfo } from '../../services/projectService';

export function KnowledgeHub() {
    const [documents, setDocuments] = useState<KnowledgeDocumentInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDocuments = useCallback(async () => {
        setIsLoading(true);
        try {
            setDocuments(await projectService.getKnowledgeDocuments());
        } catch (error) {
            console.error("Failed to fetch knowledge base documents:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    return (
        <div className="bg-white rounded-xl shadow-none border border-gray-100 p-6 w-full mt-6 h-[850px] flex flex-col">
            {/* 1. Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center">
                        <Database className="w-6 h-6 mr-2 text-brand-500" />
                        知识库看板
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        查看统一知识库中文档的同步状态与健康度。
                    </p>
                </div>

                <button
                    onClick={fetchDocuments}
                    disabled={isLoading}
                    className={clsx(
                        "inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg transition-all",
                        isLoading
                            ? "bg-brand-50 text-brand-600 cursor-not-allowed border border-brand-200"
                            : "bg-brand-500 text-white hover:bg-brand-600 shadow-none"
                    )}
                >
                    <RefreshCw className={clsx("w-4 h-4 mr-2", isLoading && "animate-spin")} />
                    {isLoading ? '刷新中...' : '刷新状态'}
                </button>
            </div>

            {/* 3. Document List */}
            <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-xl overflow-hidden bg-white">
                <div className="h-12 border-b border-gray-200 bg-gray-50 px-5 flex items-center justify-between">
                    <span className="text-base font-semibold text-gray-700">
                        知识库文件列表
                    </span>
                    <span className="text-sm text-gray-500">
                        共 {documents.length} 份文件
                    </span>
                </div>

                <div className="overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50/80">
                            <tr>
                                <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">文件名称</th>
                                <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">大小</th>
                                <th scope="col" className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">上传时间</th>
                                <th scope="col" className="px-5 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                                <th scope="col" className="px-5 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">切片数</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="px-5 py-16 text-center">
                                        <div className="inline-flex flex-col items-center justify-center">
                                            <RefreshCw className="w-8 h-8 text-brand-500 animate-spin mb-3" />
                                            <p className="text-sm font-medium text-gray-500">正在获取知识库状态...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : documents.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-gray-500 bg-gray-50">
                                        暂无知识库文档，请在统一知识库入口完成同步后刷新状态
                                    </td>
                                </tr>
                            ) : (
                                documents.map((doc) => (
                                    <tr key={doc.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center text-sm font-medium text-gray-700">
                                                <FileText className="w-4 h-4 mr-2 text-brand-600/70" />
                                                {doc.name}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-gray-500">
                                            {doc.size}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-gray-500">
                                            {doc.uploadTime}
                                        </td>
                                        <td className="px-5 py-4 text-center">
                                            {doc.status === 'success' && (
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-[var(--color-success-bg)] text-success">
                                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                                    启用中
                                                </span>
                                            )}
                                            {doc.status === 'indexing' && (
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-brand-50 text-brand-600">
                                                    <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                                                    处理中...
                                                </span>
                                            )}
                                            {doc.status === 'failed' && (
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-[var(--color-danger-bg)] text-danger">
                                                    <XCircle className="w-3.5 h-3.5 mr-1" />
                                                    失败
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-sm font-mono text-gray-600 text-right">
                                            {doc.chunks > 0 ? doc.chunks : '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

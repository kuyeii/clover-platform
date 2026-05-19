import { useState, useEffect, useCallback } from 'react';
import { Database, RefreshCw, FileText, CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';

interface DocumentInfo {
    id: string;
    name: string;
    size: string;
    uploadTime: string;
    status: 'success' | 'indexing' | 'failed';
    chunks: number;
}

import api from '../../services/api';

export function KnowledgeHub() {
    const [isSyncing, setIsSyncing] = useState(false);

    const [documents, setDocuments] = useState<DocumentInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDocuments = useCallback(async () => {
        setIsLoading(true);
        try {
            const res: any = await api.get('/knowledge/documents');
            if (res && res.documents) {
                setDocuments(res.documents || []);
            }
        } catch (error) {
            console.error("Failed to fetch knowledge base documents:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    const [syncingDocs, setSyncingDocs] = useState<Set<string>>(new Set());

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            await api.post('/knowledge/sync');
            // 同步是后台进行的，这里前台简单等一秒钟然后弹个或者刷新
            setTimeout(() => {
                fetchDocuments();
                setIsSyncing(false);
            }, 1000);
        } catch (error) {
            console.error("Sync failed", error);
            setIsSyncing(false);
        }
    };

    const handleSyncSingle = async (docId: string, docName: string) => {
        setSyncingDocs(prev => new Set(prev).add(docId));
        try {
            await api.post(`/knowledge/sync/${encodeURIComponent(docName)}`);
            setTimeout(() => {
                fetchDocuments();
                setSyncingDocs(prev => {
                    const next = new Set(prev);
                    next.delete(docId);
                    return next;
                });
            }, 1000);
        } catch (error) {
            console.error(`Sync failed for document ${docId}`, error);
            setSyncingDocs(prev => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 w-full mt-6 h-[850px] flex flex-col">
            {/* 1. Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center">
                        <Database className="w-6 h-6 mr-2 text-sky-500" />
                        知识库看板
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        监控与管理本地文档到知识库的同步状态与健康度。
                    </p>
                </div>

                <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className={clsx(
                        "inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg transition-all",
                        isSyncing
                            ? "bg-sky-50 text-sky-600 cursor-not-allowed border border-sky-100"
                            : "bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
                    )}
                >
                    <RefreshCw className={clsx("w-4 h-4 mr-2", isSyncing && "animate-spin")} />
                    {isSyncing ? '同步任务执行中...' : '触发知识库全量同步'}
                </button>
            </div>

            {/* 3. Document List */}
            <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-xl overflow-hidden bg-white">
                <div className="h-12 border-b border-gray-200 bg-gray-50 px-5 flex items-center justify-between">
                    <span className="text-base font-semibold text-gray-700">
                        最近同步文件列表
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
                                <th scope="col" className="px-5 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-5 py-16 text-center">
                                        <div className="inline-flex flex-col items-center justify-center">
                                            <RefreshCw className="w-8 h-8 text-sky-500 animate-spin mb-3" />
                                            <p className="text-sm font-medium text-gray-500">正在获取知识库状态...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : documents.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-500 bg-gray-50">
                                        知识库为空，请点击右上角进行全量同步
                                    </td>
                                </tr>
                            ) : (
                                documents.map((doc) => (
                                    <tr key={doc.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center text-sm font-medium text-gray-700">
                                                <FileText className="w-4 h-4 mr-2 text-sky-600/70" />
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
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700">
                                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                                    启用中
                                                </span>
                                            )}
                                            {doc.status === 'indexing' && (
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-sky-50 text-sky-700">
                                                    <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                                                    处理中...
                                                </span>
                                            )}
                                            {doc.status === 'failed' && (
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-red-50 text-red-700">
                                                    <XCircle className="w-3.5 h-3.5 mr-1" />
                                                    失败
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-sm font-mono text-gray-600 text-right">
                                            {doc.chunks > 0 ? doc.chunks : '-'}
                                        </td>
                                        <td className="px-5 py-4 text-center">
                                            <button
                                                onClick={() => handleSyncSingle(doc.id, doc.name)}
                                                disabled={syncingDocs.has(doc.id) || doc.status === 'indexing'}
                                                className={clsx(
                                                    "inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-sm",
                                                    (syncingDocs.has(doc.id) || doc.status === 'indexing')
                                                        ? "bg-gray-100 text-gray-400 cursor-not-allowed border-transparent"
                                                        : "bg-white border border-gray-200 text-sky-600 hover:bg-sky-50 hover:border-sky-200"
                                                )}
                                                title="重新同步该文件到知识库"
                                            >
                                                <RefreshCw className={clsx("w-3 h-3 mr-1.5", (syncingDocs.has(doc.id) || doc.status === 'indexing') && "animate-spin")} />
                                                {(syncingDocs.has(doc.id) || doc.status === 'indexing') ? '同步中' : '同步'}
                                            </button>
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

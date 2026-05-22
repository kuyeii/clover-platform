import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "../../../shared/components/Icon";
import {
  createFileDocument,
  createTextDocument,
  deleteKnowledgeDocument,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
} from "../services/ragApi";
import type { KnowledgeDocumentDetailResponse, KnowledgeDocumentItem } from "../types";
import { formatUnixTime } from "../utils";

interface KnowledgeDocumentsProps {
  refreshSignal: number;
  onCreated: () => void;
}

export function KnowledgeDocuments({ refreshSignal, onCreated }: KnowledgeDocumentsProps) {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadMode, setUploadMode] = useState<"file" | "text">("file");
  const [submitting, setSubmitting] = useState(false);
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [detailTarget, setDetailTarget] = useState<KnowledgeDocumentItem | null>(null);
  const [detail, setDetail] = useState<KnowledgeDocumentDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchKnowledgeDocuments();
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      setTotal(Number(payload.total || payload.documents?.length || 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "知识库文档加载失败。");
      setDocuments([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  useEffect(() => {
    if (!detailTarget) {
      setDetail(null);
      setDetailError("");
      return;
    }
    setDetailLoading(true);
    setDetailError("");
    void fetchKnowledgeDocumentDetail(detailTarget.id)
      .then((payload) => setDetail(payload))
      .catch((detailLoadError) => {
        setDetailError(detailLoadError instanceof Error ? detailLoadError.message : "文档详情加载失败。");
        setDetail(null);
      })
      .finally(() => setDetailLoading(false));
  }, [detailTarget]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] || null);
  };

  const submitUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (uploadMode === "file") {
        if (!file) {
          setError("请先选择要上传的文件。");
          return;
        }
        await createFileDocument(file);
        setFile(null);
        if (fileRef.current) {
          fileRef.current.value = "";
        }
      } else {
        const name = textName.trim();
        const text = textContent.trim();
        if (!name || !text) {
          setError("请填写文档名和正文。");
          return;
        }
        await createTextDocument(name, text);
        setTextName("");
        setTextContent("");
      }
      onCreated();
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "知识库文档创建失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const removeDocument = async (documentItem: KnowledgeDocumentItem) => {
    if (!window.confirm(`确定删除「${documentItem.name}」吗？此操作不可撤销。`)) {
      return;
    }
    setError("");
    try {
      await deleteKnowledgeDocument(documentItem.id);
      if (detailTarget?.id === documentItem.id) {
        setDetailTarget(null);
      }
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "知识库文档删除失败。");
    }
  };

  return (
    <section className="rag-knowledge">
      <div className="rag-panel-head">
        <div>
          <span className="eyebrow">Knowledge</span>
          <h2>知识库文档</h2>
        </div>
        <button type="button" className="ghost-button" onClick={() => void load()}>
          <Icon name="refresh" />
          刷新
        </button>
      </div>

      <form className="rag-upload-box" onSubmit={(event) => void submitUpload(event)}>
        <div className="match-switch">
          <button type="button" className={uploadMode === "file" ? "active" : ""} onClick={() => setUploadMode("file")}>
            文件上传
          </button>
          <button type="button" className={uploadMode === "text" ? "active" : ""} onClick={() => setUploadMode("text")}>
            文本创建
          </button>
        </div>

        {uploadMode === "file" ? (
          <label className="rag-file-picker">
            <Icon name="upload" />
            <input ref={fileRef} type="file" onChange={handleFileChange} disabled={submitting} />
            <span>{file ? file.name : "选择文件"}</span>
          </label>
        ) : (
          <div className="form-stack">
            <label className="form-field compact">
              <span>文档名</span>
              <input value={textName} onChange={(event) => setTextName(event.target.value)} disabled={submitting} />
            </label>
            <label className="form-field compact">
              <span>正文</span>
              <textarea rows={5} value={textContent} onChange={(event) => setTextContent(event.target.value)} disabled={submitting} />
            </label>
          </div>
        )}

        <button type="submit" className="primary-button full" disabled={submitting}>
          {submitting ? "创建中..." : "创建文档"}
        </button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="rag-section-title">
        <span>文档列表</span>
        <strong>{loading ? "加载中" : total}</strong>
      </div>

      {loading ? (
        <div className="page-center-state small">
          <div className="loading-spinner" />
          正在加载文档...
        </div>
      ) : documents.length === 0 ? (
        <p className="empty-mini">暂无文档</p>
      ) : (
        <div className="rag-document-list">
          {documents.map((documentItem) => (
            <article key={documentItem.id} className="rag-document-row">
              <button type="button" className="rag-document-main" onClick={() => setDetailTarget(documentItem)}>
                <strong>{documentItem.name}</strong>
                <span>
                  {documentItem.indexing_status || documentItem.display_status || "unknown"}
                  {documentItem.word_count ? ` · ${documentItem.word_count} 字` : ""}
                </span>
                {documentItem.description ? <small>{documentItem.description}</small> : null}
              </button>
              <button type="button" className="icon-button small" onClick={() => void removeDocument(documentItem)} aria-label="删除文档">
                <Icon name="close" />
              </button>
            </article>
          ))}
        </div>
      )}

      {detailTarget ? (
        <div className="modal-backdrop">
          <section className="dialog rag-detail-dialog" role="dialog" aria-modal="true">
            <button className="icon-button dialog-close" type="button" onClick={() => setDetailTarget(null)} aria-label="关闭">
              <Icon name="close" />
            </button>
            <h3>{detail?.document.name || detailTarget.name}</h3>
            {detailLoading ? (
              <div className="page-center-state small">
                <div className="loading-spinner" />
                正在加载详情...
              </div>
            ) : detailError ? (
              <p className="form-error">{detailError}</p>
            ) : detail ? (
              <DocumentDetail detail={detail} />
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function DocumentDetail({ detail }: { detail: KnowledgeDocumentDetailResponse }) {
  const document = detail.document;
  return (
    <div className="rag-detail-grid">
      <dl className="rag-detail-meta">
        <div>
          <dt>来源</dt>
          <dd>{document.data_source_type || "-"}</dd>
        </div>
        <div>
          <dt>创建方式</dt>
          <dd>{document.created_from || "-"}</dd>
        </div>
        <div>
          <dt>索引状态</dt>
          <dd>{document.indexing_status || "-"}</dd>
        </div>
        <div>
          <dt>字数 / Token</dt>
          <dd>
            {document.word_count ?? "-"} / {document.tokens ?? "-"}
          </dd>
        </div>
        <div>
          <dt>分段数</dt>
          <dd>{document.segment_count ?? detail.segment_total}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatUnixTime(document.updated_at)}</dd>
        </div>
        {document.upload_file?.name ? (
          <div>
            <dt>原始文件</dt>
            <dd>{document.upload_file.name}</dd>
          </div>
        ) : null}
        {document.error ? (
          <div className="rag-detail-error">
            <dt>错误</dt>
            <dd>{document.error}</dd>
          </div>
        ) : null}
      </dl>
      <div className="rag-segments">
        <strong>分段内容（{detail.segment_total}）</strong>
        {detail.segments.length === 0 ? (
          <p className="empty-mini">暂无分段</p>
        ) : (
          detail.segments.slice(0, 50).map((segment, index) => (
            <article key={segment.id || `${segment.position}-${index}`}>
              <span>
                # {segment.position ?? index + 1}
                {segment.tokens != null ? ` · ${segment.tokens} tokens` : ""}
              </span>
              <p>{segment.content || "（空）"}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

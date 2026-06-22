import React, { useState } from 'react'

export function TopBar(props: {
  file: File | null
  fileName?: string | null
  statusText: string
  runId: string | null
  riskCount: number
  riskStats?: { total: number; high: number; medium: number; low: number }
  isReviewing: boolean
  onBack?: () => void
  onGoUpload: () => void
  downloadUrl: string | null
  onDownload?: (downloadUrl: string) => Promise<void> | void
  onAcceptAllRisks?: () => Promise<void> | void
  canAcceptAllRisks?: boolean
  onUndoLastAction?: () => Promise<void> | void
  canUndoLastAction?: boolean
  onActionError?: (error: unknown, fallbackTitle: string) => void
}) {
  const [isDownloading, setIsDownloading] = useState(false)

  const handleActionError = (error: unknown, fallbackTitle: string) => {
    if (props.onActionError) {
      props.onActionError(error, fallbackTitle)
      return
    }
    alert(String((error as any)?.message || error || fallbackTitle))
  }

  const handleDownload = async () => {
    if (!props.downloadUrl || isDownloading) return
    setIsDownloading(true)
    try {
      await props.onDownload?.(props.downloadUrl)
    } catch (e) {
      handleActionError(e, '下载文档失败')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <header className="topBar glassPane">
      <div className="topBarLead">
        {props.onBack ? (
          <button className="btn btnIcon" onClick={props.onBack} aria-label="返回">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <div className="brand">
          <div className="brandDot" />
          <div>
            <div className="brandText">审查结果工作区</div>
          </div>
        </div>

        <div className="filePill" title={props.fileName || props.file?.name || ''}>
          {props.fileName || props.file?.name || '未选择合同文件'}
        </div>
      </div>

      <div className="topBarRight">
        <div className="topBarActions">
          <button className="btn" onClick={props.onGoUpload}>
            上传新合同
          </button>
          {props.downloadUrl ? (
            <button
              type="button"
              className="btn btnPrimary btnDownloadReviewed"
              disabled={isDownloading || !props.onDownload}
              onClick={handleDownload}
            >
              {isDownloading ? <span className="btnSpinner" aria-hidden="true" /> : null}
              {isDownloading ? '生成中' : '下载法务修订文档'}
            </button>
          ) : null}
          <button
            className="btn"
            disabled={!props.canAcceptAllRisks || !props.onAcceptAllRisks}
            onClick={async () => {
              try {
                await props.onAcceptAllRisks?.()
              } catch (e) {
                handleActionError(e, '一键接受未完成')
              }
            }}
          >
            一键接受全部
          </button>
          <button
            className="btn"
            disabled={!props.canUndoLastAction || !props.onUndoLastAction}
            onClick={async () => {
              try {
                await props.onUndoLastAction?.()
              } catch (e) {
                handleActionError(e, '撤销未完成')
              }
            }}
          >
            撤销
          </button>
        </div>

      </div>
    </header>
  )
}

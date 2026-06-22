import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, FileText, History, Trash2 } from 'lucide-react'
import type { ReviewHistoryItem } from '../types'

function statusLabel(status: ReviewHistoryItem['status']) {
  if (status === 'completed') return '审查完成'
  if (status === 'running') return '审查中'
  if (status === 'queued') return '排队中'
  if (status === 'failed') return '失败'
  return status
}

function formatReviewTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function statusClass(item: ReviewHistoryItem) {
  return item.status || 'queued'
}

export function ReviewHistoryPanel(props: {
  items: ReviewHistoryItem[]
  stats: any
  latestReview: ReviewHistoryItem | null
  onOpen: (item: ReviewHistoryItem) => void
  onDelete?: (item: ReviewHistoryItem) => void
  onStartNew: () => void
}) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(props.items.length / pageSize))

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  useEffect(() => {
    const computePageSize = () => {
      const vh = window.innerHeight
      const reserved = vh < 820 ? 280 : 310
      const rowHeight = vh < 820 ? 58 : 64
      const fitRows = Math.floor((vh - reserved) / rowHeight)
      setPageSize(Math.max(5, Math.min(14, fitRows)))
    }
    computePageSize()
    window.addEventListener('resize', computePageSize)
    return () => window.removeEventListener('resize', computePageSize)
  }, [])

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return props.items.slice(start, start + pageSize)
  }, [props.items, page, pageSize])

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, idx) => idx + 1)
    if (page <= 4) return [1, 2, 3, 4, 5, totalPages]
    if (page >= totalPages - 3) return [1, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [1, page - 1, page, page + 1, totalPages]
  }, [page, totalPages])

  const showingStart = props.items.length === 0 ? 0 : (page - 1) * pageSize + 1
  const showingEnd = Math.min(page * pageSize, props.items.length)

  return (
    <div className="historyPage landingHistoryPage">
      <div className="landingWave landingWave--left" aria-hidden="true" />
      <div className="landingWave landingWave--right" aria-hidden="true" />

      <div className="landingHistoryScroll">
        <header className="landingHistoryHeader">
          <div className="landingHistoryHeaderIcon" aria-hidden="true">
            <History size={20} strokeWidth={2.4} />
          </div>
          <div className="landingHistoryHeaderText">
            <h1>审查记录</h1>
            <p>查看并管理历史合同审查任务</p>
          </div>
          <button type="button" onClick={props.onStartNew} className="landingHistoryNewBtn">
            发起新审查
          </button>
        </header>

        <section className="landingHistoryTableCard" aria-label="审查记录列表">
          <div className="landingHistoryTableWrap">
            <table className="historyTable landingHistoryTable">
              <thead>
                <tr>
                  <th>文件名称</th>
                  <th>任务类型</th>
                  <th>审查时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {props.items.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="landingHistoryEmpty">暂无审查记录</div>
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((item) => {
                    const state = statusClass(item)
                    return (
                      <tr
                        key={item.id}
                        className="historyRow landingHistoryRow"
                        onClick={() => props.onOpen(item)}
                      >
                        <td>
                          <div className="landingHistoryFileCell">
                            <span className="landingHistoryFileIcon" aria-hidden="true">
                              <FileText size={16} strokeWidth={2.3} />
                            </span>
                            <span className="landingHistoryFileName" title={item.file_name || item.run_id}>
                              {item.file_name || item.run_id}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="landingHistoryType">深度审查</span>
                        </td>
                        <td>
                          <span className="landingHistoryTime">
                            <CalendarDays size={14} strokeWidth={2.2} />
                            {formatReviewTime(item.updated_at)}
                          </span>
                        </td>
                        <td>
                          <span className={`landingHistoryStatus landingHistoryStatus--${state}`}>
                            <span className={`statusDot statusDot--${state}`} />
                            {statusLabel(item.status)}
                          </span>
                        </td>
                        <td>
                          {item.status === 'completed' || item.status === 'failed' ? (
                            <button
                              type="button"
                              className="landingHistoryDeleteBtn"
                              aria-label={`删除审查记录 ${item.file_name || item.run_id}`}
                              title="删除记录"
                              onClick={(event) => {
                                event.stopPropagation()
                                props.onDelete?.(item)
                              }}
                            >
                              <Trash2 size={15} strokeWidth={2.2} />
                            </button>
                          ) : (
                            <span className="landingHistoryDeletePlaceholder">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {props.items.length > 0 ? (
            <div className="landingHistoryPagination">
              <div className="landingHistoryPaginationText">
                显示第 {showingStart}-{showingEnd} 条，共 {props.items.length} 条
              </div>
              <div className="landingHistoryPaginationControls">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="landingHistoryPageBtn landingHistoryPageBtn--icon"
                  aria-label="上一页"
                >
                  <ChevronLeft size={16} />
                </button>
                {pageNumbers.map((num, idx) => {
                  const prev = pageNumbers[idx - 1]
                  const needBreak = typeof prev === 'number' && num - prev > 1
                  return (
                    <React.Fragment key={num}>
                      {needBreak ? <span className="landingHistoryPageEllipsis">...</span> : null}
                      <button
                        type="button"
                        onClick={() => setPage(num)}
                        className={`landingHistoryPageBtn ${num === page ? 'landingHistoryPageBtn--active' : ''}`}
                      >
                        {num}
                      </button>
                    </React.Fragment>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="landingHistoryPageBtn landingHistoryPageBtn--icon"
                  aria-label="下一页"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

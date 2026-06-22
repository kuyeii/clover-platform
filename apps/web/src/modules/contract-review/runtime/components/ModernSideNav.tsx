import React from 'react'
import { HelpCircle, LayoutGrid, Settings } from 'lucide-react'
import type { NavKey } from './SideNav'
import type { ReviewHistoryItem } from '../types'

function formatRelativeTime(iso?: string) {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}天前`
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusDotClass(status?: string) {
  if (status === 'completed') return 'sideNavStatusDot--completed'
  if (status === 'running') return 'sideNavStatusDot--running'
  if (status === 'queued') return 'sideNavStatusDot--queued'
  if (status === 'failed') return 'sideNavStatusDot--failed'
  return 'sideNavStatusDot--queued'
}

function statusText(status?: string) {
  if (status === 'completed') return '已完成'
  if (status === 'running') return '审查中'
  if (status === 'queued') return '排队中'
  if (status === 'failed') return '失败'
  return status || ''
}

export function ModernSideNav(props: {
  activeNav: NavKey
  onSelect: (key: NavKey) => void
  recentItems?: ReviewHistoryItem[]
  activeRunId?: string | null
  onOpenRecent?: (item: ReviewHistoryItem) => void
}) {
  const recent = props.recentItems || []
  return (
    <aside className="sideNav sideNav--landingUnified">
      <div className="sideNavGlow sideNavGlow--top" aria-hidden="true" />
      <div className="sideNavGlow sideNavGlow--bottom" aria-hidden="true" />

      <div className="sideNavPrimaryNav">
        <button className="sideNavStartButton" onClick={() => props.onSelect('upload')} type="button">
          <LayoutGrid size={16} />
          <span>开始审查</span>
        </button>
      </div>

      <div className="sideNavRecentScroll">
        <div className="sideNavSectionHeader">
          <span>最近动态</span>
          <span className="sideNavCountPill">{recent.length}</span>
        </div>

        <div className="sideNavRecentList">
          {recent.length === 0 ? (
            <div className="sideNavEmptyState">暂无动态</div>
          ) : (
            recent.slice(0, 8).map((it) => {
              const isActive = (props.activeNav === 'result' || props.activeNav === 'waiting') && props.activeRunId && String(props.activeRunId) === String(it.run_id)
              const statusClass = statusDotClass(it.status)
              return (
                <button
                  key={it.run_id}
                  className={`sideNavRecentItem ${isActive ? 'sideNavRecentItem--active' : ''}`}
                  onClick={() => props.onOpenRecent && props.onOpenRecent(it)}
                  disabled={!props.onOpenRecent}
                  title={it.file_name || it.run_id}
                  type="button"
                >
                  <span className={`sideNavStatusDot ${statusClass}`} />
                  <span className="sideNavRecentText">
                    <span className="sideNavRecentTitle">{it.file_name || it.run_id}</span>
                    <span className="sideNavRecentMeta">
                      <span className="sideNavStatusText">{statusText(it.status)}</span>
                      <span className="sideNavMetaDivider" />
                      <span>{formatRelativeTime(it.updated_at) || ''}</span>
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <button className="sideNavViewAllButton" onClick={() => props.onSelect('history')} type="button">
          查看全部
        </button>
      </div>

      <div className="sideNavBottom">
        <nav className="sideNavUtilityList">
          <button className="sideNavUtilityButton" type="button">
            <HelpCircle size={16} />
            <span>帮助中心</span>
          </button>
          <button className="sideNavUtilityButton" type="button">
            <Settings size={16} />
            <span>系统设置</span>
          </button>
        </nav>
      </div>
    </aside>
  )
}

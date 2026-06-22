import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Message } from '../../types'

interface SearchPanelProps {
  messages: Message[]
  onNavigate: (messageId: string) => void
  onClose: () => void
}

const SearchPanel: React.FC<SearchPanelProps> = ({ messages, onNavigate, onClose }) => {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return messages
      .filter(m => m.content.toLowerCase().includes(q))
      .slice(0, 50)
      .map(m => {
        const idx = m.content.toLowerCase().indexOf(q)
        const start = Math.max(0, idx - 30)
        const end = Math.min(m.content.length, idx + q.length + 30)
        const snippet = (start > 0 ? '…' : '') + m.content.slice(start, end) + (end < m.content.length ? '…' : '')
        return { id: m.id, role: m.role, snippet, timestamp: m.timestamp }
      })
  }, [query, messages])

  const roleLabel = (role: string) => {
    if (role === 'user') return '你'
    if (role === 'agent') return 'Agent'
    return 'AI'
  }

  const highlightMatch = (text: string, q: string) => {
    if (!q) return text
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map(part =>
      part.toLowerCase() === q.toLowerCase()
        ? `<mark>${part}</mark>`
        : part
    ).join('')
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-panel" onClick={e => e.stopPropagation()}>
        <header className="search-header">
          <h3>搜索对话</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭搜索">×</button>
        </header>
        <div className="search-input-wrap">
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入关键词搜索…"
            onKeyDown={e => { if (e.key === 'Escape') onClose() }}
          />
          {query && <span className="search-count">{results.length} 条结果</span>}
        </div>
        <div className="search-results">
          {query && results.length === 0 && (
            <div className="empty-inline">没有找到匹配的消息</div>
          )}
          {results.map(r => (
            <button
              key={r.id}
              className="search-result-item"
              type="button"
              onClick={() => onNavigate(r.id)}
            >
              <span className="search-role">{roleLabel(r.role)}</span>
              <span
                className="search-snippet"
                dangerouslySetInnerHTML={{ __html: highlightMatch(r.snippet, query.trim()) }}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SearchPanel

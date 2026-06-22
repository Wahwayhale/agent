import React, { useEffect, useRef, useState } from 'react'
import { Conversation } from '../../types'
import { ipcRenderer } from '../../electron-ipc'

interface ExportMenuProps {
  conversation: Conversation
}

const ExportMenu: React.FC<ExportMenuProps> = ({ conversation }) => {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Ctrl+Shift+E 全局快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const handleExport = async (format: 'markdown' | 'json' | 'html') => {
    setOpen(false)

    if (!ipcRenderer) {
      // 浏览器模式：直接下载
      let content: string
      let ext: string
      let mime: string

      if (format === 'json') {
        content = JSON.stringify(conversation, null, 2)
        ext = '.json'
        mime = 'application/json'
      } else if (format === 'html') {
        content = exportHTML(conversation)
        ext = '.html'
        mime = 'text/html'
      } else {
        content = exportMarkdown(conversation)
        ext = '.md'
        mime = 'text/markdown'
      }

      const blob = new Blob([content], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${conversation.title || 'conversation'}${ext}`
      a.click()
      URL.revokeObjectURL(url)
      return
    }

    setExporting(true)
    try {
      const result = await ipcRenderer.invoke('conversation-export', conversation, format)
      if (result.success) {
        // 可选：显示成功提示
      }
    } catch {
      // ignore
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="export-menu-wrap" ref={menuRef}>
      <button
        className="icon-button"
        type="button"
        title="导出 (Ctrl+Shift+E)"
        aria-label="导出会话"
        onClick={() => setOpen(prev => !prev)}
        disabled={exporting}
      >
        📤
      </button>
      {open && (
        <div className="export-dropdown">
          <button type="button" onClick={() => handleExport('markdown')}>
            <strong>Markdown</strong>
            <small>.md 文件</small>
          </button>
          <button type="button" onClick={() => handleExport('json')}>
            <strong>JSON</strong>
            <small>完整数据备份</small>
          </button>
          <button type="button" onClick={() => handleExport('html')}>
            <strong>HTML</strong>
            <small>可在浏览器打开</small>
          </button>
        </div>
      )}
    </div>
  )
}

// 浏览器端导出用的简易函数
function exportMarkdown(conv: Conversation) {
  const lines = [`# ${conv.title}\n`]
  for (const msg of conv.messages) {
    const role = msg.role === 'user' ? '## 你' : msg.role === 'agent' ? '## Agent' : '## AI'
    lines.push(`${role}\n\n${msg.content}\n`)
  }
  return lines.join('\n')
}

function exportHTML(conv: Conversation) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const msgs = conv.messages.map(m => {
    const role = m.role === 'user' ? '你' : m.role === 'agent' ? 'Agent' : 'AI'
    return `<div class="msg ${m.role}"><div class="role">${role}</div><div class="content">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`
  }).join('\n')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(conv.title)}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333}
.msg{margin:16px 0;padding:12px;border-radius:8px;background:#f5f5f5}.msg.user{background:#e8f5e9}
.role{font-weight:bold;margin-bottom:6px;font-size:13px;color:#666}.content{line-height:1.6}</style>
</head><body><h1>${esc(conv.title)}</h1>${msgs}</body></html>`
}

export default ExportMenu

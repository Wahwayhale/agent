import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked, Renderer } from 'marked'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import 'highlight.js/styles/github-dark.css'
import { AgentStep, Message } from '../../types'

interface ChatAreaProps {
  messages: Message[]
  onSendMessage: (content: string, imageData?: string) => void
  onStopStreaming: () => void
  isStreaming: boolean
  draftPrompt: { id: number; content: string } | null
  agentMode: boolean
  onToggleAgentMode: (next: boolean) => void
  hasProject: boolean
  searchHighlightId?: string | null
}

const SUGGESTED_PROMPTS = [
  '帮我分析这个需求',
  '设计一个后台管理页面',
  '把功能拆成开发任务',
  '审查下面这段代码'
]

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function createMarkdownRenderer() {
  const renderer = new Renderer()

  renderer.html = (html: string) => escapeHtml(html)
  renderer.code = (code: string, infostring: string | undefined) => {
    const language = (infostring || '').trim().split(/\s+/)[0]
    const highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value
    const safeLanguage = escapeHtml(language || 'code')

    return `
      <div class="code-block">
        <div class="code-block-header">
          <span>${safeLanguage}</span>
          <button class="code-copy-button" type="button" data-code="${encodeURIComponent(code)}">复制</button>
        </div>
        <pre><code class="hljs language-${safeLanguage}">${highlighted}</code></pre>
      </div>
    `
  }

  return renderer
}

const markdownRenderer = createMarkdownRenderer()

function formatTime(value: Date) {
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

const MarkdownMessage: React.FC<{ content: string }> = ({ content }) => {
  const html = useMemo(
    () => marked(content, {
      breaks: true,
      gfm: true,
      renderer: markdownRenderer
    }) as string,
    [content]
  )

  return <div className="message-text markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}

const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  onSendMessage,
  onStopStreaming,
  isStreaming,
  draftPrompt,
  agentMode,
  onToggleAgentMode,
  hasProject,
  searchHighlightId
}) => {
  const [input, setInput] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [diffViewer, setDiffViewer] = useState<{ path: string; diff: string; isNew: boolean } | null>(null)
  const [imageData, setImageData] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const list = messageListRef.current
    if (list) {
      list.scrollTop = list.scrollHeight
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt.content)
      textareaRef.current?.focus()
    }
  }, [draftPrompt])

  useEffect(() => {
    if (!textareaRef.current) return

    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
  }, [input])

  const submitCurrent = () => {
    if (input.trim() && !isStreaming) {
      onSendMessage(input, imageData || undefined)
      setInput('')
      setImageData(null)
      setImagePreview(null)
    }
  }

  // 图片处理
  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 10 * 1024 * 1024) return // 10MB 限制

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] || ''
      setImageData(base64)
      setImagePreview(result)
    }
    reader.readAsDataURL(file)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) handleImageFile(file)
        break
      }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer?.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        handleImageFile(file)
        break
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const clearImage = () => {
    setImageData(null)
    setImagePreview(null)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    submitCurrent()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitCurrent()
    }
  }

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }

  const handleCopyMessage = async (message: Message) => {
    try {
      await copyText(message.content)
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId(null), 1200)
    } catch {
      setCopiedMessageId(null)
    }
  }

  return (
    <section className="chat-panel">
      <div className="message-list" ref={messageListRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark" aria-hidden="true">FS</div>
            <h2>今天要推进什么？</h2>
            <p>从需求拆解、页面设计到代码审查,先丢一个目标过来就行。</p>
            <div className="prompt-grid">
              {SUGGESTED_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  className="prompt-chip"
                  type="button"
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(message => (
            <MessageBubble
              key={message.id}
              message={message}
              onCopy={handleCopyMessage}
              copied={copiedMessageId === message.id}
              onShowDiff={setDiffViewer}
              highlight={searchHighlightId === message.id}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer-wrap">
        <div className="agent-toggle">
          <label className={`toggle ${agentMode ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={agentMode}
              onChange={event => onToggleAgentMode(event.target.checked)}
              disabled={isStreaming}
            />
            <span className="toggle-slider" />
            <span className="toggle-label">
              Agent 模式
              <small>{agentMode ? 'AI 可读写文件、运行命令' : '仅普通对话'}</small>
            </span>
          </label>
          {agentMode && !hasProject && (
            <span className="agent-warning">请先在右侧打开一个项目文件夹</span>
          )}
          {agentMode && hasProject && (
            <span className="agent-hint">提示:支持 OpenAI 工具调用,无工具调用能力时自动降级到文本协议</span>
          )}
        </div>
        {imagePreview && (
          <div className="image-preview-bar">
            <img src={imagePreview} alt="待上传图片" className="image-preview-thumb" />
            <span className="image-preview-info">图片已就绪</span>
            <button className="meta-action" type="button" onClick={clearImage}>移除</button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={handleSubmit}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              agentMode
                ? '描述你想让 Agent 完成的任务,例如:把 greet 函数加一个 uppercase 参数,并补一个测试'
                : '输入消息,Enter 发送,Shift + Enter 换行 · 支持粘贴/拖拽图片'
            }
            disabled={isStreaming}
            rows={1}
          />
          <div className="composer-footer">
            <span>{input.length} 字</span>
            <div className="composer-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleImageFile(file)
                  e.target.value = ''
                }}
              />
              {!agentMode && (
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming}
                  title="上传图片"
                >
                  🖼
                </button>
              )}
              <button
                className="ghost-button compact"
                type="button"
                onClick={() => setInput('')}
                disabled={!input || isStreaming}
              >
                清除
              </button>
              {isStreaming ? (
                <button className="danger-button" type="button" onClick={onStopStreaming}>
                  停止
                </button>
              ) : (
                <button
                  className={agentMode ? 'primary-button agent-send' : 'primary-button'}
                  type="submit"
                  disabled={(!input.trim() && !imageData) || (agentMode && !hasProject)}
                >
                  {agentMode ? '运行 Agent' : '发送'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {diffViewer && (
        <DiffModal viewer={diffViewer} onClose={() => setDiffViewer(null)} />
      )}
    </section>
  )
}

const MessageBubble: React.FC<{
  message: Message
  onCopy: (m: Message) => void
  copied: boolean
  onShowDiff: (v: { path: string; diff: string; isNew: boolean }) => void
  highlight?: boolean
}> = ({ message, onCopy, copied, onShowDiff, highlight }) => {
  if (message.role === 'agent') {
    return <AgentBubble message={message} onShowDiff={onShowDiff} highlight={highlight} />
  }
  return (
    <article
      className={`message-row ${message.role === 'user' ? 'from-user' : 'from-assistant'}${highlight ? ' highlight' : ''}`}
      id={`msg-${message.id}`}
    >
      <div className="message-avatar" aria-hidden="true">
        {message.role === 'user' ? '你' : 'FS'}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === 'user' ? '你' : 'FullStack Agent'}</strong>
          <span>{formatTime(message.timestamp)}</span>
          {message.tokenUsage && (
            <span className="token-badge" title={`prompt: ${message.tokenUsage.prompt} · completion: ${message.tokenUsage.completion}`}>
              {message.tokenUsage.total} tok
            </span>
          )}
          {message.role === 'assistant' && message.content && (
            <button
              className="meta-action"
              type="button"
              onClick={() => onCopy(message)}
            >
              {copied ? '已复制' : '复制'}
            </button>
          )}
        </div>
        <div className="message-bubble">
          {message.imageData && (
            <div className="message-image-wrap">
              <img src={`data:image/png;base64,${message.imageData}`} alt="附件图片" className="message-image" />
            </div>
          )}
          {message.content ? (
            <MarkdownMessage content={message.content} />
          ) : (
            <div className="typing-indicator" aria-label="正在生成回复">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

const AgentBubble: React.FC<{
  message: Message
  onShowDiff: (v: { path: string; diff: string; isNew: boolean }) => void
  highlight?: boolean
}> = ({ message, onShowDiff, highlight }) => {
  const steps = message.agentSteps || []
  const meta = message.agentMeta
  return (
    <article className={`message-row from-agent${highlight ? ' highlight' : ''}`} id={`msg-${message.id}`}>
      <div className="message-avatar" aria-hidden="true">AG</div>
      <div className="message-content">
        <div className="message-meta">
          <strong>Agent 自主执行</strong>
          <span>{formatTime(message.timestamp)}</span>
          {meta?.protocol && (
            <span className="agent-protocol">
              {meta.protocol === 'function_calling' ? '工具调用' : '文本协议'}
            </span>
          )}
          {meta?.aborted && <span className="agent-protocol aborted">已中止</span>}
        </div>
        <div className="agent-trace">
          <div className="agent-live" data-events={steps.length} title={`已收到 ${steps.length} 个事件`}>
            <span className="agent-live-dot" />
            <span className="agent-live-text">实时:已收到 {steps.length} 个事件 · 最近 = {steps[steps.length - 1]?.type || '(无)'}</span>
          </div>
          {steps.map(step => (
            <StepRow key={step.id} step={step} onShowDiff={onShowDiff} />
          ))}
          {!message.content && !steps.some(s => s.type === 'text') && (
            <div className="typing-indicator" aria-label="Agent 正在执行">
              <span />
              <span />
              <span />
            </div>
          )}
          {message.content && (
            <div className="agent-final">
              <MarkdownMessage content={message.content} />
            </div>
          )}
        </div>
        {meta && (meta.iterations > 0 || meta.tools.length > 0) && (
          <div className="agent-footer">
            <span>{meta.iterations} 轮迭代 · {meta.tools.length} 次工具调用</span>
          </div>
        )}
      </div>
    </article>
  )
}

const StepRow: React.FC<{
  step: AgentStep
  onShowDiff: (v: { path: string; diff: string; isNew: boolean }) => void
}> = ({ step, onShowDiff }) => {
  const [expanded, setExpanded] = useState(false)
  if (step.type === 'status') {
    return <div className="agent-step status">{step.text}</div>
  }
  if (step.type === 'reasoning') {
    return (
      <div className="agent-step reasoning" onClick={() => setExpanded(v => !v)}>
        <span className="step-icon">🧠</span>
        <span className="step-label">思考</span>
        {expanded ? <pre>{step.text}</pre> : <span className="step-preview">点击展开</span>}
      </div>
    )
  }
  if (step.type === 'tool_call') {
    const args = step.toolArgs || {}
    const target = (args.path as string) || (args.command as string) || (args.query as string) || ''
    return (
      <div className="agent-step tool-call" onClick={() => setExpanded(v => !v)}>
        <span className="step-icon">⚙</span>
        <span className="step-label">调用 {step.toolName}</span>
        <span className="step-target">{target}</span>
        {expanded && (
          <pre className="step-args">{JSON.stringify(args, null, 2)}</pre>
        )}
      </div>
    )
  }
  if (step.type === 'tool_result') {
    const meta = (step.result?.meta || {}) as { diff?: string; path?: string; isNew?: boolean; command?: string; exitCode?: number }
    const hasDiff = Boolean(meta.diff) && (step.toolCallId || meta.path)
    return (
      <div className={`agent-step tool-result ${step.result?.ok ? 'ok' : 'fail'}`}>
        <div className="result-head" onClick={() => setExpanded(v => !v)}>
          <span className="step-icon">{step.result?.ok ? '✓' : '✗'}</span>
          <span className="step-label">{step.result?.ok ? '完成' : '失败'}</span>
          {meta.command && <span className="step-target">$ {meta.command}</span>}
          {typeof meta.exitCode === 'number' && (
            <span className="step-exit">退出码 {meta.exitCode}</span>
          )}
          {hasDiff && (
            <button
              className="meta-action"
              type="button"
              onClick={event => {
                event.stopPropagation()
                onShowDiff({ path: meta.path || 'file', diff: meta.diff || '', isNew: !!meta.isNew })
              }}
            >
              查看 Diff
            </button>
          )}
        </div>
        {expanded && (
          <pre className="step-output">
            {step.result?.output || step.result?.error || '(无输出)'}
          </pre>
        )}
      </div>
    )
  }
  return null
}

const DiffModal: React.FC<{
  viewer: { path: string; diff: string; isNew: boolean }
  onClose: () => void
}> = ({ viewer, onClose }) => {
  return (
    <div className="diff-modal-backdrop" onClick={onClose}>
      <div className="diff-modal" onClick={event => event.stopPropagation()}>
        <header>
          <h3>{viewer.isNew ? '新建' : '改动'}: {viewer.path}</h3>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">×</button>
        </header>
        <pre className="diff-content">{viewer.diff}</pre>
      </div>
    </div>
  )
}

export default ChatArea

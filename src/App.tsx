import { useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import ChatArea from './components/Chat/ChatArea'
import Settings from './components/Settings/Settings'
import ProjectPanel from './components/Project/ProjectPanel'
import SearchPanel from './components/Search/SearchPanel'
import ExportMenu from './components/Export/ExportMenu'
import TemplatePanel from './components/PromptTemplates/TemplatePanel'
import { ipcRenderer } from './electron-ipc'
import { useConversations } from './hooks/useConversations'
import { PROVIDERS } from './providers'
import { AgentStep, Config, Message } from './types'

const DEFAULT_CONFIG: Config = {
  provider: 'mimo',
  apiKey: '',
  model: 'mimo-v2.5-pro',
  billingMode: 'token-plan',
  temperature: 1,
  maxTokens: 4096,
  thinkingIntensity: 'medium',
  theme: 'dark',
  language: 'zh'
}

const THINKING_GUIDE: Record<Config['thinkingIntensity'], string> = {
  low: '思考强度：低。优先给出简洁直接的答案，只保留关键判断和必要步骤。',
  medium: '思考强度：中。先做适度分析，再给出可执行方案、关键取舍和验证步骤。',
  high: '思考强度：高。请更深入地审视需求、边界情况、实现风险和测试策略，再给出稳妥方案。'
}

const BASE_SYSTEM_PROMPT =
  '你是 FullStack Agent，一个面向产品、设计和工程落地的全栈开发助手。请用简洁、专业、可执行的中文回答。涉及代码时，先说明会影响哪些文件，再给出实现、测试和验证建议。'

type AgentApprovalRequest = {
  approvalId: string
  kind: 'write' | 'shell'
  toolName: string
  path?: string
  isNew?: boolean
  diff?: string
  summary?: { added: number; removed: number } | null
  command?: string
  timeoutMs?: number
  riskLevel?: 'low' | 'medium' | 'high'
  reasons?: string[]
}

function createMessage(role: Message['role'], content: string, extras: Partial<Message> = {}): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: new Date(),
    ...extras
  }
}

function makeStepId() {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeConfig(savedConfig: Partial<Config>): Config {
  const provider = PROVIDERS[savedConfig.provider || DEFAULT_CONFIG.provider] || PROVIDERS[DEFAULT_CONFIG.provider]
  const billingMode = provider.billingModes?.some(mode => mode.id === savedConfig.billingMode)
    ? savedConfig.billingMode
    : provider.billingModes?.[0]?.id
  const thinkingIntensity = ['low', 'medium', 'high'].includes(savedConfig.thinkingIntensity || '')
    ? savedConfig.thinkingIntensity
    : DEFAULT_CONFIG.thinkingIntensity

  return {
    ...DEFAULT_CONFIG,
    ...savedConfig,
    provider: provider.id,
    model: provider.models.some(model => model.id === savedConfig.model)
      ? savedConfig.model || provider.defaultModel
      : provider.defaultModel,
    billingMode,
    thinkingIntensity: thinkingIntensity as Config['thinkingIntensity']
  }
}

function buildApiConfig(config: Config) {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    billingMode: config.billingMode,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    thinkingIntensity: config.thinkingIntensity
  }
}

function App() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [showSettings, setShowSettings] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState<{ id: number; content: string } | null>(null)
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [projectRoot, setProjectRoot] = useState('')
  const [agentMode, setAgentMode] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [approvalRequest, setApprovalRequest] = useState<AgentApprovalRequest | null>(null)
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null)
  const stopRequestedRef = useRef(false)

  const {
    conversations,
    activeId,
    activeConversation,
    loaded: _loaded,
    createConversation,
    deleteConversation,
    switchConversation,
    updateMessages,
    appendMessages,
    updateMessage,
    renameConversation
  } = useConversations()

  const messages = activeConversation?.messages || []

  const currentProvider = PROVIDERS[config.provider]
  const billingModeName = currentProvider?.billingModes?.find(mode => mode.id === config.billingMode)?.name
  const selectedModel = currentProvider?.models.find(model => model.id === config.model)

  const connectionStatus = useMemo(() => {
    if (currentProvider?.type === 'local') {
      return '本地服务'
    }
    return config.apiKey.trim() ? '已配置 API Key' : '待配置 API Key'
  }, [config.apiKey, currentProvider?.type])

  // 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+N — 新建会话
      if (ctrl && e.key === 'n') {
        e.preventDefault()
        createConversation()
        return
      }

      // Ctrl+K — 搜索
      if (ctrl && e.key === 'k') {
        e.preventDefault()
        setShowSearch(prev => !prev)
        return
      }

      // Ctrl+Shift+E — 导出
      if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        // 由 ExportMenu 组件处理
        return
      }

      // Escape — 关闭搜索/模态框
      if (e.key === 'Escape') {
        if (showSearch) { setShowSearch(false); return }
        if (showTemplates) { setShowTemplates(false); return }
        if (showSettings) { setShowSettings(false); return }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createConversation, showSearch, showTemplates, showSettings])

  // 加载配置
  useEffect(() => {
    const savedConfig = localStorage.getItem('fullstack-agent-config')
    if (!savedConfig) return
    try {
      setConfig(normalizeConfig(JSON.parse(savedConfig)))
    } catch {
      localStorage.removeItem('fullstack-agent-config')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('fullstack-agent-config', JSON.stringify(config))
  }, [config])

  const handleUsePrompt = (prompt: string) => {
    setDraftPrompt({ id: Date.now(), content: prompt })
  }

  const handleSaveConfig = (nextConfig: Config) => {
    setConfig(normalizeConfig(nextConfig))
  }

  const simulateBrowserStream = async (
    apiMessages: Array<{ role: string; content: string }>,
    conversationId: string,
    assistantMessageId: string
  ) => {
    const mockResponse = [
      '已收到你的消息。当前是浏览器预览模式，不会真正调用接口。',
      `\n\n- 模型：${config.model}`,
      `\n- 思考强度：${config.thinkingIntensity}`,
      `\n- 消息数：${apiMessages.length}`,
      '\n- 运行方式：请在 Electron 桌面端启动以启用真实 API、项目文件读写和流式输出。'
    ]

    for (const chunk of mockResponse) {
      if (stopRequestedRef.current) break
      updateMessage(conversationId, assistantMessageId, msg => ({
        ...msg,
        content: msg.content + chunk
      }))
      await new Promise(resolve => window.setTimeout(resolve, 160))
    }
  }

  const streamAPI = async (
    apiMessages: Array<{ role: string; content: string }>,
    conversationId: string,
    assistantMessageId: string
  ) => {
    if (!ipcRenderer) {
      await simulateBrowserStream(apiMessages, conversationId, assistantMessageId)
      return
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = `chat-completion-stream:${requestId}`
    setActiveStreamId(requestId)

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        ipcRenderer.removeListener(channel, handleStreamEvent)
        setActiveStreamId(null)
      }

      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const handleStreamEvent = (_event: unknown, payload: { type: string; content?: string; error?: string; usage?: any }) => {
        if (payload.type === 'chunk' && payload.content) {
          updateMessage(conversationId, assistantMessageId, msg => ({
            ...msg,
            content: msg.content + payload.content
          }))
          return
        }

        if (payload.type === 'done') {
          // 保存 token 用量
          if (payload.usage) {
            updateMessage(conversationId, assistantMessageId, msg => ({
              ...msg,
              tokenUsage: payload.usage
            }))
          }
          finish()
          return
        }

        if (payload.type === 'error') {
          fail(new Error(payload.error || '流式请求失败'))
        }
      }

      ipcRenderer.on(channel, handleStreamEvent)
      ipcRenderer
        .invoke('chat-completion-stream', requestId, buildApiConfig(config), apiMessages)
        .then((result: { success: boolean; error?: string }) => {
          if (result && !result.success) {
            fail(new Error(result.error || '流式请求失败'))
          }
        })
        .catch((error: Error) => fail(error))
    })
  }

  const handleSendMessage = async (content: string, imageData?: string) => {
    const trimmedContent = content.trim()
    if (!trimmedContent || isStreaming) return

    // 确保有活跃会话
    let convId = activeId
    if (!convId) {
      convId = createConversation()
    }

    const provider = PROVIDERS[config.provider]
    const userMessage = createMessage('user', trimmedContent, imageData ? { imageData } : {})
    const assistantMessage = createMessage('assistant', '')

    appendMessages(convId, userMessage)

    if (provider?.type === 'cloud' && !config.apiKey.trim()) {
      appendMessages(convId, createMessage('assistant', '请先在右上角设置中配置 API Key。配置完成后，我就可以开始处理你的请求。'))
      return
    }

    appendMessages(convId, assistantMessage)
    setIsStreaming(true)
    stopRequestedRef.current = false

    try {
      const apiMessages: Array<{ role: string; content: any }> = [
        { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n${THINKING_GUIDE[config.thinkingIntensity]}` },
        ...messages
          .filter(message => message.role !== 'system')
          .map(message => {
            if (message.imageData) {
              return {
                role: message.role,
                content: [
                  { type: 'text', text: message.content },
                  { type: 'image_url', image_url: { url: `data:image/png;base64,${message.imageData}` } }
                ]
              }
            }
            return { role: message.role, content: message.content }
          }),
        { role: 'user', content: trimmedContent }
      ]

      await streamAPI(apiMessages, convId, assistantMessage.id)

      if (stopRequestedRef.current) {
        updateMessage(convId, assistantMessage.id, msg => ({
          ...msg,
          content: msg.content || '已停止生成。'
        }))
      }
    } catch (error: any) {
      updateMessage(convId, assistantMessage.id, msg => ({
        ...msg,
        content: msg.content || `请求失败：${error.message}`
      }))
    } finally {
      setIsStreaming(false)
      setActiveStreamId(null)
      stopRequestedRef.current = false
    }
  }

  const handleStopStreaming = async () => {
    stopRequestedRef.current = true

    if (activeStreamId && ipcRenderer) {
      await ipcRenderer.invoke('chat-completion-abort', activeStreamId)
    }
    if (activeAgentId && ipcRenderer) {
      await ipcRenderer.invoke('agent-abort', activeAgentId)
    }
  }

  const handleAgentSend = async (content: string) => {
    if (!ipcRenderer) {
      const assistantMessage = createMessage('assistant', '请在 Electron 桌面端使用 Agent 模式。')
      appendMessages(activeId || createConversation(), createMessage('user', content), assistantMessage)
      return
    }
    if (!projectRoot) {
      const convId = activeId || createConversation()
      appendMessages(convId,
        createMessage('user', content),
        createMessage('assistant', '请先在右侧"项目"面板打开一个文件夹,然后再使用 Agent 模式。')
      )
      return
    }

    const provider = PROVIDERS[config.provider]
    if (provider?.type === 'cloud' && !config.apiKey.trim()) {
      const convId = activeId || createConversation()
      appendMessages(convId,
        createMessage('user', content),
        createMessage('assistant', '请先在右上角设置中配置 API Key。')
      )
      return
    }

    let convId = activeId
    if (!convId) {
      convId = createConversation()
    }

    const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const channel = `agent-event:${requestId}`

    const userMessage = createMessage('user', content)
    const agentMessage = createMessage('agent', '', {
      agentSteps: [
        { id: makeStepId(), type: 'status', text: '正在准备 Agent…' }
      ],
      agentMeta: { iterations: 0, tools: [] }
    })

    appendMessages(convId, userMessage, agentMessage)
    setIsStreaming(true)
    setActiveAgentId(requestId)
    stopRequestedRef.current = false

    const pushStep = (step: AgentStep) => {
      updateMessage(convId, agentMessage.id, msg => ({
        ...msg,
        agentSteps: [...(msg.agentSteps || []), step]
      }))
    }

    const handleEvent = (_event: unknown, payload: { type: string; [key: string]: any }) => {
      if (payload.type === 'start') {
        updateMessage(convId, agentMessage.id, msg => ({
          ...msg,
          agentMeta: {
            ...(msg.agentMeta || { iterations: 0, tools: [] }),
            protocol: payload.protocol
          }
        }))
        pushStep({
          id: makeStepId(),
          type: 'status',
          text: payload.protocol === 'function_calling'
            ? '使用 OpenAI 工具调用协议'
            : '使用文本协议(降级模式)'
        })
        return
      }
      if (payload.type === 'thinking') {
        pushStep({
          id: makeStepId(),
          type: 'status',
          text: `第 ${payload.iteration} 轮:正在等待模型响应…`
        })
        return
      }
      if (payload.type === 'reasoning' && payload.content) {
        pushStep({ id: makeStepId(), type: 'reasoning', text: payload.content })
        return
      }
      if (payload.type === 'text' && payload.content) {
        updateMessage(convId, agentMessage.id, msg => ({
          ...msg,
          content: msg.content + payload.content
        }))
        return
      }
      if (payload.type === 'tool_call' && payload.tool) {
        const step: AgentStep = {
          id: makeStepId(),
          type: 'tool_call',
          toolName: payload.tool.name,
          toolArgs: payload.tool.args || {},
          toolCallId: payload.tool.id
        }
        pushStep(step)
        return
      }
      if (payload.type === 'tool_result') {
        const step: AgentStep = {
          id: makeStepId(),
          type: 'tool_result',
          toolName: '结果',
          toolCallId: payload.toolCallId,
          result: {
            ok: !!payload.ok,
            output: payload.output,
            error: payload.error,
            meta: payload.meta
          }
        }
        pushStep(step)
        return
      }
      if (payload.type === 'approval_request' && payload.approval) {
        const approval = payload.approval as AgentApprovalRequest
        setApprovalRequest(approval)
        pushStep({
          id: makeStepId(),
          type: 'status',
          text: approval.kind === 'write'
            ? `等待确认写入：${approval.path || approval.toolName}`
            : `等待确认命令：${approval.command || approval.toolName}`
        })
        return
      }
      if (payload.type === 'done') {
        updateMessage(convId, agentMessage.id, msg => ({
          ...msg,
          agentMeta: {
            ...(msg.agentMeta || { iterations: 0, tools: [] }),
            iterations: payload.iterations || 0,
            tools: payload.tools || []
          }
        }))
        ipcRenderer.removeListener(channel, handleEvent)
        setIsStreaming(false)
        setActiveAgentId(null)
        stopRequestedRef.current = false
        return
      }
      if (payload.type === 'aborted') {
        updateMessage(convId, agentMessage.id, msg => ({
          ...msg,
          agentMeta: { ...(msg.agentMeta || { iterations: 0, tools: [] }), aborted: true }
        }))
        pushStep({ id: makeStepId(), type: 'status', text: '已停止' })
        ipcRenderer.removeListener(channel, handleEvent)
        setIsStreaming(false)
        setActiveAgentId(null)
        stopRequestedRef.current = false
        return
      }
      if (payload.type === 'error') {
        pushStep({ id: makeStepId(), type: 'status', text: `错误：${payload.error}` })
        ipcRenderer.removeListener(channel, handleEvent)
        setIsStreaming(false)
        setActiveAgentId(null)
        stopRequestedRef.current = false
        return
      }
    }

    ipcRenderer.on(channel, handleEvent)

    try {
      const result = await ipcRenderer.invoke('agent-run', requestId, buildApiConfig(config), projectRoot, content)
      if (!result?.success) {
        pushStep({ id: makeStepId(), type: 'status', text: `启动失败：${result?.error || '未知错误'}` })
        ipcRenderer.removeListener(channel, handleEvent)
        setIsStreaming(false)
        setActiveAgentId(null)
        stopRequestedRef.current = false
      }
    } catch (error: any) {
      pushStep({ id: makeStepId(), type: 'status', text: `异常：${error.message}` })
      ipcRenderer.removeListener(channel, handleEvent)
      setIsStreaming(false)
      setActiveAgentId(null)
      stopRequestedRef.current = false
    }
  }

  const handleClearChat = () => {
    if (activeId) {
      updateMessages(activeId, () => [])
    }
  }

  const handleSearchNavigate = (messageId: string) => {
    setSearchHighlightId(messageId)
    setShowSearch(false)
    // 高亮 3 秒后清除
    setTimeout(() => setSearchHighlightId(null), 3000)
  }

  const handleUseTemplate = (prompt: string) => {
    setShowTemplates(false)
    setDraftPrompt({ id: Date.now(), content: prompt })
  }

  const handleApprovalResponse = async (approved: boolean) => {
    if (!approvalRequest || !ipcRenderer) return
    const current = approvalRequest
    setApprovalRequest(null)
    await ipcRenderer.invoke('agent-approval-response', current.approvalId, approved)
  }

  const totalTokenUsage = useMemo(() => {
    let prompt = 0, completion = 0, total = 0
    for (const c of conversations) {
      if (c.tokenUsage) {
        prompt += c.tokenUsage.prompt
        completion += c.tokenUsage.completion
        total += c.tokenUsage.total
      }
    }
    return total > 0 ? { prompt, completion, total } : null
  }, [conversations])

  return (
    <div className="app-shell" data-theme={config.theme}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        messages={messages}
        onClearChat={handleClearChat}
        onOpenSettings={() => setShowSettings(true)}
        onUseCommand={handleUsePrompt}
        onCreateConversation={createConversation}
        onDeleteConversation={deleteConversation}
        onSwitchConversation={switchConversation}
        onRenameConversation={renameConversation}
        onShowTemplates={() => setShowTemplates(true)}
        config={config}
        totalTokenUsage={totalTokenUsage}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">FS</div>
            <div>
              <h1>FullStack Agent</h1>
              <p>
                {currentProvider?.name || '未知服务'} · {selectedModel?.name || config.model}
                {billingModeName ? ` · ${billingModeName}` : ''} · 思考{config.thinkingIntensity}
              </p>
            </div>
          </div>

          <div className="topbar-actions">
            <span className={config.apiKey || currentProvider?.type === 'local' ? 'status-pill ready' : 'status-pill'}>
              <span aria-hidden="true" />
              {connectionStatus}
            </span>
            {activeConversation && (
              <ExportMenu conversation={activeConversation} />
            )}
            <button
              className="icon-button"
              type="button"
              onClick={() => setShowSearch(true)}
              title="搜索 (Ctrl+K)"
              aria-label="搜索对话"
            >
              🔍
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setShowSettings(true)}
              title="打开设置"
              aria-label="打开设置"
            >
              ⚙
            </button>
          </div>
        </header>

        <ChatArea
          messages={messages}
          onSendMessage={agentMode ? handleAgentSend : handleSendMessage}
          onStopStreaming={handleStopStreaming}
          isStreaming={isStreaming}
          draftPrompt={draftPrompt}
          agentMode={agentMode}
          onToggleAgentMode={setAgentMode}
          hasProject={Boolean(projectRoot)}
          searchHighlightId={searchHighlightId}
        />
      </main>

      <ProjectPanel
        onUsePrompt={handleUsePrompt}
        projectRoot={projectRoot}
        onProjectChange={setProjectRoot}
      />

      {showSettings && (
        <Settings
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showSearch && (
        <SearchPanel
          messages={messages}
          onNavigate={handleSearchNavigate}
          onClose={() => setShowSearch(false)}
        />
      )}

      {showTemplates && (
        <TemplatePanel
          onUseTemplate={handleUseTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {approvalRequest && (
        <ApprovalModal
          request={approvalRequest}
          onRespond={handleApprovalResponse}
        />
      )}
    </div>
  )
}

function ApprovalModal({
  request,
  onRespond
}: {
  request: AgentApprovalRequest
  onRespond: (approved: boolean) => void
}) {
  const isWrite = request.kind === 'write'
  const riskLabel = request.riskLevel === 'high'
    ? '高风险'
    : request.riskLevel === 'medium'
      ? '中风险'
      : '低风险'

  return (
    <div className="approval-backdrop">
      <section className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <header>
          <div>
            <h2 id="approval-title">{isWrite ? '确认文件改动' : '确认执行命令'}</h2>
            <p>{isWrite ? request.path : riskLabel}</p>
          </div>
          <button className="icon-button" type="button" onClick={() => onRespond(false)} aria-label="拒绝">
            ×
          </button>
        </header>

        {isWrite ? (
          <>
            <div className="approval-summary">
              <span>{request.isNew ? '新建文件' : '修改文件'}</span>
              {request.summary && (
                <span>+{request.summary.added} / -{request.summary.removed}</span>
              )}
            </div>
            <pre className="approval-diff">{request.diff || '(无 diff)'}</pre>
          </>
        ) : (
          <>
            <div className={`approval-risk ${request.riskLevel || 'low'}`}>
              <strong>{riskLabel}</strong>
              {(request.reasons || []).map(reason => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
            <pre className="approval-command">{request.command}</pre>
          </>
        )}

        <footer>
          <button className="ghost-button" type="button" onClick={() => onRespond(false)}>
            拒绝
          </button>
          <button className="primary-button" type="button" onClick={() => onRespond(true)}>
            允许
          </button>
        </footer>
      </section>
    </div>
  )
}

export default App

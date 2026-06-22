import React, { useEffect, useMemo, useState } from 'react'
import { Config, Model } from '../../types'
import { PROVIDERS } from '../../providers'
import { ipcRenderer } from '../../electron-ipc'

interface SettingsProps {
  config: Config
  onSave: (config: Config) => void
  onClose: () => void
}

type TabId = 'api' | 'model' | 'general'
type ConnectionTestStatus = 'idle' | 'testing' | 'success' | 'error'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'api', label: '接入' },
  { id: 'model', label: '模型' },
  { id: 'general', label: '偏好' }
]

const MODEL_FILTERS = [
  { id: 'all', label: '全部', keywords: [] },
  { id: 'reasoning', label: '推理', keywords: ['推理', '思考', '数学', 'thinking', 'reason'] },
  { id: 'code', label: '编程', keywords: ['代码', 'coder', 'code'] },
  { id: 'vision', label: '多模态', keywords: ['多模态', '图片', '视觉', 'vision', 'omni'] },
  { id: 'fast', label: '快速', keywords: ['快速', '轻量', 'flash', 'turbo', 'lite'] },
  { id: 'long', label: '长上下文', keywords: ['长文本', '长上下文', '128k', '256k', '1m'] },
  { id: 'agent', label: 'Agent/工具', keywords: ['agent', '工具', '函数'] },
  { id: 'web', label: '联网', keywords: ['联网', '搜索', 'rag'] }
]

const MODEL_INTENTS = [
  { id: 'agent', label: 'Agent 编程', keywords: ['agent', '工具', '函数', '代码', 'coder', 'code'], contextBonus: true },
  { id: 'reasoning', label: '复杂推理', keywords: ['推理', '思考', '数学', 'reason', 'thinking'] },
  { id: 'vision', label: '图片理解', keywords: ['多模态', '图片', '视觉', 'vision', 'omni'] },
  { id: 'fast', label: '快速问答', keywords: ['快速', '轻量', 'flash', 'turbo', 'lite'] },
  { id: 'long', label: '长上下文', keywords: ['长文本', '长上下文', '128k', '256k', '1m'], contextBonus: true }
]

function formatNumber(value: number) {
  if (value >= 1000000) return `${value / 1000000}M`
  if (value >= 1000) return `${value / 1000}K`
  return `${value}`
}

function buildApiConfig(config: Config) {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    billingMode: config.billingMode,
    temperature: config.temperature,
    maxTokens: config.maxTokens
  }
}

function modelMatchesKeywords(model: Model, keywords: string[]) {
  if (keywords.length === 0) return true

  const haystack = [
    model.id,
    model.name,
    ...model.capabilities
  ].join(' ').toLowerCase()

  return keywords.some(keyword => haystack.includes(keyword.toLowerCase()))
}

function scoreModelForIntent(model: Model, intent: typeof MODEL_INTENTS[number]) {
  const haystack = [
    model.id,
    model.name,
    ...model.capabilities
  ].join(' ').toLowerCase()
  const keywordScore = intent.keywords.reduce(
    (score, keyword) => score + (haystack.includes(keyword.toLowerCase()) ? 4 : 0),
    0
  )
  const contextScore = intent.contextBonus ? Math.min(6, Math.floor(model.context / 128000)) : 0
  const outputScore = Math.min(4, Math.floor(model.maxOutput / 32768))
  const speedPenalty = intent.id === 'fast' && /pro|max|opus/i.test(model.id) ? -2 : 0

  return keywordScore + contextScore + outputScore + speedPenalty
}

const Settings: React.FC<SettingsProps> = ({
  config,
  onSave,
  onClose
}) => {
  const [formData, setFormData] = useState<Config>({ ...config })
  const [activeTab, setActiveTab] = useState<TabId>('api')
  const [models, setModels] = useState<Model[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsSource, setModelsSource] = useState<'default' | 'api'>('default')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [activeModelFilter, setActiveModelFilter] = useState('all')
  const [connectionTest, setConnectionTest] = useState<{
    status: ConnectionTestStatus
    message: string
    latency?: number
  }>({ status: 'idle', message: '尚未测试连接。' })

  const currentProvider = PROVIDERS[formData.provider]
  const activeModel = useMemo(
    () => models.find(model => model.id === formData.model),
    [formData.model, models]
  )
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase()
    const activeFilter = MODEL_FILTERS.find(filter => filter.id === activeModelFilter) || MODEL_FILTERS[0]

    return models.filter(model => {
      const haystack = [
        model.id,
        model.name,
        ...model.capabilities
      ].join(' ').toLowerCase()
      const matchesQuery = !query || haystack.includes(query)
      const matchesFilter = modelMatchesKeywords(model, activeFilter.keywords)

      return matchesQuery && matchesFilter
    })
  }, [activeModelFilter, modelQuery, models])

  useEffect(() => {
    if (!currentProvider) return

    setModels(currentProvider.models)
    setModelsSource('default')
    setModelsError(null)
    setModelQuery('')
    setActiveModelFilter('all')
  }, [currentProvider])

  useEffect(() => {
    setConnectionTest({ status: 'idle', message: '尚未测试连接。' })
  }, [formData.provider, formData.apiKey, formData.model, formData.billingMode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const updateForm = (patch: Partial<Config>) => {
    setFormData(prev => ({ ...prev, ...patch }))
  }

  const handleProviderChange = (providerId: string) => {
    const provider = PROVIDERS[providerId]
    if (!provider) return

    setFormData(prev => ({
      ...prev,
      provider: provider.id,
      model: provider.defaultModel,
      billingMode: provider.billingModes?.[0]?.id
    }))
  }

  const recommendModel = (intentId: string) => {
    const intent = MODEL_INTENTS.find(item => item.id === intentId)
    if (!intent || models.length === 0) return

    const best = [...models].sort((a, b) => scoreModelForIntent(b, intent) - scoreModelForIntent(a, intent))[0]
    if (best) {
      updateForm({ model: best.id })
      setModelQuery('')
      setActiveModelFilter(intentId === 'agent' ? 'agent' : intentId)
    }
  }

  const loadModels = async () => {
    if (!currentProvider) return

    setIsLoadingModels(true)
    setModelsError(null)

    try {
      if (!ipcRenderer) {
        setModels(currentProvider.models)
        setModelsSource('default')
        setModelsError('当前为浏览器预览模式，已使用内置模型列表。')
        return
      }

      const result = await ipcRenderer.invoke(
        'fetch-models',
        formData.provider,
        formData.apiKey,
        formData.billingMode
      )

      if (result.success && Array.isArray(result.models) && result.models.length > 0) {
        setModels(result.models)
        setModelsSource('api')
        if (!result.models.some((model: Model) => model.id === formData.model)) {
          updateForm({ model: result.models[0].id })
        }
        setModelsError(result.error || null)
      } else {
        setModels(currentProvider.models)
        setModelsSource('default')
        setModelsError(result.error || '获取失败，已回退到内置模型列表。')
      }
    } catch (error: any) {
      setModels(currentProvider.models)
      setModelsSource('default')
      setModelsError(error.message || '获取模型列表失败。')
    } finally {
      setIsLoadingModels(false)
    }
  }

  const testConnection = async () => {
    if (!currentProvider) return

    if (currentProvider.type === 'cloud' && !formData.apiKey.trim()) {
      setConnectionTest({ status: 'error', message: '请先填写 API Key。' })
      return
    }

    setConnectionTest({ status: 'testing', message: '正在测试连接...' })

    try {
      if (!ipcRenderer) {
        window.setTimeout(() => {
          setConnectionTest({
            status: 'success',
            message: '浏览器预览模式已跳过真实请求，桌面端会发起轻量测试。',
            latency: 0
          })
        }, 300)
        return
      }

      const result = await ipcRenderer.invoke('test-connection', buildApiConfig(formData))

      if (result.success) {
        setConnectionTest({
          status: 'success',
          message: `连接成功，模型返回：${result.preview || 'OK'}`,
          latency: result.latency
        })
      } else {
        setConnectionTest({
          status: 'error',
          message: result.error || '连接测试失败。'
        })
      }
    } catch (error: any) {
      setConnectionTest({
        status: 'error',
        message: error.message || '连接测试失败。'
      })
    }
  }

  const handleSave = () => {
    onSave(formData)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>配置服务商、模型和生成偏好</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </header>

        <div className="tab-list" role="tablist" aria-label="设置分类">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'tab-button active' : 'tab-button'}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {activeTab === 'api' && (
            <div className="settings-stack">
              <label className="field">
                <span>API 服务商</span>
                <select
                  value={formData.provider}
                  onChange={event => handleProviderChange(event.target.value)}
                >
                  {Object.values(PROVIDERS).map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.icon} {provider.name}
                    </option>
                  ))}
                </select>
              </label>

              {currentProvider?.billingModes && (
                <div className="field">
                  <span>计费模式</span>
                  <div className="segmented-grid">
                    {currentProvider.billingModes.map(mode => (
                      <button
                        key={mode.id}
                        className={formData.billingMode === mode.id ? 'select-tile active' : 'select-tile'}
                        type="button"
                        onClick={() => updateForm({ billingMode: mode.id })}
                      >
                        <strong>{mode.name}</strong>
                        <small>Key 前缀：{mode.keyPrefix}xxxxx</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="field">
                <span>API Key</span>
                <div className="inline-field">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.apiKey}
                    onChange={event => updateForm({ apiKey: event.target.value })}
                    placeholder={currentProvider?.type === 'local' ? '本地模型可留空' : '输入 API Key'}
                  />
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => setShowApiKey(prev => !prev)}
                  >
                    {showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <small>
                  {formData.provider === 'mimo'
                    ? 'MIMO Token Plan 通常使用 tp- 开头的 Key。'
                    : currentProvider?.type === 'local'
                      ? '本地服务默认连接 http://localhost:11434/v1。'
                      : 'Key 只保存在本机 localStorage 中。'}
                </small>
              </label>

              <div className={`connection-card ${connectionTest.status}`}>
                <div>
                  <strong>连接测试</strong>
                  <small>
                    {connectionTest.message}
                    {typeof connectionTest.latency === 'number' ? ` · ${connectionTest.latency}ms` : ''}
                  </small>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={testConnection}
                  disabled={connectionTest.status === 'testing'}
                >
                  {connectionTest.status === 'testing' ? '测试中' : '测试连接'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'model' && (
            <div className="settings-stack">
              <div className="model-toolbar">
                <div>
                  <strong>选择模型</strong>
                  <span>{modelsSource === 'api' ? '来自 API' : `内置列表 · ${models.length} 个模型`}</span>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={loadModels}
                  disabled={isLoadingModels}
                >
                  {isLoadingModels ? '刷新中' : '刷新模型'}
                </button>
              </div>

              <div className="field">
                <span>智能推荐</span>
                <div className="filter-chip-row" aria-label="按任务推荐模型">
                  {MODEL_INTENTS.map(intent => (
                    <button
                      key={intent.id}
                      className="filter-chip"
                      type="button"
                      onClick={() => recommendModel(intent.id)}
                    >
                      {intent.label}
                    </button>
                  ))}
                </div>
                <small>根据模型名称、能力标签、上下文长度和输出上限在当前服务商内选择。</small>
              </div>

              <label className="field">
                <span>搜索模型</span>
                <input
                  value={modelQuery}
                  onChange={event => setModelQuery(event.target.value)}
                  placeholder="按模型名、ID 或能力过滤"
                />
              </label>

              <div className="filter-chip-row" aria-label="模型能力筛选">
                {MODEL_FILTERS.map(filter => (
                  <button
                    key={filter.id}
                    className={activeModelFilter === filter.id ? 'filter-chip active' : 'filter-chip'}
                    type="button"
                    onClick={() => setActiveModelFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {modelsError && (
                <div className="notice warning">
                  {modelsError}
                </div>
              )}

              <div className="model-list">
                {filteredModels.map(model => (
                  <button
                    key={model.id}
                    className={formData.model === model.id ? 'model-option active' : 'model-option'}
                    type="button"
                    onClick={() => updateForm({ model: model.id })}
                  >
                    <span>
                      <strong>{model.name}</strong>
                      <small>ID：{model.id}</small>
                    </span>
                    <span className="model-metrics">
                      {model.id === currentProvider?.defaultModel && <span className="badge featured">默认</span>}
                      <small>{formatNumber(model.context)} 上下文</small>
                      <small>{formatNumber(model.maxOutput)} 输出</small>
                    </span>
                    <span className="capability-row">
                      {model.capabilities.map(capability => (
                        <span key={capability} className="badge">
                          {capability}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>

              {filteredModels.length === 0 && (
                <div className="notice">
                  没有匹配的模型，换一个关键词或筛选条件试试。
                </div>
              )}

              {activeModel && (
                <div className="notice">
                  当前选择：{activeModel.name}，最大输出约 {formatNumber(activeModel.maxOutput)} tokens。
                </div>
              )}
            </div>
          )}

          {activeTab === 'general' && (
            <div className="settings-stack">
              <div className="field">
                <span>思考强度</span>
                <div className="segmented-grid three">
                  <button
                    className={formData.thinkingIntensity === 'low' ? 'select-tile active' : 'select-tile'}
                    type="button"
                    onClick={() => updateForm({ thinkingIntensity: 'low' })}
                  >
                    <strong>低</strong>
                    <small>快速直接，适合小问题</small>
                  </button>
                  <button
                    className={formData.thinkingIntensity === 'medium' ? 'select-tile active' : 'select-tile'}
                    type="button"
                    onClick={() => updateForm({ thinkingIntensity: 'medium' })}
                  >
                    <strong>中</strong>
                    <small>平衡分析和速度</small>
                  </button>
                  <button
                    className={formData.thinkingIntensity === 'high' ? 'select-tile active' : 'select-tile'}
                    type="button"
                    onClick={() => updateForm({ thinkingIntensity: 'high' })}
                  >
                    <strong>高</strong>
                    <small>深入推敲，适合架构和代码审查</small>
                  </button>
                </div>
              </div>

              <div className="field">
                <span>主题</span>
                <div className="segmented-grid two">
                  <button
                    className={formData.theme === 'dark' ? 'select-tile active' : 'select-tile'}
                    type="button"
                    onClick={() => updateForm({ theme: 'dark' })}
                  >
                    <strong>深色</strong>
                    <small>适合长时间工作</small>
                  </button>
                  <button
                    className={formData.theme === 'light' ? 'select-tile active' : 'select-tile'}
                    type="button"
                    onClick={() => updateForm({ theme: 'light' })}
                  >
                    <strong>浅色</strong>
                    <small>适合明亮环境</small>
                  </button>
                </div>
              </div>

              <label className="field">
                <span>Temperature：{formData.temperature.toFixed(1)}</span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={formData.temperature}
                  onChange={event => updateForm({ temperature: Number(event.target.value) })}
                />
                <small>数值越低越稳定，越高越发散。</small>
              </label>

              <label className="field">
                <span>最大输出 Tokens</span>
                <input
                  type="number"
                  value={formData.maxTokens}
                  onChange={event => updateForm({ maxTokens: Number(event.target.value) })}
                  min={256}
                  max={128000}
                />
              </label>

              <label className="field">
                <span>界面语言</span>
                <select
                  value={formData.language}
                  onChange={event => updateForm({ language: event.target.value as Config['language'] })}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <footer className="settings-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={handleSave}>
            保存设置
          </button>
        </footer>
      </section>
    </div>
  )
}

export default Settings

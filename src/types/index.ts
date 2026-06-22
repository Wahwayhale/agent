export interface Provider {
  id: string
  name: string
  type: 'cloud' | 'local'
  icon: string
  baseURL?: string
  billingModes?: BillingMode[]
  models: Model[]
  defaultModel: string
}

export interface BillingMode {
  id: string
  name: string
  baseURL: string
  keyPrefix: string
}

export interface Model {
  id: string
  name: string
  context: number
  maxOutput: number
  capabilities: string[]
}

export interface Config {
  provider: string
  apiKey: string
  model: string
  billingMode?: string
  temperature: number
  maxTokens: number
  thinkingIntensity: 'low' | 'medium' | 'high'
  theme: 'light' | 'dark'
  language: 'zh' | 'en'
}

export interface AgentStep {
  id: string
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'plan' | 'status'
  text?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  result?: {
    ok: boolean
    output?: string
    error?: string
    meta?: Record<string, unknown>
  }
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'agent'
  content: string
  timestamp: Date
  imageData?: string // base64 图片数据
  tokenUsage?: TokenUsage // 单条消息的 token 消耗
  agentSteps?: AgentStep[]
  agentMeta?: {
    iterations: number
    tools: Array<{ name: string; args: Record<string, unknown> }>
    aborted?: boolean
    protocol?: 'function_calling' | 'text'
  }
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
  tokenUsage?: TokenUsage
}

export interface PromptTemplate {
  id: string
  name: string
  icon: string
  prompt: string
  isBuiltin: boolean
}

export interface ProjectFile {
  path: string
  name: string
  size: number
  modifiedAt: number
  writable: boolean
}

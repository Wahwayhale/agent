import React, { useState } from 'react'
import { Config, Conversation, Message, TokenUsage } from '../../types'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string | null
  messages: Message[]
  onClearChat: () => void
  onOpenSettings: () => void
  onUseCommand: (prompt: string) => void
  onCreateConversation: () => void
  onDeleteConversation: (id: string) => void
  onSwitchConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
  onShowTemplates: () => void
  config: Config
  totalTokenUsage: TokenUsage | null
}

const COMMANDS = [
  {
    id: 'requirements',
    icon: '需',
    name: '需求分析',
    desc: '梳理目标、角色、场景和验收标准',
    prompt: '请帮我把这个产品想法整理成完整需求文档，包含用户角色、核心流程、功能清单、边界情况和验收标准。'
  },
  {
    id: 'design',
    icon: '设',
    name: '界面设计',
    desc: '输出页面结构、交互和视觉建议',
    prompt: '请基于我的需求设计一个专业、易用的界面方案，说明布局、组件、状态、交互细节和响应式策略。'
  },
  {
    id: 'plan',
    icon: '计',
    name: '开发计划',
    desc: '拆解里程碑和执行任务',
    prompt: '请把这个需求拆成可执行的开发计划，包含任务优先级、依赖关系、风险点和测试清单。'
  },
  {
    id: 'build',
    icon: '码',
    name: '代码实现',
    desc: '生成可维护的实现方案',
    prompt: '请根据下面的需求给出实现方案和关键代码，优先使用清晰、可维护的结构。'
  },
  {
    id: 'test',
    icon: '测',
    name: '测试验证',
    desc: '补充测试用例和验证路径',
    prompt: '请为这个功能设计测试方案，覆盖正常流程、异常情况、边界条件和回归风险。'
  },
  {
    id: 'review',
    icon: '审',
    name: '代码审查',
    desc: '查找缺陷、风险和可维护性问题',
    prompt: '请按代码审查的方式检查下面的实现，优先指出 bug、边界情况、性能风险和缺失测试。'
  },
  {
    id: 'release',
    icon: '发',
    name: '发布检查',
    desc: '生成上线前检查清单',
    prompt: '请为这个版本生成发布前检查清单，包含配置、数据、兼容性、回滚和监控项。'
  },
  {
    id: 'content',
    icon: '文',
    name: '内容生成',
    desc: '生成文档、说明和演示文稿大纲',
    prompt: '请把下面的信息整理成结构清晰的说明文档，要求重点突出、层级明确、适合直接交付。'
  }
]

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function formatTokens(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  messages,
  onClearChat,
  onOpenSettings,
  onUseCommand,
  onCreateConversation,
  onDeleteConversation,
  onSwitchConversation,
  onRenameConversation,
  onShowTemplates,
  config,
  totalTokenUsage
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const userMessages = messages.filter(message => message.role === 'user').length
  const assistantMessages = messages.filter(message => message.role === 'assistant' || message.role === 'agent').length

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id)
    setEditTitle(conv.title)
  }

  const commitRename = () => {
    if (editingId && editTitle.trim()) {
      onRenameConversation(editingId, editTitle.trim())
    }
    setEditingId(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-mark large" aria-hidden="true">FS</div>
        <div>
          <h2>FullStack Agent</h2>
          <p>产品、设计、开发一体化助手</p>
        </div>
      </div>

      {/* 会话列表 */}
      <div className="sidebar-section conversation-section">
        <div className="section-title">
          <span>会话</span>
          <button className="meta-action" type="button" onClick={onCreateConversation}>
            + 新建
          </button>
        </div>
        <div className="conversation-list">
          {conversations.length === 0 ? (
            <div className="empty-inline">暂无会话，点击新建开始</div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                className={activeId === conv.id ? 'conversation-item active' : 'conversation-item'}
                onClick={() => onSwitchConversation(conv.id)}
              >
                <div className="conversation-info">
                  {editingId === conv.id ? (
                    <input
                      className="conversation-rename-input"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null) }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="conversation-title">{conv.title}</span>
                  )}
                  <span className="conversation-meta">
                    {formatTime(conv.updatedAt)}
                    {conv.tokenUsage ? ` · ${formatTokens(conv.tokenUsage.total)} tok` : ''}
                  </span>
                </div>
                <div className="conversation-actions">
                  <button
                    className="meta-action"
                    type="button"
                    title="重命名"
                    onClick={e => { e.stopPropagation(); startRename(conv) }}
                  >
                    ✏
                  </button>
                  <button
                    className="meta-action danger"
                    type="button"
                    title="删除"
                    onClick={e => { e.stopPropagation(); onDeleteConversation(conv.id) }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 快捷工作流 */}
      <div className="sidebar-section">
        <div className="section-title">
          <span>快捷工作流</span>
          <button className="meta-action" type="button" onClick={onShowTemplates}>
            模板库
          </button>
        </div>
        <div className="command-list">
          {COMMANDS.map(command => (
            <button
              key={command.id}
              className="command-item"
              type="button"
              onClick={() => onUseCommand(command.prompt)}
              title={command.desc}
            >
              <span className="command-icon" aria-hidden="true">{command.icon}</span>
              <span>
                <strong>{command.name}</strong>
                <small>{command.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="stat-grid">
          <div>
            <span>{messages.length}</span>
            <small>消息</small>
          </div>
          <div>
            <span>{userMessages}</span>
            <small>提问</small>
          </div>
          <div>
            <span>{assistantMessages}</span>
            <small>回复</small>
          </div>
        </div>

        {totalTokenUsage && (
          <div className="token-stats">
            <small>累计 Token</small>
            <strong>{formatTokens(totalTokenUsage.total)}</strong>
            <small>prompt {formatTokens(totalTokenUsage.prompt)} · completion {formatTokens(totalTokenUsage.completion)}</small>
          </div>
        )}

        <div className="model-summary" title={config.model}>
          <small>当前模型</small>
          <strong>{config.model}</strong>
        </div>

        <div className="sidebar-actions">
          <button className="ghost-button" type="button" onClick={onClearChat} disabled={messages.length === 0}>
            清空
          </button>
          <button className="ghost-button" type="button" onClick={onOpenSettings}>
            设置
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar

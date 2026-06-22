import React, { useEffect, useState } from 'react'
import { PromptTemplate } from '../../types'

interface TemplatePanelProps {
  onUseTemplate: (prompt: string) => void
  onClose: () => void
}

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  { id: 'req-01', name: '需求文档', icon: '📋', prompt: '请帮我把这个产品想法整理成完整需求文档，包含用户角色、核心流程、功能清单、边界情况和验收标准。', isBuiltin: true },
  { id: 'ui-01', name: '界面设计', icon: '🎨', prompt: '请基于我的需求设计一个专业、易用的界面方案，说明布局、组件、状态、交互细节和响应式策略。', isBuiltin: true },
  { id: 'plan-01', name: '开发计划', icon: '📊', prompt: '请把这个需求拆成可执行的开发计划，包含任务优先级、依赖关系、风险点和测试清单。', isBuiltin: true },
  { id: 'code-01', name: '代码实现', icon: '💻', prompt: '请根据下面的需求给出实现方案和关键代码，优先使用清晰、可维护的结构。', isBuiltin: true },
  { id: 'test-01', name: '测试方案', icon: '🧪', prompt: '请为这个功能设计测试方案，覆盖正常流程、异常情况、边界条件和回归风险。', isBuiltin: true },
  { id: 'review-01', name: '代码审查', icon: '🔍', prompt: '请按代码审查的方式检查下面的实现，优先指出 bug、边界情况、性能风险和缺失测试。', isBuiltin: true },
  { id: 'release-01', name: '发布检查', icon: '🚀', prompt: '请为这个版本生成发布前检查清单，包含配置、数据、兼容性、回滚和监控项。', isBuiltin: true },
  { id: 'doc-01', name: '写文档', icon: '📝', prompt: '请把下面的信息整理成结构清晰的说明文档，要求重点突出、层级明确、适合直接交付。', isBuiltin: true },
  { id: 'api-01', name: 'API 设计', icon: '🔌', prompt: '请帮我设计 RESTful API，包含路由、请求/响应格式、错误码和认证方式。', isBuiltin: true },
  { id: 'db-01', name: '数据库设计', icon: '🗄️', prompt: '请帮我设计数据库 schema，包含表结构、索引、关联关系和迁移方案。', isBuiltin: true },
  { id: 'debug-01', name: 'Bug 分析', icon: '🐛', prompt: '请帮我分析这个 bug 的根因，给出复现步骤、影响范围和修复建议。', isBuiltin: true },
  { id: 'refactor-01', name: '重构建议', icon: '♻️', prompt: '请分析这段代码的可维护性问题，给出重构方案和优先级建议。', isBuiltin: true }
]

const STORAGE_KEY = 'fsa-prompt-templates'

function loadCustomTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCustomTemplates(templates: PromptTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch { /* ignore */ }
}

const TemplatePanel: React.FC<TemplatePanelProps> = ({ onUseTemplate, onClose }) => {
  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [editId, setEditId] = useState<string | null>(null)

  useEffect(() => {
    setCustomTemplates(loadCustomTemplates())
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleAdd = () => {
    if (!newName.trim() || !newPrompt.trim()) return
    const template: PromptTemplate = {
      id: `custom-${Date.now()}`,
      name: newName.trim(),
      icon: '⭐',
      prompt: newPrompt.trim(),
      isBuiltin: false
    }
    const next = [...customTemplates, template]
    setCustomTemplates(next)
    saveCustomTemplates(next)
    setNewName('')
    setNewPrompt('')
    setShowAdd(false)
  }

  const handleDelete = (id: string) => {
    const next = customTemplates.filter(t => t.id !== id)
    setCustomTemplates(next)
    saveCustomTemplates(next)
  }

  const handleEdit = (template: PromptTemplate) => {
    setEditId(template.id)
    setNewName(template.name)
    setNewPrompt(template.prompt)
    setShowAdd(true)
  }

  const handleSaveEdit = () => {
    if (!editId || !newName.trim() || !newPrompt.trim()) return
    const next = customTemplates.map(t =>
      t.id === editId ? { ...t, name: newName.trim(), prompt: newPrompt.trim() } : t
    )
    setCustomTemplates(next)
    saveCustomTemplates(next)
    setEditId(null)
    setNewName('')
    setNewPrompt('')
    setShowAdd(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="template-modal" onClick={e => e.stopPropagation()}>
        <header className="template-header">
          <div>
            <h2>Prompt 模板库</h2>
            <p>点击模板直接使用，或管理自定义模板</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="template-body">
          {/* 内置模板 */}
          <div className="template-section">
            <div className="section-title">内置模板</div>
            <div className="template-grid">
              {BUILTIN_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  className="template-card"
                  type="button"
                  onClick={() => { onUseTemplate(t.prompt); onClose() }}
                >
                  <span className="template-icon">{t.icon}</span>
                  <span className="template-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义模板 */}
          <div className="template-section">
            <div className="section-title">
              <span>自定义模板</span>
              <button
                className="meta-action"
                type="button"
                onClick={() => { setShowAdd(true); setEditId(null); setNewName(''); setNewPrompt('') }}
              >
                + 新增
              </button>
            </div>
            {customTemplates.length === 0 && !showAdd && (
              <div className="empty-inline">暂无自定义模板</div>
            )}
            <div className="template-grid">
              {customTemplates.map(t => (
                <div key={t.id} className="template-card custom">
                  <button
                    className="template-use"
                    type="button"
                    onClick={() => { onUseTemplate(t.prompt); onClose() }}
                  >
                    <span className="template-icon">{t.icon}</span>
                    <span className="template-name">{t.name}</span>
                  </button>
                  <div className="template-card-actions">
                    <button className="meta-action" type="button" onClick={() => handleEdit(t)}>编辑</button>
                    <button className="meta-action danger" type="button" onClick={() => handleDelete(t.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>

            {showAdd && (
              <div className="template-add-form">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="模板名称"
                />
                <textarea
                  value={newPrompt}
                  onChange={e => setNewPrompt(e.target.value)}
                  placeholder="输入 prompt 内容…"
                  rows={4}
                />
                <div className="template-form-actions">
                  <button className="ghost-button" type="button" onClick={() => { setShowAdd(false); setEditId(null) }}>
                    取消
                  </button>
                  <button className="primary-button" type="button" onClick={editId ? handleSaveEdit : handleAdd}>
                    {editId ? '保存' : '添加'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default TemplatePanel

import React, { useEffect, useMemo, useState } from 'react'
import { ProjectFile } from '../../types'
import { ipcRenderer } from '../../electron-ipc'

interface ProjectPanelProps {
  onUsePrompt: (prompt: string) => void
  projectRoot: string
  onProjectChange: (root: string) => void
}

type Scripts = Record<string, string>
type ProjectPayload = { root: string; files: ProjectFile[]; scripts: Scripts; memory?: string }

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function basename(root: string) {
  return root.split(/[\\/]/).filter(Boolean).at(-1) || root
}

const ProjectPanel: React.FC<ProjectPanelProps> = ({ onUsePrompt, projectRoot, onProjectChange }) => {
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [scripts, setScripts] = useState<Scripts>({})
  const [selectedPath, setSelectedPath] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState(projectRoot ? `已打开：${projectRoot}` : '尚未打开项目。')
  const [fileQuery, setFileQuery] = useState('')
  const [dirty, setDirty] = useState(false)
  const [memory, setMemory] = useState('')
  const [memoryDirty, setMemoryDirty] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [runOutput, setRunOutput] = useState('')

  useEffect(() => {
    setStatus(projectRoot ? `已打开：${projectRoot}` : '尚未打开项目。')
  }, [projectRoot])

  const filteredFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase()
    if (!query) return files
    return files.filter(file => file.path.toLowerCase().includes(query))
  }, [fileQuery, files])

  const writableFiles = useMemo(
    () => filteredFiles.filter(file => file.writable),
    [filteredFiles]
  )

  const setProject = (payload: ProjectPayload) => {
    onProjectChange(payload.root)
    setFiles(payload.files)
    setScripts(payload.scripts || {})
    setMemory(payload.memory || '')
    setMemoryDirty(false)
    setSelectedPath('')
    setContent('')
    setDirty(false)
    setRunOutput('')
    setStatus(`已打开：${payload.root}`)
  }

  const openProject = async () => {
    if (!ipcRenderer) {
      setStatus('请在 Electron 桌面端使用项目功能。')
      return
    }

    const result = await ipcRenderer.invoke('project-open-folder')
    if (result.success) {
      setProject(result)
    } else if (!result.canceled) {
      setStatus(result.error || '打开项目失败。')
    }
  }

  const createNewProject = async () => {
    if (!ipcRenderer) {
      setStatus('请在 Electron 桌面端使用项目功能。')
      return
    }

    const name = window.prompt('新项目名称', 'fullstack-agent-project')
    if (!name) return

    const result = await ipcRenderer.invoke('project-create', name)
    if (result.success) {
      setProject(result)
    } else if (!result.canceled) {
      setStatus(result.error || '新建项目失败。')
    }
  }

  const refreshProject = async () => {
    if (!projectRoot || !ipcRenderer) return

    const result = await ipcRenderer.invoke('project-read-tree', projectRoot)
    if (result.success) {
      setFiles(result.files)
      setScripts(result.scripts || {})
      setMemory(result.memory || '')
      setMemoryDirty(false)
      setStatus('项目文件已刷新。')
    } else {
      setStatus(result.error || '刷新失败。')
    }
  }

  const readFile = async (filePath: string) => {
    if (!projectRoot || !ipcRenderer) return

    if (dirty && !window.confirm('当前文件有未保存修改，确定切换文件吗？')) {
      return
    }

    const result = await ipcRenderer.invoke('project-read-file', projectRoot, filePath)
    if (result.success) {
      setSelectedPath(filePath)
      setContent(result.content)
      setDirty(false)
      setStatus(`正在编辑：${filePath}`)
    } else {
      setStatus(result.error || '读取文件失败。')
    }
  }

  const saveFile = async () => {
    if (!projectRoot || !selectedPath || !ipcRenderer) return

    const result = await ipcRenderer.invoke('project-write-file', projectRoot, selectedPath, content)
    if (result.success) {
      setDirty(false)
      setStatus(`已保存：${selectedPath}`)
      await refreshProject()
    } else {
      setStatus(result.error || '保存失败。')
    }
  }

  const createFile = async () => {
    if (!projectRoot) {
      setStatus('请先打开或新建项目。')
      return
    }

    const filePath = window.prompt('输入项目内文件路径，例如 src/app.ts')
    if (!filePath) return

    setSelectedPath(filePath.replace(/\\/g, '/'))
    setContent('')
    setDirty(true)
    setStatus(`新文件：${filePath}`)
  }

  const runScript = async (scriptName: string) => {
    if (!projectRoot || !ipcRenderer) return

    setIsRunning(true)
    setRunOutput(`$ npm run ${scriptName}\n`)

    const result = await ipcRenderer.invoke('project-run-script', projectRoot, scriptName)
    setRunOutput(prev => `${prev}${result.output || result.error || ''}`)
    setStatus(result.success ? `脚本完成：${scriptName}` : `脚本失败：${scriptName}`)
    setIsRunning(false)
  }

  const saveMemory = async () => {
    if (!projectRoot || !ipcRenderer) return
    const result = await ipcRenderer.invoke('project-save-memory', projectRoot, memory)
    if (result.success) {
      setMemoryDirty(false)
      setStatus('项目记忆已保存。')
    } else {
      setStatus(result.error || '保存项目记忆失败。')
    }
  }

  const showGitStatus = async () => {
    if (!projectRoot || !ipcRenderer) return
    setRunOutput('$ git status --short && git diff --stat\n')
    const result = await ipcRenderer.invoke('project-git-status', projectRoot)
    if (result.success) {
      const output = [
        `branch: ${result.branch || '(unknown)'}`,
        '',
        result.status || '(working tree clean)',
        '',
        result.diffStat || ''
      ].join('\n').trim()
      setRunOutput(prev => `${prev}${output}`)
      setStatus('Git 状态已刷新。')
    } else {
      setRunOutput(prev => `${prev}${result.error || '当前目录不是 Git 仓库。'}`)
      setStatus('读取 Git 状态失败。')
    }
  }

  const sendProjectContext = () => {
    if (!projectRoot) {
      setStatus('请先打开或新建项目。')
      return
    }

    const tree = files.slice(0, 120).map(file => `- ${file.path}`).join('\n')
    const selected = selectedPath
      ? `\n\n当前文件：${selectedPath}\n\n\`\`\`\n${content.slice(0, 12000)}\n\`\`\``
      : ''
    const memoryContext = memory.trim()
      ? `\n\n项目记忆：\n${memory.trim().slice(0, 4000)}`
      : ''

    onUsePrompt(
      `请基于下面的项目结构协助我开发、修改代码并设计测试方案。\n\n项目根目录：${projectRoot}${memoryContext}\n\n文件结构：\n${tree}${selected}\n\n请先说明你会修改哪些文件，再给出具体实现建议。`
    )
  }

  return (
    <aside className="project-panel">
      <header className="project-header">
        <div>
          <h2>项目</h2>
          <p>{projectRoot ? basename(projectRoot) : '打开文件夹后开始开发'}</p>
        </div>
        <button className="icon-button" type="button" onClick={refreshProject} disabled={!projectRoot} title="刷新项目">
          ↻
        </button>
      </header>

      <div className="project-actions">
        <button className="ghost-button" type="button" onClick={openProject}>
          打开项目
        </button>
        <button className="ghost-button" type="button" onClick={createNewProject}>
          新建项目
        </button>
      </div>

      <div className="project-status" title={status}>
        {status}
      </div>

      <div className="project-section">
        <div className="project-section-title">
          <span>文件</span>
          <button className="meta-action" type="button" onClick={createFile} disabled={!projectRoot}>
            新建文件
          </button>
        </div>
        <input
          value={fileQuery}
          onChange={event => setFileQuery(event.target.value)}
          placeholder="搜索文件"
          disabled={!projectRoot}
        />
        <div className="file-list">
          {writableFiles.map(file => (
            <button
              key={file.path}
              className={selectedPath === file.path ? 'file-item active' : 'file-item'}
              type="button"
              onClick={() => readFile(file.path)}
              title={`${file.path} · ${formatSize(file.size)}`}
            >
              <span>{file.path}</span>
              <small>{formatSize(file.size)}</small>
            </button>
          ))}
          {projectRoot && writableFiles.length === 0 && (
            <div className="empty-inline">没有可编辑文本文件。</div>
          )}
        </div>
      </div>

      <div className="project-section editor-section">
        <div className="project-section-title">
          <span>{selectedPath || '编辑器'}</span>
          <button className="meta-action" type="button" onClick={saveFile} disabled={!selectedPath || !dirty}>
            保存
          </button>
        </div>
        <textarea
          className="project-editor"
          value={content}
          onChange={event => {
            setContent(event.target.value)
            setDirty(true)
          }}
          placeholder="选择文件，或新建文件后开始编写代码"
          disabled={!selectedPath}
        />
      </div>

      <div className="project-section">
        <div className="project-section-title">
          <span>开发测试</span>
          <button className="meta-action" type="button" onClick={sendProjectContext} disabled={!projectRoot}>
            发给对话
          </button>
        </div>
        <div className="script-list">
          <button
            className="script-button"
            type="button"
            onClick={showGitStatus}
            disabled={!projectRoot || isRunning}
            title="查看当前 Git 分支、状态和 diff 统计"
          >
            Git 状态
          </button>
          {Object.keys(scripts).map(script => (
            <button
              key={script}
              className="script-button"
              type="button"
              onClick={() => runScript(script)}
              disabled={isRunning}
              title={scripts[script]}
            >
              npm run {script}
            </button>
          ))}
          {projectRoot && Object.keys(scripts).length === 0 && (
            <div className="empty-inline">没有 package.json scripts。</div>
          )}
        </div>
        {runOutput && (
          <pre className="run-output">{runOutput}</pre>
        )}
      </div>

      <div className="project-section memory-section">
        <div className="project-section-title">
          <span>项目记忆</span>
          <button className="meta-action" type="button" onClick={saveMemory} disabled={!projectRoot || !memoryDirty}>
            保存记忆
          </button>
        </div>
        <textarea
          className="project-memory"
          value={memory}
          onChange={event => {
            setMemory(event.target.value)
            setMemoryDirty(true)
          }}
          placeholder="写下项目约束、常用命令、代码风格和 Agent 需要长期记住的偏好"
          disabled={!projectRoot}
        />
      </div>
    </aside>
  )
}

export default ProjectPanel

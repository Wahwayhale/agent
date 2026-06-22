# FullStack Agent Desktop

面向产品、设计和工程落地的多模型 AI 桌面助手。应用基于 Electron + React 构建，支持普通对话、项目文件读写、Agent 工具调用、会话管理、模板、搜索、导出和本地项目上下文。

## 核心功能

- 多模型接入：MIMO、通义千问、DeepSeek、智谱、Kimi、MiniMax、豆包、星火、零一万物、腾讯混元、百川、StepFun、OpenAI、Claude、Ollama 等。
- 模型设置：支持按任务一键推荐模型，例如 Agent 编程、复杂推理、图片理解、快速问答、长上下文。
- 聊天体验：流式输出、Markdown/代码高亮、复制代码、图片粘贴/拖拽输入、停止生成。
- 会话管理：多会话、重命名、删除、搜索、Token 统计、Markdown/JSON/HTML 导出。
- 提示词模板：内置产品、设计、开发、测试、审查、发布等工作流模板，并支持自定义模板。
- 项目面板：打开/新建项目、浏览可编辑文件、编辑保存文件、运行 package scripts、查看 Git 状态。
- 项目记忆：在项目内保存 `.fullstack-agent/memory.md`，用于记录代码风格、常用命令和 Agent 长期约束。
- Agent 模式：可读取文件、按行读取、搜索代码、搜索符号、提取文件大纲、写入文件、运行命令、读取 Git 状态。
- 人工确认：Agent 写文件前展示 diff 并等待确认；执行命令前展示风险提示并等待确认。
- 安全基线：Electron 渲染进程禁用 Node 集成，使用 preload + contextBridge 暴露白名单 IPC。

## Quick Start

```bash
npm install
npm run dev
```

开发模式会启动 Vite 和 Electron。

## Build

```bash
npm run build
npm run build:win
```

Windows 安装包会输出到 `release/`。

## Test

```bash
npm test
npm run build
```

当前测试覆盖 provider 配置、APIAdapter 请求体和 SSE 解析、项目服务的创建/读写/脚本运行/项目记忆。

## Project Structure

```text
electron/
  main.js                    Electron 主进程与 IPC
  preload.js                 安全 IPC 桥接
  api-adapter/               多模型 OpenAI 兼容适配
  agent/                     Agent 引擎、工具和文本协议
  project-service.js         项目文件、脚本、Git、记忆服务
  conversation-store.js      会话持久化与导出
src/
  App.tsx                    应用主入口
  electron-ipc.ts            前端 IPC 适配
  components/                聊天、设置、项目、搜索、导出、模板组件
  hooks/useConversations.ts  会话状态与自动保存
  providers.ts               服务商配置入口
tests/                       Node test 测试
```

## Agent Tools

Agent 当前内置工具：

- `get_project_info`
- `list_files`
- `read_file`
- `read_file_range`
- `search_code`
- `get_file_outline`
- `search_symbols`
- `get_git_status`
- `write_file`
- `edit_file`
- `run_command`

其中 `write_file`、`edit_file` 和 `run_command` 会走人工确认流程。

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { APIAdapter } = require('./api-adapter/adapter');
const { PROVIDERS } = require('./api-adapter/providers');
const { ModelFetcher } = require('./api-adapter/model-fetcher');
const { AgentEngine } = require('./agent/engine');
const { ConversationStore } = require('./conversation-store');
const {
  createProject,
  listProjectFiles,
  readGitStatus,
  readPackageScripts,
  readProjectFile,
  readProjectMemory,
  runProjectScript,
  saveProjectMemory,
  writeProjectFile
} = require('./project-service');

const modelFetcher = new ModelFetcher();
const activeStreams = new Map();
const activeAgents = new Map();
const pendingAgentApprovals = new Map();
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const conversationStore = new ConversationStore(app.getPath('userData'));

const DEFAULT_CONFIG = {
  api: {
    provider: 'mimo',
    apiKey: '',
    model: 'mimo-v2.5-pro',
    billingMode: 'token-plan',
    temperature: 1,
    maxTokens: 4096
  },
  ui: {
    theme: 'dark',
    fontSize: 14,
    language: 'zh'
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }

  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('保存配置失败:', error);
    return false;
  }
}

function getResponsePreview(response) {
  const content = response?.content || response?.choices?.[0]?.message?.content || '';
  return String(content).trim().slice(0, 80);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 800,
    minHeight: 620,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#10110f'
  });

  const appPath = app.getAppPath();
  const distPath = path.join(appPath, 'dist', 'index.html');
  const devServerURL = process.env.VITE_DEV_SERVER_URL;

  if (!app.isPackaged && devServerURL) {
    mainWindow.loadURL(devServerURL);
    mainWindow.webContents.openDevTools();
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
  for (const approval of pendingAgentApprovals.values()) {
    approval.resolve(false);
  }
  pendingAgentApprovals.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (_event, config) => saveConfig(config));

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('project-open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '打开项目文件夹'
  });

  if (result.canceled) {
    return { success: false, canceled: true };
  }

  const root = result.filePaths[0];
  return {
    success: true,
    root,
    files: await listProjectFiles(root),
    scripts: await readPackageScripts(root),
    memory: await readProjectMemory(root)
  };
});

ipcMain.handle('project-create', async (_event, name) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择新项目所在目录'
  });

  if (result.canceled) {
    return { success: false, canceled: true };
  }

  try {
    const root = await createProject(result.filePaths[0], name);
    return {
      success: true,
      root,
      files: await listProjectFiles(root),
      scripts: await readPackageScripts(root),
      memory: await readProjectMemory(root)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-read-tree', async (_event, root) => {
  try {
    return {
      success: true,
      files: await listProjectFiles(root),
      scripts: await readPackageScripts(root),
      memory: await readProjectMemory(root)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-read-file', async (_event, root, filePath) => {
  try {
    return { success: true, content: await readProjectFile(root, filePath) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-write-file', async (_event, root, filePath, content) => {
  try {
    return { success: true, file: await writeProjectFile(root, filePath, content) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-run-script', async (_event, root, scriptName) => {
  try {
    return await runProjectScript(root, scriptName);
  } catch (error) {
    return { success: false, error: error.message, output: error.message };
  }
});

ipcMain.handle('project-get-memory', async (_event, root) => {
  try {
    return { success: true, memory: await readProjectMemory(root) };
  } catch (error) {
    return { success: false, error: error.message, memory: '' };
  }
});

ipcMain.handle('project-save-memory', async (_event, root, content) => {
  try {
    return { success: true, file: await saveProjectMemory(root, content) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project-git-status', async (_event, root) => {
  try {
    return await readGitStatus(root);
  } catch (error) {
    return { success: false, error: error.message, status: '', diffStat: '', branch: '' };
  }
});

ipcMain.handle('chat-completion', async (_event, config, messages) => {
  try {
    const adapter = new APIAdapter(config);
    const response = await adapter.chat(messages);
    return { success: true, data: response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chat-completion-stream', async (event, requestId, config, messages) => {
  const channel = `chat-completion-stream:${requestId}`;
  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  try {
    const adapter = new APIAdapter(config);

    let usageData = null;

    for await (const chunk of adapter.chatStream(messages, { signal: controller.signal })) {
      // chunk 是 { type: 'text' | 'reasoning', content: '...' } 格式
      if (chunk && chunk.content) {
        event.sender.send(channel, { type: 'chunk', content: chunk.content });
      }
      if (chunk && chunk.type === 'usage' && chunk.usage) {
        usageData = chunk.usage;
      }
    }

    event.sender.send(channel, {
      type: 'done',
      usage: usageData ? {
        prompt: usageData.prompt_tokens || 0,
        completion: usageData.completion_tokens || 0,
        total: usageData.total_tokens || 0
      } : null
    });
    return { success: true };
  } catch (error) {
    if (error.name === 'AbortError') {
      event.sender.send(channel, { type: 'done', aborted: true });
      return { success: true, aborted: true };
    }

    event.sender.send(channel, { type: 'error', error: error.message });
    return { success: false, error: error.message };
  } finally {
    activeStreams.delete(requestId);
  }
});

// 非流式对话（用于获取 usage 统计）
ipcMain.handle('chat-completion-with-usage', async (_event, config, messages) => {
  try {
    const adapter = new APIAdapter(config);
    const response = await adapter.chat(messages);
    const usage = response.raw?.usage || null;
    return {
      success: true,
      content: response.content,
      usage: usage ? {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0
      } : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chat-completion-abort', (_event, requestId) => {
  const controller = activeStreams.get(requestId);

  if (!controller) {
    return { success: false, error: '未找到正在进行的请求。' };
  }

  controller.abort();
  activeStreams.delete(requestId);
  return { success: true };
});

ipcMain.handle('test-connection', async (_event, config) => {
  const provider = PROVIDERS[config.provider];

  if (!provider) {
    return { success: false, error: '未知的 API 服务商。' };
  }

  if (provider.type === 'cloud' && !config.apiKey) {
    return { success: false, error: '请先填写 API Key。' };
  }

  const startedAt = Date.now();

  try {
    const adapter = new APIAdapter({
      ...config,
      temperature: 0,
      maxTokens: 24
    });
    const response = await adapter.chat(
      [{ role: 'user', content: '请只回复 OK，用于连接测试。' }],
      { maxTokens: 24, temperature: 0 }
    );

    return {
      success: true,
      latency: Date.now() - startedAt,
      preview: getResponsePreview(response)
    };
  } catch (error) {
    return {
      success: false,
      latency: Date.now() - startedAt,
      error: error.message
    };
  }
});

ipcMain.handle('get-providers', () => PROVIDERS);

ipcMain.handle('fetch-models', async (_event, providerId, apiKey, billingMode) => {
  const provider = PROVIDERS[providerId];

  if (!provider) {
    return { success: false, error: '未知的 API 服务商。', models: [] };
  }

  try {
    const result = await modelFetcher.fetchModels(provider, apiKey, billingMode);
    return {
      success: true,
      models: result.models,
      fromCache: result.fromCache,
      error: result.error
    };
  } catch (error) {
    return { success: false, error: error.message, models: provider.models };
  }
});

ipcMain.handle('agent-run', async (event, requestId, config, projectRoot, userMessage) => {
  if (!projectRoot) {
    return { success: false, error: '请先在项目中打开一个文件夹。' };
  }
  if (!userMessage || !userMessage.trim()) {
    return { success: false, error: '消息不能为空。' };
  }
  if (!fs.existsSync(projectRoot)) {
    return { success: false, error: '项目根目录不存在。' };
  }

  const channel = `agent-event:${requestId}`;
  const controller = new AbortController();
  activeAgents.set(requestId, controller);

  const engine = new AgentEngine({
    config,
    projectRoot,
    signal: controller.signal,
    requestApproval: (approval) => requestAgentApproval(event, requestId, approval, controller.signal),
    onEvent: (agentEvent) => {
      try {
        event.sender.send(channel, agentEvent);
      } catch (err) {
        console.log('[Agent] send ERROR:', err.message, 'event:', agentEvent.type);
      }
    }
  });

  engine.run(userMessage).finally(() => {
    activeAgents.delete(requestId);
  });

  return { success: true };
});

ipcMain.handle('agent-abort', (_event, requestId) => {
  const controller = activeAgents.get(requestId);
  if (!controller) {
    return { success: false, error: '未找到正在运行的 Agent。' };
  }
  controller.abort();
  activeAgents.delete(requestId);
  for (const [approvalId, approval] of pendingAgentApprovals.entries()) {
    if (approval.agentId === requestId) {
      approval.resolve(false);
      pendingAgentApprovals.delete(approvalId);
    }
  }
  return { success: true };
});

ipcMain.handle('agent-approval-response', (_event, approvalId, approved) => {
  const approval = pendingAgentApprovals.get(approvalId);
  if (!approval) {
    return { success: false, error: '审批请求已失效。' };
  }
  pendingAgentApprovals.delete(approvalId);
  approval.resolve(Boolean(approved));
  return { success: true };
});

function requestAgentApproval(event, agentId, approval, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = `agent-event:${agentId}`;
    const finish = (approved) => {
      signal?.removeEventListener?.('abort', abortHandler);
      resolve(Boolean(approved));
    };
    const abortHandler = () => {
      pendingAgentApprovals.delete(approvalId);
      finish(false);
    };

    pendingAgentApprovals.set(approvalId, { agentId, resolve: finish });
    signal?.addEventListener?.('abort', abortHandler, { once: true });

    event.sender.send(channel, {
      type: 'approval_request',
      approval: {
        ...approval,
        approvalId
      }
    });
  });
}

// ============== 会话管理 IPC ==============

ipcMain.handle('conversations-load', async () => {
  try {
    const conversations = await conversationStore.load();
    return { success: true, conversations };
  } catch (error) {
    return { success: false, error: error.message, conversations: [] };
  }
});

ipcMain.handle('conversations-save', async (_event, conversations) => {
  try {
    const ok = await conversationStore.save(conversations);
    return { success: ok };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('conversation-export', async (_event, conversation, format) => {
  try {
    const extMap = { markdown: '.md', json: '.json', html: '.html' };
    const mimeMap = { markdown: 'Markdown 文件', json: 'JSON 文件', html: 'HTML 文件' };
    const ext = extMap[format] || '.md';

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出会话',
      defaultPath: `${conversation.title || 'conversation'}${ext}`,
      filters: [
        { name: mimeMap[format] || '文件', extensions: [ext.slice(1)] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return { success: false, canceled: true };
    }

    let content;
    if (format === 'json') {
      content = conversationStore.exportJSON(conversation);
    } else if (format === 'html') {
      content = conversationStore.exportHTML(conversation);
    } else {
      content = conversationStore.exportMarkdown(conversation);
    }

    await fs.promises.writeFile(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'agent-abort',
  'agent-approval-response',
  'agent-run',
  'chat-completion',
  'chat-completion-abort',
  'chat-completion-stream',
  'chat-completion-with-usage',
  'conversation-export',
  'conversations-load',
  'conversations-save',
  'fetch-models',
  'get-config',
  'get-providers',
  'project-create',
  'project-get-memory',
  'project-git-status',
  'project-open-folder',
  'project-read-file',
  'project-read-tree',
  'project-run-script',
  'project-save-memory',
  'project-write-file',
  'save-config',
  'select-folder',
  'test-connection'
]);

function isEventChannel(channel) {
  return channel.startsWith('agent-event:')
    || channel.startsWith('chat-completion-stream:');
}

function assertInvokeChannel(channel) {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`IPC channel is not allowed: ${channel}`);
  }
}

function assertEventChannel(channel) {
  if (!isEventChannel(channel)) {
    throw new Error(`IPC event channel is not allowed: ${channel}`);
  }
}

const listenerMap = new Map();

function rememberListener(channel, listener, wrapped) {
  if (!listenerMap.has(channel)) {
    listenerMap.set(channel, new Map());
  }
  listenerMap.get(channel).set(listener, wrapped);
}

function takeListener(channel, listener) {
  const channelMap = listenerMap.get(channel);
  if (!channelMap) return null;
  const wrapped = channelMap.get(listener);
  channelMap.delete(listener);
  if (channelMap.size === 0) listenerMap.delete(channel);
  return wrapped || null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel, ...args) {
    assertInvokeChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },

  on(channel, listener) {
    assertEventChannel(channel);
    const wrapped = (_event, ...args) => listener(undefined, ...args);
    rememberListener(channel, listener, wrapped);
    ipcRenderer.on(channel, wrapped);
  },

  removeListener(channel, listener) {
    assertEventChannel(channel);
    const wrapped = takeListener(channel, listener);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
    }
  }
});

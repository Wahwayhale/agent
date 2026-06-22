const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

class ConversationStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'conversations.json');
  }

  async load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const data = await fsp.readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async save(conversations) {
    try {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      await fsp.writeFile(this.filePath, JSON.stringify(conversations, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  exportMarkdown(conversation) {
    const lines = [`# ${conversation.title}\n`];
    lines.push(`创建时间: ${conversation.createdAt}\n`);

    for (const msg of conversation.messages) {
      const roleLabel = msg.role === 'user' ? '## 你' :
                        msg.role === 'agent' ? '## Agent' : '## FullStack Agent';
      lines.push(`${roleLabel}\n`);
      lines.push(`${msg.content}\n`);
      if (msg.tokenUsage) {
        lines.push(`> Token: ${msg.tokenUsage.total} (prompt: ${msg.tokenUsage.prompt}, completion: ${msg.tokenUsage.completion})\n`);
      }
    }

    if (conversation.tokenUsage) {
      lines.push('---\n');
      lines.push(`**总计 Token: ${conversation.tokenUsage.total}**\n`);
    }

    return lines.join('\n');
  }

  exportJSON(conversation) {
    return JSON.stringify(conversation, null, 2);
  }

  exportHTML(conversation) {
    const escapeHtml = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const msgHtml = conversation.messages.map(msg => {
      const roleLabel = msg.role === 'user' ? '你' :
                        msg.role === 'agent' ? 'Agent' : 'FullStack Agent';
      const contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br>');
      const tokenHtml = msg.tokenUsage
        ? `<div class="token">Token: ${msg.tokenUsage.total}</div>`
        : '';
      return `<div class="msg ${msg.role}"><div class="role">${roleLabel}</div><div class="content">${contentHtml}</div>${tokenHtml}</div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(conversation.title)}</title>
<style>
body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
.msg { margin: 16px 0; padding: 12px; border-radius: 8px; background: #f5f5f5; }
.msg.user { background: #e8f5e9; }
.msg.agent { background: #e3f2fd; }
.role { font-weight: bold; margin-bottom: 6px; font-size: 13px; color: #666; }
.content { line-height: 1.6; }
.token { font-size: 11px; color: #999; margin-top: 6px; }
</style>
</head>
<body>
<h1>${escapeHtml(conversation.title)}</h1>
<p>创建时间: ${conversation.createdAt}</p>
${msgHtml}
${conversation.tokenUsage ? `<p><strong>总计 Token: ${conversation.tokenUsage.total}</strong></p>` : ''}
</body>
</html>`;
  }
}

module.exports = { ConversationStore };

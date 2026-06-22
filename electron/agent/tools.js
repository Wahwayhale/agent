/**
 * Agent 内置工具注册表
 * 每个工具: { name, description, parameters(JSONSchema), risk, execute(args, ctx) }
 * - risk: 'read' | 'write' | 'shell',UI 用它来分级展示/请求确认
 * - execute: 返回 { ok, output, error?, meta? }
 *   - 写入类工具附带 meta.diff 给前端展示
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const {
  ensureInsideRoot,
  isTextFile,
  listProjectFiles,
  readGitStatus,
  readProjectFile,
  readPackageScripts,
  writeProjectFile
} = require('../project-service');

function normalizeRelative(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function safeResolve(root, filePath) {
  return ensureInsideRoot(root, filePath);
}

function toolSuccess(output, meta = {}) {
  return { ok: true, output, meta };
}

function toolFailure(error) {
  return { ok: false, error: String(error?.message || error) };
}

const readFileTool = {
  name: 'read_file',
  description: '读取项目内一个文本文件的完整内容(自动限制大小)。当需要查看现有代码时使用。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对项目根的文件路径,如 src/index.js' }
    },
    required: ['path']
  },
  async execute(args, ctx) {
    try {
      const target = safeResolve(ctx.projectRoot, args.path);
      const content = await readProjectFile(ctx.projectRoot, args.path);
      const stat = await fsp.stat(target);
      return toolSuccess(content, {
        path: normalizeRelative(args.path),
        size: stat.size
      });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const readFileRangeTool = {
  name: 'read_file_range',
  description: '按行号读取项目内文本文件的一段内容。用于减少上下文消耗,尤其适合大文件定位后读取。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对项目根的文件路径' },
      start_line: { type: 'number', description: '起始行号,从 1 开始' },
      end_line: { type: 'number', description: '结束行号,包含该行' }
    },
    required: ['path', 'start_line', 'end_line']
  },
  async execute(args, ctx) {
    try {
      const content = await readProjectFile(ctx.projectRoot, args.path);
      const lines = content.split(/\r?\n/);
      const start = Math.max(1, Number(args.start_line) || 1);
      const end = Math.min(lines.length, Math.max(start, Number(args.end_line) || start));
      const selected = lines
        .slice(start - 1, end)
        .map((line, index) => `${start + index}: ${line}`)
        .join('\n');
      return toolSuccess(selected || '(空)', {
        path: normalizeRelative(args.path),
        startLine: start,
        endLine: end,
        totalLines: lines.length
      });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const listFilesTool = {
  name: 'list_files',
  description: '列出项目内的文件结构(已忽略 node_modules/dist/.git 等)。用于了解项目布局。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '可选的子串过滤,匹配文件路径(不区分大小写)' },
      max: { type: 'number', description: '最多返回条数,默认 200' }
    },
  },
  async execute(args, ctx) {
    try {
      const files = await listProjectFiles(ctx.projectRoot, { maxFiles: 800 });
      const max = Number(args.max) || 200;
      const pattern = String(args.pattern || '').toLowerCase();
      const filtered = pattern
        ? files.filter(file => file.path.toLowerCase().includes(pattern))
        : files;
      const sliced = filtered.slice(0, max);
      return toolSuccess(
        sliced.map(file => `${file.path}${file.writable ? '' : ' [binary]'}`).join('\n'),
        { count: filtered.length, returned: sliced.length }
      );
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const searchCodeTool = {
  name: 'search_code',
  description: '在项目文本文件中按正则/子串搜索代码,返回匹配的文件路径和行号。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要搜索的文本或正则' },
      glob: { type: 'string', description: '可选:只搜索匹配该子串的文件路径' },
      max_results: { type: 'number', description: '最多返回多少条匹配,默认 50' }
    },
    required: ['query']
  },
  async execute(args, ctx) {
    try {
      const files = await listProjectFiles(ctx.projectRoot, { maxFiles: 800 });
      const max = Number(args.max_results) || 50;
      const glob = String(args.glob || '').toLowerCase();
      const targetFiles = glob
        ? files.filter(file => file.path.toLowerCase().includes(glob) && file.writable)
        : files.filter(file => file.writable);

      const lines = [];
      outer: for (const file of targetFiles) {
        const absolute = safeResolve(ctx.projectRoot, file.path);
        let content;
        try {
          content = await fsp.readFile(absolute, 'utf-8');
        } catch {
          continue;
        }
        const arr = content.split(/\r?\n/);
        for (let i = 0; i < arr.length; i += 1) {
          if (arr[i].includes(args.query)) {
            lines.push(`${file.path}:${i + 1}: ${arr[i].trim().slice(0, 240)}`);
            if (lines.length >= max) break outer;
          }
        }
      }
      return toolSuccess(lines.length ? lines.join('\n') : '(没有匹配)', { count: lines.length });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const getFileOutlineTool = {
  name: 'get_file_outline',
  description: '提取一个源文件中的类、函数、接口、导出符号等大纲。用于先了解文件结构再读取片段。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对项目根的文件路径' }
    },
    required: ['path']
  },
  async execute(args, ctx) {
    try {
      const content = await readProjectFile(ctx.projectRoot, args.path);
      const symbols = extractSymbols(args.path, content);
      const output = symbols.length
        ? symbols.map(s => `${s.line}: ${s.kind} ${s.name} - ${s.signature}`).join('\n')
        : '(未识别到符号)';
      return toolSuccess(output, {
        path: normalizeRelative(args.path),
        symbols
      });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const searchSymbolsTool = {
  name: 'search_symbols',
  description: '在项目内搜索函数、类、接口、导出变量等符号名。比全文搜索更适合定位代码入口。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '符号名关键词' },
      max_results: { type: 'number', description: '最多返回条数,默认 50' }
    },
    required: ['query']
  },
  async execute(args, ctx) {
    try {
      const query = String(args.query || '').toLowerCase();
      const max = Number(args.max_results) || 50;
      const files = await listProjectFiles(ctx.projectRoot, { maxFiles: 800 });
      const matches = [];

      outer: for (const file of files.filter(file => file.writable && file.size <= 512 * 1024)) {
        let content;
        try {
          content = await readProjectFile(ctx.projectRoot, file.path);
        } catch {
          continue;
        }
        for (const symbol of extractSymbols(file.path, content)) {
          if (!query || symbol.name.toLowerCase().includes(query) || symbol.signature.toLowerCase().includes(query)) {
            matches.push({ ...symbol, path: file.path });
            if (matches.length >= max) break outer;
          }
        }
      }

      const output = matches.length
        ? matches.map(s => `${s.path}:${s.line}: ${s.kind} ${s.name} - ${s.signature}`).join('\n')
        : '(未识别到匹配符号)';
      return toolSuccess(output, { count: matches.length, symbols: matches });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const getProjectInfoTool = {
  name: 'get_project_info',
  description: '返回项目的元信息:package.json 中的 name/version/scripts/dependencies,以及已识别出的语言/框架。',
  risk: 'read',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    try {
      const scripts = await readPackageScripts(ctx.projectRoot);
      const pkgPath = safeResolve(ctx.projectRoot, 'package.json');
      const pkg = fs.existsSync(pkgPath)
        ? JSON.parse(await fsp.readFile(pkgPath, 'utf-8'))
        : {};

      const info = {
        name: pkg.name || null,
        version: pkg.version || null,
        type: pkg.type || 'commonjs',
        scripts,
        dependencies: pkg.dependencies || {},
        devDependencies: pkg.devDependencies || {}
      };
      return toolSuccess(JSON.stringify(info, null, 2), { info });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const getGitStatusTool = {
  name: 'get_git_status',
  description: '读取当前项目 Git 分支、短状态和 diff 统计。只读,不会修改工作区。',
  risk: 'read',
  parameters: { type: 'object', properties: {} },
  async execute(_args, ctx) {
    try {
      const status = await readGitStatus(ctx.projectRoot);
      const output = [
        `branch: ${status.branch || '(unknown)'}`,
        '',
        status.status || '(working tree clean)',
        '',
        status.diffStat || ''
      ].join('\n').trim();
      return toolSuccess(output, status);
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const writeFileTool = {
  name: 'write_file',
  description: '创建或覆盖项目内的一个文本文件。会返回与现有内容的 diff。',
  risk: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对项目根的文件路径' },
      content: { type: 'string', description: '完整文件内容' }
    },
    required: ['path', 'content']
  },
  async execute(args, ctx) {
    try {
      const target = safeResolve(ctx.projectRoot, args.path);
      if (!isTextFile(target)) {
        return toolFailure(new Error('不支持的文本类型'));
      }
      let previous = '';
      let isNew = true;
      try {
        previous = await fsp.readFile(target, 'utf-8');
        isNew = false;
      } catch {
        // 文件不存在视为新建
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, args.content, 'utf-8');
      const diff = buildUnifiedDiff(args.path, previous, args.content);
      return toolSuccess(
        isNew ? `已创建: ${args.path}` : `已覆盖: ${args.path}`,
        {
          path: normalizeRelative(args.path),
          isNew,
          diff,
          summary: summarizeDiff(previous, args.content)
        }
      );
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const editFileTool = {
  name: 'edit_file',
  description: '对项目内一个文本文件做精确的 search/replace 替换。old_text 必须唯一匹配。',
  risk: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对项目根的文件路径' },
      old_text: { type: 'string', description: '要被替换的原文片段(必须唯一)' },
      new_text: { type: 'string', description: '替换后的新内容' }
    },
    required: ['path', 'old_text', 'new_text']
  },
  async execute(args, ctx) {
    try {
      const target = safeResolve(ctx.projectRoot, args.path);
      const previous = await fsp.readFile(target, 'utf-8');
      const occurrences = previous.split(args.old_text).length - 1;
      if (occurrences === 0) {
        return toolFailure(new Error('未在文件中找到 old_text,放弃替换'));
      }
      if (occurrences > 1) {
        return toolFailure(new Error(`old_text 出现 ${occurrences} 次,请提供更精确的上下文`));
      }
      const next = previous.replace(args.old_text, args.new_text);
      await fsp.writeFile(target, next, 'utf-8');
      const diff = buildUnifiedDiff(args.path, previous, next);
      return toolSuccess(`已修改: ${args.path}`, {
        path: normalizeRelative(args.path),
        isNew: false,
        diff,
        summary: summarizeDiff(previous, next)
      });
    } catch (error) {
      return toolFailure(error);
    }
  }
};

const runCommandTool = {
  name: 'run_command',
  description: '在项目根目录下执行 shell 命令(npm/pnpm/test 等)。返回 stdout/stderr/exitCode。',
  risk: 'shell',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '可执行命令,如 "npm test" 或 "node -v"' },
      timeout_ms: { type: 'number', description: '超时毫秒数,默认 60000' }
    },
    required: ['command']
  },
  async execute(args, ctx) {
    const timeout = Number(args.timeout_ms) || 60000;
    const root = safeResolve(ctx.projectRoot, '.');
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWin ? ['/d', '/s', '/c', args.command] : ['-c', args.command];

    return new Promise(resolve => {
      execFile(
        shell,
        shellArgs,
        {
          cwd: root,
          timeout,
          maxBuffer: 1024 * 1024 * 4,
          windowsHide: true,
          signal: ctx.signal,
          env: { ...process.env, CI: '1' }
        },
        (error, stdout, stderr) => {
          if (ctx.signal?.aborted || error?.name === 'AbortError') {
            resolve({
              ok: false,
              output: [stdout, stderr].filter(Boolean).join('\n').trim() || '命令已被中断。',
              meta: {
                command: args.command,
                exitCode: null,
                aborted: true
              },
              error: '命令已被中断。'
            });
            return;
          }
          const code = error?.code ?? 0;
          const output = [stdout, stderr].filter(Boolean).join('\n').trim() || '(无输出)';
          resolve({
            ok: !error,
            output,
            meta: {
              command: args.command,
              exitCode: code,
              truncated: output.length >= 1024 * 1024 * 4
            },
            error: error && code !== 0 ? `命令退出码 ${code}` : undefined
          });
        }
      );
    });
  }
};

async function previewToolChange(name, args, ctx) {
  if (name === 'write_file') {
    try {
      const target = safeResolve(ctx.projectRoot, args.path);
      if (!isTextFile(target)) {
        return toolFailure(new Error('不支持的文本类型'));
      }
      let previous = '';
      let isNew = true;
      try {
        previous = await fsp.readFile(target, 'utf-8');
        isNew = false;
      } catch {
        // 新建文件
      }
      const next = String(args.content || '');
      return toolSuccess(
        isNew ? `准备创建: ${args.path}` : `准备覆盖: ${args.path}`,
        {
          path: normalizeRelative(args.path),
          isNew,
          diff: buildUnifiedDiff(args.path, previous, next),
          summary: summarizeDiff(previous, next)
        }
      );
    } catch (error) {
      return toolFailure(error);
    }
  }

  if (name === 'edit_file') {
    try {
      const target = safeResolve(ctx.projectRoot, args.path);
      const previous = await fsp.readFile(target, 'utf-8');
      const occurrences = previous.split(args.old_text).length - 1;
      if (occurrences === 0) {
        return toolFailure(new Error('未在文件中找到 old_text,放弃替换'));
      }
      if (occurrences > 1) {
        return toolFailure(new Error(`old_text 出现 ${occurrences} 次,请提供更精确的上下文`));
      }
      const next = previous.replace(args.old_text, args.new_text);
      return toolSuccess(`准备修改: ${args.path}`, {
        path: normalizeRelative(args.path),
        isNew: false,
        diff: buildUnifiedDiff(args.path, previous, next),
        summary: summarizeDiff(previous, next)
      });
    } catch (error) {
      return toolFailure(error);
    }
  }

  return null;
}

function assessCommandRisk(command) {
  const text = String(command || '').toLowerCase();
  const reasons = [];
  let level = 'low';

  const highPatterns = [
    /\brm\s+(-[^\s]*r|-[^\s]*f|-[^\s]*rf|-[^\s]*fr)\b/,
    /\brmdir\b/,
    /\bdel\s+\/[sq]\b/,
    /\bformat\b/,
    /\bdrop\s+(database|table)\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\breg\s+(delete|add)\b/,
    /\bpowershell\b.*\b(remove-item|invoke-expression|iex)\b/,
    /\bcurl\b.*\|\s*(sh|bash|powershell)/,
    /\bwget\b.*\|\s*(sh|bash|powershell)/
  ];
  const mediumPatterns = [
    /\bnpm\s+(install|i|update)\b/,
    /\bpnpm\s+(install|add|update)\b/,
    /\byarn\s+(install|add|upgrade)\b/,
    /\bgit\s+(checkout|clean|reset|rebase)\b/,
    /\bmv\b|\bmove\b|\bcp\b|\bcopy\b/
  ];

  if (highPatterns.some(pattern => pattern.test(text))) {
    level = 'high';
    reasons.push('命令可能删除文件、修改系统或执行远程脚本。');
  } else if (mediumPatterns.some(pattern => pattern.test(text))) {
    level = 'medium';
    reasons.push('命令可能修改依赖、文件或 Git 工作区。');
  }

  if (!reasons.length) {
    reasons.push('命令将在项目根目录执行。');
  }

  return { level, reasons };
}

function buildUnifiedDiff(filePath, oldStr, newStr) {
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);
  const max = Math.max(oldLines.length, newLines.length);
  const out = [];
  for (let i = 0; i < max; i += 1) {
    const a = oldLines[i];
    const b = newLines[i];
    if (a === b) {
      out.push(` ${a ?? ''}`);
    } else {
      if (a !== undefined) out.push(`-${a}`);
      if (b !== undefined) out.push(`+${b}`);
    }
  }
  return [`--- ${filePath}`, `+++ ${filePath}`, ...out].join('\n');
}

function summarizeDiff(oldStr, newStr) {
  const oldLines = oldStr.split(/\r?\n/).length;
  const newLines = newStr.split(/\r?\n/).length;
  return { added: Math.max(0, newLines - oldLines), removed: Math.max(0, oldLines - newLines) };
}

function extractSymbols(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  const symbols = [];
  const lines = String(content || '').split(/\r?\n/);
  const ignoredNames = new Set(['if', 'for', 'while', 'switch', 'catch', 'function']);

  const patterns = [
    { kind: 'class', re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'interface', re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'type', re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: 'function', re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { kind: 'function', re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ },
    { kind: 'function', re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*:\s*React\.FC\b/ },
    { kind: 'method', re: /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/ }
  ];
  const pythonPatterns = [
    { kind: 'class', re: /^\s*class\s+([A-Za-z_][\w]*)/ },
    { kind: 'function', re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/ }
  ];
  const activePatterns = ['.py'].includes(ext) ? pythonPatterns : patterns;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of activePatterns) {
      const match = line.match(pattern.re);
      if (match) {
        if (ignoredNames.has(match[1])) break;
        symbols.push({
          name: match[1],
          kind: pattern.kind,
          line: i + 1,
          signature: line.trim().slice(0, 180)
        });
        break;
      }
    }
  }

  return symbols;
}

const TOOLS = {
  get_file_outline: getFileOutlineTool,
  get_git_status: getGitStatusTool,
  read_file: readFileTool,
  read_file_range: readFileRangeTool,
  list_files: listFilesTool,
  search_code: searchCodeTool,
  search_symbols: searchSymbolsTool,
  get_project_info: getProjectInfoTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  run_command: runCommandTool
};

function listTools() {
  return Object.values(TOOLS).map(tool => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    parameters: tool.parameters
  }));
}

function getTool(name) {
  return TOOLS[name] || null;
}

module.exports = { TOOLS, assessCommandRisk, getTool, listTools, previewToolChange };

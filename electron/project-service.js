const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const IGNORED_DIRS = new Set([
  '.git',
  '.idea',
  '.next',
  '.turbo',
  '.vite',
  '.vscode',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release'
]);

const TEXT_EXTENSIONS = new Set([
  '.bat',
  '.c',
  '.cmd',
  '.cpp',
  '.cs',
  '.css',
  '.env',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
]);

const PROJECT_MEMORY_DIR = '.fullstack-agent';
const PROJECT_MEMORY_FILE = 'memory.md';

const ALLOWED_DOTFILES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env',
  '.env.example',
  '.eslintignore',
  '.eslintrc',
  '.gitignore',
  '.npmrc',
  '.prettierignore',
  '.prettierrc'
]);

function ensureInsideRoot(root, relativePath = '.') {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, targetPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('目标路径不在当前项目目录内。');
  }

  return targetPath;
}

function normalizeProjectPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  return TEXT_EXTENSIONS.has(ext)
    || base === 'dockerfile'
    || base === 'makefile'
    || base.startsWith('.env');
}

async function listProjectFiles(root, options = {}) {
  const rootPath = ensureInsideRoot(root);
  const maxFiles = options.maxFiles || 800;
  const maxDepth = options.maxDepth || 7;
  const files = [];

  async function walk(currentDir, depth) {
    if (files.length >= maxFiles || depth > maxDepth) return;

    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith('.') && !ALLOWED_DOTFILES.has(entry.name) && !entry.name.startsWith('.env')) continue;

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeProjectPath(path.relative(rootPath, absolutePath));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(absolutePath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = await fsp.stat(absolutePath);
      files.push({
        path: relativePath,
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        writable: isTextFile(entry.name) && stat.size <= 1024 * 1024
      });
    }
  }

  await walk(rootPath, 0);
  return files;
}

async function readProjectFile(root, filePath) {
  const absolutePath = ensureInsideRoot(root, filePath);
  const stat = await fsp.stat(absolutePath);

  if (!stat.isFile()) {
    throw new Error('只能读取文件。');
  }

  if (!isTextFile(absolutePath)) {
    throw new Error('暂不支持读取该类型文件。');
  }

  if (stat.size > 1024 * 1024) {
    throw new Error('文件超过 1MB，请先拆分后再编辑。');
  }

  return fsp.readFile(absolutePath, 'utf-8');
}

async function writeProjectFile(root, filePath, content) {
  const absolutePath = ensureInsideRoot(root, filePath);

  if (!isTextFile(absolutePath)) {
    throw new Error('暂不支持写入该类型文件。');
  }

  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, content, 'utf-8');

  const stat = await fsp.stat(absolutePath);
  return {
    path: normalizeProjectPath(path.relative(path.resolve(root), absolutePath)),
    name: path.basename(absolutePath),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    writable: true
  };
}

async function readPackageScripts(root) {
  const packagePath = ensureInsideRoot(root, 'package.json');

  if (!fs.existsSync(packagePath)) {
    return {};
  }

  const packageJson = JSON.parse(await fsp.readFile(packagePath, 'utf-8'));
  return packageJson.scripts || {};
}

async function readProjectMemory(root) {
  const memoryPath = ensureInsideRoot(root, path.join(PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILE));
  try {
    return await fsp.readFile(memoryPath, 'utf-8');
  } catch {
    return '';
  }
}

async function saveProjectMemory(root, content) {
  const memoryPath = ensureInsideRoot(root, path.join(PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILE));
  const text = String(content || '').slice(0, 20000);
  await fsp.mkdir(path.dirname(memoryPath), { recursive: true });
  await fsp.writeFile(memoryPath, text, 'utf-8');
  return { path: normalizeProjectPath(path.relative(path.resolve(root), memoryPath)), size: Buffer.byteLength(text, 'utf-8') };
}

async function readGitStatus(root) {
  const rootPath = ensureInsideRoot(root);
  const status = await execGit(rootPath, ['status', '--short']);
  const branch = await execGit(rootPath, ['branch', '--show-current']);
  const diffStat = await execGit(rootPath, ['diff', '--stat']);

  return {
    success: status.success,
    branch: branch.stdout.trim(),
    status: status.stdout.trim(),
    diffStat: diffStat.stdout.trim(),
    error: status.error || branch.error || diffStat.error || null
  };
}

function execGit(cwd, args) {
  return new Promise(resolve => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout || '',
          stderr: stderr || '',
          error: error ? (stderr || error.message) : null
        });
      }
    );
  });
}

async function createProject(parentDir, name) {
  if (!name || !name.trim()) {
    throw new Error('项目名称不能为空。');
  }

  if (/[<>:"/\\|?*]/.test(name)) {
    throw new Error('项目名称包含非法字符。');
  }

  const parentPath = path.resolve(parentDir);
  const rootPath = path.resolve(parentPath, name.trim());
  const relative = path.relative(parentPath, rootPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('项目路径不合法。');
  }

  if (fs.existsSync(rootPath) && (await fsp.readdir(rootPath)).length > 0) {
    throw new Error('目标项目目录已存在且不为空。');
  }

  await fsp.mkdir(path.join(rootPath, 'src'), { recursive: true });
  await fsp.mkdir(path.join(rootPath, 'tests'), { recursive: true });

  const packageName = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-project';

  await fsp.writeFile(
    path.join(rootPath, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.1.0',
      type: 'module',
      scripts: {
        start: 'node src/index.js',
        test: 'node --test tests/*.test.js'
      }
    }, null, 2),
    'utf-8'
  );

  await fsp.writeFile(
    path.join(rootPath, 'src', 'index.js'),
    "export function greet(name = 'world') {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet());\n",
    'utf-8'
  );

  await fsp.writeFile(
    path.join(rootPath, 'tests', 'index.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/index.js';\n\ntest('greet returns a friendly message', () => {\n  assert.equal(greet('Agent'), 'Hello, Agent!');\n});\n",
    'utf-8'
  );

  await fsp.writeFile(
    path.join(rootPath, 'README.md'),
    `# ${name.trim()}\n\n使用 FullStack Agent 创建的项目。\n\n## Scripts\n\n- \`npm start\`\n- \`npm test\`\n`,
    'utf-8'
  );

  return rootPath;
}

async function runProjectScript(root, scriptName) {
  const scripts = await readPackageScripts(root);

  if (!scripts[scriptName]) {
    throw new Error(`package.json 中不存在脚本：${scriptName}`);
  }

  const rootPath = ensureInsideRoot(root);
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm', 'run', scriptName]
    : ['run', scriptName];

  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: rootPath,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          code: error?.code ?? 0,
          stdout,
          stderr,
          output: [stdout, stderr].filter(Boolean).join('\n')
        });
      }
    );
  });
}

module.exports = {
  createProject,
  ensureInsideRoot,
  isTextFile,
  listProjectFiles,
  readGitStatus,
  readPackageScripts,
  readProjectFile,
  readProjectMemory,
  runProjectScript,
  saveProjectMemory,
  writeProjectFile
};

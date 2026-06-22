/**
 * 代码库索引:在项目根目录上做一次轻量扫描,产出一段可注入到 system prompt 的摘要。
 * - 文件树(限制条数)
 * - package.json 关键信息
 * - 关键源文件头注释 / README
 * - 已识别语言/框架指纹
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ensureInsideRoot, listProjectFiles, readProjectScriptsSafe } = require('./compat');

async function buildIndex(root) {
  const rootPath = ensureInsideRoot(root);
  const files = await listProjectFiles(rootPath, { maxFiles: 600 });

  const tree = files.slice(0, 250).map(file => `- ${file.path}`).join('\n');

  const pkgPath = path.join(rootPath, 'package.json');
  let pkg = null;
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    } catch {
      pkg = null;
    }
  }

  const frameworks = detectFrameworks(pkg, files);
  const readme = await safeReadText(path.join(rootPath, 'README.md'), 1200);
  const memory = await safeReadText(path.join(rootPath, '.fullstack-agent', 'memory.md'), 2000);
  const sampleFiles = pickSampleFiles(files, rootPath, 4);

  return {
    root: rootPath,
    tree,
    fileCount: files.length,
    pkg,
    scripts: pkg?.scripts || {},
    dependencies: { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) },
    frameworks,
    readme,
    memory,
    samples: sampleFiles
  };
}

function detectFrameworks(pkg, files) {
  const found = new Set();
  const allDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const depMap = {
    react: 'React',
    next: 'Next.js',
    vue: 'Vue',
    nuxt: 'Nuxt',
    'react-dom': 'React',
    express: 'Express',
    fastify: 'Fastify',
    koa: 'Koa',
    nestjs: 'NestJS',
    '@nestjs/core': 'NestJS',
    electron: 'Electron',
    vite: 'Vite',
    webpack: 'Webpack',
    typescript: 'TypeScript',
    tailwindcss: 'Tailwind',
    'element-plus': 'Element Plus',
    antd: 'Ant Design'
  };
  for (const dep of Object.keys(allDeps)) {
    if (depMap[dep]) found.add(depMap[dep]);
  }
  const pathSet = new Set(files.map(file => file.path));
  if (pathSet.has('angular.json')) found.add('Angular');
  if (pathSet.has('pubspec.yaml')) found.add('Flutter');
  if (pathSet.has('Cargo.toml')) found.add('Rust');
  if (pathSet.has('go.mod')) found.add('Go');
  if (pathSet.has('pom.xml')) found.add('Java/Maven');
  return Array.from(found);
}

async function safeReadText(filePath, limit) {
  try {
    const text = await fsp.readFile(filePath, 'utf-8');
    return text.length > limit ? `${text.slice(0, limit)}\n... (已截断)` : text;
  } catch {
    return null;
  }
}

async function pickSampleFiles(files, rootPath, count) {
  const candidates = files
    .filter(file => file.writable && file.size < 16 * 1024)
    .sort((a, b) => a.size - b.size)
    .slice(0, 40);
  const preferred = candidates.filter(file =>
    /(^|\/)(index|main|app|server|greet|add)\.(js|ts|jsx|tsx)$/i.test(file.path)
  );
  const picked = (preferred.length ? preferred : candidates).slice(0, count);
  const samples = [];
  for (const file of picked) {
    const text = await safeReadText(path.join(rootPath, file.path), 1500);
    if (text) samples.push({ path: file.path, content: text });
  }
  return samples;
}

function indexToSystemPrompt(index, options = {}) {
  const lines = [];
  lines.push('# 项目上下文(由 Agent 引擎自动生成)');
  lines.push(`项目根: ${index.root}`);
  if (index.pkg?.name) lines.push(`项目名: ${index.pkg.name}${index.pkg.version ? ` @ ${index.pkg.version}` : ''}`);
  if (index.frameworks.length) lines.push(`已识别框架/语言: ${index.frameworks.join(', ')}`);
  lines.push(`文件总数(已忽略 node_modules 等): ${index.fileCount}`);
  if (index.scripts && Object.keys(index.scripts).length) {
    lines.push(`npm scripts: ${Object.keys(index.scripts).join(', ')}`);
  }
  if (index.dependencies && Object.keys(index.dependencies).length) {
    const depList = Object.keys(index.dependencies).slice(0, 30).join(', ');
    lines.push(`主要依赖: ${depList}${Object.keys(index.dependencies).length > 30 ? ' ...' : ''}`);
  }
  if (index.readme) {
    lines.push('\n## README 摘要');
    lines.push(index.readme);
  }
  if (index.memory) {
    lines.push('\n## 项目记忆');
    lines.push(index.memory);
  }
  lines.push('\n## 文件结构(前 250 条)');
  lines.push(index.tree || '(空)');
  if (index.samples?.length) {
    lines.push('\n## 关键文件样例');
    for (const sample of index.samples) {
      lines.push(`\n### ${sample.path}`);
      lines.push('```');
      lines.push(sample.content);
      lines.push('```');
    }
  }
  return lines.join('\n');
}

module.exports = { buildIndex, indexToSystemPrompt };

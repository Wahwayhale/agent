/**
 * Agent 引擎烟雾测试
 *  1. 文本协议解析器
 *  2. 代码库索引器
 *  3. function calling 协议下 Agent 跑通
 *  4. 文本协议降级
 *  5. 工具注册表
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const fakeScenarios = { current: null };

function makeFakeAdapter(scenario) {
  return {
    async *chatStream(messages /*, options */) {
      if (scenario === 'function_calling') {
        // 第一轮只发 read_file
        yield { type: 'tool_call', toolCall: { id: 'call-1', name: 'read_file', arguments: JSON.stringify({ path: 'src/index.js' }) } };
        yield { type: 'text', content: '我先读一下 src/index.js' };
        return;
      }
      if (scenario === 'text') {
        const lastTool = [...messages].reverse().find(m => m.role === 'user' && m.content.startsWith('[工具'));
        if (!lastTool) {
          yield { type: 'text', content: '我先读一下文件。\n<tool name="read_file" path="src/index.js" />\n好的我看完了。' };
          return;
        }
        yield { type: 'text', content: '我创建一个新文件:\n<tool name="write_file" path="src/new.js" ><content>export const x = 1;\n</content></tool>\n完成!' };
        return;
      }
      yield { type: 'text', content: 'noop' };
    }
  };
}

function makeFakeAdapterClass() {
  return function FakeAdapter() {
    this.chat = async () => ({ content: '', toolCalls: [] });
    this.buildRequestBody = () => ({});
    this.chatStream = async function* (messages, options) {
      const scenario = fakeScenarios.current;
      const fake = makeFakeAdapter(scenario);
      yield* fake.chatStream.call(this, messages, options);
    };
  };
}

const { AgentEngine } = require('./engine');
const { buildIndex, indexToSystemPrompt } = require('./indexer');
const { StreamingTextParser } = require('./text-protocol');
const { listTools } = require('./tools');

const FakeAdapterClass = makeFakeAdapterClass();

async function withTempDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function collectEvents() {
  const events = [];
  return {
    push: e => events.push(e),
    all: () => events,
    types: () => events.map(e => e.type)
  };
}

let testsRun = 0;
let testsPassed = 0;
function assert(condition, message) {
  testsRun += 1;
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    testsPassed += 1;
    console.log(`✓ ${message}`);
  }
}

(async () => {
  // === 1. StreamingTextParser 基础 ===
  console.log('\n[文本协议解析器]');
  const p1 = new StreamingTextParser();
  const r1 = p1.feed('我先看看<tool name="read_file" path="x.js" />文件');
  const f1 = p1.flush();
  assert(r1.concat(f1).some(e => e.type === 'text' && e.content.includes('我先看看')), '解析器抽出正文');
  assert(r1.concat(f1).some(e => e.type === 'tool' && e.tool.name === 'read_file'), '解析器抽出工具调用');

  const p2 = new StreamingTextParser();
  const r2 = p2.feed('正文<tool name="write_file" path="a.js" ><content>line1\nline2\n</content></tool>尾');
  const f2 = p2.flush();
  const tools = r2.concat(f2).filter(e => e.type === 'tool');
  assert(tools.length === 1 && tools[0].tool.args.path === 'a.js', '自闭合 + 带 content 混排解析');
  assert(tools[0].tool.args.content.includes('line2'), 'content 体被正确捕获');

  // === 2. 索引器 ===
  console.log('\n[代码库索引器]');
  await withTempDir('agent-test-index-', async dir => {
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'demo',
      version: '0.1.0',
      scripts: { test: 'node --test' },
      dependencies: { react: '^18', express: '^4' }
    }));
    await fsp.writeFile(path.join(dir, 'src', 'index.js'), "export const x = 1;\n");
    await fsp.writeFile(path.join(dir, 'README.md'), '# Demo\n\n测试项目\n');
    const index = await buildIndex(dir);
    assert(index.frameworks.includes('React') && index.frameworks.includes('Express'), '识别框架');
    assert(index.tree.includes('src/index.js'), '文件树包含目标');
    assert(index.scripts.test === 'node --test', 'scripts 解析');
    const sys = indexToSystemPrompt(index);
    assert(sys.includes('React') && sys.includes('Express'), 'system prompt 注入框架');
  });

  // === 3. function calling 协议下 Agent 跑通 ===
  console.log('\n[Agent 引擎 - function calling 协议]');
  fakeScenarios.current = 'function_calling';
  await withTempDir('agent-test-fc-', async dir => {
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'src', 'index.js'), 'export const greet = () => "hi";\n');

    const events = collectEvents();
    const engine = new AgentEngine({
      config: { provider: 'mock', apiKey: 'k', model: 'm', maxTokens: 1024, capabilities: ['工具调用'] },
      projectRoot: dir,
      onEvent: events.push,
      adapter: new FakeAdapterClass()
    });
    await engine.run('读 src/index.js 后告诉我要怎么扩展');
    const types = events.types();
    assert(types.includes('start'), '发出 start 事件');
    assert(types.includes('tool_call'), '发出 tool_call 事件');
    assert(types.includes('tool_result'), '发出 tool_result 事件');
    assert(types[types.length - 1] === 'done' || types[types.length - 1] === 'error', '最终以 done/error 结束');
  });

  // === 4. 文本协议降级 ===
  console.log('\n[Agent 引擎 - 文本协议降级]');
  fakeScenarios.current = 'text';
  await withTempDir('agent-test-text-', async dir => {
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'src', 'index.js'), 'export const greet = () => "hi";\n');

    const events = collectEvents();
    const engine = new AgentEngine({
      config: { provider: 'mock', apiKey: 'k', model: 'm', maxTokens: 1024 },
      projectRoot: dir,
      onEvent: events.push,
      adapter: new FakeAdapterClass()
    });
    engine.supportsFunctionCalling = false;
    await engine.run('把 src/index.js 改造成新文件 src/new.js');
    const types = events.types();
    assert(types.filter(t => t === 'tool_call').length >= 2, '文本协议触发 2 次工具调用');
    assert(types.includes('tool_result'), '工具执行返回结果');
    const fileExists = fs.existsSync(path.join(dir, 'src', 'new.js'));
    assert(fileExists, 'write_file 工具实际写入了文件');
  });
  fakeScenarios.current = null;

  // === 5. 工具列表 ===
  console.log('\n[工具注册表]');
  const registered = listTools();
  const names = registered.map(t => t.name);
  assert(names.includes('read_file'), '注册了 read_file');
  assert(names.includes('write_file'), '注册了 write_file');
  assert(names.includes('edit_file'), '注册了 edit_file');
  assert(names.includes('list_files'), '注册了 list_files');
  assert(names.includes('search_code'), '注册了 search_code');
  assert(names.includes('run_command'), '注册了 run_command');
  assert(names.includes('get_project_info'), '注册了 get_project_info');

  console.log(`\n通过: ${testsPassed}/${testsRun}`);
  if (testsRun !== testsPassed) process.exit(1);
})().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});

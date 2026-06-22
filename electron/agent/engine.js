/**
 * Agent 引擎:主循环
 *
 * 输入: userMessage, config, projectRoot
 * 输出: 通过 onEvent 推流式事件给调用方
 *
 * 协议选择:
 *   1) 优先 OpenAI 兼容 function calling
 *   2) 模型 capabilities 没标 '工具调用' / '函数调用' / 'Agent' → 自动降级到 XML 文本协议
 *
 * 事件:
 *   start | text | reasoning | tool_call | tool_result | done | error | aborted
 */

const { APIAdapter } = require('../api-adapter/adapter');
const { PROVIDERS } = require('../api-adapter/providers');
const { assessCommandRisk, listTools, getTool, previewToolChange } = require('./tools');
const { buildIndex, indexToSystemPrompt } = require('./indexer');
const { StreamingTextParser, describeToolsForPrompt } = require('./text-protocol');

const TOOL_CALLING_KEYWORDS = ['工具调用', '函数调用', 'Agent', 'agent', 'tool', 'function calling'];

const MAX_ITERATIONS = 12;
const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_IDLE_ROUNDS = 1; // 连续无工具调用的轮数上限
const MAX_REPEAT_ROUNDS = 2; // 连续重复工具调用的轮数上限

class AgentEngine {
  constructor({ config, projectRoot, onEvent, signal, maxIterations = MAX_ITERATIONS, adapter, requestApproval }) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.onEvent = onEvent || (() => {});
    this.signal = signal || new AbortController().signal;
    this.maxIterations = maxIterations;
    this.adapter = adapter || new APIAdapter(config);
    this.requestApproval = requestApproval || (async () => true);
    this.supportsFunctionCalling = detectFunctionCallingSupport(config);
    this.conversation = [];
    this.index = null;
    this.iteration = 0;
    this.usedTools = [];
    this.idleRounds = 0;
    this.lastToolSignature = null;
    this.repeatCount = 0;
  }

  async run(userMessage) {
    try {
      this.emit({ type: 'start', projectRoot: this.projectRoot, protocol: this.supportsFunctionCalling ? 'function_calling' : 'text' });

      this.index = await buildIndex(this.projectRoot);
      this.conversation.push({ role: 'user', content: userMessage });

      while (this.iteration < this.maxIterations) {
        if (this.signal.aborted) {
          this.emit({ type: 'aborted' });
          return;
        }
        this.iteration += 1;
        this.emit({ type: 'thinking', iteration: this.iteration, protocol: this.supportsFunctionCalling ? 'function_calling' : 'text' });

        const messages = this.buildMessages();
        const tools = listTools();

        const toolsBefore = this.usedTools.length;
        if (this.supportsFunctionCalling) {
          await this.runFunctionCallingTurn(messages, tools);
        } else {
          await this.runTextProtocolTurn(messages, tools);
        }
        const toolsAfter = this.usedTools.length;
        const toolsThisRound = toolsAfter - toolsBefore;

        // 检测1: 连续无工具调用 → 模型已给出最终答复
        if (toolsThisRound === 0) {
          this.idleRounds += 1;
          if (this.idleRounds >= MAX_IDLE_ROUNDS) {
            this.emit({ type: 'done', iterations: this.iteration, tools: this.usedTools });
            return;
          }
        } else {
          this.idleRounds = 0;
        }

        // 检测2: 连续重复相同工具调用 → 循环检测
        const currentToolSignature = toolsThisRound > 0
          ? this.usedTools.slice(-toolsThisRound).map(t => `${t.name}:${JSON.stringify(t.args)}`).join('|')
          : null;

        if (currentToolSignature && currentToolSignature === this.lastToolSignature) {
          this.repeatCount += 1;
          if (this.repeatCount >= MAX_REPEAT_ROUNDS) {
            this.emit({ type: 'text', content: `\n\n[Agent 自动停止: 检测到连续 ${MAX_REPEAT_ROUNDS} 轮相同的工具调用,可能存在循环]` });
            this.emit({ type: 'done', iterations: this.iteration, tools: this.usedTools });
            return;
          }
        } else {
          this.repeatCount = 0;
        }
        this.lastToolSignature = currentToolSignature;
      }

      this.emit({ type: 'error', error: `已达最大迭代次数 ${this.maxIterations},停止 Agent` });
    } catch (error) {
      console.log('[Agent] CAUGHT ERROR:', error?.message, error?.stack?.slice(0, 500));
      this.emit({ type: 'error', error: error.message || String(error) });
    }
  }

  buildMessages() {
    const systemParts = [
      '你是 FullStack Agent Desktop 中的 AI 编程 Agent。',
      '你可以在用户的项目目录中读取文件、修改文件、运行命令、搜索代码。',
      '当用户的请求涉及代码改动时,先列出计划,再通过工具一步步落地。',
      '优先使用 search_symbols、get_file_outline 和 read_file_range 精确定位代码,避免无谓读取大文件。',
      '如果运行测试或构建命令失败,请阅读错误输出,修改代码后重新验证;最多做少量针对性修复,不要无限循环。',
      '每次工具调用前用一两句中文简述目的即可,不要长篇大论。',
      '如果信息已经足够,直接给出最终答复并停止调用工具。'
    ];

    if (this.index) {
      systemParts.push('\n' + indexToSystemPrompt(this.index));
    }

    if (!this.supportsFunctionCalling) {
      systemParts.push(describeToolsForPrompt(listTools()));
    }

    return [
      { role: 'system', content: systemParts.join('\n') },
      ...this.conversation
    ];
  }

  async runFunctionCallingTurn(messages, tools) {
    let assistantText = '';
    const toolCalls = [];
    const toolSchema = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    console.log(`[Agent] calling LLM, messages = ${messages.length} tools = ${toolSchema.length}`);
    for await (const event of this.adapter.chatStream(messages, { tools: toolSchema, signal: this.signal })) {
      if (event.type === 'text' && event.content) {
        assistantText += event.content;
        this.emit({ type: 'text', content: event.content });
      } else if (event.type === 'reasoning' && event.content) {
        this.emit({ type: 'reasoning', content: event.content });
      } else if (event.type === 'tool_call' && event.toolCall) {
        toolCalls.push(event.toolCall);
      }
    }
    console.log(`[Agent] stream done, text len = ${assistantText.length} toolCalls = ${toolCalls.length}`);

    this.conversation.push({
      role: 'assistant',
      content: assistantText,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }))
    });

    if (toolCalls.length === 0) return;

    for (const tc of toolCalls) {
      const args = safeParseJSON(tc.arguments);
      this.emit({ type: 'tool_call', tool: { id: tc.id, name: tc.name, args } });
      const result = await this.executeTool(tc.name, args);
      const output = truncate(result.output || result.error || '', MAX_TOOL_RESULT_CHARS);
      this.emit({
        type: 'tool_result',
        toolCallId: tc.id,
        ok: result.ok,
        output,
        error: result.error,
        meta: result.meta
      });
      this.conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: output
      });
    }
  }

  async runTextProtocolTurn(messages, tools) {
    let assistantText = '';
    const parser = new StreamingTextParser();
    const toolCallsInTurn = [];

    for await (const event of this.adapter.chatStream(messages, { signal: this.signal })) {
      if (event.type === 'reasoning' && event.content) {
        this.emit({ type: 'reasoning', content: event.content });
        continue;
      }
      if (event.type === 'text' && event.content) {
        assistantText += event.content;
        const parsed = parser.feed(event.content);
        for (const piece of parsed) {
          if (piece.type === 'text') {
            this.emit({ type: 'text', content: piece.content });
          } else if (piece.type === 'tool') {
            const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const toolCall = { id, name: piece.tool.name, args: piece.tool.args };
            toolCallsInTurn.push(toolCall);
            this.emit({ type: 'tool_call', tool: { id, name: piece.tool.name, args: piece.tool.args } });
          }
        }
      }
    }

    for (const piece of parser.flush()) {
      if (piece.type === 'text') {
        this.emit({ type: 'text', content: piece.content });
      } else if (piece.type === 'tool') {
        const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const toolCall = { id, name: piece.tool.name, args: piece.tool.args };
        toolCallsInTurn.push(toolCall);
        this.emit({ type: 'tool_call', tool: { id, name: piece.tool.name, args: piece.tool.args } });
      }
    }

    // 清理 assistantText 中可能残留的 XML 标签(它们已经被工具消费了)
    const cleanedText = stripToolTags(assistantText);
    this.conversation.push({ role: 'assistant', content: cleanedText });

    if (toolCallsInTurn.length === 0) return;

    // 文本协议没有 tool_call_id,我们用"观察者"消息模拟 tool 结果
    for (const tc of toolCallsInTurn) {
      const result = await this.executeTool(tc.name, tc.args);
      const output = truncate(result.output || result.error || '', MAX_TOOL_RESULT_CHARS);
      this.emit({
        type: 'tool_result',
        toolCallId: tc.id,
        ok: result.ok,
        output,
        error: result.error,
        meta: result.meta
      });
      this.conversation.push({
        role: 'user',
        content: `[工具 ${tc.name} 执行结果]\n${output}`
      });
    }
  }

  async executeTool(name, args) {
    const tool = getTool(name);
    this.usedTools.push({ name, args, iteration: this.iteration });
    if (!tool) return { ok: false, error: `未知工具: ${name}` };
    try {
      const ctx = { projectRoot: this.projectRoot, signal: this.signal };
      const approved = await this.ensureToolApproved(tool, args, ctx);
      if (!approved.ok) return approved;
      const result = await tool.execute(args || {}, ctx);
      return result;
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }

  async ensureToolApproved(tool, args, ctx) {
    if (tool.risk === 'write') {
      const preview = await previewToolChange(tool.name, args || {}, ctx);
      if (preview && !preview.ok) return preview;

      const meta = preview?.meta || {};
      const approved = await this.requestApproval({
        kind: 'write',
        toolName: tool.name,
        path: meta.path || args?.path,
        isNew: !!meta.isNew,
        diff: meta.diff || '',
        summary: meta.summary || null
      });
      if (!approved) {
        return { ok: false, error: `用户拒绝写入: ${args?.path || tool.name}` };
      }
      return { ok: true };
    }

    if (tool.risk === 'shell') {
      const risk = assessCommandRisk(args?.command || '');
      const approved = await this.requestApproval({
        kind: 'shell',
        toolName: tool.name,
        command: args?.command || '',
        timeoutMs: args?.timeout_ms || 60000,
        riskLevel: risk.level,
        reasons: risk.reasons
      });
      if (!approved) {
        return { ok: false, error: `用户拒绝执行命令: ${args?.command || ''}` };
      }
    }

    return { ok: true };
  }

  emit(event) {
    try {
      if (event.type === 'error') {
        console.log('[Agent] emit: error', event.error);
      } else if (event.type === 'text') {
        // 文本内容太长,只打字节数
        console.log(`[Agent] emit: text +${(event.content || '').length}B`);
      } else if (event.type === 'tool_call') {
        console.log(`[Agent] emit: tool_call ${event.tool?.name} id=${event.tool?.id}`);
      } else if (event.type === 'tool_result') {
        console.log(`[Agent] emit: tool_result ok=${event.ok} +${(event.output || '').length}B`);
      } else {
        console.log(`[Agent] emit: ${event.type}`);
      }
      this.onEvent(event);
    } catch (error) {
      console.log('[Agent] emit ERROR:', error.message);
    }
  }
}

function detectFunctionCallingSupport(config) {
  const provider = PROVIDERS[config.provider];
  if (!provider) return true; // 未知 provider,默认尝试 function calling
  const model = provider.models.find(m => m.id === config.model);
  if (!model) return true;
  const caps = (model.capabilities || []).map(c => c.toLowerCase());
  return caps.some(cap => TOOL_CALLING_KEYWORDS.some(keyword => cap.includes(keyword.toLowerCase())));
}

function safeParseJSON(text) {
  if (!text) return {};
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (已截断,共 ${text.length} 字符)`;
}

function stripToolTags(text) {
  if (!text) return '';
  return text
    .replace(/<tool\b[^>]*>[\s\S]*?<\/tool>/g, '')
    .replace(/<tool\b[^>]*\/>/g, '')
    .trim();
}

module.exports = { AgentEngine };

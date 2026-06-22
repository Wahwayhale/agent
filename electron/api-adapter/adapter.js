const { PROVIDERS } = require('./providers');

class APIAdapter {
  constructor(config) {
    this.config = config;
    this.provider = PROVIDERS[config.provider];

    if (!this.provider) {
      throw new Error(`未知的 API 服务商：${config.provider}`);
    }
  }

  getBaseURL() {
    if (this.provider.billingModes) {
      const billingMode = this.provider.billingModes.find(
        mode => mode.id === this.config.billingMode
      );
      return billingMode ? billingMode.baseURL : this.provider.billingModes[0].baseURL;
    }

    return this.provider.baseURL;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.config.provider === 'claude') {
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  getModelMaxOutput() {
    // 硬上限兜底,防止用户填写超大值
    const HARD_LIMIT = 131072;
    const models = this.provider?.models || [];
    const matched = models.find(m => m.id === this.config.model);
    if (matched && typeof matched.maxOutput === 'number' && matched.maxOutput > 0) {
      return Math.min(matched.maxOutput, HARD_LIMIT);
    }
    return HARD_LIMIT;
  }

  clampMaxTokens(value) {
    const cap = this.getModelMaxOutput();
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return cap;
    }
    return Math.min(value, cap);
  }

  buildRequestBody(messages, options = {}) {
    const requestedMaxTokens = options.maxTokens || this.config.maxTokens || 4096;
    const maxTokens = this.clampMaxTokens(requestedMaxTokens);
    const body = {
      model: this.config.model,
      messages,
      temperature: options.temperature ?? this.config.temperature ?? 1,
      stream: options.stream || false
    };

    if (this.config.provider === 'mimo') {
      body.max_completion_tokens = maxTokens;
      body.top_p = options.topP ?? this.config.topP ?? 0.95;
    } else {
      body.max_tokens = maxTokens;
    }

    if (Array.isArray(options.tools) && options.tools.length > 0) {
      body.tools = options.tools;
      if (options.toolChoice) {
        body.tool_choice = options.toolChoice;
      } else {
        body.tool_choice = 'auto';
      }
    }

    return body;
  }

  async chat(messages, options = {}) {
    const baseURL = this.getBaseURL();
    const headers = this.getHeaders();
    const body = this.buildRequestBody(messages, { ...options, stream: false });
    const url = `${baseURL}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[API Error]', {
        provider: this.config.provider,
        model: this.config.model,
        url,
        status: response.status,
        statusText: response.statusText,
        requestBody: body,
        errorResponse: error
      });
      throw new Error(`API 调用失败：${response.status} - ${error.error?.message || error.message || JSON.stringify(error)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0] || {};
    const message = choice.message || {};
    return {
      content: message.content || '',
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      reasoning: message.reasoning_content || null,
      raw: data
    };
  }

  async *chatStream(messages, options = {}) {
    const baseURL = this.getBaseURL();
    const headers = this.getHeaders();
    const body = this.buildRequestBody(messages, { ...options, stream: true });
    const url = `${baseURL}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal
    });

   if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[API Error]', {
        provider: this.config.provider,
        model: this.config.model,
        url,
        status: response.status,
        statusText: response.statusText,
        requestBody: body,
        errorResponse: error
      });
      throw new Error(`API 调用失败：${response.status} - ${error.error?.message || error.message || JSON.stringify(error)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallBuffers = new Map();
    let lastToolId = null;

    const parseLine = (line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || !trimmedLine.startsWith('data:')) return { done: false, content: '', toolDeltas: [], reasoning: '', usage: null };

      const payload = trimmedLine.replace(/^data:\s*/, '');
      if (payload === '[DONE]') return { done: true, content: '', toolDeltas: [], reasoning: '', usage: null };

      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta || {};
        const content = delta.content || '';
        const reasoning = delta.reasoning_content || '';
        const toolDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        const usage = parsed.usage || null;
        return { done: false, content, toolDeltas, reasoning, usage };
      } catch {
        return { done: false, content: '', toolDeltas: [], reasoning: '', usage: null };
      }
    };

    const getOrCreateBuffer = (rawId, name) => {
      // 如果 delta 没带 id,挂到上一个 tool call(同一函数的续传)
      const id = rawId || lastToolId || `fallback-${toolCallBuffers.size}`;
      if (!toolCallBuffers.has(id)) {
        toolCallBuffers.set(id, { id, name: name || '', arguments: '' });
      }
      return toolCallBuffers.get(id);
    };

    const handleToolDeltas = (deltas) => {
      for (const delta of deltas) {
        const hasName = typeof delta.function?.name === 'string' && delta.function.name.length > 0;
        const entry = getOrCreateBuffer(delta.id, hasName ? delta.function.name : null);
        if (hasName) entry.name = delta.function.name;
        if (typeof delta.function?.arguments === 'string') {
          entry.arguments += delta.function.arguments;
        }
        if (entry.id) lastToolId = entry.id;
      }
    };

    const flushToolCalls = function* () {
      for (const toolCall of toolCallBuffers.values()) {
        if (toolCall.name && toolCall.id) {
          yield { type: 'tool_call', toolCall };
        }
        // 缺 name 或 id 的丢弃(API 不接受)
      }
    };

    let lastUsage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed.done) {
          yield* flushToolCalls();
          if (lastUsage) {
            yield { type: 'usage', usage: lastUsage };
          }
          return;
        }
        if (parsed.reasoning) {
          yield { type: 'reasoning', content: parsed.reasoning };
        }
        if (parsed.content) {
          yield { type: 'text', content: parsed.content };
        }
        if (parsed.usage) {
          lastUsage = parsed.usage;
        }
        handleToolDeltas(parsed.toolDeltas);
      }
    }

    if (buffer.trim()) {
      const parsed = parseLine(buffer);
      if (parsed.done) {
        yield* flushToolCalls();
        if (lastUsage) {
          yield { type: 'usage', usage: lastUsage };
        }
        return;
      }
      if (parsed.content) yield { type: 'text', content: parsed.content };
      if (parsed.usage) lastUsage = parsed.usage;
      handleToolDeltas(parsed.toolDeltas);
    }

    yield* flushToolCalls();
    if (lastUsage) {
      yield { type: 'usage', usage: lastUsage };
    }
  }
}

module.exports = { APIAdapter };

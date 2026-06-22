/**
 * 文本协议降级:在不支持 OpenAI function calling 的模型上,要求它输出 XML 风格的工具调用。
 *
 * 支持的两种形态:
 *  1. 自闭合(参数都是简单字符串): <tool name="read_file" path="src/index.js" />
 *  2. 带 content 体(用于长内容):     <tool name="write_file" path="src/utils.js"><content>...</content></tool>
 *
 * StreamingTextParser 是一个增量解析器,每喂一段 text 就吐一次:
 *   { type: 'text', content }    - 普通正文
 *   { type: 'tool', tool: { name, args } } - 一个完整的工具调用
 */

class StreamingTextParser {
  constructor() {
    this.buffer = '';
    this.inTool = false;
    this.toolText = '';
    this.openTagRe = /<tool\b([^>]*?)\/?>/g;
  }

  feed(chunk) {
    this.buffer += chunk;
    const out = [];
    let cursor = 0;
    let safety = 0;

    while (safety++ < 200) {
      if (this.inTool) {
        // 在工具块内:寻找 </tool>
        const closeIdx = this.buffer.indexOf('</tool>', cursor);
        if (closeIdx === -1) {
          // 还没结束,缓存
          this.toolText += this.buffer.slice(cursor);
          this.buffer = '';
          return out;
        }
        this.toolText += this.buffer.slice(cursor, closeIdx);
        const parsed = parseToolBlock(this.toolText);
        if (parsed) {
          out.push({ type: 'tool', tool: parsed });
        }
        this.inTool = false;
        this.toolText = '';
        this.buffer = this.buffer.slice(closeIdx + '</tool>'.length);
        cursor = 0;
        continue;
      }

      const openMatch = this.openTagRe.exec(this.buffer);
      if (!openMatch) {
        // 没有更多工具调用,把所有正文推出去(保留最后一段可能的开头)
        const safeCut = findSafeCut(this.buffer);
        if (safeCut > 0) {
          out.push({ type: 'text', content: this.buffer.slice(0, safeCut) });
          this.buffer = this.buffer.slice(safeCut);
        }
        return out;
      }
      // 有匹配:把匹配之前的正文推出去
      if (openMatch.index > cursor) {
        out.push({ type: 'text', content: this.buffer.slice(cursor, openMatch.index) });
      }
      const fullTag = openMatch[0];
      const isSelfClose = fullTag.endsWith('/>');
      if (isSelfClose) {
        const parsed = parseToolBlock(openMatch[1]);
        if (parsed) out.push({ type: 'tool', tool: parsed });
        this.buffer = this.buffer.slice(openMatch.index + fullTag.length);
        this.openTagRe.lastIndex = 0;
        cursor = 0;
        continue;
      }
      // 非自闭合:开始累积工具体
      this.inTool = true;
      this.toolText = openMatch[1] || '';
      this.buffer = this.buffer.slice(openMatch.index + fullTag.length);
      this.openTagRe.lastIndex = 0;
      cursor = 0;
    }
    return out;
  }

  flush() {
    const out = [];
    if (this.inTool) {
      const parsed = parseToolBlock(this.toolText);
      if (parsed) out.push({ type: 'tool', tool: parsed });
      this.inTool = false;
      this.toolText = '';
    } else if (this.buffer) {
      out.push({ type: 'text', content: this.buffer });
      this.buffer = '';
    }
    return out;
  }
}

function findSafeCut(buffer) {
  // 留最后 64 字符以防半个标签
  if (buffer.length <= 64) return 0;
  const lastOpen = buffer.lastIndexOf('<tool');
  if (lastOpen === -1) return buffer.length;
  if (buffer.length - lastOpen < 64) return lastOpen;
  return buffer.length;
}

function parseToolBlock(headerAndBody) {
  // headerAndBody 形如 ' name="write_file" path="x"<content>...</content>'
  const contentStart = headerAndBody.indexOf('<content>');
  let headerPart = headerAndBody;
  let body = null;
  if (contentStart !== -1) {
    headerPart = headerAndBody.slice(0, contentStart);
    const bodyEnd = headerAndBody.lastIndexOf('</content>');
    if (bodyEnd === -1) {
      // 还没收完
      return null;
    }
    body = headerAndBody.slice(contentStart + '<content>'.length, bodyEnd);
  }
  const attrs = parseAttributes(headerPart);
  const name = attrs.name;
  if (!name) return null;
  const { name: _ignored, ...rest } = attrs;
  if (body !== null) rest.content = body;
  return { name, args: rest };
}

function parseAttributes(text) {
  const attrs = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    attrs[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

/**
 * 把工具 schema 转成给模型的自然语言描述(放在 system prompt 末尾)
 */
function describeToolsForPrompt(tools) {
  const lines = ['\n# 工具调用(文本协议)\n如果当前模型不支持原生 function calling,请用以下 XML 语法发起工具调用,不要同时输出解释文字:\n'];
  for (const tool of tools) {
    lines.push(`<tool name="${tool.name}" ${Object.entries(tool.parameters?.properties || {})
      .map(([k, v]) => `${k}="${exampleFor(v)}"`)
      .join(' ')} />`);
    if (tool.parameters?.properties?.content) {
      lines.push(`或(长内容):\n<tool name="${tool.name}" path="..."><content>\n...\n</content></tool>`);
    }
    lines.push(`用途: ${tool.description}\n`);
  }
  lines.push('完成所有工具调用后,再以普通文本给出最终答复。');
  return lines.join('\n');
}

function exampleFor(schema) {
  if (schema?.examples?.length) return schema.examples[0];
  if (schema?.type === 'string') return 'value';
  if (schema?.type === 'number') return '0';
  return '...';
}

module.exports = { StreamingTextParser, describeToolsForPrompt };

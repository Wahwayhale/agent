const https = require('https');
const http = require('http');

class ModelFetcher {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000;
  }

  async fetchModels(provider, apiKey = null, billingMode = null) {
    const cacheKey = `${provider.id}_${billingMode || 'default'}_${apiKey ? 'auth' : 'noauth'}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return { models: cached.models, fromCache: true };
    }

    if (['claude', 'minimax'].includes(provider.id)) {
      return { models: provider.models, fromCache: false };
    }

    try {
      const models = await this.fetchFromAPI(provider, apiKey, billingMode);

      this.cache.set(cacheKey, {
        models,
        timestamp: Date.now()
      });

      return { models, fromCache: false };
    } catch (error) {
      return { models: provider.models, fromCache: false, error: error.message };
    }
  }

  async fetchFromAPI(provider, apiKey = null, billingMode = null) {
    const baseURL = this.getBaseURL(provider, billingMode);

    return new Promise((resolve, reject) => {
      const url = new URL(`${baseURL}/models`);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const headers = {
        'Content-Type': 'application/json'
      };

      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        headers,
        timeout: 15000
      };

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error('API Key 无效或未提供。'));
              return;
            }

            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }

            const parsed = JSON.parse(data);

            if (parsed.data && Array.isArray(parsed.data)) {
              const models = parsed.data.map(model => ({
                id: model.id,
                name: model.id,
                context: this.estimateContext(model.id),
                maxOutput: this.estimateOutput(model.id),
                capabilities: this.guessCapabilities(model.id)
              }));
              resolve(models);
              return;
            }

            reject(new Error('模型接口响应格式不符合预期。'));
          } catch (error) {
            reject(new Error(`解析模型列表失败：${error.message}`));
          }
        });
      });

      req.on('error', reject);

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时。'));
      });

      req.end();
    });
  }

  getBaseURL(provider, billingMode = null) {
    if (provider.billingModes) {
      if (billingMode) {
        const mode = provider.billingModes.find(item => item.id === billingMode);
        if (mode) return mode.baseURL;
      }

      return provider.billingModes[0].baseURL;
    }

    return provider.baseURL;
  }

  estimateContext(modelId) {
    const id = modelId.toLowerCase();

    if (id.includes('10m') || id.includes('10000000')) return 10000000;
    if (id.includes('1m') || id.includes('1000k') || id.includes('1000000')) return 1000000;
    if (id.includes('256k') || id.includes('256000')) return 256000;
    if (id.includes('200k') || id.includes('200000')) return 200000;
    if (id.includes('128k') || id.includes('128000')) return 128000;
    if (id.includes('64k') || id.includes('64000')) return 64000;
    if (id.includes('32k') || id.includes('32000')) return 32000;
    if (id.includes('16k') || id.includes('16000')) return 16000;
    if (id.includes('8k') || id.includes('8000')) return 8000;

    if (id.includes('plus') || id.includes('max') || id.includes('pro')) return 128000;
    if (id.includes('lite') || id.includes('mini') || id.includes('flash')) return 32000;

    return 32000;
  }

  estimateOutput(modelId) {
    const id = modelId.toLowerCase();

    if (id.includes('o1')) return 100000;
    if (id.includes('r1')) return 8192;
    if (id.includes('pro') || id.includes('max')) return 8192;
    if (id.includes('lite') || id.includes('mini') || id.includes('flash')) return 4096;

    return 4096;
  }

  guessCapabilities(modelId) {
    const id = modelId.toLowerCase();
    const capabilities = ['文本生成'];

    if (id.includes('coder') || id.includes('code')) {
      capabilities.push('代码生成');
    }

    if (id.includes('reason') || id.includes('think') || id.includes('r1') || id.includes('o1')) {
      capabilities.push('深度推理');
    }

    if (id.includes('vision') || id.includes('omni') || id.includes('4o')) {
      capabilities.push('多模态理解');
    }

    if (id.includes('function') || id.includes('tool')) {
      capabilities.push('函数调用');
    }

    return capabilities;
  }
}

module.exports = { ModelFetcher };

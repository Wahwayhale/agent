const assert = require('node:assert/strict');
const test = require('node:test');
const { APIAdapter } = require('../electron/api-adapter/adapter');
const { PROVIDERS } = require('../electron/api-adapter/providers');

const REQUIRED_DOMESTIC_PROVIDERS = [
  'mimo',
  'qwen',
  'baidu',
  'deepseek',
  'zhipu',
  'kimi',
  'minimax',
  'doubao',
  'spark',
  'yi',
  'hunyuan',
  'baichuan',
  'stepfun'
];

const REQUIRED_MODEL_IDS = {
  qwen: ['qwen3-max', 'qwen3-coder-plus', 'qwq-plus'],
  baidu: ['ernie-5.1', 'ernie-x1.1-preview', 'ernie-4.5-turbo-128k-preview'],
  deepseek: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
  zhipu: ['glm-5.2', 'glm-5.1', 'glm-4.5'],
  kimi: ['kimi-k2.7-code', 'moonshot-v1-128k', 'moonshot-v1-128k-vision-preview'],
  minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-Text-01'],
  doubao: ['doubao-seed-1-6', 'doubao-1.5-pro-256k'],
  spark: ['4.0Ultra', 'generalv3.5', 'pro-128k'],
  yi: ['yi-large', 'yi-large-rag', 'yi-lightning'],
  hunyuan: ['hunyuan-2.0-thinking-20251109', 'hunyuan-t1-latest', 'hunyuan-vision-1.5-instruct'],
  baichuan: ['Baichuan4-Turbo', 'Baichuan3-Turbo-128k'],
  stepfun: ['step-3.7-flash', 'step-router-v1'],
  mimo: ['mimo-v2.5-pro', 'mimo-v2.5']
};

function providerModelIds(providerId) {
  return new Set(PROVIDERS[providerId].models.map(model => model.id));
}

test('includes the expected domestic model providers', () => {
  for (const providerId of REQUIRED_DOMESTIC_PROVIDERS) {
    assert.ok(PROVIDERS[providerId], `missing provider: ${providerId}`);
  }
});

test('each required domestic provider exposes the checked model IDs', () => {
  for (const [providerId, modelIds] of Object.entries(REQUIRED_MODEL_IDS)) {
    const availableModels = providerModelIds(providerId);

    for (const modelId of modelIds) {
      assert.ok(availableModels.has(modelId), `missing ${providerId} model: ${modelId}`);
    }
  }
});

test('provider configuration is internally consistent', () => {
  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    assert.equal(provider.id, providerId);
    assert.ok(provider.name, `${providerId} must have a display name`);
    assert.match(provider.type, /^(cloud|local)$/);
    assert.ok(Array.isArray(provider.models) && provider.models.length > 0, `${providerId} must have models`);

    const modelIds = new Set();
    for (const model of provider.models) {
      assert.ok(model.id, `${providerId} has a model without id`);
      assert.ok(model.name, `${providerId}/${model.id} has no display name`);
      assert.ok(Number.isFinite(model.context) && model.context > 0, `${providerId}/${model.id} has invalid context`);
      assert.ok(Number.isFinite(model.maxOutput) && model.maxOutput > 0, `${providerId}/${model.id} has invalid maxOutput`);
      assert.ok(Array.isArray(model.capabilities), `${providerId}/${model.id} capabilities must be an array`);
      assert.ok(!modelIds.has(model.id), `${providerId} duplicates model id: ${model.id}`);
      modelIds.add(model.id);
    }

    assert.ok(modelIds.has(provider.defaultModel), `${providerId} defaultModel is not in models`);

    if (provider.billingModes) {
      assert.ok(!provider.baseURL, `${providerId} should not mix baseURL with billingModes`);
      for (const mode of provider.billingModes) {
        assert.ok(mode.id, `${providerId} has billing mode without id`);
        assert.ok(mode.name, `${providerId}/${mode.id} has no billing display name`);
        assert.doesNotThrow(() => new URL(mode.baseURL), `${providerId}/${mode.id} has invalid baseURL`);
        assert.ok(mode.keyPrefix, `${providerId}/${mode.id} has no key prefix`);
      }
    } else {
      assert.doesNotThrow(() => new URL(provider.baseURL), `${providerId} has invalid baseURL`);
    }
  }
});

test('APIAdapter resolves normal and billing-mode base URLs', () => {
  const qwenAdapter = new APIAdapter({
    provider: 'qwen',
    apiKey: 'test-key',
    model: PROVIDERS.qwen.defaultModel,
    temperature: 1,
    maxTokens: 4096
  });
  assert.equal(qwenAdapter.getBaseURL(), PROVIDERS.qwen.baseURL);

  const mimoAdapter = new APIAdapter({
    provider: 'mimo',
    apiKey: 'tp-test',
    model: PROVIDERS.mimo.defaultModel,
    billingMode: 'token-plan',
    temperature: 1,
    maxTokens: 4096
  });
  assert.equal(
    mimoAdapter.getBaseURL(),
    PROVIDERS.mimo.billingModes.find(mode => mode.id === 'token-plan').baseURL
  );
});

test('APIAdapter builds provider-specific request bodies', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const mimoAdapter = new APIAdapter({
    provider: 'mimo',
    apiKey: 'tp-test',
    model: PROVIDERS.mimo.defaultModel,
    billingMode: 'token-plan',
    temperature: 0.7,
    maxTokens: 2048
  });
  const body = mimoAdapter.buildRequestBody(messages);

  assert.equal(body.model, PROVIDERS.mimo.defaultModel);
  assert.equal(body.max_completion_tokens, 2048);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.top_p, 0.95);
});

test('APIAdapter allows lightweight request overrides for connection tests', () => {
  const adapter = new APIAdapter({
    provider: 'qwen',
    apiKey: 'test-key',
    model: PROVIDERS.qwen.defaultModel,
    temperature: 1,
    maxTokens: 4096
  });
  const body = adapter.buildRequestBody(
    [{ role: 'user', content: 'hello' }],
    { maxTokens: 24, temperature: 0 }
  );

  assert.equal(body.max_tokens, 24);
  assert.equal(body.temperature, 0);
});

test('APIAdapter parses OpenAI-compatible SSE stream chunks', async () => {
  const originalFetch = global.fetch;
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  global.fetch = async () => new Response(chunks.join(''), { status: 200 });

  try {
    const adapter = new APIAdapter({
      provider: 'qwen',
      apiKey: 'test-key',
      model: PROVIDERS.qwen.defaultModel,
      temperature: 1,
      maxTokens: 4096
    });
    const received = [];

    for await (const chunk of adapter.chatStream([{ role: 'user', content: 'hello' }])) {
      received.push(chunk);
    }

    assert.deepEqual(received, [
      { type: 'text', content: 'Hel' },
      { type: 'text', content: 'lo' }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

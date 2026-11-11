import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const transport = await server.ssrLoadModule('/src/services/providerTransport.ts');
const { testOpenRouterKey, queryOpenRouterWithTools, FAST_MODEL } = await server.ssrLoadModule('/src/services/openrouter.ts');
const { HAI_PROVIDER_BASE, HAI_DEFAULT_MODEL, providerFetch, validProviderModel, SERVER_HELD_KEY, setProviderProxyAuth } = transport;

test('HAI permits bare aliases while OpenRouter retains its model format', () => {
  assert.equal(validProviderModel('qwen3.8-27b', HAI_PROVIDER_BASE), true);
  assert.equal(validProviderModel('Qwen/Qwen3.8-27B', HAI_PROVIDER_BASE), true);
  assert.equal(validProviderModel('qwen3.8-27b', transport.DEFAULT_PROVIDER_BASE), false);
  assert.equal(validProviderModel('qwen model', HAI_PROVIDER_BASE), false);
});

test('HAI chat keeps tools and streaming, maps background defaults, and uses Bearer auth', async () => {
  const previous = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return Response.json({ choices: [{ message: { content: 'hello', tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }] });
    };
    const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }];
    const result = await queryOpenRouterWithTools([{ role: 'user', content: 'hi' }], tools, 'hai-test-key', HAI_DEFAULT_MODEL, undefined, 'auto', undefined, { onText() {} }, HAI_PROVIDER_BASE);
    assert.equal(result.content, 'hello');
    assert.equal(result.toolCalls[0].function.name, 'lookup');
    assert.equal(calls[0].url, 'https://hai.mehapps.com/v1/chat/completions');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer hai-test-key');
    assert.equal(calls[0].body.model, HAI_DEFAULT_MODEL);
    assert.deepEqual(calls[0].body.tools, tools);
    assert.equal(calls[0].body.stream, true);
    await providerFetch('chat/completions', 'hai-test-key', { model: FAST_MODEL }, undefined, HAI_PROVIDER_BASE);
    assert.equal(calls[1].body.model, HAI_DEFAULT_MODEL);
    await providerFetch('chat/completions', 'hai-test-key', { model: 'my-qwen-alias' }, undefined, HAI_PROVIDER_BASE);
    assert.equal(calls[2].body.model, 'my-qwen-alias');
  } finally { globalThis.fetch = previous; }
});

test('HAI key test uses the selected alias without an OpenRouter auth request', async () => {
  const previous = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ choices: [] }); };
    assert.equal((await testOpenRouterKey('hai-test-key', 'my-qwen-alias', HAI_PROVIDER_BASE)).success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${HAI_PROVIDER_BASE}/chat/completions`);
    assert.equal(calls[0].body.model, 'my-qwen-alias');
  } finally { globalThis.fetch = previous; }
});

test('authenticated model discovery uses GET directly and the secure proxy for stored keys', async () => {
  const previous = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ id: 'my-qwen-alias' }] }); };
    await providerFetch('models', 'hai-test-key', {}, undefined, HAI_PROVIDER_BASE);
    assert.equal(calls[0].url, `${HAI_PROVIDER_BASE}/models`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    setProviderProxyAuth(async () => 'user-token');
    await providerFetch('models', SERVER_HELD_KEY, {}, undefined, HAI_PROVIDER_BASE);
    assert.match(calls[1].url, /^\/api\/ai\?endpoint=models&base=/);
    assert.equal(calls[1].init.headers.Authorization, 'Bearer user-token');
  } finally { globalThis.fetch = previous; setProviderProxyAuth(null); }
});

test('server model discovery forwards GET with the decrypted HAI key and no request body', async () => {
  const { sealSecret } = await server.ssrLoadModule('/server/lib/crypto.ts');
  const { aiHandlers } = await server.ssrLoadModule('/server/routes/ai.ts');
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const userId = 'hai-provider-test-user';
  const sealed = await sealSecret(encryptionKey, userId, 'openrouter', 'hai-test-secret-key');
  const deps = { caller: async () => ({ store: { userId, getSecret: async () => sealed } }), secretsKey: () => encryptionKey };
  const calls = [];
  const route = aiHandlers(deps, async (url, init) => {
    calls.push({ url, init });
    return Response.json({ data: [{ id: 'my-qwen-alias' }] });
  });
  const response = await route.POST(new Request(`https://app.test/api/ai?endpoint=models&base=${encodeURIComponent(HAI_PROVIDER_BASE)}`, { method: 'POST', body: '{}' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [{ id: 'my-qwen-alias' }] });
  assert.equal(calls[0].url, `${HAI_PROVIDER_BASE}/models`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer hai-test-secret-key');
});

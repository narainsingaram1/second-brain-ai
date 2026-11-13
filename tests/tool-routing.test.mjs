import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ cacheDir: '/tmp/synapse-tool-routing-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const { AutonomousBrainAgent } = await server.ssrLoadModule('/src/services/agentDispatcher.ts');
const { BRAIN_TOOLS } = await server.ssrLoadModule('/src/services/brainTools.ts');
const { TOOL_AREAS, AREA_NAMES, conversationAreas } = await server.ssrLoadModule('/src/services/toolRouting.ts');

const state = () => ({ userId: 'test', tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], sections: ['Academic'], subsections: { Academic: ['General'] },
  noteFolders: [], chatHistory: [], openRouterKey: 'test-key', selectedModel: 'test/model', theme: 'light',
  trackerItems: [], workspaces: [{ id: 'w1', name: 'Career', template: 'career', color: 'blue', createdAt: '2026-01-01' }] });
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => ({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { content, tool_calls } }] });
async function run(prompt, queue, live = state()) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { requests.push(JSON.parse(opts.body)); return Response.json(queue.shift()); };
  try { return { requests, result: await AutonomousBrainAgent.execute(prompt, live, 'test-key', 'test/model', { commit: async () => {} }) }; }
  finally { globalThis.fetch = original; }
}
const names = request => request.tools.map(t => t.function.name);

test('every routed tool exists, and every tool is either always sent or in exactly one area', () => {
  const catalog = new Set(BRAIN_TOOLS.map(t => t.function.name));
  const routed = AREA_NAMES.flatMap(area => TOOL_AREAS[area]);
  for (const name of routed) assert.ok(catalog.has(name), `${name} is routed but is not a tool`);
  assert.equal(new Set(routed).size, routed.length);
});

test('areas come from the whole conversation, and only words or records that mean them', () => {
  assert.deepEqual([...conversationAreas('add milk to my list for 11/13', [])], []);
  assert.deepEqual([...conversationAreas('what is due in 2026?', [])], []);
  assert.deepEqual([...conversationAreas('I applied to Stripe today', [])], ['career']);
  assert.deepEqual([...conversationAreas('add the CS 2110 problem set', [])], ['study']);
  assert.deepEqual([...conversationAreas('mark it rejected', [{ id: 'a', role: 'assistant', content: 'Done.', timestamp: '', sources: [{ type: 'tracker', id: 'x', title: 'Stripe' }] }])].sort(), ['career']);
  assert.deepEqual([...conversationAreas('and the next one?', [{ id: 'u', role: 'user', content: 'how did I sleep?', timestamp: '' }])], ['health']);
  assert.equal(conversationAreas('add these', [], true).size, AREA_NAMES.length);
});

test('a plain message is sent without area tools, keeping use_tools to add them', async () => {
  const { requests } = await run('add milk to my list', [reply('Added.')]);
  const offered = names(requests[0]);
  assert.ok(offered.includes('create_task') && offered.includes('show_card') && offered.includes('use_tools'));
  for (const name of AREA_NAMES.flatMap(area => TOOL_AREAS[area])) assert.ok(!offered.includes(name), `${name} should not be sent`);
  assert.ok(JSON.stringify(requests[0].tools).length < JSON.stringify(BRAIN_TOOLS).length * 0.75);
});

test('a career message is sent with the career tools', async () => {
  const { requests } = await run('I applied to Stripe today', [reply('Nice.')]);
  assert.ok(names(requests[0]).includes('create_tracker_item'));
  assert.ok(!names(requests[0]).includes('log_health_day'));
});

test('use_tools adds an area from the next step on, and the tool list never shrinks during a turn', async () => {
  const { requests } = await run('note down 7 hours last night', [reply(null, [call('use_tools', { areas: ['health'] })]), reply('Logged.')]);
  assert.ok(!names(requests[0]).includes('log_health_day'));
  assert.ok(names(requests[1]).includes('log_health_day'));
  assert.match(requests[1].messages.at(-1).content, /log_health_day/);
});

test('calling a tool from an area not offered yet still works, and adds that area', async () => {
  const { requests, result } = await run('track that Stripe thing', [
    reply(null, [call('create_tracker_item', { workspaceId: 'w1', kind: 'application', title: 'Stripe' })]), reply('Tracked.')]);
  assert.ok(!names(requests[0]).includes('create_tracker_item'));
  assert.ok(names(requests[1]).includes('create_tracker_item'));
  assert.doesNotMatch(requests[1].messages.at(-1).content, /Unsupported tool/);
  assert.equal(result.queryAnswer, 'Tracked.');
});

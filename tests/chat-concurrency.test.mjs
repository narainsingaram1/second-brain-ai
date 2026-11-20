import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { orderSystemMessages } = await server.ssrLoadModule('/src/services/openrouter.ts');
test.after(() => server.close());

test('a system message after the first is sent as a marked user message, for strict chat templates', () => {
  const out = orderSystemMessages([
    { role: 'system', content: 'You are Iris.' },
    { role: 'system', content: 'Context.' },
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] },
    { role: 'tool', tool_call_id: 'a', content: '{}' },
    { role: 'system', content: 'Stop using tools now.' },
    { role: 'user', content: 'Evidence' },
  ]);
  assert.equal(out.filter(m => m.role === 'system').length, 1);
  assert.equal(out[0].content, 'You are Iris.\n\nContext.');
  const last = out[out.length - 1];
  assert.equal(last.role, 'user');
  assert.match(last.content, /Instruction from the app[\s\S]*Stop using tools now\.[\s\S]*Evidence/);
  assert.equal(out[out.length - 2].role, 'tool', 'no two user turns in a row');
});

test('messages already in order are left as they are', () => {
  const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }];
  assert.equal(orderSystemMessages(messages), messages);
});

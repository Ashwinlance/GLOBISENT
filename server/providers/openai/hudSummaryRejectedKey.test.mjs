import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleHudSummary, _resetRejectedOpenAiKey } from './hud-summary.js';

function request(method, url, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function call(method, url, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(text) { resolve({ status: this.statusCode, body: JSON.parse(text || '{}') }); },
    };
    handleHudSummary(request(method, url, body), res);
  });
}

test('a key OpenAI rejects is not retried until it changes', async (t) => {
  const savedKey = process.env.OPENAI_API_KEY;
  const savedFetch = globalThis.fetch;
  const savedWarn = console.warn;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return { ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key' } }) };
  };
  console.warn = () => {};
  t.after(() => {
    process.env.OPENAI_API_KEY = savedKey ?? '';
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    globalThis.fetch = savedFetch;
    console.warn = savedWarn;
    _resetRejectedOpenAiKey();
  });
  _resetRejectedOpenAiKey();
  process.env.OPENAI_API_KEY = 'sk-fixture-only-dead-key';

  assert.equal((await call('GET', '/status')).body.configured, true);
  assert.equal((await call('POST', '/', '{}')).status, 401);
  assert.equal(upstreamCalls, 1);

  // Same dead key: reported as not configured and never sent upstream again.
  assert.equal((await call('GET', '/status')).body.configured, false);
  const second = await call('POST', '/', '{}');
  assert.equal(second.status, 200);
  assert.equal(second.body.configured, false);
  assert.equal(upstreamCalls, 1);

  // A new key is tried again.
  process.env.OPENAI_API_KEY = 'sk-fixture-only-new-key';
  assert.equal((await call('GET', '/status')).body.configured, true);
  await call('POST', '/', '{}');
  assert.equal(upstreamCalls, 2);
});

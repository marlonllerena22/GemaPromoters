import test from 'node:test';
import assert from 'node:assert/strict';
import { response } from '../src/finance-ai.js';

for (const [status, code, expected] of [
  [429, 'insufficient_quota', /sin saldo/],
  [429, 'credit_balance_exhausted', /Se agotó el crédito/],
  [429, 'project_spend_limit_exceeded', /límite de consumo/],
  [429, 'rate_limit_exceeded', /demasiadas solicitudes/],
  [401, 'invalid_api_key', /no está autorizada/],
  [400, 'invalid_json_schema', /diagnóstico/],
  [503, 'server_error', /fallo temporal/],
]) test(`provider ${status}/${code} gives an actionable message without exposing inputs`, async t => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-secret';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  const logged = [];
  t.mock.method(console, 'warn', message => logged.push(message));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: {
    code, type: 'invalid_request_error', message: 'PRIVATE PHOTO ACCOUNT AND SECRET', param: 'private input with spaces',
  } }, { status, headers: { 'x-request-id': 'req-test-123' } }));
  await assert.rejects(response([], 'test', {}), error => {
    assert.match(error.message, expected);
    assert.equal(error.status, 502);
    assert.equal(error.provider.code, code);
    assert.equal(error.provider.request_id, 'req-test-123');
    assert.equal(error.provider.param, null);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|test-secret/);
    return true;
  });
  assert.equal(logged.length, 1);
  assert.doesNotMatch(logged[0], /PRIVATE|test-secret|private input/);
});

test('a non-JSON upstream error still produces a safe retry message', async t => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-secret';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>bad gateway</html>', { status: 502 }));
  await assert.rejects(response([], 'test', {}), /fallo temporal/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { handleGitHubOAuthRequest, readGitHubClientSecret } from '../lib/github-oauth.ts';

const clientId = 'Ov23liEXAMPLE12345678';
const serverSecret = 'server-only-secret-for-tests';
const code = '0123456789abcdef0123';
const request = (body = { code, client_id: clientId }, contentType = 'application/json') => new Request('http://127.0.0.1:3010/api/github', {
  method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const forbiddenFetch = async () => { assert.fail('Invalid or unconfigured requests must not call GitHub'); };

test('server environment takes precedence over local file and rejects a mismatched environment ID', async () => {
  const noRead = async () => { assert.fail('Environment configuration must take precedence'); };
  assert.equal(await readGitHubClientSecret(clientId, { env: { GITHUB_CLIENT_SECRET: serverSecret }, readText: noRead }), serverSecret);
  assert.equal(await readGitHubClientSecret(clientId, { env: { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: serverSecret }, readText: noRead }), serverSecret);
  assert.equal(await readGitHubClientSecret(clientId, { env: { GITHUB_CLIENT_ID: 'OtherApplication', GITHUB_CLIENT_SECRET: serverSecret }, readText: noRead }), '');
});

test('local fallback reads only a matching ID from the shared private runtime directory', async () => {
  const cwd = path.resolve('test-project', 'my-blog-manager');
  assert.equal(await readGitHubClientSecret(clientId, {
    env: {}, cwd,
    readText: async filename => {
      assert.equal(filename, path.resolve(cwd, '..', '.local-runtime', 'github-oauth.json'));
      return JSON.stringify({ clientId, clientSecret: serverSecret });
    },
  }), serverSecret);
  for (const contents of ['not json', '{}', 'null', JSON.stringify({ clientId: 'OtherApplication', clientSecret: serverSecret })]) {
    assert.equal(await readGitHubClientSecret(clientId, { env: {}, readText: async () => contents }), '');
  }
  assert.equal(await readGitHubClientSecret(clientId, { env: {}, readText: async () => { throw new Error(serverSecret); } }), '');
});

test('invalid bodies, content types and authorization codes are rejected without network access', async () => {
  const invalid = [null, [], {}, { code, client_id: 123 }, { code: 'short', client_id: clientId }, { code: 'x'.repeat(513), client_id: clientId }, { code: `${code}\n`, client_id: clientId }, { code: `${code}&client_secret=bad`, client_id: clientId }];
  for (const body of invalid) {
    const response = await handleGitHubOAuthRequest(request(body), clientId, { fetchImpl: forbiddenFetch });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_request');
  }
  for (const req of [request('{broken'), request('code=123', 'application/x-www-form-urlencoded'), request('x'.repeat(8193))]) {
    assert.equal((await handleGitHubOAuthRequest(req, clientId, { fetchImpl: forbiddenFetch })).status, 400);
  }
});

test('browser application ID must match current public configuration', async () => {
  const response = await handleGitHubOAuthRequest(request({ code, client_id: 'OtherApplication' }), clientId, { fetchImpl: forbiddenFetch });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'client_id_mismatch');
});

test('missing or unreadable server secret returns a safe configuration error without contacting GitHub', async () => {
  for (const secretProvider of [async () => '', async () => { throw new Error(serverSecret); }]) {
    const response = await handleGitHubOAuthRequest(request(), clientId, { secretProvider, fetchImpl: forbiddenFetch });
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.ok(text.includes('server_not_configured'));
    assert.ok(!text.includes(serverSecret));
  }
});

test('exchange discards browser secret, redirect URI and extra fields and uses a fixed JSON endpoint', async () => {
  const response = await handleGitHubOAuthRequest(request({
    code, client_id: clientId, client_secret: 'malicious-browser-secret', redirect_uri: 'https://attacker.invalid/steal', arbitrary: 'untrusted',
  }), clientId, {
    secretProvider: async id => { assert.equal(id, clientId); return serverSecret; },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://github.com/login/oauth/access_token');
      assert.deepEqual(JSON.parse(options.body), { client_id: clientId, client_secret: serverSecret, code });
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
      assert.equal(options.method, 'POST');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ access_token: 'test-token', token_type: 'bearer', scope: 'public_repo', client_secret: serverSecret, extra: serverSecret });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { access_token: 'test-token', token_type: 'bearer', scope: 'public_repo' });
});

test('GitHub errors and error descriptions never leak upstream text or credentials', async () => {
  for (const [error, status] of [['bad_verification_code', 401], ['expired_token', 401], [serverSecret, 400]]) {
    const response = await handleGitHubOAuthRequest(request(), clientId, {
      secretProvider: async () => serverSecret,
      fetchImpl: async () => Response.json({ error, error_description: serverSecret, client_secret: serverSecret }),
    });
    assert.equal(response.status, status);
    const text = await response.text();
    assert.ok(text.includes('authorization_rejected'));
    assert.ok(!text.includes(serverSecret));
  }
});

test('network errors, timeouts and invalid upstream responses return safe 502 errors', async () => {
  const upstreamCases = [
    async () => { throw new Error(serverSecret); },
    async () => { throw new DOMException(serverSecret, 'TimeoutError'); },
    async () => new Response('<html>upstream failure</html>'),
    async () => Response.json({ unexpected: serverSecret }),
    async () => Response.json({ error: serverSecret }, { status: 503 }),
    async () => Response.json({ error: serverSecret }, { status: 429 }),
  ];
  for (const fetchImpl of upstreamCases) {
    const response = await handleGitHubOAuthRequest(request(), clientId, { secretProvider: async () => serverSecret, fetchImpl });
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.ok(text.includes('github_unavailable'));
    assert.ok(!text.includes(serverSecret));
  }
});

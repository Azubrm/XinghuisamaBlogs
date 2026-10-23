import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canManageGitHubSecret, saveGitHubClientSecret, validGitHubSecretInput } from '../lib/github-secret-settings.ts';

const clientId = 'testClientId123456789';
const clientSecret = 'test-only-secret-1234567890123456789';

test('only a matching loopback origin may save a secret', () => {
  const request = (url, origin, host) => new Request(url, { method: 'PUT', headers: { ...(origin ? { origin } : {}), ...(host ? { host } : {}) } });
  assert.equal(canManageGitHubSecret(request('http://127.0.0.1:3010/api/github/config', 'http://127.0.0.1:3010')), true);
  assert.equal(canManageGitHubSecret(request('http://localhost:3010/api/github/config', 'http://localhost:3010')), true);
  assert.equal(canManageGitHubSecret(request('http://127.0.0.1:3010/api/github/config', 'https://example.com')), false);
  assert.equal(canManageGitHubSecret(request('http://127.0.0.1:3010/api/github/config')), false);
  assert.equal(canManageGitHubSecret(request('http://127.0.0.1:3010/api/github/config', 'http://example.com', 'example.com')), false);
  assert.equal(canManageGitHubSecret(request('https://example.com/api/github/config', 'https://example.com')), false);
});

test('credential input accepts expected values and rejects multiline or malformed data', () => {
  assert.equal(validGitHubSecretInput({ clientId, clientSecret }), true);
  for (const value of [null, {}, { clientId, clientSecret: '' }, { clientId: '../bad', clientSecret }, { clientId, clientSecret: `${clientSecret}\nNEXT=oops` }]) {
    assert.equal(validGitHubSecretInput(value), false);
  }
});

test('secret storage replaces only its private file and leaves no temporary files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blog-secret-test-'));
  try {
    const file = path.join(directory, 'private', 'github-oauth.json');
    await saveGitHubClientSecret(clientId, clientSecret, file);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { clientId, clientSecret });
    await saveGitHubClientSecret(clientId, 'replacement-test-only-secret-123456', file);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).clientSecret, 'replacement-test-only-secret-123456');
    assert.deepEqual(await readdir(path.dirname(file)), ['github-oauth.json']);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('blog-secret-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

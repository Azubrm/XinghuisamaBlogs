import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubCommentReader } from '../lib/github-comment-reader.ts';

const config = { clientId: 'Ov23liEXAMPLE12345678', owner: 'Azubrm', repo: 'Blog' };
const secret = 'private-app-secret-only-for-tests';
const base = '/repos/Azubrm/Blog/issues';
const request = (resource = base, accept = 'application/vnd.github+json', headers = {}) => new Request(`http://127.0.0.1:3010/api/github/comments?resource=${encodeURIComponent(resource)}`, { headers: { Accept: accept, ...headers } });
const noFetch = async () => { assert.fail('Rejected requests must not contact GitHub'); };
const create = (deps = {}) => createGitHubCommentReader(config, { secretProvider: async () => secret, ...deps });

test('only the configured repository issue and comment GET paths are allowed', async () => {
  let calls = 0;
  const reader = create({ fetchImpl: async url => {
    calls++;
    assert.ok(url.startsWith('https://api.github.com/repos/Azubrm/Blog/issues'));
    return Response.json(url.endsWith('/12') ? { id: 12, title: 'Example' } : []);
  } });
  for (const path of [base, `${base}/12`, `${base}/12/comments`]) {
    assert.equal((await reader.handle(request(path))).status, 200);
  }
  assert.equal(calls, 3);
});

test('SSRF, traversal, foreign repository, unsupported queries and invalid pagination are rejected', async () => {
  const reader = create({ fetchImpl: noFetch });
  const paths = [
    'https://api.github.com' + base, 'https://attacker.invalid/steal', '//attacker.invalid/steal',
    '/repos/Azubrm/Other/issues', '/repos/Other/Blog/issues', '/repos/Azubrm/Blog/pulls',
    `${base}/../issues`, `${base}/%2e%2e`, `${base}/0`, `${base}/01/comments`, `${base}/-1`,
    `${base}/1/labels`, `${base}/1/comments/../../user`, `${base}/%31/comments`, `${base}\\anything`, `${base}#fragment`,
    `${base}?access_token=evil`, `${base}?sort=created`, `${base}?labels=${'x'.repeat(501)}`,
    `${base}?page=0`, `${base}?page=-1`, `${base}?page=1.5`, `${base}?page=9007199254740992`,
    `${base}?per_page=0`, `${base}?per_page=101`, `${base}?per_page=1e2`, `${base}?page=1&page=2`,
  ];
  for (const path of paths) assert.equal((await reader.handle(request(path))).status, 400, path);
  assert.equal((await reader.handle(request(base, 'text/html'))).status, 400);
  const duplicated = new Request(`http://localhost/api/github/comments?resource=${encodeURIComponent(base)}&resource=${encodeURIComponent(base)}`);
  assert.equal((await reader.handle(duplicated)).status, 400);
  const post = new Request(`http://localhost/api/github/comments?resource=${encodeURIComponent(base)}`, { method: 'POST' });
  assert.equal((await reader.handle(post)).status, 405);
});

test('server Basic credentials are used only with the fixed GitHub API and browser credentials are discarded', async () => {
  const reader = create({ fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.github.com${base}?labels=comments%2Cexample&page=2&per_page=100`);
    assert.deepEqual(options.headers, {
      Accept: 'application/vnd.github.v3.full+json',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${secret}`).toString('base64')}`,
      'X-GitHub-Api-Version': '2022-11-28',
    });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json([{ id: 1, body_html: '<p>public comment</p>' }], {
      headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'set-cookie': secret, Authorization: secret, 'x-untrusted': secret },
    });
  } });
  const result = await reader.handle(request(`${base}?per_page=100&t=123&labels=comments%2Cexample&page=2`, 'application/vnd.github.v3.full+json', { Authorization: 'Bearer browser-token', Cookie: 'secret-cookie', 'X-Untrusted': 'evil' }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-ratelimit-limit'), '5000');
  assert.equal(result.headers.get('x-ratelimit-remaining'), '4999');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(result.headers.get('authorization'), null);
  assert.equal(result.headers.get('x-untrusted'), null);
  assert.ok(!(await result.text()).includes(secret));
});

test('configuration and missing secrets return safe 503 without network access', async () => {
  for (const secretProvider of [async () => '', async () => { throw new Error(secret); }]) {
    const result = await create({ secretProvider, fetchImpl: noFetch }).handle(request());
    assert.equal(result.status, 503);
    assert.ok(!(await result.text()).includes(secret));
  }
  const notConfigured = createGitHubCommentReader({ ...config, clientId: '' }, { fetchImpl: noFetch });
  assert.equal((await notConfigured.handle(request())).status, 503);
  const noProvider = createGitHubCommentReader(config, { fetchImpl: noFetch });
  assert.equal((await noProvider.handle(request())).status, 503);
});

test('successful public responses are cached for 60 seconds and cachebuster/query order do not split cache', async () => {
  let timestamp = 1_000_000;
  let calls = 0;
  let secretChecks = 0;
  const reader = create({ now: () => timestamp, secretProvider: async () => { secretChecks++; return secret; }, fetchImpl: async () => { calls++; return Response.json([{ id: calls }]); } });
  const first = await reader.handle(request(`${base}?labels=blog&page=1&t=1`));
  assert.deepEqual(await first.json(), [{ id: 1 }]);
  timestamp += 59_999;
  const cached = await reader.handle(request(`${base}?t=2&page=1&labels=blog`));
  assert.deepEqual(await cached.json(), [{ id: 1 }]);
  assert.equal(calls, 1);
  assert.equal(secretChecks, 2);
  timestamp++;
  assert.equal((await reader.handle(request(`${base}?page=1&labels=blog`))).status, 200);
  assert.equal(calls, 2);
});

test('cached public data cannot be served after the server secret is removed', async () => {
  let configured = true;
  let calls = 0;
  const reader = create({ secretProvider: async () => configured ? secret : '', fetchImpl: async () => { calls++; return Response.json([]); } });
  assert.equal((await reader.handle(request())).status, 200);
  configured = false;
  assert.equal((await reader.handle(request())).status, 503);
  assert.equal(calls, 1);
});

test('concurrent identical requests share one upstream request while different Accept representations stay separate', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const reader = create({ fetchImpl: async () => { calls++; await gate; return Response.json([{ id: 123 }]); } });
  const first = reader.handle(request());
  const second = reader.handle(request());
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(await results[0].json(), [{ id: 123 }]);
  assert.deepEqual(await results[1].json(), [{ id: 123 }]);
  assert.equal(calls, 1);
  assert.equal((await reader.handle(request(base, 'application/vnd.github.v3.full+json'))).status, 200);
  assert.equal(calls, 2);
});

test('cache is bounded to 100 public responses', async () => {
  let calls = 0;
  const reader = create({ fetchImpl: async () => { calls++; return Response.json([]); } });
  for (let page = 1; page <= 101; page++) await reader.handle(request(`${base}?page=${page}`));
  assert.equal(calls, 101);
  await reader.handle(request(`${base}?page=1`));
  assert.equal(calls, 102);
  await reader.handle(request(`${base}?page=101`));
  assert.equal(calls, 102);
});

test('exhausted GitHub quota pauses all new upstream reads until reset without automatic retry', async () => {
  let timestamp = 1_000_000;
  let calls = 0;
  const reset = (timestamp + 120_000) / 1000;
  const reader = create({ now: () => timestamp, fetchImpl: async () => {
    calls++;
    return calls === 1 ? Response.json({ message: secret }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset), 'x-ratelimit-limit': '5000' } }) : Response.json([]);
  } });
  const initial = await reader.handle(request());
  assert.equal(initial.status, 429);
  const details = await initial.json();
  assert.equal(details.error, 'rate_limited');
  assert.equal(details.retryAt, new Date(reset * 1000).toISOString());
  assert.ok(!JSON.stringify(details).includes(secret));
  assert.equal(initial.headers.get('retry-after'), '120');
  timestamp += 30_000;
  const blocked = await reader.handle(request(`${base}/1/comments`));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '90');
  assert.equal(calls, 1);
  timestamp = reset * 1000;
  assert.equal((await reader.handle(request(`${base}/1/comments`))).status, 200);
  assert.equal(calls, 2);
});

test('HTTP 429 without reset defaults to a 60-second pause', async () => {
  let timestamp = 1_000_000;
  let calls = 0;
  const reader = create({ now: () => timestamp, fetchImpl: async () => { calls++; return Response.json({ message: secret }, { status: 429 }); } });
  const result = await reader.handle(request());
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '60');
  timestamp += 59_000;
  assert.equal((await reader.handle(request(`${base}/2/comments`))).status, 429);
  assert.equal(calls, 1);
});

test('Retry-After is honored and invalid reset timestamps cannot break cooldown responses', async () => {
  const timestamp = 1_000_000;
  const reader = create({ now: () => timestamp, fetchImpl: async () => Response.json({}, {
    status: 429, headers: { 'retry-after': '75', 'x-ratelimit-reset': '9999999999999999' },
  }) });
  const result = await reader.handle(request());
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '75');
  assert.equal((await reader.handle(request(`${base}/1/comments`))).status, 429);
});

test('HTTP errors, invalid JSON and transport failures return fixed Chinese errors without leaking upstream details', async () => {
  for (const [status, expected] of [[401, 401], [404, 404], [403, 502], [500, 503], [503, 503]]) {
    const reader = create({ fetchImpl: async () => Response.json({ message: secret, authorization: secret }, { status }) });
    const result = await reader.handle(request());
    assert.equal(result.status, expected);
    const text = await result.text();
    assert.ok(!text.includes(secret));
    assert.match(text, /[\u4e00-\u9fff]/);
  }
  for (const fetchImpl of [async () => { throw new Error(secret); }, async () => new Response(secret), async () => Response.json({ unexpected: secret })]) {
    const result = await create({ fetchImpl }).handle(request());
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes(secret));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { patchGitalkPublicReads } from '../lib/gitalk-public-reads.ts';

function issue(number = 7, comments = 3) {
  return {
    number, comments,
    comments_url: `https://api.github.com/repos/example-owner/comments/issues/${number}/comments`,
    title: 'Example comments',
  };
}

function fixture(options = {}) {
  return {
    options: {
      owner: 'example-owner', repo: 'comments', id: '/example', labels: ['Gitalk'],
      number: -1, perPage: 2, createIssueManually: false,
      clientID: 'public-example-client', clientSecret: '', ...options,
    },
    state: { issue: null, comments: [], page: 1, isNoInit: false, isLoadOver: false },
    accessToken: '',
    isAdmin: false,
    created: 0,
    legacyReads: 0,
    setState(update) { Object.assign(this.state, update); },
    async createIssue() {
      this.created += 1;
      const created = issue(8, 0);
      this.setState({ issue: created });
      return created;
    },
    getIssue() {
      if (this.state.issue) {
        this.setState({ isNoInit: false });
        return Promise.resolve(this.state.issue);
      }
      if (this.options.number > 0) {
        return this.getIssueById().then(found => found || this.getIssueByLabels());
      }
      return this.getIssueByLabels();
    },
    getUserInfo() { return Promise.resolve(); },
    getInit() {
      return this.getUserInfo().then(() => this.getIssue())
        .then(found => found ? this.getCommentsV3(found) : undefined);
    },
    getIssueById() { this.legacyReads += 1; throw new Error('Legacy Basic auth read was called'); },
    getIssueByLabels() { this.legacyReads += 1; throw new Error('Legacy Basic auth read was called'); },
    getCommentsV3() { this.legacyReads += 1; throw new Error('Legacy Basic auth read was called'); },
  };
}

function mockFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetcher = async (url, init) => {
    const rawUrl = String(url);
    const requestUrl = new URL(rawUrl, 'https://blog.example');
    const resource = requestUrl.searchParams.get('resource');
    calls.push({
      rawUrl, url: requestUrl,
      githubUrl: resource === null ? requestUrl : new URL(resource, 'https://api.github.com'),
      init,
    });
    assert.ok(queue.length, 'Unexpected extra GitHub request');
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.data), {
      status: next.status || 200,
      headers: { 'Content-Type': 'application/json', ...next.headers },
    });
  };
  return { calls, fetcher, remaining: () => queue.length };
}

function assertPublic(calls, proxy = '/api/github/comments') {
  assert.ok(calls.length);
  for (const { rawUrl, url, githubUrl, init } of calls) {
    assert.ok(rawUrl.startsWith(`${proxy}?resource=`));
    assert.equal(url.origin, 'https://blog.example');
    assert.equal(url.pathname, proxy);
    assert.equal(url.searchParams.get('resource'), githubUrl.pathname + githubUrl.search);
    assert.deepEqual([...url.searchParams.keys()], ['resource']);
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal('auth' in init, false);
  }
}

function assertAuthenticated(calls, token) {
  assert.ok(calls.length);
  for (const { rawUrl, url, init } of calls) {
    assert.ok(rawUrl.startsWith('https://api.github.com/'));
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal('auth' in init, false);
  }
}

test('reads issue labels anonymously and preserves lookup/state semantics', async () => {
  const found = issue();
  const component = fixture({ id: '/含空格 page', labels: ['Gitalk', 'Discussion'] });
  const originalOptions = { ...component.options };
  const mock = mockFetch([{ data: [found] }]);
  assert.equal(patchGitalkPublicReads(component, mock.fetcher), component);
  assert.deepEqual(await component.getIssueByLabels(), found);
  assert.equal(mock.calls[0].githubUrl.pathname, '/repos/example-owner/comments/issues');
  assert.equal(mock.calls[0].githubUrl.searchParams.get('labels'), 'Gitalk,Discussion,/含空格 page');
  assert.equal(new Headers(mock.calls[0].init.headers).get('Accept'), 'application/vnd.github+json');
  assert.deepEqual(component.state.issue, found);
  assert.equal(component.state.isNoInit, false);
  assert.deepEqual(component.options, originalOptions);
  assertPublic(mock.calls);
});

test('issue-number 404 falls back to labels without a failed-auth header', async () => {
  const found = issue(9);
  const component = fixture({ number: 7 });
  const mock = mockFetch([{ status: 404, data: { message: 'Not Found' } }, { data: [found] }]);
  patchGitalkPublicReads(component, mock.fetcher);
  assert.deepEqual(await component.getIssue(), found);
  assert.equal(mock.calls[0].githubUrl.pathname, '/repos/example-owner/comments/issues/7');
  assert.equal(mock.calls[1].githubUrl.pathname, '/repos/example-owner/comments/issues');
  assert.equal(component.state.isNoInit, false);
  assertPublic(mock.calls);
});

test('issue-number lookup accepts matching results and treats a mismatched number as absent', async () => {
  const component = fixture({ number: 7 });
  const found = issue(7);
  const mock = mockFetch([{ data: found }, { data: issue(9) }]);
  patchGitalkPublicReads(component, mock.fetcher);
  assert.deepEqual(await component.getIssueById(), found);
  assert.equal(await component.getIssueById(), null);
  assertPublic(mock.calls);
});

test('empty public issues show not initialized and retain manual creation behavior', async () => {
  for (const [isAdmin, createIssueManually] of [[false, false], [-1, true]]) {
    const component = fixture({ createIssueManually });
    component.isAdmin = isAdmin;
    const mock = mockFetch([{ data: [] }]);
    patchGitalkPublicReads(component, mock.fetcher);
    assert.equal(await component.getIssueByLabels(), null);
    assert.equal(component.state.issue, null);
    assert.equal(component.state.isNoInit, true);
    assert.equal(component.created, 0);
    assertPublic(mock.calls);
  }
});

test('logged-in administrator creation still uses the existing createIssue method', async () => {
  const component = fixture();
  component.isAdmin = -1; // Gitalk's real getter uses a truthy bitwise index.
  const originalCreate = component.createIssue;
  const mock = mockFetch([{ data: [] }]);
  patchGitalkPublicReads(component, mock.fetcher);
  const created = await component.getIssueByLabels();
  assert.equal(component.createIssue, originalCreate);
  assert.equal(component.created, 1);
  assert.equal(created.number, 8);
  assert.deepEqual(component.state.issue, created);
  assertPublic(mock.calls);
});

test('V3 comments preserve full-body media type, accumulated comments and page counters', async () => {
  const component = fixture();
  component.state.issue = issue(7, 3);
  const mock = mockFetch([{ data: [{ id: 1 }, { id: 2 }] }, { data: [{ id: 3 }] }]);
  patchGitalkPublicReads(component, mock.fetcher);
  assert.deepEqual(await component.getCommentsV3(), [{ id: 1 }, { id: 2 }]);
  assert.equal(component.state.page, 2);
  assert.equal(component.state.isLoadOver, false);
  assert.deepEqual(await component.getCommentsV3(), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(component.state.page, 3);
  assert.equal(component.state.isLoadOver, true);
  assert.deepEqual(mock.calls.map(call => call.githubUrl.searchParams.get('page')), ['1', '2']);
  for (const call of mock.calls) {
    assert.equal(call.githubUrl.searchParams.get('per_page'), '2');
    assert.equal(new Headers(call.init.headers).get('Accept'), 'application/vnd.github.v3.full+json');
  }
  assertPublic(mock.calls);
});

test('comment pagination finishes for either a short page or the issue comment count', async () => {
  for (const [count, comments] of [[99, [{ id: 1 }]], [2, [{ id: 1 }, { id: 2 }]]]) {
    const component = fixture();
    component.state.issue = issue(7, count);
    const mock = mockFetch([{ data: comments }]);
    patchGitalkPublicReads(component, mock.fetcher);
    await component.getCommentsV3();
    assert.equal(component.state.isLoadOver, true);
  }
});

test('HTTP and network errors retain the response.status shape expected by Gitalk', async () => {
  const component = fixture({ number: 7 });
  const mock = mockFetch([{ status: 403, data: { message: 'Forbidden' } }, new Error('offline')]);
  patchGitalkPublicReads(component, mock.fetcher);
  await assert.rejects(component.getIssueById(), error => {
    assert.equal(error.response.status, 403);
    assert.match(error.response.data.message, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(error.response.data.message, /Forbidden/);
    return true;
  });
  await assert.rejects(component.getIssueById(), error => {
    assert.equal(error.response.status, 0);
    assert.equal(typeof error.response.data.message, 'string');
    return true;
  });
  assertPublic(mock.calls);
});

test('synchronous render-then-patch wins before the first initialization microtask', async () => {
  function renderFixture() {
    const component = fixture();
    component.ready = component.getInit();
    return component;
  }
  const mock = mockFetch([{ data: [issue(7, 1)] }, { data: [{ id: 1 }] }]);
  const component = renderFixture();
  patchGitalkPublicReads(component, mock.fetcher); // No await between render and patch.
  await component.ready;
  assert.equal(component.legacyReads, 0);
  assert.equal(mock.remaining(), 0);
  assert.equal(component.state.comments.length, 1);
  assertPublic(mock.calls);
});

test('refuses an unsupported instance and a non-GitHub comments URL', async () => {
  assert.throws(() => patchGitalkPublicReads({}), /Gitalk/);
  const component = fixture();
  component.state.issue = { ...issue(), comments_url: 'https://example.com/comments' };
  const mock = mockFetch([]);
  patchGitalkPublicReads(component, mock.fetcher);
  await assert.rejects(component.getCommentsV3(), error => error.response.status === 0);
  assert.equal(mock.calls.length, 0);
});

test('anonymous proxy preserves the encoded GitHub resource under a deployment base path', async () => {
  const component = fixture({ id: '/含空格 page?&+', labels: ['Gitalk', 'Discussion'] });
  const found = issue(7, 1);
  const mock = mockFetch([{ data: [found] }, { data: [{ id: 1 }] }]);
  const publicReadProxy = '/blog/api/github/comments';
  patchGitalkPublicReads(component, mock.fetcher, { publicReadProxy });
  await component.getIssueByLabels();
  await component.getCommentsV3();
  assertPublic(mock.calls, publicReadProxy);
  assert.equal(mock.calls[0].githubUrl.searchParams.get('labels'), 'Gitalk,Discussion,/含空格 page?&+');
  assert.equal(mock.calls[1].githubUrl.pathname, '/repos/example-owner/comments/issues/7/comments');
  for (const call of mock.calls) {
    assert.equal(call.rawUrl, `${publicReadProxy}?resource=${encodeURIComponent(call.githubUrl.pathname + call.githubUrl.search)}`);
  }
  assert.equal(new Headers(mock.calls[1].init.headers).get('Accept'), 'application/vnd.github.v3.full+json');
});

test('reads the current accessToken getter for every request across login and logout', async () => {
  let accessToken = '';
  const component = fixture({ number: 7, clientSecret: 'must-not-be-used' });
  Object.defineProperty(component, 'accessToken', { get: () => accessToken });
  const found = issue(7, 3);
  const mock = mockFetch([
    { data: found }, { data: found }, { data: [{ id: 1 }, { id: 2 }] }, { data: [{ id: 3 }] },
  ]);
  patchGitalkPublicReads(component, mock.fetcher);
  await component.getIssueById();
  accessToken = 'example-current-user-token';
  await component.getIssueById();
  await component.getCommentsV3();
  accessToken = '';
  await component.getCommentsV3();
  assertPublic([mock.calls[0], mock.calls[3]]);
  assertAuthenticated([mock.calls[1], mock.calls[2]], 'example-current-user-token');
  assert.equal(new Headers(mock.calls[1].init.headers).get('Accept'), 'application/vnd.github+json');
  assert.equal(new Headers(mock.calls[2].init.headers).get('Accept'), 'application/vnd.github.v3.full+json');
  for (const call of mock.calls) {
    assert.doesNotMatch(JSON.stringify(call), /Basic |must-not-be-used|public-example-client/);
  }
});

test('rejects unsafe public proxy addresses when patching before any fetch', () => {
  for (const publicReadProxy of [
    'https://example.com/comments', '//example.com/comments', 'api/github/comments',
    '/api\\github/comments', '\\example.com/comments',
    '/api/github/comments?extra=1', '/api/github/comments#fragment', '/api github/comments',
  ]) {
    const mock = mockFetch([]);
    assert.throws(() => patchGitalkPublicReads(fixture(), mock.fetcher, { publicReadProxy }));
    assert.equal(mock.calls.length, 0);
  }
});

test('rejects foreign hosts and issue paths outside the configured repository before any fetch', async () => {
  const invalidUrls = [
    'http://api.github.com/repos/example-owner/comments/issues/7/comments',
    'https://api.github.com.evil.example/repos/example-owner/comments/issues/7/comments',
    'https://user:pass@api.github.com/repos/example-owner/comments/issues/7/comments',
    'https://api.github.com:444/repos/example-owner/comments/issues/7/comments',
    'https://api.github.com/repos/another-owner/comments/issues/7/comments',
    'https://api.github.com/repos/example-owner/another-repo/issues/7/comments',
    'https://api.github.com/repos/example-owner/comments/pulls/7/comments',
    'https://api.github.com/user',
  ];
  for (const accessToken of ['', 'example-current-user-token']) {
    for (const comments_url of invalidUrls) {
      const component = fixture();
      component.accessToken = accessToken;
      component.state.issue = { ...issue(), comments_url };
      const mock = mockFetch([]);
      patchGitalkPublicReads(component, mock.fetcher);
      await assert.rejects(component.getCommentsV3(), error => error.response.status === 0);
      assert.equal(mock.calls.length, 0);
    }
  }
});

test('quota errors preserve status and show safe Chinese guidance for anonymous and signed-in readers', async () => {
  const rawMessage = 'API rate limit exceeded for 203.0.113.9';
  for (const accessToken of ['', 'example-current-user-token']) {
    for (const response of [
      { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
      { status: 429 },
    ]) {
      const component = fixture({ number: 7 });
      component.accessToken = accessToken;
      const mock = mockFetch([{ ...response, data: { message: rawMessage, errors: [{ message: rawMessage }] } }]);
      patchGitalkPublicReads(component, mock.fetcher);
      await assert.rejects(component.getIssueById(), error => {
        assert.equal(error.response.status, response.status);
        assert.doesNotMatch(JSON.stringify(error.response.data), /API rate limit|203\.0\.113\.9/);
        for (const message of [error.message, error.response.data.message]) {
          assert.match(message, /[\u4e00-\u9fff]/);
          assert.doesNotMatch(message, /API rate limit|203\.0\.113\.9|example-current-user-token/);
          if (accessToken) assert.doesNotMatch(message, /登录/);
          else assert.match(message, /登录/);
        }
        return true;
      });
      if (accessToken) assertAuthenticated(mock.calls, accessToken);
      else assertPublic(mock.calls);
    }
  }
});

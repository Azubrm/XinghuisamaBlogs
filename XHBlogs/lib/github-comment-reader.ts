// Server-only: this module must only be imported by Node.js Route Handlers.
type ReaderConfiguration = { clientId: string; owner: string; repo: string };
type ReaderDependencies = {
  secretProvider?: (clientId: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};
type Snapshot = { status: number; body: string; headers: Record<string, string> };
type CacheEntry = { expiresAt: number; value: Snapshot };

const ACCEPT_TYPES = new Set(['application/vnd.github+json', 'application/vnd.github.v3.full+json']);
const CACHE_TTL = 60_000;
const CACHE_LIMIT = 100;

function snapshot(body: unknown, status = 200, headers: Record<string, string> = {}): Snapshot {
  return { status, body: JSON.stringify(body), headers };
}

function failure(error: string, message: string, status: number, headers: Record<string, string> = {}): Snapshot {
  return snapshot({ error, message, error_description: message }, status, headers);
}

function response(value: Snapshot): Response {
  return new Response(value.body, {
    status: value.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...value.headers },
  });
}

function safeRateHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
    const value = headers.get(name);
    if (value && /^\d{1,16}$/.test(value)) result[name] = value;
  }
  return result;
}

function normalizedResource(resource: string, configuration: ReaderConfiguration): { path: string; list: boolean } | null {
  if (resource.length > 4096 || /[\\#\u0000-\u0020\u007f]/.test(resource)) return null;
  const queryStart = resource.indexOf('?');
  const pathname = queryStart < 0 ? resource : resource.slice(0, queryStart);
  const base = `/repos/${configuration.owner}/${configuration.repo}/issues`;
  const suffix = pathname.slice(base.length);
  if (pathname !== base && !(pathname.startsWith(`${base}/`) && /^\/[1-9]\d*(?:\/comments)?$/.test(suffix))) return null;
  const source = new URLSearchParams(queryStart < 0 ? '' : resource.slice(queryStart + 1));
  const selected = new Map<string, string>();
  for (const [key, value] of source) {
    if (key === 't') continue;
    if (!['labels', 'page', 'per_page'].includes(key) || selected.has(key)) return null;
    if (key === 'labels' && value.length > 500) return null;
    if (key === 'page' && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) return null;
    if (key === 'per_page' && (!/^[1-9]\d*$/.test(value) || Number(value) > 100)) return null;
    selected.set(key, value);
  }
  const query = new URLSearchParams();
  for (const key of ['labels', 'page', 'per_page']) {
    if (selected.has(key)) query.set(key, selected.get(key)!);
  }
  const search = query.toString();
  return { path: pathname + (search ? `?${search}` : ''), list: pathname === base || pathname.endsWith('/comments') };
}

export function createGitHubCommentReader(configuration: ReaderConfiguration, dependencies: ReaderDependencies = {}) {
  const config = { ...configuration };
  const validConfiguration = /^[a-zA-Z0-9]{10,64}$/.test(config.clientId)
    && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(config.owner)
    && /^[a-zA-Z0-9_.-]{1,100}$/.test(config.repo) && !['.', '..'].includes(config.repo);
  const now = dependencies.now ?? Date.now;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const secretProvider = dependencies.secretProvider ?? (async () => '');
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<Snapshot>>();
  let cooldown: { until: number; headers: Record<string, string> } | null = null;

  function limited(): Snapshot {
    const until = cooldown!.until;
    const message = `GitHub 评论接口请求过于频繁，请在 ${new Date(until).toISOString()} 后重试。`;
    return snapshot({ error: 'rate_limited', message, error_description: message, retryAt: new Date(until).toISOString() }, 429, {
      ...cooldown!.headers, 'retry-after': String(Math.max(1, Math.ceil((until - now()) / 1000))),
    });
  }

  async function retrieve(resource: { path: string; list: boolean }, accept: string, secret: string): Promise<Snapshot> {
    try {
      const upstream = await fetchImpl(`https://api.github.com${resource.path}`, {
        method: 'GET',
        headers: {
          Accept: accept,
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${secret}`, 'utf8').toString('base64')}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      const headers = safeRateHeaders(upstream.headers);
      if (upstream.status === 429 || (upstream.status === 403 && headers['x-ratelimit-remaining'] === '0')) {
        const timestamp = now();
        const reset = Number(headers['x-ratelimit-reset']) * 1000;
        const retryAfter = Number(headers['retry-after']) * 1000;
        const validTime = (value: number) => Number.isFinite(value) && value > timestamp && value <= 8_640_000_000_000_000 ? value : 0;
        const candidates = [validTime(reset), validTime(timestamp + retryAfter)];
        const until = Math.max(...candidates) || timestamp + 60_000;
        cooldown = { until, headers };
        return limited();
      }
      if (upstream.status === 401) return failure('invalid_credentials', 'GitHub 应用凭据无效，请检查服务器上的 Client ID 和 Client Secret。', 401, headers);
      if (upstream.status === 404) return failure('not_found', '评论仓库或评论主题暂不可用，请检查仓库名称并确认已开启 Issues。', 404, headers);
      if (!upstream.ok) return failure('github_unavailable', 'GitHub 评论服务暂不可用，请稍后重试。', upstream.status >= 500 ? 503 : 502, headers);
      const body = await upstream.json();
      if (!body || typeof body !== 'object' || (resource.list ? !Array.isArray(body) : Array.isArray(body))) {
        return failure('github_unavailable', 'GitHub 评论服务返回了无效数据，请稍后重试。', 502, headers);
      }
      return snapshot(body, 200, headers);
    } catch {
      return failure('github_unavailable', '暂时无法连接 GitHub 评论服务，请稍后重试。', 502);
    }
  }

  async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return response(failure('method_not_allowed', '评论读取接口仅支持 GET 请求。', 405));
    if (!validConfiguration) return response(failure('server_not_configured', 'GitHub 评论尚未配置完成，请检查应用和仓库设置。', 503));
    const url = new URL(request.url);
    const resources = url.searchParams.getAll('resource');
    const accept = (request.headers.get('accept') || 'application/vnd.github+json').trim().toLowerCase();
    if (resources.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'resource') || !ACCEPT_TYPES.has(accept)) {
      return response(failure('invalid_request', '无效的评论读取请求。', 400));
    }
    const resource = normalizedResource(resources[0], config);
    if (!resource) return response(failure('invalid_request', '仅允许读取当前评论仓库的公开主题和评论。', 400));

    let secret = '';
    try { secret = await secretProvider(config.clientId); } catch { /* Never expose credential files or errors. */ }
    if (!secret) return response(failure('server_not_configured', 'GitHub 评论所需的服务器密钥尚未配置，请在管理器保存 Client Secret。', 503));

    const key = `${accept}\n${resource.path}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return response(cached.value);
    }
    cache.delete(key);
    if (cooldown && cooldown.until > now()) return response(limited());
    cooldown = null;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = retrieve(resource, accept, secret).then(value => {
        if (value.status === 200) {
          for (const [entryKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(entryKey);
          cache.set(key, { expiresAt: now() + CACHE_TTL, value });
          while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        }
        return value;
      }).finally(() => { inFlight.delete(key); });
      inFlight.set(key, pending);
    }
    return response(await pending);
  }

  return { handle };
}

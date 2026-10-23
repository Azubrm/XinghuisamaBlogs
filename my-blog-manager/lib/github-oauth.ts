// Server-only helper. Import from Node.js Route Handlers, never client components.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type SecretReadOptions = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  readText?: (filename: string) => Promise<string>;
};

type ExchangeOptions = {
  fetchImpl?: typeof fetch;
  secretProvider?: (clientId: string) => Promise<string>;
};

function usableSecret(value: unknown): string {
  if (typeof value !== 'string') return '';
  const secret = value.trim();
  return secret && secret.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(secret) ? secret : '';
}

export async function readGitHubClientSecret(clientId: string, options: SecretReadOptions = {}): Promise<string> {
  if (!clientId) return '';
  const env = options.env ?? process.env;
  const environmentId = env.GITHUB_CLIENT_ID?.trim();
  if (environmentId && environmentId !== clientId) return '';
  const environmentSecret = usableSecret(env.GITHUB_CLIENT_SECRET);
  if (environmentSecret) return environmentSecret;

  try {
    const filename = path.resolve(options.cwd ?? process.cwd(), '..', '.local-runtime', 'github-oauth.json');
    const contents = await (options.readText ?? ((file: string) => readFile(file, 'utf8')))(filename);
    const stored = JSON.parse(contents);
    if (!stored || typeof stored !== 'object' || stored.clientId !== clientId) return '';
    return usableSecret(stored.clientSecret);
  } catch {
    return '';
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function failure(error: string, description: string, status: number): Response {
  return json({ error, error_description: description }, status);
}

export async function handleGitHubOAuthRequest(req: Request, clientId: string, options: ExchangeOptions = {}): Promise<Response> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) {
    return failure('invalid_request', 'Expected a JSON request.', 400);
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 8192) return failure('invalid_request', 'Invalid authorization request.', 400);
    body = JSON.parse(text);
  } catch {
    return failure('invalid_request', 'Invalid authorization request.', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return failure('invalid_request', 'Invalid authorization request.', 400);
  }
  const input = body as Record<string, unknown>;
  if (typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{8,512}$/.test(input.code) || typeof input.client_id !== 'string') {
    return failure('invalid_request', 'Invalid authorization request.', 400);
  }
  if (!clientId || input.client_id !== clientId) {
    return failure('client_id_mismatch', 'The OAuth application does not match this site.', 400);
  }

  let secret = '';
  try {
    secret = await (options.secretProvider ?? readGitHubClientSecret)(clientId);
  } catch {
    // Configuration errors must not expose file paths or credential contents.
  }
  if (!secret) return failure('server_not_configured', 'GitHub login is not configured on this server.', 503);

  try {
    // Only these server-selected fields may leave this application. Browser-supplied
    // client_secret and redirect_uri are deliberately ignored.
    const githubResponse = await (options.fetchImpl ?? fetch)('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code: input.code }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await githubResponse.json();
    if (githubResponse.status >= 500 || githubResponse.status === 429) {
      return failure('github_unavailable', 'GitHub authorization is temporarily unavailable. Please try again.', 502);
    }
    if (!githubResponse.ok || !data || typeof data !== 'object' || data.error) {
      const rejected = data?.error === 'bad_verification_code' || data?.error === 'expired_token';
      return failure('authorization_rejected', 'GitHub could not complete authorization. Please sign in again.', rejected ? 401 : 400);
    }
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 4096) {
      return failure('github_unavailable', 'GitHub returned an invalid authorization response.', 502);
    }
    return json({
      access_token: data.access_token,
      token_type: 'bearer',
      scope: typeof data.scope === 'string' && data.scope.length <= 4096 ? data.scope : '',
    });
  } catch {
    return failure('github_unavailable', 'GitHub authorization is temporarily unavailable. Please try again.', 502);
  }
}

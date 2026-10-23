import { readGitHubClientSecret } from '../../../../lib/github-oauth';
import { canManageGitHubSecret, saveGitHubClientSecret, validGitHubSecretInput } from '../../../../lib/github-secret-settings';

export const runtime = 'nodejs';

const respond = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get('client_id') || '';
  if (!/^[a-zA-Z0-9]{10,64}$/.test(clientId)) return respond({ configured: false });
  return respond({ configured: Boolean(await readGitHubClientSecret(clientId)) });
}

export async function PUT(request: Request) {
  if (!canManageGitHubSecret(request)) return respond({ success: false, message: '请从本机管理器保存密钥' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return respond({ success: false, message: '请求格式无效' }, 400);
  const raw = await request.text();
  if (raw.length > 2048) return respond({ success: false, message: '输入内容过长' }, 400);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return respond({ success: false, message: '请求格式无效' }, 400); }
  if (!validGitHubSecretInput(input)) return respond({ success: false, message: '请填写有效的 Client ID 和 Client Secret' }, 400);
  try {
    await saveGitHubClientSecret(input.clientId, input.clientSecret);
    return respond({ success: true, configured: true, message: '密钥已保存到本机' });
  } catch {
    return respond({ success: false, message: '保存失败，请检查本地目录权限' }, 500);
  }
}

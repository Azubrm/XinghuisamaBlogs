import { handleGitHubOAuthRequest } from '../../../lib/github-oauth';
import { siteConfig } from '../../../siteConfig';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handleGitHubOAuthRequest(req, siteConfig.gitalkConfig.clientID);
}

import { createGitHubCommentReader } from '../../../../lib/github-comment-reader';
import { readGitHubClientSecret } from '../../../../lib/github-oauth';
import { siteConfig } from '../../../../siteConfig';

export const runtime = 'nodejs';

const reader = createGitHubCommentReader({
  clientId: siteConfig.gitalkConfig.clientID,
  owner: siteConfig.gitalkConfig.owner,
  repo: siteConfig.gitalkConfig.repo,
}, { secretProvider: readGitHubClientSecret });

export async function GET(request: Request) {
  return reader.handle(request);
}

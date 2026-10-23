'use client';

import Gitalk from 'gitalk';
import { isLocalGitalkProxy, patchGitalkPublicReads, type GitalkReadInstance } from './gitalk-public-reads';

export function renderGitalk(options: Gitalk.GitalkOptions, container: HTMLElement): GitalkReadInstance | null {
  const clientID = typeof options.clientID === 'string' ? options.clientID.trim() : '';
  const owner = typeof options.owner === 'string' ? options.owner.trim() : '';
  const repo = typeof options.repo === 'string' ? options.repo.trim() : '';
  if (!clientID || !owner || !repo) {
    container.textContent = '评论功能尚未配置。';
    return null;
  }
  const tokenProxy = typeof options.proxy === 'string' ? options.proxy.trim() : '/api/github';
  if (!isLocalGitalkProxy(tokenProxy)) {
    container.textContent = '评论服务地址配置无效。';
    return null;
  }
  const publicReadProxy = `${tokenProxy.replace(/\/+$/, '')}/comments`;
  const gitalk = new Gitalk({
    ...options, clientID, owner, repo, clientSecret: '', proxy: tokenProxy,
    createIssueManually: true,
  });
  // Gitalk 1.8.0 returns its Preact component despite declaring render(): void.
  // Its initial public reads run in a promise microtask, so patch without await.
  const component: unknown = gitalk.render(container);
  return patchGitalkPublicReads(component, fetch, { publicReadProxy });
}

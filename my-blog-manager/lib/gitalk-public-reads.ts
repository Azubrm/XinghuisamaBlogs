type GitalkComment = Record<string, unknown>;

export interface GitalkIssue {
  number: number;
  comments: number;
  comments_url: string;
  [key: string]: unknown;
}

interface GitalkReadState {
  issue: GitalkIssue | null;
  comments: GitalkComment[];
  page: number;
  isNoInit?: boolean;
  isLoadOver?: boolean;
}

/** The small, version-specific part of Gitalk 1.8.0 used by public reads. */
export interface GitalkReadInstance {
  options: {
    owner: string;
    repo: string;
    id: string;
    labels: string[];
    number: number;
    perPage: number;
    createIssueManually: boolean;
  };
  state: GitalkReadState;
  readonly isAdmin: boolean | number | null;
  readonly accessToken?: string | null;
  setState(update: Partial<GitalkReadState>): void;
  createIssue(): Promise<GitalkIssue>;
  getIssue(): Promise<GitalkIssue | null>;
  getIssueById(): Promise<GitalkIssue | null>;
  getIssueByLabels(): Promise<GitalkIssue | null>;
  getCommentsV3(issue?: GitalkIssue | null): Promise<GitalkComment[] | undefined>;
}

type GithubError = Error & { response: { status: number; data: unknown } };

export interface GitalkPublicReadOptions {
  publicReadProxy?: string;
}

export function isLocalGitalkProxy(value: string): boolean {
  return /^\/(?!\/)[^\\\s?#]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGitalkInstance(value: unknown): value is GitalkReadInstance {
  if (!isRecord(value) || !isRecord(value.options) || !isRecord(value.state)) return false;
  return ['setState', 'getIssue', 'createIssue', 'getIssueById', 'getIssueByLabels', 'getCommentsV3']
    .every(method => typeof value[method] === 'function')
    && typeof value.options.owner === 'string'
    && typeof value.options.repo === 'string'
    && typeof value.options.id === 'string'
    && Array.isArray(value.options.labels)
    && Array.isArray(value.state.comments);
}

function githubError(status: number, data: unknown, fallback: string): GithubError {
  const message = isRecord(data) && typeof data.message === 'string' ? data.message : fallback;
  return Object.assign(new Error(message), { response: { status, data } });
}

function isIssue(value: unknown): value is GitalkIssue {
  return isRecord(value) && typeof value.number === 'number'
    && typeof value.comments === 'number' && typeof value.comments_url === 'string';
}

/** Patch the returned component synchronously, before its first promise runs. */
export function patchGitalkPublicReads(
  candidate: unknown,
  fetcher: typeof fetch = fetch,
  options: GitalkPublicReadOptions = {},
): GitalkReadInstance {
  const publicReadProxy = options.publicReadProxy ?? '/api/github/comments';
  if (typeof publicReadProxy !== 'string' || !isLocalGitalkProxy(publicReadProxy)) {
    throw githubError(0, { message: '评论代理地址无效。' }, '评论代理地址无效。');
  }
  if (!isGitalkInstance(candidate)) {
    throw new Error('当前 Gitalk 版本不支持安全的公开评论读取。');
  }
  const component = candidate;
  const issuePath = `/repos/${encodeURIComponent(component.options.owner)}/${encodeURIComponent(component.options.repo)}/issues`;

  async function read(url: URL, accept = 'application/vnd.github+json'): Promise<unknown> {
    const pathname = url.pathname.toLowerCase();
    const basePath = issuePath.toLowerCase();
    const allowedPath = pathname === basePath || (
      pathname.startsWith(`${basePath}/`) && /^\d+(?:\/comments)?$/.test(pathname.slice(basePath.length + 1))
    );
    if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.username || url.password || url.port || url.hash || !allowedPath) {
      throw githubError(0, { message: '评论接口地址无效。' }, '评论接口地址无效。');
    }
    // Read the getter at request time: login/logout can change it after mounting.
    const tokenValue = component.accessToken;
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
    const headers: Record<string, string> = { Accept: accept };
    if (token) headers.Authorization = `Bearer ${token}`;
    const target = token
      ? url.toString()
      : `${publicReadProxy}?resource=${encodeURIComponent(url.pathname + url.search)}`;
    let response: Response;
    try {
      response = await fetcher(target, {
        method: 'GET',
        headers,
        credentials: token ? 'omit' : 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw githubError(0, { message: '暂时无法连接 GitHub 评论服务。' }, '暂时无法连接 GitHub 评论服务。');
    }
    const remaining = response.headers?.get?.('x-ratelimit-remaining')?.trim();
    const limited = response.status === 429 || (response.status === 403 && remaining === '0');
    const quotaMessage = `GitHub 评论暂时达到访问上限，请稍后再试。${token ? '' : '也可以登录 GitHub 后重试。'}`;
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (limited) throw githubError(response.status, { message: quotaMessage }, quotaMessage);
      throw githubError(response.status, { message: 'GitHub 评论服务返回了无效数据。' }, 'GitHub 评论服务返回了无效数据。');
    }
    if (!response.ok) {
      let message = limited
        ? quotaMessage
        : response.status === 401 && token
          ? 'GitHub 登录已失效，请重新登录后再试。'
          : `GitHub 评论请求失败（${response.status}），请稍后再试。`;
      const proxyMessage = !token && isRecord(data) && typeof data.message === 'string' ? data.message : '';
      if (!limited && proxyMessage.length <= 300 && /[\u3400-\u9fff]/.test(proxyMessage)
        && !/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(proxyMessage)) {
        message = proxyMessage;
      }
      // Gitalk prioritizes response.data.message and also prints errors[].message.
      // Replace the payload instead of retaining upstream English/IP details.
      throw githubError(response.status, { message }, message);
    }
    return data;
  }

  function issuesUrl(number?: number): URL {
    const { owner, repo } = component.options;
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
    return new URL(`${path}${number === undefined ? '' : `/${number}`}`, 'https://api.github.com');
  }

  component.getIssueById = async () => {
    const { number } = component.options;
    const url = issuesUrl(number);
    try {
      const data = await read(url);
      if (!isIssue(data) || data.number !== number) return null;
      component.setState({ issue: data, isNoInit: false });
      return data;
    } catch (error) {
      if ((error as GithubError).response?.status === 404) return null;
      throw error;
    }
  };

  component.getIssueByLabels = async () => {
    const { id, labels, createIssueManually } = component.options;
    const url = issuesUrl();
    url.searchParams.set('labels', labels.concat(id).join(','));
    const data = await read(url);
    if (!Array.isArray(data)) throw githubError(200, { message: 'GitHub 评论主题数据无效。' }, 'GitHub 评论主题数据无效。');
    if (data.length === 0) {
      if (!createIssueManually && component.isAdmin) return component.createIssue();
      component.setState({ issue: null, isNoInit: true });
      return null;
    }
    const issue: unknown = data[0];
    if (!isIssue(issue)) throw githubError(200, { message: 'GitHub 评论主题数据无效。' }, 'GitHub 评论主题数据无效。');
    component.setState({ issue, isNoInit: false });
    return issue;
  };

  component.getCommentsV3 = async () => {
    const { perPage } = component.options;
    const { page } = component.state;
    const issue = await component.getIssue();
    if (!issue) return;
    const url = new URL(issue.comments_url);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    const data = await read(url, 'application/vnd.github.v3.full+json');
    if (!Array.isArray(data) || !data.every(isRecord)) {
      throw githubError(200, { message: 'GitHub 评论列表数据无效。' }, 'GitHub 评论列表数据无效。');
    }
    const comments = component.state.comments.concat(data);
    const currentIssue = component.state.issue || issue;
    component.setState({
      comments,
      isLoadOver: comments.length >= currentIssue.comments || data.length < perPage,
      page: page + 1,
    });
    return comments;
  };
  return component;
}

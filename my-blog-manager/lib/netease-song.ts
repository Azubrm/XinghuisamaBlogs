const POSITIVE_ID = /^[1-9]\d*$/;
const NETEASE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*music\.163\.com$/i;

function idFromRoute(pathname: string, parameters: URLSearchParams): string | null {
  const pathId = pathname.match(/^\/(?:m\/)?song\/([1-9]\d*)\/?$/);
  if (pathId) return pathId[1];
  if (!/^\/(?:m\/)?song\/?$/.test(pathname)) return null;
  const ids = parameters.getAll('id');
  return ids.length === 1 && POSITIVE_ID.test(ids[0]) ? ids[0] : null;
}

function idFromUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (!['https:', 'http:'].includes(url.protocol) || !NETEASE_HOST.test(url.hostname)) return null;
    if (url.username || url.password || url.port) return null;
    // The classic desktop site stores its route and query inside the fragment.
    if (url.pathname === '/' && url.hash.startsWith('#/')) {
      const route = url.hash.slice(1);
      const queryIndex = route.indexOf('?');
      return idFromRoute(
        queryIndex < 0 ? route : route.slice(0, queryIndex),
        new URLSearchParams(queryIndex < 0 ? '' : route.slice(queryIndex + 1)),
      );
    }
    return idFromRoute(url.pathname, url.searchParams);
  } catch {
    return null;
  }
}

/** Extract a song ID locally; never follow short links or convert IDs to numbers. */
export function extractNeteaseSongId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (POSITIVE_ID.test(value)) return value;

  // Support a full bare-domain link without treating arbitrary text as a URL.
  if (/^(?:\/\/)?(?:[a-z0-9-]+\.)*music\.163\.com(?::\d+)?\//i.test(value)) {
    return idFromUrl(`https://${value.replace(/^\/\//, '')}`);
  }

  // A copied share message may surround the complete URL with text or brackets.
  // Match whole URLs first, so a song URL embedded in another domain's query is
  // not mistaken for a standalone official link.
  const candidates = value.match(/https?:\/\/[^\s<>"'`()\[\]{}，。！？；、（）【】《》]+/gi) || [];
  for (const candidate of candidates) {
    const id = idFromUrl(candidate);
    if (id) return id;
  }
  return null;
}

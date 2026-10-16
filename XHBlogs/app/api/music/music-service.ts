const NET_EASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://music.163.com/',
}
const SUCCESS_TTL = 15 * 60 * 1000
const FAILURE_TTL = 60 * 1000

export type SongResult = {
  id: string
  name?: string
  artist?: string
  author?: string
  cover?: string
  pic?: string
  url?: string
  lrc?: string
  error?: string
  message?: string
  metadataUnavailable?: boolean
  metadataError?: string
}

type SongDetail = {
  name?: string
  artists?: { name?: string }[]
  album?: { picUrl?: string }
}
type DetailResult = { song: SongDetail } | { error: string; message: string }

function upstreamUrl(path: string, params: Record<string, string>) {
  const url = new URL(path, 'https://music.163.com')
  url.search = new URLSearchParams(params).toString()
  return url.toString()
}

export function createMusicLoader(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher || fetch
  const now = options.now || Date.now
  const cache = new Map<string, { expires: number; result: SongResult }>()
  const inFlight = new Map<string, Promise<SongResult>>()
  let detailQueue = Promise.resolve()
  let cooldown: { until: number; error: string; message: string } | undefined

  function upstreamFailure(error: string, message: string): DetailResult {
    cooldown = { until: now() + FAILURE_TTL, error, message }
    return { error, message }
  }

  async function getDetail(id: string): Promise<DetailResult> {
    if (cooldown && cooldown.until > now()) {
      return { error: cooldown.error, message: cooldown.message }
    }
    try {
      const response = await fetcher(upstreamUrl('/api/song/detail/', { id, ids: `[${id}]` }), {
        headers: NET_EASE_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(6000),
      })
      if (response.status === 429) {
        return upstreamFailure('rate_limited', '网易云歌曲信息请求受限，请稍后重试。')
      }
      if (response.status === 404) return { error: 'not_found', message: '未找到这首网易云歌曲。' }
      if (!response.ok) {
        return upstreamFailure('upstream_error', `网易云歌曲信息服务暂不可用（HTTP ${response.status}）。`)
      }
      const detail = await response.json()
      if (detail.code === 405 || detail.code === 429) {
        return upstreamFailure('rate_limited', '网易云歌曲信息请求受限，请稍后重试。')
      }
      if (detail.code === 404) return { error: 'not_found', message: '未找到这首网易云歌曲。' }
      if (detail.code !== 200 || !Array.isArray(detail.songs)) {
        return upstreamFailure('upstream_error', '网易云未返回有效的歌曲信息，请稍后重试。')
      }
      const song = detail.songs[0]
      return song && typeof song === 'object'
        ? { song }
        : { error: 'not_found', message: '未找到这首网易云歌曲。' }
    } catch {
      return upstreamFailure('upstream_error', '暂时无法连接网易云歌曲信息服务，请稍后重试。')
    }
  }

  function queuedDetail(id: string) {
    // One detail request at a time: a rate limit stops the rest of the batch.
    const pending = detailQueue.then(() => getDetail(id))
    detailQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  async function load(id: string): Promise<SongResult> {
    const detail = await queuedDetail(id)
    const url = upstreamUrl('/song/media/outer/url', { id: `${id}.mp3` })
    if ('error' in detail) {
      if (detail.error === 'not_found') return { id, ...detail }
      // Metadata failures do not prove audio is absent. Use only the ordinary
      // public audio endpoint, and confirm it returns audio before offering it.
      try {
        const audio = await fetcher(url, {
          method: 'HEAD', headers: NET_EASE_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(6000),
        })
        if (audio.ok && audio.headers.get('content-type')?.toLowerCase().startsWith('audio/')) {
          return {
            id, name: `网易云歌曲 ${id}`, artist: '未知歌手', author: '未知歌手',
            cover: '', pic: '', url, lrc: '', metadataUnavailable: true,
            metadataError: detail.error, message: `${detail.message}已找到公开音频，歌曲名称和封面暂不可用。`,
          }
        }
      } catch { /* Report audio unavailable without claiming a specific cause. */ }
      return {
        id, error: 'audio_unavailable', metadataUnavailable: true, metadataError: detail.error,
        message: `${detail.message}网易云未返回可播放的音频，可能受版权、登录状态或音源可用性影响。`,
      }
    }

    let lrc = ''
    try {
      const response = await fetcher(upstreamUrl('/api/song/lyric', { id, lv: '-1', kv: '-1', tv: '-1' }), {
        headers: NET_EASE_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(4000),
      })
      if (response.ok) {
        const lyrics = await response.json()
        if (lyrics.code === 200 && typeof lyrics.lrc?.lyric === 'string') lrc = lyrics.lrc.lyric
      }
    } catch { /* Lyrics are optional. */ }
    const { song } = detail
    const artist = song.artists?.[0]?.name || '未知歌手'
    const cover = song.album?.picUrl || ''
    return { id, name: song.name || `网易云歌曲 ${id}`, artist, author: artist, cover, pic: cover, url, lrc }
  }

  return function loadSong(id: string): Promise<SongResult> {
    if (!/^\d{1,20}$/.test(id)) return Promise.resolve({ id, error: 'invalid_id', message: '网易云歌曲 ID 必须为数字。' })
    const cached = cache.get(id)
    if (cached && cached.expires > now()) return Promise.resolve(cached.result)
    const pending = inFlight.get(id)
    if (pending) return pending
    const task = load(id).then((result) => {
      // A fallback needs a short retry window so names/covers can recover.
      const ttl = result.error || result.metadataUnavailable ? FAILURE_TTL : SUCCESS_TTL
      cache.delete(id)
      cache.set(id, { expires: now() + ttl, result })
      if (cache.size > 256) cache.delete(cache.keys().next().value!)
      return result
    }).finally(() => inFlight.delete(id))
    inFlight.set(id, task)
    return task
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { createMusicLoader } from '../app/api/music/music-service.ts'

const audioResponse = () => new Response(null, { headers: { 'content-type': 'audio/mpeg' } })

test('405 metadata response falls back only to verified audio, dedupes requests and retains order', async () => {
  const calls = []
  const load = createMusicLoader({ fetcher: async (input, init) => {
    const url = new URL(input)
    calls.push({ url, method: init.method })
    if (url.pathname === '/api/song/detail/') return Response.json({ code: 405, msg: '操作频繁' })
    assert.equal(init.method, 'HEAD')
    return audioResponse()
  } })
  const results = await Promise.all(['2', '1', '2'].map(load))
  assert.deepEqual(results.map((song) => song.id), ['2', '1', '2'])
  for (const song of results) {
    assert.equal(song.error, undefined)
    assert.equal(song.metadataUnavailable, true)
    assert.equal(song.metadataError, 'rate_limited')
    assert.equal(song.name, `网易云歌曲 ${song.id}`)
    assert.equal(new URL(song.url).searchParams.get('id'), `${song.id}.mp3`)
  }
  assert.equal(calls.filter((call) => call.url.pathname === '/api/song/detail/').length, 1)
  assert.equal(calls.filter((call) => call.method === 'HEAD').length, 2)
  await load('2')
  assert.equal(calls.length, 3)
})

test('HTML, failed HTTP and unreachable streams remain unavailable and never become playlist URLs', async () => {
  for (const mode of ['html', 'forbidden', 'timeout']) {
    const load = createMusicLoader({ fetcher: async (input, init) => {
      if (init.method !== 'HEAD') return Response.json({ code: 405 })
      if (mode === 'timeout') throw new Error('timeout')
      return new Response(null, { status: mode === 'forbidden' ? 403 : 200, headers: { 'content-type': 'text/html' } })
    } })
    const song = await load('2018179130')
    assert.equal(song.error, 'audio_unavailable')
    assert.equal(song.metadataError, 'rate_limited')
    assert.equal(song.url, undefined)
  }
})

test('metadata status and payload errors are distinguished from a genuinely absent song', async () => {
  for (const [status, payload, expected] of [
    [429, { code: 200, songs: [] }, 'rate_limited'],
    [503, { code: 200, songs: [] }, 'upstream_error'],
    [200, { code: 500 }, 'upstream_error'],
    [200, { code: 200, songs: [] }, 'not_found'],
    [404, {}, 'not_found'],
  ]) {
    let headCalls = 0
    const load = createMusicLoader({ fetcher: async (input, init) => {
      if (init.method === 'HEAD') { headCalls++; return audioResponse() }
      return Response.json(payload, { status })
    } })
    const song = await load('123')
    assert.equal(song.metadataError || song.error, expected)
    assert.equal(headCalls, expected === 'not_found' ? 0 : 1)
  }
})

test('successful metadata is cached, query parameters encoded, and lyric failure is optional', async () => {
  let time = 0
  const calls = []
  const load = createMusicLoader({ now: () => time, fetcher: async (input) => {
    const url = new URL(input)
    calls.push(url)
    if (url.pathname === '/api/song/lyric') throw new Error('lyric service unavailable')
    assert.equal(url.searchParams.get('id'), '123')
    assert.equal(url.searchParams.get('ids'), '[123]')
    assert.match(url.search, /%5B123%5D/)
    return Response.json({ code: 200, songs: [{ name: '歌曲', artists: [{ name: '歌手' }], album: { picUrl: 'https://example.com/cover.jpg' } }] })
  } })
  const song = await load('123')
  assert.equal(song.name, '歌曲')
  assert.equal(song.artist, '歌手')
  assert.equal(song.lrc, '')
  assert.equal(song.metadataUnavailable, undefined)
  time = 14 * 60 * 1000
  assert.deepEqual(await load('123'), song)
  assert.equal(calls.length, 2)
  time = 16 * 60 * 1000
  await load('123')
  assert.equal(calls.length, 4)
})

test('failure cooldown expires and lets metadata recover without repeated upstream calls', async () => {
  let time = 0
  let detailCalls = 0
  const load = createMusicLoader({ now: () => time, fetcher: async (input, init) => {
    const url = new URL(input)
    if (init.method === 'HEAD') return audioResponse()
    if (url.pathname === '/api/song/lyric') return Response.json({ code: 200 })
    detailCalls++
    return detailCalls === 1
      ? Response.json({ code: 405 })
      : Response.json({ code: 200, songs: [{ name: '恢复的歌曲' }] })
  } })
  assert.equal((await load('1')).metadataError, 'rate_limited')
  assert.equal((await load('2')).metadataError, 'rate_limited')
  assert.equal(detailCalls, 1)
  time = 60_001
  assert.equal((await load('1')).name, '恢复的歌曲')
  assert.equal(detailCalls, 2)
})

test('invalid IDs remain per-song errors without making an upstream request', async () => {
  const load = createMusicLoader({ fetcher: async () => { throw new Error('must not fetch') } })
  for (const id of ['1&ids=[2]', '-1', '', '123456789012345678901']) {
    assert.equal((await load(id)).error, 'invalid_id')
  }
})

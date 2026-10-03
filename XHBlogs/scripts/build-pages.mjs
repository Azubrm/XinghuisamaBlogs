import { existsSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteConfig } from '../siteConfig.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiPath = join(root, 'app', 'api');
const privateApiPath = join(root, 'app', '_api');
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '/XinghuisamaBlogs').replace(/\/$/, '');
if (basePath && (!basePath.startsWith('/') || basePath.startsWith('//'))) {
  throw new Error('NEXT_PUBLIC_BASE_PATH must be empty or an absolute URL path.');
}
if (existsSync(privateApiPath)) {
  throw new Error('app/_api already exists. Restore it to app/api before retrying the Pages build.');
}

const headers = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://music.163.com/',
};

async function readJson(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Music metadata returned HTTP ${response.status}`);
  return response.json();
}

async function getSong(id) {
  try {
    const [detail, lyric] = await Promise.all([
      readJson(`https://music.163.com/api/song/detail/?id=${encodeURIComponent(id)}&ids=${encodeURIComponent(JSON.stringify([id]))}`),
      readJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`).catch(() => null),
    ]);
    const song = detail.songs?.[0];
    if (!song) throw new Error('Song not found');
    return {
      id,
      name: song.name,
      artist: song.artists?.map(artist => artist.name).join(' / ') || '未知歌手',
      cover: (song.album?.picUrl || '').replace(/^http:/, 'https:'),
      url: `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(id)}.mp3`,
      lrc: lyric?.lrc?.lyric || '',
    };
  } catch (error) {
    console.warn(`Music metadata unavailable for ${id}: ${error.message}`);
    // Playback remains available when the optional metadata service is unreachable.
    return {
      id,
      name: `网易云歌曲 ${id}`,
      artist: '网易云音乐',
      cover: siteConfig.defaultPostCover,
      url: `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(id)}.mp3`,
      lrc: '',
    };
  }
}

let movedApi = false;
try {
  if (existsSync(apiPath)) {
    // Next.js private folders are excluded from routing. Restore the APIs even on failure.
    await rename(apiPath, privateApiPath);
    movedApi = true;
  }
  const result = spawnSync(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_STATIC_EXPORT: 'true', NEXT_PUBLIC_BASE_PATH: basePath },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Next.js build exited with status ${result.status}`);
  const songs = await Promise.all((siteConfig.cloudMusicIds || []).map(getSong));
  await writeFile(join(root, 'out', 'music.json'), JSON.stringify(songs, null, 2) + '\n');
  await writeFile(join(root, 'out', '.nojekyll'), '');
  // The template's domain belongs to its author; it must not be part of this deployment.
  await rm(join(root, 'out', 'CNAME'), { force: true });
  console.log(`Pages export ready: ${join(root, 'out')} (base path: ${basePath || '/'})`);
} finally {
  if (movedApi) await rename(privateApiPath, apiPath);
}

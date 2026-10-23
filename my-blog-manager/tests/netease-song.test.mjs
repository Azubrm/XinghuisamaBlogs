import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNeteaseSongId } from '../lib/netease-song.ts';

const ID = '2014336709';

test('accepts positive integer IDs without losing precision', () => {
  for (const id of [ID, '1', '9007199254740993123456789']) {
    assert.equal(extractNeteaseSongId(`  ${id}\n`), id);
  }
});

test('extracts IDs from official desktop, hash and mobile song links', () => {
  const links = [
    `https://music.163.com/song?id=${ID}&uct2=fake-share-parameter`,
    `http://music.163.com/song?id=${ID}`,
    `https://music.163.com/song/?uct2=fake&id=${ID}`,
    `https://music.163.com/#/song?id=${ID}&uct2=fake-share-parameter`,
    `https://music.163.com/#/song/${ID}`,
    `https://y.music.163.com/m/song?id=${ID}&uct2=fake-share-parameter`,
    `https://y.music.163.com/m/song/${ID}?uct2=fake-share-parameter`,
    `https://music.163.com/song/${ID}`,
    `https://music.163.com/song/${ID}/?uct2=fake`,
    `https://MUSIC.163.COM/song?id=${ID}`,
    `music.163.com/song?id=${ID}&uct2=fake-share-parameter`,
    `music.163.com/#/song?id=${ID}`,
    `y.music.163.com/m/song?id=${ID}`,
    `//music.163.com/song?id=${ID}`,
  ];
  for (const link of links) assert.equal(extractNeteaseSongId(link), ID, link);
});

test('accepts official links inside copied share text', () => {
  for (const text of [
    `分享歌曲：https://music.163.com/song?id=${ID}&uct2=made-up-parameter（网易云音乐）`,
    `【分享】「一首歌」 https://y.music.163.com/m/song?id=${ID}&uct2=fake。`,
    `Listen here (https://music.163.com/#/song?id=${ID})`,
    `分享歌曲\nhttps://music.163.com/song?id=${ID}\n快来听听`,
  ]) assert.equal(extractNeteaseSongId(text), ID, text);
});

test('rejects playlists, albums, artists and other non-song routes', () => {
  for (const route of ['playlist', 'album', 'artist', 'djradio', 'program', 'discover', 'song/abc', 'm/playlist']) {
    for (const prefix of ['https://music.163.com/', 'https://music.163.com/#/']) {
      const link = `${prefix}${route}?id=${ID}`;
      assert.equal(extractNeteaseSongId(link), null, link);
    }
  }
  assert.equal(extractNeteaseSongId(`https://music.163.com/playlist?id=1#/song?id=${ID}`), null);
  assert.equal(extractNeteaseSongId(`https://music.163.com/?id=${ID}`), null);
});

test('rejects other domains, lookalike hosts, credentials, ports and short links', () => {
  const links = [
    `https://example.com/song?id=${ID}`,
    `https://music.163.com.example.com/song?id=${ID}`,
    `https://notmusic.163.com/song?id=${ID}`,
    `https://music163.com/song?id=${ID}`,
    `https://music.163.com@example.com/song?id=${ID}`,
    `https://user:password@music.163.com/song?id=${ID}`,
    `https://music.163.com:1234/song?id=${ID}`,
    `https://example.com/?next=https://music.163.com/song?id=${ID}`,
    `example.com/music.163.com/song?id=${ID}`,
    'https://163cn.tv/fake-short-link',
    'https://163cn.tv/fake-short-link?id=2014336709',
    `ftp://music.163.com/song?id=${ID}`,
  ];
  for (const link of links) assert.equal(extractNeteaseSongId(link), null, link);
});

test('rejects empty, zero, signed, fractional, exponential and ambiguous IDs', () => {
  for (const id of ['', '0', '000', '0123', '-123', '+123', '1.5', '2e9', '123abc', '１２３', 'id=2014336709']) {
    assert.equal(extractNeteaseSongId(id), null, id);
    if (id) assert.equal(extractNeteaseSongId(`https://music.163.com/song?id=${encodeURIComponent(id)}`), null, id);
  }
  assert.equal(extractNeteaseSongId('https://music.163.com/song'), null);
  assert.equal(extractNeteaseSongId(`https://music.163.com/song?id=${ID}&id=1`), null);
});

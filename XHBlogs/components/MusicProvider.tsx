"use client";

import { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { siteConfig } from '../siteConfig';
import { isStaticExport, withBasePath } from '../lib/deployment';

// 【增强版 LRC 歌词解析】
function parseLrc(lrcText: string) {
  if (!lrcText || lrcText.length > 30000) return [];

  const lines = lrcText.split(/\r?\n/);
  const result = [];

  for (let line of lines) {
    const matches = [...line.matchAll(/\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]/g)];
    if (matches.length > 0) {
      let text = line.replace(/\[\d{2,}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();

      // 剔除控制字符
      const cleanText = text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "");

      if (cleanText) {
        for (const match of matches) {
          const min = parseInt(match[1]);
          const sec = parseInt(match[2]);
          const ms = match[3] ? parseInt(match[3]) : 0;
          const divisor = match[3] && match[3].length === 3 ? 1000 : 100;
          const time = min * 60 + sec + ms / divisor;
          result.push({ time, text: cleanText });
        }
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

// 🌟 1. 扩充 Context 类型，加入 MusicPage 需要的所有属性
type PlayMode = 'loop' | 'single' | 'random';

interface MusicContextType {
  playlist: any[];
  currentIndex: number;
  currentSong: any; // 扩展了 lyrics 属性
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  currentLyric: string;
  isLoading: boolean;
  loadError: string | null;
  playbackError: string | null;
  retryMusic: () => void;
  volume: number;
  isMuted: boolean;
  playMode: PlayMode;

  togglePlay: () => void;
  nextSong: () => void;
  prevSong: () => void;
  handleSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  playSong: (index: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  togglePlayMode: () => void;
}

const MusicContext = createContext<MusicContextType | null>(null);

export function MusicProvider({ children }: { children: ReactNode }) {
  const [playlist, setPlaylist] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyrics, setLyrics] = useState<{ time: number; text: string }[]>([]);
  const [currentLyric, setCurrentLyric] = useState("正在连接高可用神经云端...");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // 🌟 2. 新增音量和播放模式状态
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>('loop');

  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let isMounted = true;
    let timedOut = false;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setIsLoading(true);
    setLoadError(null);

    const fetchMusicData = async () => {
      try {
        if (!Array.isArray(siteConfig.cloudMusicIds)) {
          throw new Error('播放列表配置有误，请在后台重新保存音乐播放设置。');
        }
        if (siteConfig.cloudMusicIds.length === 0) {
          setPlaylist([]);
          setCurrentLyric('暂无歌曲');
          return;
        }
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 20000);
        const musicUrl = isStaticExport
          ? withBasePath('/music.json')
          : withBasePath(`/api/music?ids=${encodeURIComponent(siteConfig.cloudMusicIds.join(','))}`);
        const res = await fetch(musicUrl, { signal: controller.signal });
        if (!res.ok) throw new Error('音乐服务暂时不可用，请稍后重试。');
        const rawResults = await res.json();
        if (!Array.isArray(rawResults)) throw new Error('音乐服务返回了无效的歌单数据，请稍后重试。');

        const mergedPlaylist = rawResults
          .filter((song: any) => song && song.url && !song.error)
          .map((song: any) => ({
            id: song.id || Math.random().toString(),
            title: song.name || '未知歌曲',
            artist: song.artist || song.author || '未知歌手',
            cover: song.cover || song.pic || 'https://bu.dusays.com/2026/03/24/69c24230a5ff8.jpg',
            src: song.url,
            warning: song.warning || (song.metadataUnavailable ? '歌曲信息服务暂时受限，暂时无法显示完整歌名和歌词。' : null),
            lrcUrl: null,
            lyrics: song.lrc ? parseLrc(song.lrc) : []
          }));

        if (isMounted) {
          setPlaylist(mergedPlaylist);
          setCurrentIndex(0);
          setIsPlaying(false);
          setPlaybackError(null);
          if (mergedPlaylist.length === 0) {
            const reportedReason = rawResults.find((song: any) => typeof song?.message === 'string' && song.message.trim())?.message;
            const reason = reportedReason || '暂时无法获取歌曲信息，音乐服务可能受限，请稍后重试。';
            setLoadError(reason);
            setCurrentLyric(reason);
          }
        }
      } catch (error) {
        if (isMounted) {
          const reason = timedOut
            ? '加载歌单超时，请检查网络后重试。'
            : error instanceof TypeError
              ? '无法连接音乐服务，请检查网络后重试。'
              : error instanceof SyntaxError
                ? '音乐服务返回了无效的歌单数据，请稍后重试。'
                : error instanceof Error ? error.message : '歌单加载失败，请稍后重试。';
          setLoadError(reason);
          setCurrentLyric(reason);
        }
      } finally {
        if (timeout) clearTimeout(timeout);
        if (isMounted) setIsLoading(false);
      }
    };

    fetchMusicData();

    return () => {
      isMounted = false;
      if (timeout) clearTimeout(timeout);
      controller.abort();
    };
  }, [loadAttempt]);

  const retryMusic = () => setLoadAttempt(attempt => attempt + 1);

  const handlePlaybackError = () => {
    setIsPlaying(false);
    setPlaybackError('这首歌曲暂时无法播放，可能受版权或网络限制，请尝试下一首。');
  };

  useEffect(() => {
    const currentSong = playlist[currentIndex];
    if (!currentSong) return;
    let isMounted = true;
    setPlaybackError(null);
    setLyrics([]);
    setCurrentLyric("♪ 正在缓冲 ♪");
    if (currentSong.lyrics && currentSong.lyrics.length > 0) {
      if (isMounted) {
        setLyrics(currentSong.lyrics);
        setCurrentLyric(currentSong.lyrics[0]?.text || "\u266a \u7eaf\u4eab\u97f3\u4e50 \u266a");
      }
    } else if (currentSong.lrcUrl) {
      fetch(currentSong.lrcUrl)
        .then(res => res.text())
        .then(text => {
          if (isMounted) {
             const parsed = parseLrc(text);
             setLyrics(parsed);
             setPlaylist(prev => {
                const newPlaylist = [...prev];
                newPlaylist[currentIndex].lyrics = parsed;
                return newPlaylist;
             });
          }
        })
        .catch(() => { if (isMounted) setCurrentLyric("\u266a \u7eaf\u4eab\u97f3\u4e50 \u266a"); });
    } else {
      setCurrentLyric('♪ 纯享音乐 · 歌词暂不可用 ♪');
    }

    if (isPlaying && audioRef.current) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => { if (isMounted) handlePlaybackError(); });
      }
    }
    return () => { isMounted = false; };
  }, [currentIndex, playlist.length]); // 移除 playlist 依赖防止无限循环，只依赖长度

  // 🌟 4. 同步音量到 audio 元素
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const togglePlay = () => {
    if (audioRef.current) {
      setPlaybackError(null);
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play().catch(handlePlaybackError);
      setIsPlaying(!isPlaying);
    }
  };

  // 🌟 5. 重写 nextSong，加入对随机模式的处理
  const nextSong = () => {
    if (playlist.length === 0) return;
    if (playMode === 'random') {
      setCurrentIndex(Math.floor(Math.random() * playlist.length));
    } else {
      setCurrentIndex((prev) => (prev + 1) % playlist.length);
    }
  };

  const prevSong = () => {
    if (playlist.length === 0) return;
    if (playMode === 'random') {
      setCurrentIndex(Math.floor(Math.random() * playlist.length));
    } else {
      setCurrentIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
    }
  };

  // 🌟 6. 暴露直接播放指定歌曲的方法
  const playSong = (index: number) => {
    if (!playlist[index]) return;
    if (index === currentIndex && audioRef.current) {
      setPlaybackError(null);
      audioRef.current.play().then(() => setIsPlaying(true)).catch(handlePlaybackError);
      return;
    }
    setCurrentIndex(index);
    if (!isPlaying) setIsPlaying(true); // 保证切歌后自动播放
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const { currentTime, duration } = audioRef.current;
      setCurrentTime(currentTime);
      setDuration(duration || 0);
      setProgress((currentTime / (duration || 1)) * 100);

      if (lyrics.length > 0) {
        const activeLyric = lyrics.slice().reverse().find(l => currentTime >= l.time);
        if (activeLyric && activeLyric.text !== currentLyric) {
          setCurrentLyric(activeLyric.text);
        }
      }
    }
  };

  // 🌟 7. 处理歌曲结束
  const handleEnded = () => {
    if (playMode === 'single' && audioRef.current) {
       audioRef.current.currentTime = 0;
       audioRef.current.play().catch(handlePlaybackError);
    } else {
       nextSong();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newProgress = Number(e.target.value);
    setProgress(newProgress);
    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = (newProgress / 100) * audioRef.current.duration;
    }
  };

  const setVolume = (val: number) => {
    setVolumeState(val);
    if (isMuted && val > 0) setIsMuted(false);
  };

  const toggleMute = () => setIsMuted(!isMuted);

  const togglePlayMode = () => {
    setPlayMode(prev => {
      if (prev === 'loop') return 'single';
      if (prev === 'single') return 'random';
      return 'loop';
    });
  };

  const currentSong = playlist[currentIndex];

  return (
    <MusicContext.Provider value={{
        playlist, currentIndex, currentSong, isPlaying, progress, currentTime, duration, currentLyric, isLoading,
        loadError, playbackError, retryMusic,
        volume, isMuted, playMode, // 暴露新状态
        togglePlay, nextSong, prevSong, handleSeek,
        playSong, setVolume, toggleMute, togglePlayMode // 暴露新方法
    }}>
      {children}
      {currentSong && (
        <audio
          ref={audioRef}
          src={currentSong.src}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded} // 使用我们重写的结束处理
          onLoadedMetadata={handleTimeUpdate}
          onError={handlePlaybackError}
          onPlay={() => { setIsPlaying(true); setPlaybackError(null); }}
          onPause={() => setIsPlaying(false)}
        />
      )}
    </MusicContext.Provider>
  );
}

export const useMusic = () => {
  const context = useContext(MusicContext);
  if (!context) throw new Error("useMusic must be used within MusicProvider");
  return context;
};

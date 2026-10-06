/**
 * 播放器状态。与编辑器状态分开，避免播放进度的高频更新触发整棵编辑 UI 重渲染。
 */
import { create } from 'zustand';

export type MediaKind = 'video' | 'audio';

interface PlayerState {
  mediaUrl: string | null;
  mediaName: string | null;
  mediaKind: MediaKind | null;
  durationMs: number;
  currentTimeMs: number;
  isPlaying: boolean;
  /** 待执行的跳转请求；由 MediaPreview 消费后置空 */
  pendingSeek: number | null;
  muted: boolean;

  loadMedia: (file: File) => void;
  clearMedia: () => void;
  setDuration: (ms: number) => void;
  setCurrentTime: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  seek: (ms: number) => void;
  consumeSeek: () => void;
  toggleMute: () => void;
}

function kindOf(file: File): MediaKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  // 有些系统给不出 MIME，用扩展名兜底
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name) ? 'audio' : 'video';
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  mediaUrl: null,
  mediaName: null,
  mediaKind: null,
  durationMs: 0,
  currentTimeMs: 0,
  isPlaying: false,
  pendingSeek: null,
  muted: false,

  loadMedia(file) {
    const prev = get().mediaUrl;
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(file);
    set({
      mediaUrl: url,
      mediaName: file.name,
      mediaKind: kindOf(file),
      durationMs: 0,
      currentTimeMs: 0,
      isPlaying: false,
      pendingSeek: 0,
    });
  },

  clearMedia() {
    const prev = get().mediaUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      mediaUrl: null,
      mediaName: null,
      mediaKind: null,
      durationMs: 0,
      currentTimeMs: 0,
      isPlaying: false,
      pendingSeek: null,
    });
  },

  setDuration(ms) {
    set({ durationMs: ms });
  },

  setCurrentTime(ms) {
    set({ currentTimeMs: ms });
  },

  setPlaying(playing) {
    set({ isPlaying: playing });
  },

  seek(ms) {
    set({ pendingSeek: Math.max(0, ms), currentTimeMs: Math.max(0, ms) });
  },

  consumeSeek() {
    set({ pendingSeek: null });
  },

  toggleMute() {
    set((s) => ({ muted: !s.muted }));
  },
}));

/** 根据当前播放时间找出应当显示的字幕（按开始时间线性查找，条目通常不大） */
export function findActiveCue<T extends { start: number; end: number }>(
  cues: T[],
  timeMs: number,
): T | null {
  for (const cue of cues) {
    if (timeMs >= cue.start && timeMs < cue.end) return cue;
    if (cue.start > timeMs) break;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 媒体元素引用                                                        */
/* ------------------------------------------------------------------ */

/**
 * 由 MediaPreview 注册真实的 <video>/<audio> 元素，
 * 让全局快捷键（空格播放/暂停）不必把元素塞进 store 或层层传 ref。
 */
let mediaElement: HTMLMediaElement | null = null;

export function registerMediaElement(el: HTMLMediaElement | null): void {
  mediaElement = el;
}

export function getMediaElement(): HTMLMediaElement | null {
  return mediaElement;
}

/** 播放 / 暂停。没有加载媒体时静默返回。 */
export function togglePlayback(): void {
  const el = mediaElement;
  if (!el) return;
  if (el.paused) {
    void el.play().catch(() => {
      /* 浏览器可能因缺少用户手势而拒绝，忽略即可 */
    });
  } else {
    el.pause();
  }
}

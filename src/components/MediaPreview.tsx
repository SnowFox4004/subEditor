import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '../core/timecode';
import { useEditorStore } from '../state/store';
import {
  findActiveCue,
  registerMediaElement,
  usePlayerStore,
} from '../state/player';

interface DisplayBox {
  width: number;
  height: number;
}

export function MediaPreview() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const mediaUrl = usePlayerStore((s) => s.mediaUrl);
  const mediaName = usePlayerStore((s) => s.mediaName);
  const mediaKind = usePlayerStore((s) => s.mediaKind);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const pendingSeek = usePlayerStore((s) => s.pendingSeek);
  const muted = usePlayerStore((s) => s.muted);
  const loadMedia = usePlayerStore((s) => s.loadMedia);
  const clearMedia = usePlayerStore((s) => s.clearMedia);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const consumeSeek = usePlayerStore((s) => s.consumeSeek);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  const docs = useEditorStore((s) => s.docs);
  const activeId = useEditorStore((s) => s.activeId);
  const selection = useEditorStore((s) => s.selection);
  const doc = activeId ? docs[activeId] : null;

  const activeCue = useMemo(
    () => (doc ? findActiveCue(doc.cues, currentTimeMs) : null),
    [doc, currentTimeMs],
  );

  /**
   * 视频在容器里是「按比例尽量大」显示，四周可能留黑边。
   * 字幕必须贴在画面内而不是舞台底部，所以这里算出视频的实际显示尺寸，
   * 让叠加层跟它一模一样大并居中。
   */
  const [box, setBox] = useState<DisplayBox | null>(null);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const video = mediaRef.current;
    if (!frame || !video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      setBox(null);
      return;
    }
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    if (!fw || !fh) return;
    const scale = Math.min(fw / vw, fh / vh);
    setBox({ width: Math.round(vw * scale), height: Math.round(vh * scale) });
  }, []);

  // 舞台尺寸变化（拖拽分隔条、窗口缩放）时重新测量
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    measure();
    return () => ro.disconnect();
  }, [measure, mediaUrl]);

  // 把真实元素暴露给全局快捷键
  useEffect(() => {
    registerMediaElement(mediaUrl ? mediaRef.current : null);
    return () => registerMediaElement(null);
  }, [mediaUrl]);

  // 响应跳转请求
  useEffect(() => {
    if (pendingSeek === null) return;
    const el = mediaRef.current;
    if (el) {
      el.currentTime = pendingSeek / 1000;
      setCurrentTime(pendingSeek);
    }
    consumeSeek();
  }, [pendingSeek, mediaUrl, consumeSeek, setCurrentTime]);

  // 静音同步
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.muted = muted;
  }, [muted, mediaUrl]);

  const onPickFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      loadMedia(file);
    },
    [loadMedia],
  );

  if (!mediaUrl) {
    return (
      <div className="media-pane empty">
        <h2 style={{ fontSize: 14 }}>媒体预览</h2>
        <p style={{ fontSize: 12, maxWidth: 260 }}>
          载入本地视频或音频，字幕会按时间叠加显示，点任意字幕条即可跳转。
          <br />
          <strong>文件不会离开这台电脑。</strong>
        </p>
        <label className="btn primary">
          选择媒体文件
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="media-pane">
      <div className="media-head">
        <span className="media-name" title={mediaName ?? ''}>
          {mediaName}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="btn ghost icon"
          title={muted ? '取消静音' : '静音'}
          onClick={toggleMute}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="btn ghost icon" title="移除媒体" onClick={clearMedia}>
          ✕
        </button>
      </div>

      <div className={`media-stage ${mediaKind === 'audio' ? 'audio' : ''}`}>
        <div className="media-frame" ref={frameRef}>
          <video
            ref={mediaRef}
            className="media-el"
            src={mediaUrl}
            controls
            playsInline
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              setDuration(Number.isFinite(el.duration) ? el.duration * 1000 : 0);
              el.muted = muted;
              measure();
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime * 1000)}
            onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime * 1000)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />

          {mediaKind === 'video' && box && (
            <div
              className="subtitle-overlay"
              style={{ width: box.width, height: box.height }}
            >
              {activeCue?.text.split('\n').map((line, i) => (
                <div key={i} className="subtitle-line">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="media-foot">
        <span className="num">{formatDuration(currentTimeMs)}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>/</span>
        <span className="num" style={{ color: 'var(--text-tertiary)' }}>
          {formatDuration(durationMs)}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        {activeCue ? (
          <span className="media-current">
            #{activeCue.index}
            {selection.includes(activeCue.id) ? ' · 已选中' : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>无字幕</span>
        )}
        <span style={{ color: 'var(--text-tertiary)' }}>{isPlaying ? '播放中' : '已暂停'}</span>
      </div>

      {mediaKind === 'audio' && activeCue && (
        <div className="audio-subtitle">
          {activeCue.text.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

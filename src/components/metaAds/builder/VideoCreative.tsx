// A video creative: a real player (play/pause, seek, time, mute, volume,
// replay, full screen) and its cover — a frame the customer picks, or
// "Let HOMATCH choose" (deterministic frame statistics, lib/metaAds/videoCover).
// The cover is saved as its own still; the uploaded video is never altered.
import React, { useEffect, useRef, useState } from 'react';
import { Expand, ImageIcon, Loader2, Pause, Play, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { bestCover, formatTime, frameStats, sampleTimes, type FrameStats } from '@/lib/metaAds/videoCover';
import { saveVideoCover, type MetaCreativeRow } from '@/services/metaAds';
import { useMediaUrl } from './CreativeStep';

const SAMPLE_W = 96;

/** Seeks a video element and resolves once the frame is decoded. */
function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { v.removeEventListener('seeked', done); v.removeEventListener('error', fail); resolve(); };
    const fail = () => { v.removeEventListener('seeked', done); v.removeEventListener('error', fail); reject(new Error('seek')); };
    v.addEventListener('seeked', done); v.addEventListener('error', fail);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05));
  });
}

/** The current frame as a JPEG still at the video's own resolution. Throws if the frame cannot be read. */
function stillOf(v: HTMLVideoElement): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d');
  if (!g || !c.width) return Promise.reject(new Error('canvas'));
  g.drawImage(v, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.9));
}

export function VideoCreative({ creative, url, onChange }: { creative: MetaCreativeRow; url: string | null; onChange: (c: MetaCreativeRow) => void }) {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const m0 = creative.media[0];
  const coverUrl = useMediaUrl(m0?.cover?.path ?? null);
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number(m0?.duration) || 0);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [busy, setBusy] = useState<null | 'frame' | 'auto'>(null);

  useEffect(() => { if (video.current) { video.current.muted = muted; video.current.volume = volume; } }, [muted, volume]);

  const toggle = () => {
    const v = video.current; if (!v) return;
    if (v.paused || v.ended) { if (v.ended) v.currentTime = 0; void v.play().catch(() => undefined); } else v.pause();
  };
  const fullscreen = () => {
    const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const vid = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => vid?.webkitEnterFullscreen?.());
    else vid?.webkitEnterFullscreen?.();
  };

  const save = async (blob: Blob, at: number, auto: boolean) => {
    if (!homatchUser) return;
    const next = await saveVideoCover(homatchUser.id, creative, blob, at, auto);
    onChange(next);
    toast.success(t(auto ? 'mm_c_vid_cover_auto_done' : 'mm_c_vid_cover_saved', { time: formatTime(at) }));
  };

  const useFrame = async () => {
    const v = video.current; if (!v || busy) return;
    setBusy('frame');
    try { v.pause(); await save(await stillOf(v), v.currentTime, false); }
    catch { toast.error(t('mm_c_vid_cover_failed')); }
    finally { setBusy(null); }
  };

  /* Samples frames on a separate, hidden element so playback is untouched. */
  const autoPick = async () => {
    if (!url || busy) return;
    setBusy('auto');
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try {
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('load')); });
      const c = document.createElement('canvas');
      const h = Math.max(1, Math.round((SAMPLE_W * v.videoHeight) / Math.max(1, v.videoWidth)));
      c.width = SAMPLE_W; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) throw new Error('canvas');
      const stats: FrameStats[] = [];
      for (const at of sampleTimes(v.duration, 8)) {
        await seekTo(v, at);
        g.drawImage(v, 0, 0, SAMPLE_W, h);
        stats.push(frameStats(at, g.getImageData(0, 0, SAMPLE_W, h).data, SAMPLE_W, h));
      }
      const best = bestCover(stats);
      if (!best) throw new Error('none');
      await seekTo(v, best.t);
      await save(await stillOf(v), best.t, true);
    } catch { toast.error(t('mm_c_vid_cover_failed')); }
    finally { v.removeAttribute('src'); v.load(); setBusy(null); }
  };

  if (!url) return <Skeleton className="aspect-[9/16] max-h-80 w-full rounded-xl" />;
  const ctl = 'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]';

  return (
    <div className="space-y-2" data-mm-video={creative.id}>
      <div ref={box} className="overflow-hidden rounded-xl bg-black">
        <video ref={video} src={url} crossOrigin="anonymous" playsInline preload="metadata" poster={coverUrl ?? undefined}
          className="block max-h-80 w-full bg-black object-contain" onClick={toggle} data-mm-video-el=""
          onPlay={() => { setPlaying(true); setEnded(false); }} onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setEnded(true); }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }} />
        <div className="bg-[#0B1220] px-1 pb-1 text-white" data-mm-video-controls="">
          {/* The scrubber has its own full-width row, so it stays usable at 320 px. */}
          <input type="range" min={0} max={duration || 0} step={0.05} value={Math.min(time, duration || 0)} data-mm-video-seek=""
            aria-label={t('mm_c_vid_seek')} aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
            onChange={(e) => { const v = video.current; if (v) { v.currentTime = Number(e.target.value); setTime(Number(e.target.value)); } }}
            className="block h-8 w-full accent-[hsl(40_90%_62%)]" />
          <div className="flex items-center gap-1">
            <button type="button" className={ctl} onClick={toggle} data-mm-video-play=""
              aria-label={t(ended ? 'mm_c_vid_replay' : playing ? 'mm_c_vid_pause' : 'mm_c_vid_play')}>
              {ended ? <RotateCcw className="h-4 w-4" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="min-w-0 flex-1 px-1 text-2xs tabular-nums text-white/80" dir="ltr" data-mm-video-time="">{formatTime(time)} / {formatTime(duration)}</span>
            <button type="button" className={ctl} onClick={() => setMuted((m) => !m)} aria-pressed={!muted} data-mm-video-mute=""
              aria-label={t(muted ? 'mm_c_vid_unmute' : 'mm_c_vid_mute')}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={volume} aria-label={t('mm_c_vid_volume')} data-mm-video-volume=""
              onChange={(e) => { setVolume(Number(e.target.value)); if (Number(e.target.value) > 0) setMuted(false); }}
              className="hidden h-11 w-16 accent-[hsl(40_90%_62%)] sm:block" />
            <button type="button" className={ctl} onClick={fullscreen} aria-label={t('mm_c_vid_fullscreen')} data-mm-video-full="">
              <Expand className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border p-2.5" data-mm-video-cover={m0?.cover ? (m0.cover.auto ? 'auto' : 'manual') : 'meta'}>
        <div className="flex items-center gap-2.5">
          {coverUrl
            ? <img src={coverUrl} alt={t('mm_c_vid_cover_alt')} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-[hsl(var(--secondary))]"><ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden /></span>}
          <p className="min-w-0 text-2xs leading-relaxed text-muted-foreground">
            <span className="block text-[13px] font-semibold text-foreground">{t('mm_c_vid_cover_title')}</span>
            {m0?.cover
              ? t(m0.cover.auto ? 'mm_c_vid_cover_is_auto' : 'mm_c_vid_cover_is_manual', { time: formatTime(m0.cover.t) })
              : t('mm_c_vid_cover_none')}
          </p>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={useFrame} disabled={!!busy} data-mm-video-use-frame="">
            {busy === 'frame' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}{t('mm_c_vid_use_frame')}
          </Button>
          <Button type="button" variant="outline" size="sm" className={cn('min-h-11 gap-1.5')} onClick={autoPick} disabled={!!busy} data-mm-video-auto="">
            {busy === 'auto' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" />}{t('mm_c_vid_auto')}
          </Button>
        </div>
        <p className="mt-1.5 text-2xs text-muted-foreground">{t('mm_c_vid_cover_hint')}</p>
        <span className="sr-only" role="status" aria-live="polite">{busy ? t('mm_c_vid_cover_working') : ''}</span>
      </div>
    </div>
  );
}

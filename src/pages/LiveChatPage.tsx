import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Radio, Send, Pencil, Trash2, Flag, UserX, MoreVertical, MessageCircleReply, X, Loader2,
  MessageSquare, ImagePlus, Mic, Play, Pause, Bookmark, BookmarkCheck, Copy, SmilePlus, Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getMyLiveChatProfile, isNicknameAvailable, createLiveChatProfile, touchLiveChatActivity,
  getLiveChatMessages, getLiveChatProfiles, sendLiveChatMessage, editLiveChatMessage,
  deleteLiveChatMessage, reportLiveChatMessage, blockLiveChatUser, getMyBlockedUserIds,
  sendLiveChatPhoto, sendLiveChatVoice, getLiveChatMediaUrl,
  getLiveChatReactions, addLiveChatReaction, removeLiveChatReaction,
  saveLiveChatMessage, unsaveLiveChatMessage, getMySavedMessageIds, getMySavedMessages,
  LIVE_CHAT_REACTIONS, LIVE_CHAT_IMAGE_MIME, LIVE_CHAT_MAX_MEDIA_BYTES, LIVE_CHAT_VOICE_MAX_SECONDS,
  type LiveChatMessageRow, type LiveChatReactionRow, type LiveChatReactionEmoji,
} from '@/services/liveChat';
import { sendMessage as sendPrivateMessage } from '@/services/api3';
import type { LiveChatProfile } from '@/types/types';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const NICK_RE = /^[A-Za-z0-9_]{3,24}$/;

function initialsFor(nickname: string) {
  return nickname.slice(0, 2).toUpperCase();
}

/* The burst guard raises `LIVE_CHAT_COOLDOWN:<seconds remaining>`. The number
   is the backend's own, so showing it is honest; inventing one would not be. */
function cooldownSecondsFrom(message: string | undefined): number | null {
  const m = /LIVE_CHAT_COOLDOWN:(\d+)/.exec(message ?? '');
  return m ? Number(m[1]) : null;
}

function NicknameSetupDialog({ userId, onDone }: { userId: string; onDone: (p: LiveChatProfile) => void }) {
  const { t } = useLanguage();
  const [nickname, setNickname] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!NICK_RE.test(nickname)) { setError(t('live_chat_nickname_invalid')); return; }
    setChecking(true);
    setError(null);
    try {
      const available = await isNicknameAvailable(nickname);
      if (!available) { setError(t('live_chat_nickname_taken')); return; }
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
      const profile = await createLiveChatProfile(userId, nickname, color);
      onDone(profile);
    } catch {
      setError(t('live_chat_nickname_error'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Radio className="h-4 w-4 text-primary" />{t('live_chat_nickname_title')}</DialogTitle>
          <DialogDescription className="text-xs">{t('live_chat_nickname_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            placeholder={t('live_chat_nickname_placeholder')}
            value={nickname}
            onChange={e => setNickname(e.target.value.replace(/\s/g, ''))}
            maxLength={24}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[14px] text-muted-foreground">{t('live_chat_nickname_hint')}</p>
        </div>
        <DialogFooter>
          <Button className="w-full" disabled={checking || nickname.length < 3} onClick={submit}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t('live_chat_nickname_continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
        <DialogHeader><DialogTitle>{t('live_chat_report_title')}</DialogTitle></DialogHeader>
        <Input placeholder={t('live_chat_report_placeholder')} value={reason} onChange={e => setReason(e.target.value)} maxLength={280} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('live_chat_cancel')}</Button>
          <Button variant="destructive" disabled={!reason.trim()} onClick={() => { onSubmit(reason.trim()); setReason(''); }}>{t('live_chat_report_submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── MEDIA RENDERERS ──────────────────────────────────────────────────────
 * The bucket is private, so every render starts from a signed URL. The URL
 * is fetched once per mounted message and cached in component state; a
 * failure renders an honest failed state, never a broken image icon.
 */

function PhotoBubble({ path, caption, onDark }: { path: string; caption: string; onDark: boolean }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    getLiveChatMediaUrl(path).then(u => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path]);
  if (failed) return <p className="text-xs italic opacity-70">{t('live_chat_media_unavailable')}</p>;
  return (
    <div className="min-w-0">
      {url ? (
        <button type="button" onClick={() => setOpen(true)} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] rounded-xl">
          <img src={url} alt={caption || t('live_chat_photo_label')} className="max-h-64 w-auto max-w-full rounded-xl object-cover" loading="lazy" />
        </button>
      ) : (
        <Skeleton className="h-40 w-52 rounded-xl" />
      )}
      {caption ? <p className={cn('mt-1.5 text-sm break-words', onDark ? '' : '')}>{caption}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,60rem)] p-2">
          <DialogHeader className="sr-only"><DialogTitle>{t('live_chat_photo_label')}</DialogTitle></DialogHeader>
          {url && <img src={url} alt={caption || t('live_chat_photo_label')} className="max-h-[80vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VoiceBubble({ path, duration, onDark }: { path: string; duration: number; onDark: boolean }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    let alive = true;
    getLiveChatMediaUrl(path).then(u => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; audioRef.current?.pause(); };
  }, [path]);
  const toggle = () => {
    if (!url) return;
    if (!audioRef.current) {
      const a = new Audio(url);
      audioRef.current = a;
      a.addEventListener('timeupdate', () => setPosition(a.currentTime));
      a.addEventListener('ended', () => { setPlaying(false); setPosition(0); });
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { void audioRef.current.play(); setPlaying(true); }
  };
  if (failed) return <p className="text-xs italic opacity-70">{t('live_chat_media_unavailable')}</p>;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="flex min-w-[11rem] items-center gap-2.5" dir="ltr">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? t('live_chat_voice_pause') : t('live_chat_voice_play')}
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2',
          onDark
            ? 'bg-[hsl(38_92%_56%)] text-[#161309] hover:bg-[hsl(38_92%_62%)] focus-visible:ring-white/70'
            : 'bg-[#0C1119] text-[hsl(38_92%_60%)] hover:bg-[#1a2231] focus-visible:ring-[hsl(var(--ring))]',
        )}
      >
        {!url ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('h-1.5 w-full overflow-hidden rounded-full', onDark ? 'bg-white/25' : 'bg-[hsl(var(--border))]')}>
          <div className={cn('h-full rounded-full transition-[width]', onDark ? 'bg-white' : 'bg-[#0C1119]')} style={{ width: `${pct}%` }} />
        </div>
        <p className={cn('mt-1 text-2xs tabular-nums', onDark ? 'opacity-80' : 'text-muted-foreground')}>
          {playing || position > 0 ? fmt(position) : fmt(duration)}
        </p>
      </div>
    </div>
  );
}

/** One line describing a message for reply previews and the saved list. */
function messageGlance(m: LiveChatMessageRow, t: (k: never) => string): string {
  if (m.kind === 'PHOTO') return `📷 ${(m.body || (t as (k: string) => string)('live_chat_photo_label'))}`.slice(0, 60);
  if (m.kind === 'VOICE') return `🎙 ${(t as (k: string) => string)('live_chat_voice_label')}`;
  return m.body.slice(0, 60);
}

export default function LiveChatPage() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<LiveChatProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [messages, setMessages] = useState<LiveChatMessageRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, LiveChatProfile>>({});
  const [blocked, setBlocked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<LiveChatMessageRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, LiveChatReactionRow[]>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedList, setSavedList] = useState<Array<{ saved_at: string; message: LiveChatMessageRow }>>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  /* Voice recorder: idle → recording → previewing a blob → sending. */
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceDraft, setVoiceDraft] = useState<{ blob: Blob; seconds: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadProfiles = useCallback(async (rows: LiveChatMessageRow[]) => {
    const ids = rows.map(r => r.user_id);
    const map = await getLiveChatProfiles(ids);
    setProfiles(prev => ({ ...prev, ...map }));
  }, []);

  const loadReactions = useCallback(async (rows: LiveChatMessageRow[]) => {
    try {
      const list = await getLiveChatReactions(rows.map(r => r.id));
      setReactions(prev => {
        const next = { ...prev };
        for (const row of rows) next[row.id] = [];
        for (const r of list) (next[r.message_id] = next[r.message_id] ?? []).push(r);
        return next;
      });
    } catch { /* reactions are decoration; the room works without them */ }
  }, []);

  useEffect(() => {
    if (!homatchUser) return;
    getMyLiveChatProfile(homatchUser.id)
      .then(p => { setProfile(p); })
      .catch(() => { toast.error(t('live_chat_profile_load_error')); })
      .finally(() => setProfileLoading(false));
    getMyBlockedUserIds(homatchUser.id).then(setBlocked).catch(() => { console.error('[LiveChatPage] failed to load blocked users'); });
    getMySavedMessageIds(homatchUser.id).then(ids => setSavedIds(new Set(ids))).catch(() => {});
  }, [homatchUser, t]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getLiveChatMessages();
      setMessages(rows);
      setHasMore(rows.length > 0);
      await Promise.all([loadProfiles(rows), loadReactions(rows)]);
    } finally {
      setLoading(false);
    }
  }, [loadProfiles, loadReactions]);

  useEffect(() => { if (profile) loadInitial(); }, [profile, loadInitial]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel('live_chat_messages_stream')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_chat_messages' }, payload => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as LiveChatMessageRow;
          setMessages(prev => (prev.find(m => m.id === row.id) ? prev : [...prev, row]));
          loadProfiles([row]);
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as LiveChatMessageRow;
          setMessages(prev => prev.map(m => (m.id === row.id ? row : m)));
        }
      })
      /* Reactions ride the same publication; both events keep the local
         aggregate honest without refetching the room. */
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_chat_reactions' }, payload => {
        if (payload.eventType === 'INSERT') {
          const r = payload.new as LiveChatReactionRow;
          setReactions(prev => {
            const list = prev[r.message_id] ?? [];
            if (list.some(x => x.user_id === r.user_id && x.emoji === r.emoji)) return prev;
            return { ...prev, [r.message_id]: [...list, r] };
          });
        } else if (payload.eventType === 'DELETE') {
          const r = payload.old as Partial<LiveChatReactionRow>;
          if (!r.message_id) return;
          setReactions(prev => ({
            ...prev,
            [r.message_id!]: (prev[r.message_id!] ?? []).filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji)),
          }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, loadProfiles]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  /* Recorder teardown on unmount, so navigating away releases the mic. */
  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recorderRef.current?.stream.getTracks().forEach(t_ => t_.stop());
  }, []);

  const loadOlder = async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const older = await getLiveChatMessages(messages[0].seq);
      if (older.length === 0) { setHasMore(false); return; }
      setMessages(prev => [...older, ...prev]);
      await Promise.all([loadProfiles(older), loadReactions(older)]);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } finally {
      setLoadingMore(false);
    }
  };

  const surfaceSendError = (e: unknown) => {
    const msg = (e as { message?: string })?.message ?? '';
    const cooldown = cooldownSecondsFrom(msg);
    if (cooldown != null) {
      toast.error(t('live_chat_cooldown_wait', { seconds: String(cooldown) }));
    } else if (/row-level security|violates check|LIVE_CHAT/i.test(msg)) {
      toast.error(t('live_chat_rate_limited'));
    } else if (/VOICE_TOO_LONG/.test(msg)) {
      toast.error(t('live_chat_voice_too_long'));
    } else if (/MEDIA_TOO_LARGE|maximum allowed size/i.test(msg)) {
      toast.error(t('live_chat_media_too_large'));
    } else {
      toast.error(t('live_chat_send_failed'));
    }
  };

  const handleSend = async () => {
    if (!text.trim() || !homatchUser) return;
    setSending(true);
    const body = text.trim();
    try {
      if (editingId) {
        await editLiveChatMessage(editingId, body);
        setMessages(prev => prev.map(m => (m.id === editingId ? { ...m, body, edited_at: new Date().toISOString() } : m)));
        setEditingId(null);
      } else {
        await sendLiveChatMessage(homatchUser.id, body, replyTo?.id ?? null);
        touchLiveChatActivity(homatchUser.id).catch(() => {});
        setReplyTo(null);
      }
      setText('');
    } catch (e) {
      surfaceSendError(e);
    } finally {
      setSending(false);
    }
  };

  const handlePickPhoto = () => fileInputRef.current?.click();

  const handlePhotoChosen = async (file: File | null) => {
    if (!file || !homatchUser) return;
    if (!LIVE_CHAT_IMAGE_MIME.includes(file.type as (typeof LIVE_CHAT_IMAGE_MIME)[number])) {
      toast.error(t('live_chat_photo_type'));
      return;
    }
    if (file.size > LIVE_CHAT_MAX_MEDIA_BYTES) { toast.error(t('live_chat_media_too_large')); return; }
    setSending(true);
    try {
      /* Whatever is in the composer travels as the caption. */
      await sendLiveChatPhoto(homatchUser.id, file, text.trim(), replyTo?.id ?? null);
      touchLiveChatActivity(homatchUser.id).catch(() => {});
      setText('');
      setReplyTo(null);
    } catch (e) {
      surfaceSendError(e);
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    if (recording || voiceDraft) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t('live_chat_mic_denied'));
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    const startedAt = Date.now();
    discardRef.current = false;
    rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t_ => t_.stop());
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
      setRecording(false);
      if (discardRef.current) { setRecordSeconds(0); return; }
      const seconds = Math.min(LIVE_CHAT_VOICE_MAX_SECONDS, (Date.now() - startedAt) / 1000);
      if (seconds < 0.5 || chunks.length === 0) { setRecordSeconds(0); return; }
      setVoiceDraft({ blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), seconds });
      setRecordSeconds(0);
    };
    recorderRef.current = rec;
    setRecording(true);
    setRecordSeconds(0);
    rec.start(250);
    recordTimerRef.current = setInterval(() => {
      setRecordSeconds(prev => {
        const next = prev + 1;
        /* The hard stop the UI promises: 60 seconds, not one more. */
        if (next >= LIVE_CHAT_VOICE_MAX_SECONDS && rec.state === 'recording') rec.stop();
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); };
  const cancelRecording = () => {
    discardRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setVoiceDraft(null);
  };

  const sendVoiceDraft = async () => {
    if (!voiceDraft || !homatchUser) return;
    setSending(true);
    try {
      await sendLiveChatVoice(homatchUser.id, voiceDraft.blob, voiceDraft.seconds, replyTo?.id ?? null);
      touchLiveChatActivity(homatchUser.id).catch(() => {});
      setVoiceDraft(null);
      setReplyTo(null);
    } catch (e) {
      surfaceSendError(e);
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = async (msg: LiveChatMessageRow, emoji: LiveChatReactionEmoji) => {
    if (!homatchUser) return;
    const mine = (reactions[msg.id] ?? []).some(r => r.user_id === homatchUser.id && r.emoji === emoji);
    /* Optimistic: realtime confirms; on failure the local change reverts. */
    setReactions(prev => {
      const list = prev[msg.id] ?? [];
      return {
        ...prev,
        [msg.id]: mine
          ? list.filter(r => !(r.user_id === homatchUser.id && r.emoji === emoji))
          : [...list, { message_id: msg.id, user_id: homatchUser.id, emoji, created_at: new Date().toISOString() }],
      };
    });
    try {
      if (mine) await removeLiveChatReaction(homatchUser.id, msg.id, emoji);
      else await addLiveChatReaction(homatchUser.id, msg.id, emoji);
    } catch {
      await loadReactions([msg]);
      toast.error(t('live_chat_action_failed'));
    }
  };

  const toggleSaved = async (msg: LiveChatMessageRow) => {
    if (!homatchUser) return;
    const isSaved = savedIds.has(msg.id);
    setSavedIds(prev => {
      const next = new Set(prev);
      if (isSaved) next.delete(msg.id); else next.add(msg.id);
      return next;
    });
    try {
      if (isSaved) await unsaveLiveChatMessage(homatchUser.id, msg.id);
      else { await saveLiveChatMessage(homatchUser.id, msg.id); toast.success(t('live_chat_saved_toast')); }
    } catch {
      setSavedIds(prev => {
        const next = new Set(prev);
        if (isSaved) next.add(msg.id); else next.delete(msg.id);
        return next;
      });
      toast.error(t('live_chat_action_failed'));
    }
  };

  const openSaved = async () => {
    if (!homatchUser) return;
    setSavedOpen(true);
    setSavedLoading(true);
    try {
      setSavedList(await getMySavedMessages(homatchUser.id));
    } catch {
      toast.error(t('live_chat_action_failed'));
    } finally {
      setSavedLoading(false);
    }
  };

  const jumpToMessage = (id: string) => {
    setSavedOpen(false);
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast.info(t('live_chat_saved_not_loaded'));
  };

  const copyMessage = async (msg: LiveChatMessageRow) => {
    try {
      await navigator.clipboard.writeText(msg.body);
      toast.success(t('live_chat_copied'));
    } catch {
      toast.error(t('live_chat_action_failed'));
    }
  };

  const handleDelete = async (id: string) => {
    await deleteLiveChatMessage(id);
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, deleted_at: new Date().toISOString() } : m)));
  };

  const handleBlock = async (userId: string) => {
    if (!homatchUser) return;
    try {
      await blockLiveChatUser(homatchUser.id, userId);
      setBlocked(prev => [...prev, userId]);
      toast.success(t('live_chat_user_blocked'));
    } catch {
      toast.error(t('live_chat_action_failed'));
    }
  };

  const handleReport = async (reason: string) => {
    if (!reportTarget || !homatchUser) return;
    try {
      await reportLiveChatMessage(reportTarget, homatchUser.id, reason);
      toast.success(t('live_chat_report_sent'));
    } catch {
      toast.error(t('live_chat_action_failed'));
    } finally {
      setReportTarget(null);
    }
  };

  const handlePrivateMessage = async (userId: string) => {
    try {
      const { conversation_id } = await sendPrivateMessage(userId, t('live_chat_dm_opener'));
      navigate(`/chat?conversation=${conversation_id}`);
    } catch {
      toast.error(t('live_chat_action_failed'));
    }
  };

  /*
   * THE PAGE EXISTS BEHIND THE SETUP DIALOG.
   *
   * This branch used to render the dialog and NOTHING else. A dialog is
   * portalled out of the page, so what was actually behind it was an
   * empty document with no heading — measured as four characters of
   * content, all of them the back button. Anyone who dismissed the dialog
   * was looking at a blank screen, and there was no h1 for a screen
   * reader to land on.
   */
  if (!profileLoading && homatchUser && !profile) {
    return (
      <RouteGuard>
        <AppLayout>
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <h1 className="font-display text-2xl font-bold tracking-[-0.015em]">{t('live_chat_title')}</h1>
                <p className="text-base text-ink-soft">{t('live_chat_subtitle')}</p>
              </div>
            </div>
            <p className="measure mt-4 text-base leading-relaxed text-muted-foreground">
              {t('live_chat_nickname_needed')}
            </p>
          </div>
          <NicknameSetupDialog userId={homatchUser.id} onDone={setProfile} />
        </AppLayout>
      </RouteGuard>
    );
  }

  const visibleMessages = messages.filter(m => !blocked.includes(m.user_id));
  /* Deterministic, role-free starters for an empty room — plain templates a
     tap places INTO the composer for editing. No model call anywhere. */
  const STARTERS = ['live_chat_starter_hello', 'live_chat_starter_looking', 'live_chat_starter_selling', 'live_chat_starter_market'] as const;

  return (
    <RouteGuard>
      {/*
       * hidePadding, like /ai: the shell becomes a fixed-height flex column
       * (window minus the real header), so h-full below is the space that is
       * actually left — no header-height guess, and none of the shell's
       * pb-24 bottom padding, which on a self-sized screen was pure overflow
       * that made the whole page scroll behind the composer.
       */}
      <AppLayout hidePadding>
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden">
          {/* The product's navy identity strip — structure over the white
              conversation workspace, same grammar as every other family. */}
          <div className="flex shrink-0 items-center gap-2.5 bg-[#0C1119] px-4 py-3 text-white">
            <Radio className="h-5 w-5 text-[hsl(38_92%_60%)]" />
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-white">{t('live_chat_title')}</h1>
              <p className="text-[13px] text-white/70">{t('live_chat_subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={openSaved}
              aria-label={t('live_chat_saved_title')}
              className="grid h-9 w-9 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            >
              <Bookmark className="h-[1.1rem] w-[1.1rem]" />
            </button>
          </div>

          <div ref={scrollRef} onScroll={e => { if (e.currentTarget.scrollTop < 40) loadOlder(); }} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}><Skeleton className="h-10 w-48 rounded-2xl" /></div>
              ))
            ) : visibleMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-gold/10 ring-1 ring-inset ring-gold/25 text-gold-ink" aria-hidden="true">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{t('live_chat_empty')}</p>
                <p className="text-xs text-muted-foreground">{t('live_chat_empty_desc')}</p>
                <div className="mt-2 flex max-w-sm flex-wrap justify-center gap-2">
                  {STARTERS.map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setText(t(key))}
                      className="rounded-full border border-[hsl(var(--border))] bg-card px-3 py-1.5 text-[13px] font-medium text-foreground shadow-card transition-colors hover:border-[hsl(var(--gold-border))]"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {loadingMore && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
                {visibleMessages.map(msg => {
                  const author = profiles[msg.user_id];
                  const isMine = msg.user_id === homatchUser?.id;
                  const isDeleted = !!msg.deleted_at;
                  const isHidden = msg.hidden_by_admin && !isMine;
                  const replySource = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
                  const msgReactions = reactions[msg.id] ?? [];
                  const byEmoji = new Map<string, LiveChatReactionRow[]>();
                  for (const r of msgReactions) (byEmoji.get(r.emoji) ?? byEmoji.set(r.emoji, []).get(r.emoji)!).push(r);
                  const isSaved = savedIds.has(msg.id);
                  return (
                    <div key={msg.id} data-msg-id={msg.id} className={cn('flex gap-2', isMine ? 'justify-end' : 'justify-start')}>
                      {!isMine && (
                        <Avatar className="h-7 w-7 shrink-0 mt-1">
                          <AvatarFallback style={{ backgroundColor: (author?.avatar_color ?? '#6366f1') + '33', color: author?.avatar_color ?? '#6366f1' }} className="text-[13px] font-semibold">
                            {initialsFor(author?.nickname ?? '??')}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className={cn('max-w-[75%] group', isMine && 'flex flex-col items-end')}>
                        {!isMine && <p className="text-[14px] font-medium text-muted-foreground mb-0.5 px-1">{author?.nickname ?? t('live_chat_unknown_user')}</p>}
                        {replySource && !isDeleted && (
                          <button
                            type="button"
                            onClick={() => jumpToMessage(replySource.id)}
                            className="mb-1 max-w-[220px] truncate border-l-2 border-gold pl-1.5 text-start text-[13px] text-muted-foreground hover:text-foreground"
                          >
                            {profiles[replySource.user_id]?.nickname ?? '…'}: {messageGlance(replySource, t as never)}
                          </button>
                        )}
                        <div className={cn('flex items-center gap-1', isMine ? 'flex-row-reverse' : 'flex-row')}>
                          <div className={cn(
                            'px-3.5 py-2 rounded-2xl text-sm break-words',
                            isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm',
                            (isDeleted || isHidden) && 'italic text-muted-foreground bg-transparent border border-dashed border-border',
                          )}>
                            {isDeleted ? t('live_chat_message_deleted')
                              : isHidden ? t('live_chat_message_hidden')
                              : msg.kind === 'PHOTO' && msg.media_path ? <PhotoBubble path={msg.media_path} caption={msg.body} onDark={isMine} />
                              : msg.kind === 'VOICE' && msg.media_path ? <VoiceBubble path={msg.media_path} duration={Number(msg.media_meta?.duration_seconds ?? 0)} onDark={isMine} />
                              : msg.body}
                            {msg.edited_at && !isDeleted && <span className="text-2xs opacity-60 ms-1.5">{t('live_chat_edited')}</span>}
                          </div>
                          {!isDeleted && !isHidden && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={t('live_chat_message_menu')} className="h-6 w-6 opacity-60 transition-opacity group-hover:opacity-100 shrink-0 focus-visible:opacity-100">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align={isMine ? 'end' : 'start'}>
                                {/* React: the fixed palette, one row. */}
                                <div className="flex items-center gap-0.5 px-2 py-1.5" role="group" aria-label={t('live_chat_react')}>
                                  {LIVE_CHAT_REACTIONS.map(e => {
                                    const mine = msgReactions.some(r => r.user_id === homatchUser?.id && r.emoji === e);
                                    return (
                                      <button
                                        key={e}
                                        type="button"
                                        aria-label={`${t('live_chat_react')} ${e}`}
                                        aria-pressed={mine}
                                        onClick={() => toggleReaction(msg, e)}
                                        className={cn('grid h-8 w-8 place-items-center rounded-lg text-base transition-colors hover:bg-[hsl(var(--secondary))]', mine && 'bg-[hsl(var(--gold-soft))] ring-1 ring-inset ring-[hsl(var(--gold-border))]/60')}
                                      >
                                        {e}
                                      </button>
                                    );
                                  })}
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setReplyTo(msg)} className="gap-2"><MessageCircleReply className="h-3.5 w-3.5" />{t('live_chat_reply')}</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toggleSaved(msg)} className="gap-2">
                                  {isSaved ? <BookmarkCheck className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" /> : <Bookmark className="h-3.5 w-3.5" />}
                                  {isSaved ? t('live_chat_unsave') : t('live_chat_save')}
                                </DropdownMenuItem>
                                {msg.kind === 'TEXT' && (
                                  <DropdownMenuItem onClick={() => copyMessage(msg)} className="gap-2"><Copy className="h-3.5 w-3.5" />{t('live_chat_copy')}</DropdownMenuItem>
                                )}
                                {isMine ? (
                                  <>
                                    {msg.kind === 'TEXT' && (
                                      <DropdownMenuItem onClick={() => { setEditingId(msg.id); setText(msg.body); }} className="gap-2"><Pencil className="h-3.5 w-3.5" />{t('live_chat_edit')}</DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem onClick={() => handleDelete(msg.id)} className="gap-2 text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5" />{t('live_chat_delete')}</DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem onClick={() => handlePrivateMessage(msg.user_id)} className="gap-2"><MessageSquare className="h-3.5 w-3.5" />{t('live_chat_send_private')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setReportTarget(msg.id)} className="gap-2"><Flag className="h-3.5 w-3.5" />{t('live_chat_report')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleBlock(msg.user_id)} className="gap-2 text-destructive focus:text-destructive"><UserX className="h-3.5 w-3.5" />{t('live_chat_block')}</DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        {/* Aggregated reactions, mine highlighted; tap toggles. */}
                        {byEmoji.size > 0 && !isDeleted && !isHidden && (
                          <div className={cn('mt-1 flex flex-wrap gap-1', isMine && 'justify-end')}>
                            {[...byEmoji.entries()].map(([emoji, rows]) => {
                              const mine = rows.some(r => r.user_id === homatchUser?.id);
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  aria-pressed={mine}
                                  onClick={() => toggleReaction(msg, emoji as LiveChatReactionEmoji)}
                                  className={cn(
                                    'inline-flex min-h-6 items-center gap-1 rounded-full border px-1.5 text-[13px] tabular-nums transition-colors',
                                    mine
                                      ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-foreground'
                                      : 'border-[hsl(var(--border))] bg-card text-muted-foreground hover:border-[hsl(var(--gold-border))]',
                                  )}
                                >
                                  <span>{emoji}</span>
                                  <span>{rows.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <span className="text-2xs text-muted-foreground mt-0.5 px-1">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/*
            * The composer clears two fixed things at once on a phone: the
            * 4rem bottom tab bar (this page is always signed-in, so the bar
            * always exists) and the home indicator inset beneath it. From md
            * the bar is gone and the ordinary 0.75rem remains. Same clearance
            * as AIPage's NAV_CLEARANCE.
            */}
          <div className="px-4 pt-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-3 border-t border-border shrink-0">
            {(replyTo || editingId) && (
              <div className="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 rounded-lg bg-secondary/60 text-xs">
                <span className="truncate text-muted-foreground">
                  {editingId
                    ? t('live_chat_editing')
                    : `${t('live_chat_replying_to')} ${profiles[replyTo!.user_id]?.nickname ?? ''} · ${messageGlance(replyTo!, t as never)}`}
                </span>
                <button onClick={() => { setReplyTo(null); setEditingId(null); setText(''); }} aria-label={t('live_chat_cancel')}><X className="h-3.5 w-3.5" /></button>
              </div>
            )}

            {recording ? (
              /* RECORDING: a live timer against the 60s ceiling, stop, cancel. */
              <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3 py-2.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
                </span>
                <span className="flex-1 text-sm font-medium tabular-nums text-foreground" dir="ltr">
                  {t('live_chat_recording')} 0:{String(recordSeconds).padStart(2, '0')} / 1:00
                </span>
                <Button variant="ghost" size="sm" className="h-9 px-2.5 text-muted-foreground hover:text-destructive" onClick={cancelRecording}>
                  <X className="h-4 w-4 me-1" />{t('live_chat_discard')}
                </Button>
                <Button size="sm" className="h-9 gap-1.5" onClick={stopRecording}>
                  <Square className="h-3.5 w-3.5" />{t('live_chat_stop')}
                </Button>
              </div>
            ) : voiceDraft ? (
              /* PREVIEW BEFORE SEND: listen, then send it or throw it away. */
              <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-card px-3 py-2.5 shadow-card">
                <div className="min-w-0 flex-1">
                  <VoicePreview blob={voiceDraft.blob} seconds={voiceDraft.seconds} />
                </div>
                <Button variant="ghost" size="sm" className="h-9 px-2.5 text-muted-foreground hover:text-destructive" onClick={cancelRecording} disabled={sending}>
                  <Trash2 className="h-4 w-4 me-1" />{t('live_chat_discard')}
                </Button>
                <Button size="sm" className="h-9 gap-1.5 bg-[hsl(var(--gold))] font-bold text-[#161309] hover:bg-[hsl(var(--gold-hover))]" onClick={sendVoiceDraft} disabled={sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('live_chat_send_voice')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={LIVE_CHAT_IMAGE_MIME.join(',')}
                  className="hidden"
                  onChange={e => handlePhotoChosen(e.target.files?.[0] ?? null)}
                />
                <Button
                  variant="ghost" size="icon" onClick={handlePickPhoto} disabled={sending || !!editingId}
                  aria-label={t('live_chat_photo')}
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ImagePlus className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost" size="icon" onClick={startRecording} disabled={sending || !!editingId}
                  aria-label={t('live_chat_voice')}
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Mic className="h-5 w-5" />
                </Button>
                <Input
                  className="flex-1"
                  placeholder={t('live_chat_composer_placeholder')}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  maxLength={2000}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  disabled={sending}
                />
                <Button onClick={handleSend} disabled={sending || !text.trim()} size="icon" aria-label={t('ai_send')} className="shrink-0 h-10 w-10 bg-[hsl(var(--gold))] text-[#161309] hover:bg-[hsl(var(--gold-hover))] disabled:bg-[hsl(var(--secondary))] disabled:text-[hsl(var(--muted-foreground))] disabled:opacity-100">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* SAVED MESSAGES — the private bookmark list. Nothing here notifies
            anyone; a save that lost its source message is simply not shown
            (the service filters deleted/hidden), stated by the empty copy. */}
        <Dialog open={savedOpen} onOpenChange={setSavedOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bookmark className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('live_chat_saved_title')}
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {savedLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
              ) : savedList.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t('live_chat_saved_empty')}</p>
              ) : (
                savedList.map(({ saved_at, message }) => (
                  <div key={message.id} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-card px-3 py-2.5">
                    <button type="button" onClick={() => jumpToMessage(message.id)} className="min-w-0 flex-1 text-start">
                      <p className="truncate text-sm text-foreground">{messageGlance(message, t as never)}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {profiles[message.user_id]?.nickname ?? t('live_chat_unknown_user')} · {new Date(saved_at).toLocaleDateString()}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={t('live_chat_unsave')}
                      onClick={async () => {
                        if (!homatchUser) return;
                        await unsaveLiveChatMessage(homatchUser.id, message.id).catch(() => {});
                        setSavedIds(prev => { const n = new Set(prev); n.delete(message.id); return n; });
                        setSavedList(prev => prev.filter(s => s.message.id !== message.id));
                      }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--secondary))] hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        <ReportDialog open={!!reportTarget} onClose={() => setReportTarget(null)} onSubmit={handleReport} />
      </AppLayout>
    </RouteGuard>
  );
}

/** Preview player for a just-recorded voice note, before anything is sent. */
function VoicePreview({ blob, seconds }: { blob: Blob; seconds: number }) {
  const { t } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  const toggle = () => {
    if (!audioRef.current) {
      urlRef.current = URL.createObjectURL(blob);
      const a = new Audio(urlRef.current);
      a.addEventListener('ended', () => setPlaying(false));
      audioRef.current = a;
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { void audioRef.current.play(); setPlaying(true); }
  };
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="flex items-center gap-2.5" dir="ltr">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('live_chat_voice_pause') : t('live_chat_voice_play')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0C1119] text-[hsl(38_92%_60%)] hover:bg-[#1a2231] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <span className="text-sm font-medium tabular-nums text-foreground">{fmt(seconds)}</span>
      <span className="truncate text-2xs text-muted-foreground">{t('live_chat_voice_preview')}</span>
    </div>
  );
}

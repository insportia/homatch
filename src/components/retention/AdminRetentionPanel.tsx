/*
 * Admin → Storage → Storage retention: the owner's control center.
 *
 * Only allowlisted, disposable storage objects are ever deleted (migration
 * 20261104090000): a regenerable cache, explicitly temporary generated files,
 * and the self-test's own files. Everything permanent is listed under "Never
 * deleted" and cannot be put in scope from this screen.
 *
 * One sentence says what the system is doing. Three switches run it
 * (automatic run, pause everything, expiry notices); each category has its own
 * switch and applies only to files created after it is turned on. Anything
 * that can delete asks first. Every change goes through a server function that
 * validates it and writes the audit log.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Play, Eye, RotateCcw, FlaskConical, Lock, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatBytes, localDate } from '@/services/retention';
import {
  artifactEvents, artifactList, artifactPreview, artifactStatus, artifactsMode, configureArtifacts, retryArtifact,
  runNow, runSelftest, setCategory, ttlParts,
  type ArtifactCategory, type ArtifactEvent, type ArtifactFilter, type ArtifactPatch, type ArtifactPreview,
  type ArtifactRow, type ArtifactStatus,
} from '@/services/retentionAdmin';

const MODE_STYLE: Record<string, string> = {
  OFF: 'bg-muted-foreground',
  PAUSED: 'bg-amber-500',
  MANUAL: 'bg-sky-500',
  ON: 'bg-emerald-500',
};

const TABS: ArtifactFilter[] = ['PENDING', 'PROBLEMS', 'DELETED', 'NOTICES'];

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 border-b border-border/50 py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{title}</div>
        <div className="break-words text-xs text-muted-foreground">{desc}</div>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 p-3">
      <div className="truncate text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-2xs text-muted-foreground">{label}</div>
    </div>
  );
}

type Confirm = { title: string; desc: string; run: () => Promise<void>; danger?: boolean } | null;

export function AdminRetentionPanel() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<ArtifactStatus | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [tab, setTab] = useState<ArtifactFilter | 'LOG'>('PENDING');
  const [rows, setRows] = useState<ArtifactRow[]>([]);
  const [events, setEvents] = useState<ArtifactEvent[]>([]);

  const loadTab = useCallback(async (which: ArtifactFilter | 'LOG') => {
    if (which === 'LOG') setEvents(await artifactEvents(50));
    else setRows(await artifactList(which, 50));
  }, []);

  const load = useCallback(async () => {
    const s = await artifactStatus();
    if (!s) { setMissing(true); return; }
    setStatus(s);
    await loadTab(tab);
  }, [loadTab, tab]);
  useEffect(() => { load(); }, [load]);

  const fail = (code: string) => toast.error(t(`rt_cc_err_${code}`) || t('rt_cc_err_generic'));

  const guarded = async (fn: () => Promise<ArtifactStatus | void>) => {
    setBusy(true);
    try {
      const s = await fn();
      if (s) setStatus(s);
      toast.success(t('rt_cc_saved'));
      setPreview(null);
      await loadTab(tab);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'generic');
    } finally {
      setBusy(false);
    }
  };
  const apply = (patch: ArtifactPatch) => guarded(() => configureArtifacts(patch, 'admin control center'));

  if (missing) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('rt_ax_title')}</h2>
        <p className="text-2xs text-muted-foreground">{t('rt_admin_not_installed')}</p>
      </section>
    );
  }
  if (!status) return null;

  const mode = artifactsMode(status);
  const real = status.categories.filter((c) => c.kind !== 'SELFTEST');
  const tests = status.categories.filter((c) => c.kind === 'SELFTEST');
  const sum = (f: (c: ArtifactCategory) => number) => status.categories.reduce((n, c) => n + Number(f(c) || 0), 0);
  const ttl = (c: ArtifactCategory) => {
    const p = ttlParts(c.ttl_seconds);
    return t(`rt_ax_ttl_${p.unit}`, { n: p.n });
  };
  const lastTick = status.last_tick;

  const askCategory = (c: ArtifactCategory, on: boolean) => setConfirm(on
    ? {
      title: t('rt_ax_confirm_cat_on_title', { name: t(`rt_ax_cat_${c.key}`) }),
      desc: `${t(`rt_ax_cat_${c.key}_desc`)} ${t('rt_ax_confirm_cat_on_desc', { ttl: ttl(c) })}`,
      run: () => guarded(() => setCategory(c.key, true, 'admin control center')),
    }
    : {
      title: t('rt_ax_confirm_cat_off_title', { name: t(`rt_ax_cat_${c.key}`) }),
      desc: t('rt_ax_confirm_cat_off_desc'),
      run: () => guarded(() => setCategory(c.key, false, 'admin control center')),
    });

  const CategoryRow = ({ c }: { c: ArtifactCategory }) => (
    <div className="space-y-1.5 border-b border-border/50 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {t(`rt_ax_cat_${c.key}`)}
            <Badge variant="outline" className="text-2xs">{t(`rt_ax_kind_${c.kind}`)}</Badge>
          </div>
          <div className="break-words text-xs text-muted-foreground">{t(`rt_ax_cat_${c.key}_desc`)}</div>
          <div className="text-2xs text-muted-foreground">
            {ttl(c)} · {c.notify_owner ? t('rt_ax_notice_yes') : t('rt_ax_notice_no')}
            {c.enabled && c.active_since ? ` · ${t('rt_ax_since', { date: localDate(c.active_since, lang) })}` : ''}
          </div>
        </div>
        <Switch checked={c.enabled} disabled={busy} aria-label={t(`rt_ax_cat_${c.key}`)}
          onCheckedChange={(on) => askCategory(c, on)} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-2xs text-muted-foreground">
        <span>{t('rt_ax_tracked')}: <b className="tabular-nums">{c.tracked}</b> ({formatBytes(c.tracked_bytes)})</span>
        <span>· {t('rt_ax_soon')}: <b className="tabular-nums">{c.expiring_7d}</b></span>
        <span>· {t('rt_ax_deleted')}: <b className="tabular-nums">{c.deleted}</b></span>
        {c.problems > 0 ? <span className="text-amber-600 dark:text-amber-400">· {t('rt_ax_problems')}: <b className="tabular-nums">{c.problems}</b></span> : null}
      </div>
    </div>
  );

  return (
    <section className="space-y-3" aria-labelledby="retention-ax">
      <h2 id="retention-ax" className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />{t('rt_ax_title')}
      </h2>

      {/* ── What is happening right now ── */}
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${MODE_STYLE[mode]}`} aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="break-words text-sm font-medium">{t(`rt_ax_status_${mode.toLowerCase()}`)}</p>
            <p className="text-2xs text-muted-foreground">
              {lastTick ? t('rt_ax_last_run', { date: localDate(lastTick.at, lang), deleted: Number(lastTick.detail?.deleted ?? 0) }) : t('rt_ax_never_run')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── The three switches ── */}
      <Card>
        <CardContent className="px-4 py-1">
          <Row title={t('rt_ax_auto_title')} desc={t('rt_ax_auto_desc')}>
            <Switch checked={status.auto_run} disabled={busy} aria-label={t('rt_ax_auto_title')}
              onCheckedChange={(on) => (on
                ? setConfirm({ title: t('rt_ax_confirm_auto_title'), desc: t('rt_ax_confirm_auto_desc'), run: () => apply({ auto_run: true }), danger: true })
                : apply({ auto_run: false }))} />
          </Row>
          <Row title={t('rt_ax_pause_title')} desc={t('rt_ax_pause_desc')}>
            <Switch checked={status.settings.paused} disabled={busy} aria-label={t('rt_ax_pause_title')}
              className="data-[state=checked]:bg-amber-500"
              onCheckedChange={(on) => (on
                ? apply({ paused: true })
                : setConfirm({ title: t('rt_ax_confirm_resume_title'), desc: t('rt_ax_confirm_resume_desc'), run: () => apply({ paused: false }) }))} />
          </Row>
          <Row title={t('rt_ax_notices_title')} desc={t('rt_ax_notices_desc')}>
            <Switch checked={status.settings.notifications_enabled} disabled={busy} aria-label={t('rt_ax_notices_title')}
              onCheckedChange={(on) => apply({ notifications_enabled: on })} />
          </Row>
        </CardContent>
      </Card>

      {/* ── What may be deleted ── */}
      <Card>
        <CardContent className="px-4 py-1">
          <h3 className="pt-3 text-xs font-semibold">{t('rt_ax_categories')}</h3>
          {real.map((c) => <CategoryRow key={c.key} c={c} />)}
        </CardContent>
      </Card>

      {/* ── What is never deleted ── */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{t('rt_ax_protected')}</h3>
          <ul className="space-y-1">
            {status.protected.map((p) => (
              <li key={p.area} className="min-w-0 break-words text-xs text-muted-foreground">• {t(`rt_ax_protected_${p.area.replace(/-/g, '_')}`)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ── Numbers ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label={t('rt_ax_tracked')} value={sum((c) => c.tracked)} />
        <Tile label={t('rt_ax_soon')} value={sum((c) => c.expiring_7d)} />
        <Tile label={t('rt_ax_deleted')} value={sum((c) => c.deleted)} />
        <Tile label={t('rt_ax_saved')} value={formatBytes(sum((c) => c.reclaimed_bytes))} />
        <Tile label={t('rt_ax_problems')} value={sum((c) => c.problems)} />
      </div>

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => setPreview(await artifactPreview())}>
          <Eye className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('rt_ax_preview')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
          const p = await artifactPreview();
          setConfirm({
            title: t('rt_ax_confirm_run_title'),
            desc: p?.paused ? t('rt_ax_preview_paused') : t('rt_ax_preview_result', { n: p?.count ?? 0, size: formatBytes(p?.bytes ?? 0) }),
            danger: !!p && !p.paused && p.count > 0,
            run: async () => {
              setBusy(true);
              const r = await runNow();
              setBusy(false);
              if (!r) { fail('generic'); return; }
              toast.success(t('rt_ax_ran', { deleted: r.deleted, kept: r.kept, failed: r.failed }));
              load();
            },
          });
        }}>
          <Play className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_run_now')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await runSelftest();
          setBusy(false);
          if (!r) { fail('generic'); return; }
          toast.success(t('rt_ax_selftest_started'));
          load();
        }}>
          <FlaskConical className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('rt_ax_selftest')}
        </Button>
      </div>
      {preview ? (
        <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
          <p className="break-words">
            {preview.paused ? t('rt_ax_preview_paused') : preview.count === 0 ? t('rt_cc_preview_none')
              : t('rt_ax_preview_result', { n: preview.count, size: formatBytes(preview.bytes) })}
            {preview.awaiting_notice > 0 ? ` ${t('rt_ax_preview_awaiting', { n: preview.awaiting_notice })}` : ''}
          </p>
          {preview.items.length > 0 ? (
            <ul className="space-y-0.5">
              {preview.items.map((i) => (
                <li key={i.id} className="min-w-0 break-all text-2xs text-muted-foreground">
                  {t(`rt_ax_cat_${i.category}`)} · {i.object_key} · {formatBytes(Number(i.bytes ?? 0))}
                  {i.needs_regeneration_check ? ` · ${t('rt_ax_regen_check')}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ── Lists and the log ── */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('rt_ax_lists')}>
            {[...TABS, 'LOG' as const].map((k) => (
              <Button key={k} size="sm" role="tab" aria-selected={tab === k} variant={tab === k ? 'secondary' : 'ghost'}
                onClick={() => { setTab(k); loadTab(k); }}>
                {t(`rt_ax_tab_${k.toLowerCase()}`)}
              </Button>
            ))}
          </div>
          {tab === 'LOG' ? (
            events.length === 0 ? <p className="text-2xs text-muted-foreground">{t('rt_ax_empty')}</p> : (
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id} className="min-w-0 break-words text-2xs">
                    <span className="tabular-nums text-muted-foreground">{localDate(e.created_at, lang)}</span> · <b>{e.event}</b>
                    {e.event === 'TICK' ? ` · ${t('rt_ax_log_tick', { deleted: Number(e.detail?.deleted ?? 0), kept: Number(e.detail?.kept ?? 0), failed: Number(e.detail?.failed ?? 0) })}` : ''}
                    {e.detail?.error ? ` · ${String(e.detail.error).slice(0, 120)}` : ''}
                  </li>
                ))}
              </ul>
            )
          ) : rows.length === 0 ? <p className="text-2xs text-muted-foreground">{t('rt_ax_empty')}</p> : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <div className="break-words">{r.label ?? t(`rt_ax_cat_${r.category}`)} · <Badge variant="outline" className="text-2xs">{r.state}</Badge></div>
                    <div className="break-all text-2xs text-muted-foreground">{r.object_key}</div>
                    <div className="text-2xs text-muted-foreground">
                      {r.deleted_at ? t('rt_ax_deleted_on', { date: localDate(r.deleted_at, lang) }) : t('rt_ax_expires_on', { date: localDate(r.expires_at, lang) })}
                      {r.notification_id ? ` · ${t(r.notification_read ? 'rt_ax_notice_read' : 'rt_ax_notice_queued')}` : ''}
                      {r.notice_error ? ` · ${t('rt_ax_notice_failed')}` : ''}
                      {r.last_error ? ` · ${r.last_error.slice(0, 120)}` : ''}
                    </div>
                  </div>
                  {r.state === 'FAILED' || r.state === 'DEAD_LETTER' || r.notice_error || (r.state === 'ACTIVE' && r.last_error) ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { await retryArtifact(r.id); load(); }}>
                      <RotateCcw className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_retry')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Self-test categories, out of the way ── */}
      <Card>
        <CardContent className="px-4 py-1">
          <h3 className="flex items-center gap-1.5 pt-3 text-xs font-semibold"><PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />{t('rt_ax_test_categories')}</h3>
          {tests.map((c) => <CategoryRow key={c.key} c={c} />)}
        </CardContent>
      </Card>

      {/* ── Confirmations ── */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{confirm?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('rt_cc_cancel')}</AlertDialogCancel>
            <AlertDialogAction className={confirm?.danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={() => { const run = confirm?.run; setConfirm(null); if (run) run(); }}>
              {t('rt_cc_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

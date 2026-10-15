/*
 * Admin → Storage → Data retention: the owner's control center.
 *
 * One sentence says what the system is doing right now. Six switches, each
 * with one line of plain explanation, are the only decisions there are. The
 * ones that can delete something ask first and show the real numbers. Every
 * change goes through retention_admin_configure, which refuses unsafe
 * combinations on the server and logs who changed what.
 *
 * Ids and counts only — no customer content is shown here.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Play, Eye, RotateCcw, Lock, Unlock, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { formatBytes, localDate } from '@/services/retention';
import {
  configureRetention, holdSource, previewDeletion, retentionMode, retentionRecords, retentionStatus,
  retryRecord, runNow, type RetentionPatch, type RetentionRecordRow, type RetentionStatus,
} from '@/services/retentionAdmin';

type Json = Record<string, any>;

const MODE_STYLE: Record<string, string> = {
  OFF: 'bg-muted-foreground',
  DATING: 'bg-sky-500',
  MANUAL: 'bg-amber-500',
  ON: 'bg-emerald-500',
};

function Row({ title, desc, children, muted }: { title: string; desc: string; children: React.ReactNode; muted?: string | null }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 border-b border-border/50 py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{title}</div>
        <div className="break-words text-xs text-muted-foreground">{desc}</div>
        {muted ? <div className="text-2xs text-muted-foreground/80">{muted}</div> : null}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-2xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Pairs({ data, bytes = false }: { data: Json | null | undefined; bytes?: boolean }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <span className="text-2xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="outline" className="max-w-full break-all text-2xs">
          {k} · {typeof v === 'object' && v !== null
            ? `${v.objects ?? ''}${v.bytes != null ? ` · ${formatBytes(Number(v.bytes))}` : ''}`
            : bytes ? formatBytes(Number(v)) : String(v)}
        </Badge>
      ))}
    </div>
  );
}

type Confirm = { title: string; desc: string; patch: RetentionPatch; danger?: boolean } | null;

export function AdminRetentionPanel() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<RetentionStatus | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problems, setProblems] = useState<RetentionRecordRow[]>([]);
  const [holds, setHolds] = useState<RetentionRecordRow[]>([]);
  const [graceOpen, setGraceOpen] = useState(false);
  const [graceDate, setGraceDate] = useState('');
  const [holdId, setHoldId] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [details, setDetails] = useState<Json | null>(null);

  const load = useCallback(async () => {
    const s = await retentionStatus();
    if (!s) { setMissing(true); return; }
    setStatus(s);
    setProblems(await retentionRecords('PROBLEMS'));
    setHolds(await retentionRecords('HOLDS'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const fail = (code: string) => toast.error(t(`rt_cc_err_${code}`) || t('rt_cc_err_generic'));

  const apply = async (patch: RetentionPatch) => {
    setBusy(true);
    try {
      setStatus(await configureRetention(patch, 'admin control center'));
      toast.success(t('rt_cc_saved'));
      setPreview(null);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'generic');
    } finally {
      setBusy(false);
    }
  };

  const previewSentence = async (): Promise<string> => {
    if (!status) return '';
    const p = await previewDeletion(status.config);
    if (!p) return t('rt_cc_err_generic');
    const main = p.verify + p.contracts === 0
      ? t('rt_cc_preview_none')
      : t('rt_cc_preview_result', { verify: p.verify, contracts: p.contracts, size: formatBytes(p.bytes) });
    return p.protected > 0 ? `${main} ${t('rt_cc_preview_protected', { n: p.protected })}` : main;
  };

  if (missing) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('rt_cc_title')}</h2>
        <p className="text-2xs text-muted-foreground">{t('rt_admin_not_installed')}</p>
      </section>
    );
  }
  if (!status) return null;

  const cfg = status.config;
  const ruleOn = !!cfg.effective_at;
  const mode = retentionMode(status);

  const askDelete = async () => {
    setConfirm({ title: t('rt_cc_confirm_delete_title'), desc: `${await previewSentence()} ${t('rt_cc_confirm_delete_desc')}`, patch: { purge_enabled: true }, danger: true });
  };

  return (
    <section className="space-y-3" aria-labelledby="retention-cc">
      <h2 id="retention-cc" className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />{t('rt_cc_title')}
      </h2>

      {/* ── What is happening right now, in one sentence ── */}
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${MODE_STYLE[mode]}`} aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="break-words text-sm font-medium">{t(`rt_cc_status_${mode.toLowerCase()}`)}</p>
            {ruleOn ? <p className="text-2xs text-muted-foreground">{t('rt_cc_since', { date: localDate(cfg.effective_at!, lang) })}</p> : null}
          </div>
        </CardContent>
      </Card>

      {/* ── The six decisions ── */}
      <Card>
        <CardContent className="px-4 py-1">
          <Row title={t('rt_cc_rule_title')} desc={t('rt_cc_rule_desc')}>
            <Switch checked={ruleOn} disabled={busy} aria-label={t('rt_cc_rule_title')}
              onCheckedChange={(on) => setConfirm(on
                ? { title: t('rt_cc_confirm_rule_on_title'), desc: t('rt_cc_confirm_rule_on_desc'), patch: { effective_at: new Date().toISOString() } }
                : { title: t('rt_cc_confirm_rule_off_title'), desc: t('rt_cc_confirm_rule_off_desc'), patch: { effective_at: null } })} />
          </Row>
          <Row title={t('rt_cc_older_title')}
            desc={cfg.legacy_grace_until ? t('rt_cc_older_until', { date: localDate(cfg.legacy_grace_until, lang) }) : t('rt_cc_older_keep')}
            muted={ruleOn ? null : t('rt_cc_needs_rule')}>
            <Button size="sm" variant="outline" disabled={!ruleOn || busy} onClick={() => setGraceOpen(true)}>{t('rt_cc_older_set')}</Button>
          </Row>
          <Row title={t('rt_cc_remind_title')} desc={t('rt_cc_remind_desc')} muted={ruleOn ? null : t('rt_cc_needs_rule')}>
            <Switch checked={!!cfg.reminders_enabled} disabled={!ruleOn || busy} aria-label={t('rt_cc_remind_title')}
              onCheckedChange={(on) => apply({ reminders_enabled: on })} />
          </Row>
          <Row title={t('rt_cc_delete_title')} desc={t('rt_cc_delete_desc')} muted={ruleOn ? null : t('rt_cc_needs_rule')}>
            <Switch checked={!!cfg.purge_enabled} disabled={!ruleOn || busy} aria-label={t('rt_cc_delete_title')}
              className="data-[state=checked]:bg-destructive"
              onCheckedChange={(on) => (on ? askDelete() : apply({ purge_enabled: false }))} />
          </Row>
          <Row title={t('rt_cc_auto_title')} desc={t('rt_cc_auto_desc')}>
            <Switch checked={status.auto_run} disabled={busy} aria-label={t('rt_cc_auto_title')}
              onCheckedChange={(on) => apply({ auto_run: on })} />
          </Row>
          <Row title={t('rt_cc_knowledge_title')} desc={t('rt_cc_knowledge_desc')}>
            <Switch checked={!!cfg.knowledge_enabled} disabled={busy} aria-label={t('rt_cc_knowledge_title')}
              onCheckedChange={(on) => apply({ knowledge_enabled: on })} />
          </Row>
        </CardContent>
      </Card>

      {/* ── Two buttons ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => setPreview(await previewSentence())}>
          <Eye className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_preview')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !ruleOn} onClick={async () => {
          setBusy(true);
          const r = await runNow();
          setBusy(false);
          if (!r) { fail('generic'); return; }
          toast.success(t('rt_cc_ran', { deleted: r.purged, failed: r.failed }));
          load();
        }}>
          <Play className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_run_now')}
        </Button>
      </div>
      {preview ? <p className="break-words rounded-md bg-muted/50 p-3 text-xs">{preview}</p> : null}

      {/* ── Four numbers ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={t('rt_cc_tile_kept')} value={status.not_expiring} />
        <Tile label={t('rt_cc_tile_soon')} value={status.expiring_7d} />
        <Tile label={t('rt_cc_tile_waiting')} value={status.expired_waiting} />
        <Tile label={t('rt_cc_tile_deleted')} value={status.deleted} />
      </div>

      {/* ── Needs attention ── */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="text-xs font-semibold">{t('rt_cc_attention')}</h3>
          {problems.length === 0 ? <p className="text-2xs text-muted-foreground">{t('rt_cc_attention_none')}</p> : (
            <ul className="space-y-1.5">
              {problems.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 break-all">
                    {t(`rt_cc_product_${r.product}`)} · <span className="tabular-nums">{r.source_id.slice(0, 8)}</span> · {r.last_error ?? r.state}
                  </span>
                  {r.state === 'DEAD_LETTER' || r.state === 'FAILED' ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { await retryRecord(r.id); load(); }}>
                      <RotateCcw className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_retry')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Protected (legal hold) ── */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h3 className="text-xs font-semibold">{t('rt_cc_holds')}</h3>
          {holds.length === 0 ? <p className="text-2xs text-muted-foreground">{t('rt_cc_holds_none')}</p> : (
            <ul className="space-y-1.5">
              {holds.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 break-all">
                    {t(`rt_cc_product_${r.product}`)} · <span className="tabular-nums">{r.source_id.slice(0, 8)}</span> · {r.legal_hold_reason}
                  </span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
                    try { await holdSource(r.source_id, false, 'released'); load(); } catch (e) { fail(e instanceof Error ? e.message : 'generic'); }
                  }}>
                    <Unlock className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_release')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Input className="h-9 min-w-0 flex-1 basis-56 text-xs" value={holdId} onChange={(e) => setHoldId(e.target.value)}
              placeholder={t('rt_cc_hold_id')} aria-label={t('rt_cc_hold_id')} />
            <Input className="h-9 min-w-0 flex-1 basis-56 text-xs" value={holdReason} onChange={(e) => setHoldReason(e.target.value)}
              placeholder={t('rt_cc_hold_reason')} aria-label={t('rt_cc_hold_reason')} />
            <Button size="sm" disabled={busy || !/^[0-9a-f-]{36}$/i.test(holdId.trim()) || !holdReason.trim()} onClick={async () => {
              try {
                await holdSource(holdId.trim(), true, holdReason.trim());
                setHoldId(''); setHoldReason('');
                toast.success(t('rt_cc_saved'));
                load();
              } catch (e) { fail(e instanceof Error ? e.message : 'generic'); }
            }}>
              <Lock className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_hold_add')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Details for later ── */}
      <Collapsible onOpenChange={async (open) => {
        if (open && !details) {
          const { data } = await supabase.rpc('retention_admin_summary');
          setDetails((data as Json) ?? {});
        }
      }}>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="-ms-2">
            <ChevronDown className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('rt_cc_details')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {details ? (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_supabase')}</div><Pairs data={details.supabase_storage} /></div>
                <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_r2')}</div><Pairs data={details.r2} /></div>
                <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_postgres')}</div><Pairs data={details.postgres} bytes /></div>
                <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_knowledge_size')}</div><Pairs data={details.knowledge} /></div>
                <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_reclaimed')}</div>
                  <span className="text-xs tabular-nums">{formatBytes(Number(details.reclaimed_bytes_measured ?? 0))}</span></div>
              </CardContent>
            </Card>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

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
              onClick={() => { const p = confirm?.patch; setConfirm(null); if (p) apply(p); }}>
              {t('rt_cc_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={graceOpen} onOpenChange={setGraceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rt_cc_older_title')}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{t('rt_cc_older_dialog_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Input type="date" value={graceDate} onChange={(e) => setGraceDate(e.target.value)} aria-label={t('rt_cc_older_title')}
            min={new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('rt_cc_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={!graceDate} onClick={() => {
              setGraceOpen(false);
              apply({ legacy_grace_until: new Date(`${graceDate}T00:00:00Z`).toISOString() });
            }}>
              {t('rt_cc_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

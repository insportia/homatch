// HOMATCH DESIGN STUDIO — SHARE MANAGER.
//
// Make a public link to the walkthrough of THIS version as it is now (the
// link keeps showing exactly this, whatever changes later), copy it, send
// it, open it, and revoke any link on its own. Every link is independent;
// there is no cap per project.

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2, Share2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DesignStudioError } from '@/services/designStudio/projects';
import {
  createShare, listShares, revokeShare, shareStatus, shareUrl, type ShareRecord, type ShareType,
} from '@/services/designStudio/shares';
import { cn } from '@/lib/utils';

const EXPIRY: Array<{ days: number | null; key: string }> = [
  { days: null, key: 'ds_share_expiry_never' },
  { days: 7, key: 'ds_share_expiry_7' },
  { days: 30, key: 'ds_share_expiry_30' },
  { days: 90, key: 'ds_share_expiry_90' },
];

const ERROR_KEY: Record<string, string> = {
  DS_SHARE_SOURCE_UNSUPPORTED: 'ds_share_error_source',
  DS_SHARE_ASSET_NOT_PUBLIC: 'ds_share_error_asset',
  DS_SHARE_RATE_LIMITED: 'ds_share_error_rate',
};

export function ShareDialog({
  projectId, versionId, versionName, versionNames, beforeCreate, initialType = 'WALKTHROUGH', onClose,
}: {
  projectId: string;
  versionId: string;
  versionName: string;
  versionNames: Map<string, string>;
  /** Save pending edits first: a link freezes the version as stored. */
  beforeCreate: () => Promise<void>;
  /** Which kind of link the dialog starts on. */
  initialType?: ShareType;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ShareType>(initialType);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tokens exist in plaintext only here, only for links made in this session.
  const [fresh, setFresh] = useState<Map<string, string>>(new Map());
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listShares(projectId).then(setShares).catch(() => setError(t('ds_share_error_generic')));
  }, [projectId, t]);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await beforeCreate();
      const expiresAt = expiry ? new Date(Date.now() + expiry * 86400_000).toISOString() : null;
      const r = await createShare({ versionId, type, label: label.trim() || null, expiresAt });
      setFresh((m) => new Map(m).set(r.id, r.token));
      setLabel('');
      refresh();
    } catch (e) {
      setError(t(ERROR_KEY[e instanceof DesignStudioError ? e.code : ''] ?? 'ds_share_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      window.prompt(t('ds_share_copy_manual'), url);
    }
  };

  const send = async (url: string) => {
    try { await navigator.share({ title: t('ds_share_native_title'), url }); } catch { /* the visitor closed the sheet */ }
  };
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const revoke = async (id: string) => {
    try { await revokeShare(id); refresh(); } catch { setError(t('ds_share_error_generic')); }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div role="dialog" aria-modal="true" aria-label={t('ds_share_title')} className="fixed inset-0 z-50 grid place-items-center bg-[#0C1119]/55 p-3">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-[#0C1119] shadow-2xl">
        <header className="flex items-start gap-3 border-b border-[#E4E6EA] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">{t('ds_share_title')}</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[#4A5263]">{t('ds_share_intro', { version: versionName })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('ds_action_close')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <div className="space-y-3 rounded-xl border border-[#E4E6EA] p-3">
            <div role="radiogroup" aria-label={t('ds_share_type')} className="grid grid-cols-2 gap-1.5">
              {(['WALKTHROUGH', 'DESIGN'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
                  className={cn('rounded-lg border px-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]', type === k ? 'border-[#0C1119] bg-[#F4F5F7]' : 'border-[#E4E6EA] hover:bg-[#F8F9FA]')}>
                  <span className="block text-[14px] font-semibold">{t(k === 'DESIGN' ? 'ds_share_type_design' : 'ds_share_type_walkthrough')}</span>
                  <span className="mt-0.5 block text-2xs leading-snug text-[#4A5263]">{t(k === 'DESIGN' ? 'ds_share_type_design_body' : 'ds_share_type_walkthrough_body')}</span>
                </button>
              ))}
            </div>
            <label className="block text-[13px] font-medium">
              {t('ds_share_label')}
              <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} maxLength={60} placeholder={t('ds_share_label_placeholder')}
                className="mt-1 h-10 w-full rounded-lg border border-[#D5D9E0] px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" />
            </label>
            <label className="block text-[13px] font-medium">
              {t('ds_share_expiry')}
              <select value={expiry ?? ''} onChange={(e) => setExpiry(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 h-10 w-full rounded-lg border border-[#D5D9E0] bg-white px-2 text-[14px]">
                {EXPIRY.map((o) => <option key={o.key} value={o.days ?? ''}>{t(o.key)}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => { void create(); }} disabled={busy}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0C1119] text-[14px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              {t('ds_share_create')}
            </button>
            <p className="text-2xs leading-relaxed text-[#4A5263]">{t('ds_share_frozen_note')}</p>
          </div>

          {error ? <p role="alert" className="mt-3 rounded-lg bg-[hsl(0_66%_44%)]/10 px-3 py-2 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}

          <h3 className="mb-2 mt-5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_share_links')}</h3>
          {shares === null ? (
            <p className="flex items-center gap-2 text-[14px] text-[#4A5263]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('ds_share_loading')}</p>
          ) : shares.length === 0 ? (
            <p className="text-[14px] text-[#4A5263]">{t('ds_share_none')}</p>
          ) : (
            <ul className="space-y-2" aria-label={t('ds_share_links')}>
              {shares.map((s) => {
                const status = shareStatus(s);
                const token = fresh.get(s.id);
                const url = token ? shareUrl(token, s.share_type) : null;
                const vName = s.published?.version_id ? versionNames.get(s.published.version_id) : null;
                return (
                  <li key={s.id} aria-label={s.label ?? `…${s.token_hint}`} className="rounded-xl border border-[#E4E6EA] p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{s.label ?? t('ds_share_unnamed', { hint: s.token_hint })}</p>
                        <p className="text-2xs text-[#4A5263]">
                          {[t(s.share_type === 'DESIGN' ? 'ds_share_type_design' : 'ds_share_type_walkthrough'), vName, t('ds_share_created', { date: fmt(s.created_at) }), t('ds_share_views', { n: String(s.view_count) }),
                            s.expires_at && status === 'ACTIVE' ? t('ds_share_expires', { date: fmt(s.expires_at) }) : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold',
                        status === 'ACTIVE' ? 'bg-[hsl(152_60%_32%)]/12 text-[hsl(152_60%_26%)]'
                          : status === 'EXPIRED' ? 'bg-[hsl(38_92%_54%)]/15 text-[hsl(32_78%_30%)]' : 'bg-[#EEF0F3] text-[#4A5263]')}>
                        {t(`ds_share_status_${status.toLowerCase()}`)}
                      </span>
                    </div>
                    {url && status === 'ACTIVE' ? (
                      <div className="mt-2 space-y-2">
                        <input readOnly value={url} aria-label={t('ds_share_url')} onFocus={(e) => e.currentTarget.select()}
                          className="h-9 w-full rounded-md border border-[#D5D9E0] bg-[#F8F9FA] px-2 font-mono text-2xs" />
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => { void copy(s.id, url); }} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0C1119] px-2.5 text-[13px] font-semibold text-white">
                            {copied === s.id ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                            {t(copied === s.id ? 'ds_share_copied' : 'ds_share_copy')}
                          </button>
                          {canNativeShare ? (
                            <button type="button" onClick={() => { void send(url); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D5D9E0] px-2.5 text-[13px] font-medium">
                              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />{t('ds_share_send')}
                            </button>
                          ) : null}
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D5D9E0] px-2.5 text-[13px] font-medium">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('ds_share_open')}
                          </a>
                        </div>
                      </div>
                    ) : status === 'ACTIVE' ? (
                      <p className="mt-1.5 text-2xs text-[#4A5263]">{t('ds_share_copy_once')}</p>
                    ) : null}
                    {status === 'ACTIVE' ? (
                      <button type="button" onClick={() => { void revoke(s.id); }} className="mt-2 text-[13px] font-medium text-[hsl(0_66%_40%)] underline underline-offset-4">
                        {t('ds_share_revoke')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

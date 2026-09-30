// Campaign Guard, in calm words: the ad account's standing, warnings and
// strikes against the policy maximum, this campaign's review state, the
// notices and any protective action HOMATCH took. Never accusatory.
import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import type { CampaignDetail } from '@/services/metaAds';
import { Card, Chip, Muted, type Fmt, type T, type Tone } from './shared';

const GUARD_KEYS = ['guard_changed_in_meta', 'guard_connection_attention', 'guard_duplicate_detected',
  'guard_material_change_paused', 'guard_repeated_changes', 'guard_warning_count'];
const LEVELS = ['NOTICE', 'WARNING', 'STRIKE', 'REVIEW_REQUIRED'];
const LEVEL_TONE: Record<string, Tone> = { NOTICE: 'quiet', WARNING: 'watch', STRIKE: 'watch', REVIEW_REQUIRED: 'gold' };
const ACCOUNT_TONE: Record<string, Tone> = { ACTIVE: 'good', WATCH: 'watch', SUSPENDED: 'act' };
const CAMPAIGN_STATES = ['OK', 'NEEDS_REVIEW', 'LOCKED_FOR_REVIEW'];

export function SuspendedBanner({ t }: { t: T }) {
  return (
    <div role="status" className="flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[13px] text-foreground">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t('mm_c_suspended_title')}</p>
        <p className="mt-0.5 leading-relaxed text-muted-foreground">{t('mm_c_suspended_body')}</p>
      </div>
    </div>
  );
}

export function IntegritySection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const g = d.guard;
  const acct = g?.account ?? null;
  const campaignState = CAMPAIGN_STATES.includes(String(g?.campaignState)) ? String(g?.campaignState) : 'OK';
  const incidents = g?.incidents ?? [];
  return (
    <div className="space-y-4">
      {acct?.status === 'SUSPENDED' && <SuspendedBanner t={t} />}
      <Card id="mm-guard" title={t('mm_c_guard_title')}>
        <div className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          <Muted>{t('mm_c_guard_lead')}</Muted>
        </div>
        <dl className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-border px-3 py-2.5">
            <dt className="text-2xs text-muted-foreground">{t('mm_c_guard_account')}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              {acct ? (
                <>
                  <Chip tone={ACCOUNT_TONE[acct.status] ?? 'quiet'}>{t(`mm_c_guard_status_${ACCOUNT_TONE[acct.status] ? acct.status : 'ACTIVE'}`)}</Chip>
                  <span className="text-[13px] text-foreground">{t('mm_c_guard_warnings', { n: fmt.num(acct.active_warnings) })}</span>
                  <span className="text-[13px] text-foreground">{t('mm_c_guard_strikes', { n: fmt.num(acct.active_strikes), max: fmt.num(g.maxStrikes) })}</span>
                </>
              ) : <span className="text-[13px] text-muted-foreground">{t('mm_c_guard_no_account')}</span>}
            </dd>
          </div>
          <div className="rounded-xl border border-border px-3 py-2.5">
            <dt className="text-2xs text-muted-foreground">{t('mm_c_guard_campaign')}</dt>
            <dd className="mt-1">
              <Chip tone={campaignState === 'OK' ? 'good' : campaignState === 'LOCKED_FOR_REVIEW' ? 'watch' : 'gold'}>
                {t(`mm_c_guard_campaign_${campaignState}`)}
              </Chip>
            </dd>
          </div>
        </dl>

        <h3 className="mb-2 mt-4 text-[13px] font-semibold text-foreground">{t('mm_c_guard_incidents')}</h3>
        {incidents.length === 0 ? <Muted>{t('mm_c_guard_none')}</Muted> : (
          <ul className="space-y-2" data-mm-incidents="">
            {incidents.map((i) => {
              const key = GUARD_KEYS.includes(i.customer_key) ? i.customer_key : 'guard_changed_in_meta';
              return (
                <li key={i.id} className="rounded-xl border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {LEVELS.includes(i.level) && <Chip tone={LEVEL_TONE[i.level]}>{t(`mm_c_guard_level_${i.level}`)}</Chip>}
                    <span className="text-2xs text-muted-foreground">{fmt.dateTime(i.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{t(`mm_${key}`)}</p>
                  {(i.protective_action === 'PAUSE_CAMPAIGN' || i.protective_action === 'PAUSE_DUPLICATE') && (
                    <p className="mt-1 text-2xs text-muted-foreground">{t(`mm_c_guard_protective_${i.protective_action}`)}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

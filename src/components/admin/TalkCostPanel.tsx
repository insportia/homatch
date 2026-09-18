/*
 * WHAT A CONVERSATION COSTS HOMATCH.
 *
 * COGS ONLY. Not a price, not a margin, not anything a customer is ever
 * shown. The table behind this says the same thing in its own header and it
 * is worth repeating on the screen, because a panel full of money is one
 * somebody will eventually mistake for an invoice.
 *
 * THE RULE THIS PANEL IS BUILT ON
 *
 * A figure that is not known renders as unknown. Never as zero, never as a
 * dash that could be read as zero, never averaged into a smaller number by
 * being silently skipped. Before this existed, every one of the 2,238 AI Talk
 * usage rows in production carried a NULL cost and the product's entire
 * speech and model spend was invisible -- not disputed, not estimated,
 * absent. The point of this screen is that the gaps are as legible as the
 * numbers.
 *
 * TWO KINDS OF COST, NEVER MIXED
 *
 *   VARIABLE   metered by a provider for this conversation: Cartesia by the
 *              character, Google by the second, OpenAI by the token.
 *   ALLOCATED  a share of a fixed monthly subscription. Railway and Supabase
 *              bill by the month whether anybody talks or not, so there is no
 *              per-call price to report and inventing one would be a lie with
 *              a decimal point in it. Shown separately, with its method.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTalkCogs, getTalkSessionCogs } from '@/services/voiceAi';
import type { TalkCogs, TalkCogsLeg, TalkSessionCogs } from '@/services/voiceAi';

/**
 * Money, or the honest absence of it.
 *
 * Widens below a cent rather than rounding to $0.00: a cost of $0.00042 that
 * renders as zero reads as free, and per-turn voice costs live exactly there.
 */
function usd(value: number | null | undefined, frac = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 6 : frac;
  return `$${value.toFixed(digits)}`;
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function Stat({ label, value, sub, unknown, unknownLabel }: {
  label: string; value: string; sub?: string; unknown?: boolean; unknownLabel: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${unknown ? 'text-amber-600 dark:text-amber-400' : ''}`}
        dir="ltr"
      >
        {unknown ? unknownLabel : value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** One provider's row. The unpriced count is printed even when it is zero. */
function LegRow({ name, leg, units, unknownLabel, cancelledLabel }: {
  name: string; leg: TalkCogsLeg; units: string; unknownLabel: string; cancelledLabel: string;
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 font-medium">{name}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">{num(leg.calls)}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">{units}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {leg.failures
          ? <span className="text-amber-600 dark:text-amber-400">{num(leg.failures)}</span>
          : num(0)}
        {leg.cancelled
          ? (
            <span className="ms-1 text-muted-foreground">
              {cancelledLabel.replace('{n}', num(leg.cancelled))}
            </span>
          )
          : null}
      </td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {leg.costUsd === null
          ? <span className="text-amber-600 dark:text-amber-400">{unknownLabel}</span>
          : usd(leg.costUsd)}
      </td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {leg.unknownCalls
          ? <span className="text-amber-600 dark:text-amber-400">{num(leg.unknownCalls)}</span>
          : num(0)}
      </td>
    </tr>
  );
}

export function TalkCostPanel() {
  const { t } = useLanguage();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<TalkCogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [session, setSession] = useState<TalkSessionCogs | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getTalkCogs(days)
      .then((out) => { if (alive) setData(out); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const unknownLabel = t('talk_cogs_unknown');

  const inspect = async () => {
    const id = sessionId.trim();
    if (!id) return;
    setSessionLoading(true);
    setSessionError('');
    const out = await getTalkSessionCogs(id);
    setSession(out);
    if (!out) setSessionError(t('talk_cogs_not_found'));
    setSessionLoading(false);
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (!data) return <p className="text-sm text-muted-foreground">{t('talk_cogs_unavailable')}</p>;

  const sttUnits = data.stt.audioSeconds
    ? t('talk_cogs_min_audio').replace('{n}', (data.stt.audioSeconds / 60).toFixed(1))
    : '—';
  const llmUnits = data.llm.inputTokens
    ? t('talk_cogs_tokens')
      .replace('{in}', num(data.llm.inputTokens))
      .replace('{cached}', num(data.llm.cachedInputTokens))
      .replace('{out}', num(data.llm.outputTokens))
    : '—';
  const ttsUnits = data.tts.characters
    ? t('talk_cogs_chars').replace('{n}', num(data.tts.characters))
    : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-amber-700 dark:text-amber-400">
          {t('talk_cogs_note')}
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{t('talk_cogs_today')}</SelectItem>
            <SelectItem value="7">{t('talk_cogs_7d')}</SelectItem>
            <SelectItem value="30">{t('talk_cogs_30d')}</SelectItem>
            <SelectItem value="0">{t('talk_cogs_all')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('talk_cogs_sessions')} value={num(data.sessions)} unknownLabel={unknownLabel} />
        <Stat label={t('talk_cogs_turns')} value={num(data.turns)} unknownLabel={unknownLabel} />
        <Stat label={t('talk_cogs_minutes')} value={data.minutes.toFixed(1)} unknownLabel={unknownLabel} />
        <Stat
          label={t('talk_cogs_total_known')}
          value={usd(data.totals.knownUsd)}
          sub={t('talk_cogs_split')
            .replace('{metered}', usd(data.totals.variableUsd))
            .replace('{allocated}', usd(data.totals.allocatedUsd))}
          unknownLabel={unknownLabel}
        />
        <Stat
          label={t('talk_cogs_per_session')}
          value={usd(data.averages.perSessionUsd)}
          unknown={data.averages.perSessionUsd === null}
          unknownLabel={unknownLabel}
        />
        <Stat
          label={t('talk_cogs_per_minute')}
          value={usd(data.averages.perMinuteUsd)}
          unknown={data.averages.perMinuteUsd === null}
          unknownLabel={unknownLabel}
        />
        <Stat
          label={t('talk_cogs_per_turn')}
          value={usd(data.averages.perTurnUsd)}
          unknown={data.averages.perTurnUsd === null}
          unknownLabel={unknownLabel}
        />
        <Stat
          label={t('talk_cogs_unpriced')}
          value={num(data.totals.unknownCalls)}
          sub={data.totals.unknownCalls ? t('talk_cogs_no_rate') : t('talk_cogs_all_priced')}
          unknownLabel={unknownLabel}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('talk_cogs_metered')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">{t('talk_cogs_col_leg')}</th>
                  <th className="py-2 text-end font-medium">{t('talk_cogs_col_calls')}</th>
                  <th className="py-2 text-end font-medium">{t('talk_cogs_col_units')}</th>
                  <th className="py-2 text-end font-medium">{t('talk_cogs_col_failed')}</th>
                  <th className="py-2 text-end font-medium">{t('talk_cogs_col_cogs')}</th>
                  <th className="py-2 text-end font-medium">{t('talk_cogs_col_unpriced')}</th>
                </tr>
              </thead>
              <tbody>
                <LegRow
                  name={t('talk_cogs_leg_stt')} leg={data.stt} units={sttUnits}
                  unknownLabel={unknownLabel} cancelledLabel={t('talk_cogs_cancelled')}
                />
                <LegRow
                  name={t('talk_cogs_leg_llm')} leg={data.llm} units={llmUnits}
                  unknownLabel={unknownLabel} cancelledLabel={t('talk_cogs_cancelled')}
                />
                <LegRow
                  name={t('talk_cogs_leg_tts')} leg={data.tts} units={ttsUnits}
                  unknownLabel={unknownLabel} cancelledLabel={t('talk_cogs_cancelled')}
                />
              </tbody>
            </table>
          </div>
          {data.stt.audioSeconds > 0
            ? (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {t('talk_cogs_two_streams')}
              </p>
            )
            : null}
          {data.totals.sessionsWithoutStt || data.totals.sessionsWithoutLlm
            ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                {t('talk_cogs_missing_rows')
                  .replace('{stt}', String(data.totals.sessionsWithoutStt))
                  .replace('{llm}', String(data.totals.sessionsWithoutLlm))}
              </p>
            )
            : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('talk_cogs_infra')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.infra
            ? <p className="text-xs text-muted-foreground">{t('talk_cogs_no_fixed')}</p>
            : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat
                    label={t('talk_cogs_fixed_monthly')} value={usd(data.infra.monthlyUsd)}
                    unknownLabel={unknownLabel}
                  />
                  <Stat
                    label={t('talk_cogs_window_share')}
                    value={t('talk_cogs_pct_month').replace('{n}', (data.infra.months * 100).toFixed(1))}
                    unknownLabel={unknownLabel}
                  />
                  <Stat
                    label={t('talk_cogs_allocated_window')} value={usd(data.infra.periodUsd)}
                    unknownLabel={unknownLabel}
                  />
                  <Stat
                    label={t('talk_cogs_per_conv_minute')}
                    value={usd(data.infra.usdPerMinute)}
                    unknown={data.infra.usdPerMinute === null}
                    sub={data.infra.usdPerMinute === null ? t('talk_cogs_no_minutes') : undefined}
                    unknownLabel={unknownLabel}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  {t('talk_cogs_method')}
                </p>
              </>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('talk_cogs_inspect')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void inspect(); }}
              placeholder={t('talk_cogs_session_placeholder')}
              className="h-8 text-xs"
            />
            <Button
              size="sm" variant="secondary" className="h-8"
              onClick={() => void inspect()} disabled={sessionLoading}
            >
              {sessionLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {sessionError
            ? <p className="text-xs text-amber-700 dark:text-amber-400">{sessionError}</p>
            : null}
          {session
            ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat
                    label={t('talk_cogs_duration')}
                    value={t('talk_cogs_min').replace('{n}', session.session.minutes.toFixed(2))}
                    unknownLabel={unknownLabel}
                  />
                  <Stat label={t('talk_cogs_turns')} value={num(session.session.turns)} unknownLabel={unknownLabel} />
                  <Stat
                    label={t('talk_cogs_total_known')} value={usd(session.totals.knownUsd)}
                    unknownLabel={unknownLabel}
                  />
                  <Stat
                    label={t('talk_cogs_per_turn')} value={usd(session.averages.perTurnUsd)}
                    unknown={session.averages.perTurnUsd === null} unknownLabel={unknownLabel}
                  />
                </div>
                {session.totals.missingLegs.length
                  ? (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      {t('talk_cogs_missing_legs').replace('{legs}', session.totals.missingLegs.join(', '))}
                    </p>
                  )
                  : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 text-start font-medium">{t('talk_cogs_col_at')}</th>
                        <th className="py-2 text-start font-medium">{t('talk_cogs_col_leg')}</th>
                        <th className="py-2 text-start font-medium">{t('talk_cogs_col_model')}</th>
                        <th className="py-2 text-end font-medium">{t('talk_cogs_col_units')}</th>
                        <th className="py-2 text-end font-medium">{t('talk_cogs_col_cogs')}</th>
                        <th className="py-2 text-start font-medium">{t('talk_cogs_col_basis')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.events.map((e, i) => (
                        <tr key={`${e.at}-${i}`} className="border-b border-border/50">
                          <td className="py-2 tabular-nums" dir="ltr">{new Date(e.at).toLocaleTimeString()}</td>
                          <td className="py-2">
                            {e.role}
                            {e.errorCode
                              ? <span className="ms-1 text-amber-600 dark:text-amber-400">{e.errorCode}</span>
                              : null}
                          </td>
                          <td className="py-2 text-muted-foreground">{e.model ?? '—'}</td>
                          <td className="py-2 text-end tabular-nums" dir="ltr">
                            {e.role === 'STT' ? `${num(e.audioSeconds)}s`
                              : e.role === 'TTS' ? `${num(e.characters)}c`
                                : `${num(e.inputTokens)}/${num(e.cachedInputTokens)}/${num(e.outputTokens)}`}
                          </td>
                          <td className="py-2 text-end tabular-nums" dir="ltr">
                            {e.costUsd === null
                              ? <span className="text-amber-600 dark:text-amber-400">{unknownLabel}</span>
                              : usd(e.costUsd)}
                          </td>
                          <td className="py-2 text-muted-foreground">{e.costBasis ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {session.infra.allocatedUsd !== null
                  ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t('talk_cogs_plus_infra')
                        .replace('{amount}', usd(session.infra.allocatedUsd))
                        .replace('{rate}', usd(session.infra.usdPerMinute))}
                    </p>
                  )
                  : null}
              </div>
            )
            : null}
        </CardContent>
      </Card>
    </div>
  );
}

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

function Stat({ label, value, sub, unknown }: {
  label: string; value: string; sub?: string; unknown?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${unknown ? 'text-amber-600 dark:text-amber-400' : ''}`} dir="ltr">
        {unknown ? 'Unknown' : value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** One provider's row. `unknownCalls` is printed even when it is zero-cost news. */
function LegRow({ name, leg, units }: { name: string; leg: TalkCogsLeg; units: string }) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 font-medium">{name}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">{num(leg.calls)}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">{units}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {leg.failures ? <span className="text-amber-600 dark:text-amber-400">{num(leg.failures)}</span> : '0'}
        {leg.cancelled ? <span className="ms-1 text-muted-foreground">({num(leg.cancelled)} cancelled)</span> : null}
      </td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {leg.costUsd === null
          ? <span className="text-amber-600 dark:text-amber-400">Unknown</span>
          : usd(leg.costUsd)}
      </td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {leg.unknownCalls
          ? <span className="text-amber-600 dark:text-amber-400">{num(leg.unknownCalls)}</span>
          : '0'}
      </td>
    </tr>
  );
}

export function TalkCostPanel() {
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

  const inspect = async () => {
    const id = sessionId.trim();
    if (!id) return;
    setSessionLoading(true);
    setSessionError('');
    const out = await getTalkSessionCogs(id);
    setSession(out);
    if (!out) setSessionError('No session with that id, or it has been purged.');
    setSessionLoading(false);
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (!data) return <p className="text-sm text-muted-foreground">Cost data is unavailable.</p>;

  const sttUnits = data.stt.audioSeconds
    ? `${(data.stt.audioSeconds / 60).toFixed(1)} min audio`
    : '—';
  const llmUnits = data.llm.inputTokens
    ? `${num(data.llm.inputTokens)} in / ${num(data.llm.cachedInputTokens)} cached / ${num(data.llm.outputTokens)} out`
    : '—';
  const ttsUnits = data.tts.characters ? `${num(data.tts.characters)} chars` : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-amber-700 dark:text-amber-400">
          Provider cost of goods only. Not customer pricing.
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Today</SelectItem>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="0">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions" value={num(data.sessions)} />
        <Stat label="Turns" value={num(data.turns)} />
        <Stat label="Conversation minutes" value={data.minutes.toFixed(1)} />
        <Stat
          label="Total known COGS"
          value={usd(data.totals.knownUsd)}
          sub={`${usd(data.totals.variableUsd)} metered + ${usd(data.totals.allocatedUsd)} allocated`}
        />
        <Stat label="Per session" value={usd(data.averages.perSessionUsd)} unknown={data.averages.perSessionUsd === null} />
        <Stat label="Per minute" value={usd(data.averages.perMinuteUsd)} unknown={data.averages.perMinuteUsd === null} />
        <Stat label="Per turn" value={usd(data.averages.perTurnUsd)} unknown={data.averages.perTurnUsd === null} />
        <Stat
          label="Unpriced calls"
          value={num(data.totals.unknownCalls)}
          sub={data.totals.unknownCalls ? 'no rate on file' : 'every call priced'}
        />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Metered by the provider</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 text-start font-medium">Leg</th>
                  <th className="py-2 text-end font-medium">Calls</th>
                  <th className="py-2 text-end font-medium">Units</th>
                  <th className="py-2 text-end font-medium">Failed</th>
                  <th className="py-2 text-end font-medium">COGS</th>
                  <th className="py-2 text-end font-medium">Unpriced</th>
                </tr>
              </thead>
              <tbody>
                <LegRow name="Speech recognition (Google)" leg={data.stt} units={sttUnits} />
                <LegRow name="Luna (OpenAI)" leg={data.llm} units={llmUnits} />
                <LegRow name="Speech synthesis (Cartesia)" leg={data.tts} units={ttsUnits} />
              </tbody>
            </table>
          </div>
          {data.stt.audioSeconds > 0 ? (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Recognition opens two concurrent streams per session, the pinned recogniser and
              the second opinion that catches language switches, and Google bills both. The
              audio above is the sum of the two, which is roughly double the speech spoken.
            </p>
          ) : null}
          {data.totals.sessionsWithoutStt || data.totals.sessionsWithoutLlm ? (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              {data.totals.sessionsWithoutStt} session(s) have no recognition row and{' '}
              {data.totals.sessionsWithoutLlm} have no model row. Those conversations predate
              the measurement and are counted here rather than averaged in as cheap ones.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Allocated infrastructure</CardTitle></CardHeader>
        <CardContent>
          {!data.infra ? (
            <p className="text-xs text-muted-foreground">No fixed-cost rows on file.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Fixed monthly" value={usd(data.infra.monthlyUsd)} />
                <Stat label="Window share" value={`${(data.infra.months * 100).toFixed(1)}% of a month`} />
                <Stat label="Allocated to this window" value={usd(data.infra.periodUsd)} />
                <Stat
                  label="Per conversation minute"
                  value={usd(data.infra.usdPerMinute)}
                  unknown={data.infra.usdPerMinute === null}
                  sub={data.infra.usdPerMinute === null ? 'no minutes served' : undefined}
                />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{data.infra.method}</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Inspect one conversation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void inspect(); }}
              placeholder="Talk session id"
              className="h-8 text-xs"
            />
            <Button size="sm" variant="secondary" className="h-8" onClick={() => void inspect()} disabled={sessionLoading}>
              {sessionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {sessionError ? <p className="text-xs text-amber-700 dark:text-amber-400">{sessionError}</p> : null}
          {session ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Duration" value={`${session.session.minutes.toFixed(2)} min`} />
                <Stat label="Turns" value={num(session.session.turns)} />
                <Stat label="Total known COGS" value={usd(session.totals.knownUsd)} />
                <Stat label="Per turn" value={usd(session.averages.perTurnUsd)} unknown={session.averages.perTurnUsd === null} />
              </div>
              {session.totals.missingLegs.length ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  No usage recorded for: {session.totals.missingLegs.join(', ')}. This conversation
                  has a hole in it, and the hole is the answer rather than a zero.
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 text-start font-medium">At</th>
                      <th className="py-2 text-start font-medium">Leg</th>
                      <th className="py-2 text-start font-medium">Model</th>
                      <th className="py-2 text-end font-medium">Units</th>
                      <th className="py-2 text-end font-medium">COGS</th>
                      <th className="py-2 text-start font-medium">Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.events.map((e, i) => (
                      <tr key={`${e.at}-${i}`} className="border-b border-border/50">
                        <td className="py-2 tabular-nums" dir="ltr">{new Date(e.at).toLocaleTimeString()}</td>
                        <td className="py-2">
                          {e.role}
                          {e.errorCode ? <span className="ms-1 text-amber-600 dark:text-amber-400">{e.errorCode}</span> : null}
                        </td>
                        <td className="py-2 text-muted-foreground">{e.model ?? '—'}</td>
                        <td className="py-2 text-end tabular-nums" dir="ltr">
                          {e.role === 'STT' ? `${num(e.audioSeconds)}s`
                            : e.role === 'TTS' ? `${num(e.characters)}c`
                              : `${num(e.inputTokens)}/${num(e.cachedInputTokens)}/${num(e.outputTokens)}`}
                        </td>
                        <td className="py-2 text-end tabular-nums" dir="ltr">
                          {e.costUsd === null
                            ? <span className="text-amber-600 dark:text-amber-400">Unknown</span>
                            : usd(e.costUsd)}
                        </td>
                        <td className="py-2 text-muted-foreground">{e.costBasis ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {session.infra.allocatedUsd !== null ? (
                <p className="text-[11px] text-muted-foreground">
                  Plus {usd(session.infra.allocatedUsd)} allocated infrastructure at{' '}
                  {usd(session.infra.usdPerMinute)} per minute. Allocated, not metered.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

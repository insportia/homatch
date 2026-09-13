// HOMATCH — one real call, to one number.
//
// This is deliberately not "a campaign with one contact". A campaign needs an
// audience, a schedule and the dispatcher, and enabling the dispatcher so
// somebody can hear their agent speak is how a list gets dialled by accident.
//
// It also does not relax a single gate. The server runs the same channel
// checks the Admin go-live screen runs and the same reservation the campaign
// path takes, and refuses if any of them fail — so what this screen adds is
// not permission, it is legibility: when it refuses, it says what is missing
// instead of "unavailable".
//
// A customer sees a sentence. An admin sees the identifiers.

import React, { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { PhoneCall, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { previewTestCall, runTestCall, type TestCallResult } from '@/services/communications';
import { parsePhone } from '@/lib/comm/phone';

export function PhoneTestCard({ agentId, isAdmin }: { agentId: string; isAdmin: boolean }) {
  const { t } = useLanguage();
  const [to, setTo] = useState('');
  const [checking, setChecking] = useState(false);
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<TestCallResult | null>(null);

  const parsed = to.trim() ? parsePhone(to, null) : null;
  const numberUsable = Boolean(parsed?.e164);

  const check = useCallback(async () => {
    if (!numberUsable) { toast.error(t('testcall_bad_number')); return; }
    setChecking(true);
    setResult(null);
    try {
      const res = await previewTestCall({ agentId, toE164: to });
      // The preview answers even when it refuses, so a refusal body is still
      // the thing to show.
      setResult((res.ok ? res.data : (res.data as TestCallResult)) ?? null);
    } finally {
      setChecking(false);
    }
  }, [agentId, to, numberUsable, t]);

  const place = useCallback(async () => {
    if (!numberUsable) { toast.error(t('testcall_bad_number')); return; }
    setCalling(true);
    try {
      const res = await runTestCall({ agentId, toE164: to });
      if (res.ok && res.data?.ok) {
        toast.success(t('testcall_placed'));
        setResult(res.data);
        return;
      }
      const payload = (res.ok ? res.data : (res.data as TestCallResult)) ?? null;
      setResult(payload);
      toast.error(t('testcall_blocked'));
    } finally {
      setCalling(false);
    }
  }, [agentId, to, numberUsable, t]);

  const ready = result?.ok === true && !result.providerCallId;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PhoneCall className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('testcall_title')}
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {t('testcall_sub')}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tc-to" className="text-xs">{t('testcall_destination')}</Label>
          <Input
            id="tc-to" value={to} onChange={(e) => { setTo(e.target.value); setResult(null); }}
            inputMode="tel" autoComplete="tel" placeholder="+995 555 01 02 03"
            className="h-9 font-mono text-sm"
          />
          {to.trim() ? (
            <p className="text-2xs text-muted-foreground">
              {parsed?.e164 ?? t('testcall_bad_number')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline" size="sm" className="h-8"
            onClick={() => void check()} disabled={checking || calling || !numberUsable}
          >
            {checking ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {t('testcall_check')}
          </Button>
          {/* Only offered once the server has said everything is in place. It
              would refuse anyway; offering it beforehand teaches people that
              the button does not work. */}
          {ready ? (
            <Button size="sm" className="h-8" onClick={() => void place()} disabled={calling}>
              {calling ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {t('testcall_place')}
            </Button>
          ) : null}
        </div>

        {result?.providerCallId ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('testcall_placed')}</AlertDescription>
          </Alert>
        ) : ready ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('testcall_ready')}</AlertDescription>
          </Alert>
        ) : result && result.ok === false ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="space-y-2 text-xs">
              <p>{t('testcall_blocked')}</p>
              {isAdmin ? (
                /* Identifiers and the exact config to change — admin only. A
                   customer gets the sentence above and nothing more. */
                <ul className="space-y-1">
                  {(result.checks ?? []).filter((c) => !c.ok).map((c) => (
                    <li key={c.key} className="[overflow-wrap:anywhere]">
                      <code className="font-mono text-2xs">{c.key}</code>
                      {c.detail ? <span className="ms-1.5 opacity-80">{c.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="opacity-80">{t('testcall_blocked_admin')}</p>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

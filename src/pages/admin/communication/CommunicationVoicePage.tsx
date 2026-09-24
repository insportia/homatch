// HOMATCH Admin — AI voices.
//
// The destination for "I want to change the AI voice". Three clicks from
// anywhere in the Admin: AI & communication, Voice, type, Save.
//
// TWO PRODUCTS, TWO SETTINGS, SAID OUT LOUD
//
// AI TALK and the AI Call Center both speak, and it would be tidy to put
// one voice control at the top and call it "the voice". It would also be
// false. AI TALK reads `ai_talk_voice`, one value for the whole product.
// A calling agent reads `voice_id` out of its OWN version snapshot, so
// two agents can and do speak differently. Pretending they were one
// control would mean an owner changing the website voice and believing
// they had changed what the phone does.
//
// So they are two cards, and the second one says plainly that it is a
// different setting and sends the reader to the agent that owns it.

import { ArrowRight, AudioLines, Info, PhoneCall } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { AiTalkVoiceControl } from '@/components/admin/AiTalkVoiceControl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { CommunicationShell } from './CommunicationShell';
import { useCommStatus, VerdictBadge, verdictOf } from './status';

export default function CommunicationVoicePage() {
  const { t } = useLanguage();
  const status = useCommStatus();

  const talkVerdict = React.useMemo(() => {
    if (!status.ok) return 'UNKNOWN' as const;
    const row = status.readiness.find((r) => r.channel === 'AI_TALK');
    if (row) return row.ready ? ('OK' as const) : ('ACTION' as const);
    return verdictOf(status.providers.find((p) => p.provider === 'CARTESIA'), status.ok);
  }, [status]);

  return (
    <CommunicationShell titleKey="voice_page_title" subtitleKey="voice_page_subtitle">
      {/* ── AI TALK ────────────────────────────────────────────────── */}
      <Card data-testid="voice-ai-talk-card">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-[12rem] flex-1 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                <AudioLines className="h-4 w-4 text-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-foreground">{t('comms_card_ai_talk')}</h2>
                <p className="mt-0.5 max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
                  {t('voice_ai_talk_desc')}
                </p>
              </div>
            </div>
            <VerdictBadge verdict={talkVerdict} />
          </div>

          <AiTalkVoiceControl />
        </CardContent>
      </Card>

      {/* ── AI Call Center ─────────────────────────────────────────── */}
      <Card data-testid="voice-call-center-card">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
              <PhoneCall className="h-4 w-4 text-foreground" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-foreground">{t('admin_nav_call_center')}</h2>
              <p className="mt-0.5 max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
                {t('voice_cc_desc')}
              </p>
            </div>
          </div>

          <Alert className="mb-3">
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-xs leading-relaxed">
              {t('voice_cc_not_shared')}
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/outreach/agents">
                {t('voice_cc_open_agents')}
                <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
              <Link to="/admin/communication/call-center">{t('admin_nav_call_center')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── The way out to the technical tooling ───────────────────── */}
      <p className="text-2xs leading-relaxed text-muted-foreground">
        {t('admin_advanced_hint')}{' '}
        <Link to="/admin/communication/advanced" className="text-primary underline underline-offset-2">
          {t('admin_advanced_show')}
        </Link>
      </p>
    </CommunicationShell>
  );
}

// HOMATCH Admin — the technical voice tooling, kept and moved.
//
// WHAT HAPPENED TO THE ELEVEN TABS
//
// /admin/voice-ai was a top-level sidebar entry with eleven tabs —
// Overview, STT, Brain, Voices, Audition, Vocabulary, Pronunciation,
// Personality, Failover, Usage, Cost — and it was the place an owner was
// implicitly told to go to change the voice. None of it is deleted: an
// operator who needs to tune the recogniser or approve a pronunciation
// still needs every one of those tools, and they are all still here.
//
// What changed is that this is now the END of a path rather than the
// front of one. The voice itself left: it lives on the Voice page, two
// clicks from the sidebar, in a box with a Test button. This page is what
// remains once the common task has been taken out of it, and the first
// thing on it is the way back.
//
// The old route still works. /admin/voice-ai redirects here, so a
// bookmark from before the redesign lands on the same tooling.

import { ArrowLeft } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import AdminVoiceAiPage from '@/pages/admin/AdminVoiceAiPage';
import { CommunicationShell } from './CommunicationShell';

export default function CommunicationAdvancedPage() {
  const { t } = useLanguage();
  return (
    <CommunicationShell
      titleKey="adv_admin_title"
      subtitleKey="adv_admin_subtitle"
      actions={
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/admin/communication/voice">
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            {t('adv_back_to_voice')}
          </Link>
        </Button>
      }
    >
      <Alert>
        <AlertDescription className="text-xs leading-relaxed">
          {t('admin_advanced_hint')}
        </AlertDescription>
      </Alert>

      {/* The existing tooling, unchanged apart from being told that the
          page around it already has a heading. Hiding its h1 with CSS
          would have left it in the accessibility tree, so the page would
          still have announced two titles. */}
      <div data-testid="advanced-voice-tooling">
        <AdminVoiceAiPage embedded />
      </div>
    </CommunicationShell>
  );
}

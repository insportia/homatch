// HOMATCH — add a voice of your own.
//
// The provider supports cloning, so the product does. What the product adds on
// top is the part the provider does not care about: a person saying, on the
// record, that they are allowed to clone this voice.
//
// The Create button is disabled until that box is ticked. Not warned about,
// not defaulted — disabled. A cloned voice can say things the speaker never
// said, and the only defensible position is that nobody can produce one by
// accident.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Mic2, Loader2, Upload } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { cloneVoice } from '@/services/communications';

const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

/** Mirrors the server's allowlist; the server remains the one that decides. */
const ACCEPT = '.wav,.mp3,.m4a,.ogg,.webm,audio/*';

export function AddVoiceDialog({
  open, onOpenChange, defaultLanguage, onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  defaultLanguage: string;
  onCreated: (voiceId: string, name: string) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState(defaultLanguage || 'ka');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const canCreate = Boolean(name.trim() && file && consent) && !busy;

  const submit = async () => {
    if (!canCreate || !file) return;
    setBusy(true);
    try {
      const res = await cloneVoice({ file, name: name.trim(), language, consent, source: 'UPLOAD' });
      if (res.ok) {
        toast.success(t('voice_created'));
        setName(''); setFile(null); setConsent(false);
        onOpenChange(false);
        onCreated(res.voiceId, name.trim());
        return;
      }
      toast.error(t(
        res.reason === 'TOO_SHORT' ? 'voice_clip_too_short'
          : res.reason === 'TOO_LARGE' ? 'voice_clip_too_large'
          : res.reason === 'UNSUPPORTED_FORMAT' ? 'voice_clip_format'
          : res.reason === 'RATE_LIMITED' ? 'comm_rate_limited'
          : 'voice_clone_failed',
      ));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mic2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('voice_add')}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-snug [overflow-wrap:anywhere]">
            {t('voice_add_sub')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="av-name" className="text-xs">{t('voice_name_label')}</Label>
            <Input
              id="av-name" value={name} onChange={(e) => setName(e.target.value)}
              className="h-9 text-sm" maxLength={80}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="av-file" className="text-xs">{t('voice_file_label')}</Label>
              <Input
                id="av-file" type="file" accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="h-9 text-xs file:me-2 file:text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av-lang" className="text-xs">{t('comm_field_language')}</Label>
              <select
                id="av-lang" value={language} onChange={(e) => setLanguage(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          {/* The gate. Unticked, Create does nothing. */}
          <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/[0.04] p-3">
            <Checkbox
              id="av-consent" checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5 shrink-0"
            />
            <Label htmlFor="av-consent" className="cursor-pointer text-[13px] font-normal leading-snug [overflow-wrap:anywhere]">
              {t('voice_consent_label')}
              <span className="mt-1 block text-2xs text-muted-foreground">
                {t('voice_consent_why')}
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('comm_cancel')}
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={!canCreate}>
            {busy
              ? <><Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('voice_creating')}</>
              : <><Upload className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('voice_add')}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

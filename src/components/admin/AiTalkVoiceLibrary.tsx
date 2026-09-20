/*
 * A SHELF OF VOICES, SO CHANGING ONE IS NOT A TYPING EXERCISE.
 *
 * Pasting a uuid, hearing it and saving it already worked. What it did not do
 * was REMEMBER: comparing Nino against Mariam meant keeping two uuids
 * somewhere outside the product and pasting them back and forth, and a uuid
 * is exactly the kind of string that loses one character and then gets blamed
 * on the voice.
 *
 * So this is a shelf. Paste an id once, Cartesia is asked what it is, give it
 * a name you will recognise, and from then on switching production is picking
 * a card.
 *
 * WHAT "USE VOICE" CHANGES, AND WHAT IT CANNOT.
 *
 * It writes `ai_talk_voice` and nothing else. The recogniser, the model, the
 * prompt, the personality, the endpointing, the streaming, the language rules
 * and the audio format are not in that key and cannot be moved by this
 * screen. Speed is the one other thing in it, and it only changes when
 * somebody changes it.
 *
 * AND AN ID THAT DOES NOT EXIST NEVER GETS THAT FAR. It is resolved against
 * Cartesia on the way ONTO the shelf, so production cannot be pointed at a
 * voice that is not there. If the lookup fails the card is not created and
 * the assistant keeps speaking with the voice it already had.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  VOICE_ID_SHAPE, type SavedVoice,
  getAiTalkVoiceLibrary, saveAiTalkVoiceLibrary, lookupCartesiaVoice,
  previewAiTalkVoice, saveAiTalkVoice,
} from '@/services/communications';

interface Props {
  /** The voice AI Talk is speaking with right now. */
  activeVoiceId: string | null;
  /** The one it was speaking with before that, for Restore. */
  previousVoiceId: string | null;
  /** Play PCM through the panel's own audio path, so Test sounds like Test. */
  playPcm: (base64: string, sampleRate: number) => Promise<void>;
  /** Tell the parent panel production moved, so its own fields stay truthful. */
  onActivated: (voiceId: string) => void;
}

const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

function AiTalkVoiceLibraryImpl({ activeVoiceId, previousVoiceId, playPcm, onActivated }: Props) {
  const { t } = useLanguage();
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    void getAiTalkVoiceLibrary().then((lib) => setVoices(lib?.voices ?? []));
  }, []);

  const persist = useCallback(async (next: SavedVoice[]) => {
    setVoices(next);
    const ok = await saveAiTalkVoiceLibrary(next);
    if (!ok) toast.error(t('comm_save_failed'));
    return ok;
  }, [t]);

  /*
   * ASK CARTESIA WHAT THIS IS, THEN SAVE IT.
   *
   * The name and description come from the provider, so a card says what the
   * voice actually is rather than what somebody guessed at midnight. Where
   * Cartesia returns no description the card shows none -- nothing here fills
   * the gap with an invention.
   */
  const onAdd = useCallback(async () => {
    const id = newId.trim();
    if (!VOICE_ID_SHAPE.test(id)) { toast.error(t('admin_talk_voice_invalid')); return; }
    if (voices.some((v) => v.voiceId === id)) { toast.error(t('admin_talk_lib_duplicate')); return; }

    setLooking(true);
    try {
      const found = await lookupCartesiaVoice(id);
      if (!found.ok) {
        // Refused here, which is why production can never point at it.
        toast.error(found.reason === 'VOICE_NOT_FOUND'
          ? t('admin_talk_lib_not_found')
          : t('admin_talk_voice_test_failed'));
        return;
      }
      const ok = await persist([...voices, {
        voiceId: id,
        name: newName.trim() || found.name,
        description: found.description,
        language: found.language,
        addedAt: new Date().toISOString(),
      }]);
      if (ok) { setNewId(''); setNewName(''); toast.success(t('admin_talk_lib_added')); }
    } finally {
      setLooking(false);
    }
  }, [newId, newName, voices, persist, t]);

  const onPreview = useCallback(async (id: string) => {
    setBusy(id);
    try {
      // Georgian: the language this product lives or dies on, and the one a
      // wrong voice mangles first.
      const out = await previewAiTalkVoice(id, 'ka');
      if (!out.ok) { toast.error(t('admin_talk_voice_test_failed')); return; }
      await playPcm(out.pcmBase64, out.sampleRate);
    } catch {
      toast.error(t('admin_talk_voice_test_failed'));
    } finally {
      setBusy(null);
    }
  }, [playPcm, t]);

  /** The only thing on this screen that changes what production sounds like. */
  const onUse = useCallback(async (id: string) => {
    setBusy(id);
    try {
      // speed is deliberately NOT passed: saveAiTalkVoice leaves it exactly
      // as configured when it is undefined, so switching voice moves the
      // voice and nothing else.
      const ok = await saveAiTalkVoice(id, activeVoiceId);
      if (!ok) { toast.error(t('comm_save_failed')); return; }
      onActivated(id);
      toast.success(t('admin_talk_lib_in_use'));
    } finally {
      setBusy(null);
    }
  }, [activeVoiceId, onActivated, t]);

  const onDelete = useCallback(async (id: string) => {
    // Removing a card never touches production: if this voice is the live one
    // it keeps speaking, because the live voice is a different setting.
    await persist(voices.filter((v) => v.voiceId !== id));
  }, [voices, persist]);

  const onRename = useCallback(async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditing(null); return; }
    await persist(voices.map((v) => (v.voiceId === id ? { ...v, name: name.slice(0, 40) } : v)));
    setEditing(null);
  }, [editName, voices, persist]);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-xs font-medium">{t('admin_talk_lib_title')}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t('admin_talk_lib_hint')}</p>
      </div>

      {/* Which voice is live, which one it replaced, and the way back. */}
      <div className="rounded-lg bg-muted/40 p-2.5 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="text-muted-foreground">{t('admin_talk_lib_current')}: </span>
            <span className="font-mono">{activeVoiceId ? short(activeVoiceId) : '—'}</span>
            {activeVoiceId && voices.find((v) => v.voiceId === activeVoiceId)
              ? <span className="ml-1">({voices.find((v) => v.voiceId === activeVoiceId)?.name})</span>
              : null}
          </span>
          <span>
            <span className="text-muted-foreground">{t('admin_talk_lib_previous')}: </span>
            <span className="font-mono">{previousVoiceId ? short(previousVoiceId) : '—'}</span>
          </span>
          {previousVoiceId && previousVoiceId !== activeVoiceId ? (
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              disabled={busy !== null}
              onClick={() => void onUse(previousVoiceId)}
            >
              {t('admin_talk_lib_restore')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Add one. */}
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="lib-voice-id">{t('admin_talk_voice_id')}</Label>
          <Input
            id="lib-voice-id" value={newId} spellCheck={false} autoComplete="off"
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(e) => setNewId(e.target.value)}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="lib-voice-name">{t('admin_talk_lib_name')}</Label>
          <Input
            id="lib-voice-name" value={newName} maxLength={40}
            placeholder={t('admin_talk_lib_name_placeholder')}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" className="h-8 text-xs" disabled={looking} onClick={() => void onAdd()}>
            {looking ? t('admin_talk_lib_checking') : t('admin_talk_lib_add')}
          </Button>
        </div>
      </div>

      {/* The shelf. */}
      {voices.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('admin_talk_lib_empty')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {voices.map((v) => {
            const live = v.voiceId === activeVoiceId;
            return (
              <li key={v.voiceId} className={`rounded-xl border p-2.5 ${live ? 'border-primary' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {editing === v.voiceId ? (
                      <Input
                        autoFocus value={editName} maxLength={40}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => void onRename(v.voiceId)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void onRename(v.voiceId); }}
                        className="h-7 text-xs"
                      />
                    ) : (
                      <p className="truncate text-sm font-medium">{v.name}</p>
                    )}
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{v.voiceId}</p>
                    {/* Only what Cartesia said. No description means none. */}
                    {v.description ? (
                      <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{v.description}</p>
                    ) : null}
                  </div>
                  {live ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                      {t('admin_talk_lib_live')}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs"
                    disabled={busy === v.voiceId}
                    onClick={() => void onPreview(v.voiceId)}
                  >
                    {busy === v.voiceId ? t('admin_talk_lib_playing') : t('admin_talk_lib_preview')}
                  </Button>
                  <Button
                    size="sm" className="h-7 text-xs"
                    disabled={live || busy !== null}
                    onClick={() => void onUse(v.voiceId)}
                  >
                    {t('admin_talk_lib_use')}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setEditing(v.voiceId); setEditName(v.name); }}
                  >
                    {t('admin_talk_lib_edit')}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                    onClick={() => void onDelete(v.voiceId)}
                  >
                    {t('admin_talk_lib_delete')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const AiTalkVoiceLibrary = memo(AiTalkVoiceLibraryImpl);

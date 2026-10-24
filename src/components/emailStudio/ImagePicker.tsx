// EMAIL STUDIO — pick an image for a design block (UX pass §4): upload from the computer, reuse an
// earlier upload, replace or remove. Files go to HOMATCH's private R2 storage through the server
// (services/emailCampaignStudio uploadAsset); the block keeps the stable public link a mail client
// can load. A URL field remains for an image already hosted elsewhere, folded away by default.

import { ImagePlus, Images, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { deleteAsset, type EmailAsset, listAssets, StudioError, uploadAsset } from '@/services/emailCampaignStudio';
import { CropDialog } from './designer/CropDialog';
import { addPlayMark, cropImage } from './designer/imageTools';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,image/avif';

export function ImagePicker({ value, onChange, kind = 'IMAGE', label, crop = true, playMark = false }: {
  value: string; onChange: (src: string, meta?: { width: number | null; height: number | null; name: string | null }) => void;
  kind?: 'IMAGE' | 'LOGO'; label: string;
  /** Offer cropping before upload (the file is cropped in the browser, then uploaded). */
  crop?: boolean;
  /** Video thumbnails: draw a play button into the image before upload. */
  playMark?: boolean;
}) {
  const { t } = useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [assets, setAssets] = useState<EmailAsset[] | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');

  const errorText = (e: unknown) => {
    const code = e instanceof StudioError ? e.code.toLowerCase() : 'upload_failed';
    const k = `ems_img_err_${code}`;
    return t(k) === k ? t('ems_img_err_upload_failed') : t(k);
  };

  const [cropping, setCropping] = useState<File | null>(null);
  /* A picked file goes through the crop step first (GIFs keep their animation: no crop). */
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (crop && file.type !== 'image/gif' && !/heic|heif/i.test(file.type)) { setCropping(file); return; }
    await upload(file);
  };
  const upload = async (picked: File, rect: Parameters<typeof cropImage>[1] | null = null) => {
    setBusy(true);
    try {
      let file = rect ? await cropImage(picked, rect) : picked;
      if (playMark) file = await addPlayMark(file);
      const a = await uploadAsset(file, kind);
      onChange(a.url, { width: a.width, height: a.height, name: a.original_filename });
      setAssets((list) => (list ? [a, ...list] : list));
      toast.success(t('ems_img_uploaded'));
    } catch (e) { toast.error(errorText(e)); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const openLibrary = async () => {
    setLibOpen(true);
    if (!assets) setAssets(await listAssets().catch(() => []));
  };

  const remove = async (a: EmailAsset) => {
    try {
      await deleteAsset(a.id);
      setAssets((list) => (list ?? []).filter((x) => x.id !== a.id));
      if (value === a.url) onChange('');
    } catch (e) {
      toast.error(e instanceof StudioError && e.code === 'ASSET_IN_USE' ? t('ems_img_in_use') : t('ems_img_err_delete'));
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} aria-hidden="true" tabIndex={-1} />
      {value ? (
        <div className="overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#f1f1f1_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
          <img src={value} alt="" className="mx-auto max-h-40 w-auto object-contain" />
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files?.[0]); }}
          className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/25 bg-muted/30 text-xs text-muted-foreground transition-colors hover:border-[hsl(38_70%_55%)] hover:bg-[hsl(38_90%_97%)]">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          <span className="font-medium text-foreground">{busy ? t('ems_img_uploading') : t('ems_img_drop')}</span>
          <span>{t('ems_img_types')}</span>
        </button>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : value ? <RefreshCw className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
          {value ? t('ems_img_replace') : t('ems_img_upload')}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void openLibrary()}><Images className="h-3.5 w-3.5" />{t('ems_img_library')}</Button>
        {value ? <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-red-700" onClick={() => onChange('')}><Trash2 className="h-3.5 w-3.5" />{t('ems_img_remove')}</Button> : null}
      </div>
      <button type="button" className="text-2xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setUrl(value); setUrlOpen((o) => !o); }}>
        {t('ems_img_use_url')}
      </button>
      {urlOpen ? (
        <div className="flex gap-1.5">
          <Input value={url} dir="ltr" inputMode="url" placeholder="https://" className="h-8 text-xs" onChange={(e) => setUrl(e.target.value)} aria-label={t('ems_d_image_url')} />
          <Button type="button" size="sm" className="h-8" onClick={() => { if (/^https:\/\//i.test(url.trim())) { onChange(url.trim()); setUrlOpen(false); } else toast.error(t('ems_d_url_https_image')); }}>{t('ems_rt_apply')}</Button>
        </div>
      ) : null}

      <CropDialog file={cropping} onCancel={() => { setCropping(null); if (input.current) input.current.value = ''; }}
        onDone={(rect) => { const f = cropping; setCropping(null); if (f) void upload(f, rect); }} />
      {value && crop ? <p className="text-2xs text-muted-foreground">{t('ems_b_crop_existing')}</p> : null}
      {playMark ? <p className="text-2xs text-muted-foreground">{t('ems_b_play_mark_hint')}</p> : null}

      <Dialog open={libOpen} onOpenChange={setLibOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('ems_img_library')}</DialogTitle>
            <DialogDescription>{t('ems_img_library_sub')}</DialogDescription>
          </DialogHeader>
          {assets === null ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : assets.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('ems_img_library_empty')}
              <div className="mt-3"><Button size="sm" className="gap-1.5" onClick={() => { setLibOpen(false); input.current?.click(); }}><Upload className="h-3.5 w-3.5" />{t('ems_img_upload')}</Button></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {assets.map((a) => (
                <div key={a.id} className={cn('group relative overflow-hidden rounded-lg border', value === a.url && 'ring-2 ring-[hsl(38_85%_52%)]')}>
                  <button type="button" className="block w-full" onClick={() => { onChange(a.url, { width: a.width, height: a.height, name: a.original_filename }); setLibOpen(false); }}>
                    <img src={a.url} alt={a.original_filename ?? ''} loading="lazy" className="h-28 w-full bg-muted object-contain" />
                    <span className="block truncate px-2 py-1 text-start text-2xs text-muted-foreground">{a.original_filename ?? a.kind}{a.width ? ` · ${a.width}×${a.height}` : ''}</span>
                  </button>
                  <button type="button" aria-label={t('ems_img_delete')} title={t('ems_img_delete')} onClick={() => void remove(a)}
                    className="absolute end-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/95 text-red-700 opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

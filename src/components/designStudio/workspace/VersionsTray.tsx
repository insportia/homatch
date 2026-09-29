// VERSIONS AND VIEWS — the work states of a design, and the places to look from.
//
// A contextual tray under the canvas, opened from the toolbar: every version
// of this space as a card (thumbnail, name, origin, when), the current one
// marked; actions to open, duplicate, start a new direction, rename,
// archive, compare. Beside it, saved views — the same camera, reusable
// across versions, which is what makes comparing them honest.

import React, { useState } from 'react';
import { Camera, Check, Columns2, Copy, GitBranch, Archive, Pencil, Trash2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DesignVersionRecord } from '@/lib/designStudio/types';
import type { SavedView } from '@/services/designStudio/projects';
import { cn } from '@/lib/utils';
import { RoomSketch } from '../RoomSketch';
import { relativeTimeFrom } from '../format';

const ORIGIN_KEY: Record<string, string> = {
  ORIGINAL: 'ds_origin_original', USER: 'ds_origin_user', AI: 'ds_origin_ai',
  DUPLICATE: 'ds_origin_duplicate', BRANCH: 'ds_origin_branch', RESTORE: 'ds_origin_restore',
};

const SMALL = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[#0C1119] hover:bg-[#F1F2F4] '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-40 disabled:pointer-events-none';

export function VersionsTray({
  versions, currentId, thumbnails, views, busy,
  onOpen, onDuplicate, onBranch, onRename, onArchive, onCompare, onSaveView, onView, onDeleteView, onClose,
}: {
  versions: DesignVersionRecord[];
  currentId: string;
  thumbnails: Map<string, string>;
  views: SavedView[];
  busy: boolean;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBranch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onCompare: () => void;
  onSaveView: (name: string) => void;
  onView: (view: SavedView) => void;
  onDeleteView: (id: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useLanguage();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [viewName, setViewName] = useState('');
  const active = versions.filter((v) => !v.archived_at);

  return (
    <section aria-label={t('ds_versions_title')} className="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-[#D5D9E0] bg-white text-[#0C1119]">
      <div className="flex items-center gap-2 border-b border-[#E4E6EA] px-3 py-2">
        <h2 className="font-display text-[15px] font-semibold">{t('ds_versions_title')}</h2>
        <span className="text-[13px] text-[#4A5263]">{t('ds_versions_count', { n: String(active.length) })}</span>
        <button type="button" className={cn(SMALL, 'ms-auto')} onClick={onCompare} disabled={active.length < 2}>
          <Columns2 className="h-4 w-4" aria-hidden="true" />{t('ds_action_compare')}
        </button>
        <button type="button" className={SMALL} onClick={onClose} aria-label={t('ds_action_close')}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-3 lg:flex-row">
        <ul className="flex min-w-0 flex-1 gap-2.5 overflow-x-auto pb-1" aria-label={t('ds_versions_title')}>
          {active.map((v) => {
            const current = v.id === currentId;
            const thumb = v.thumbnail_key ? thumbnails.get(v.thumbnail_key) : undefined;
            return (
              <li key={v.id} className={cn('w-52 shrink-0 overflow-hidden rounded-lg border', current ? 'border-[#0C1119] ring-1 ring-[#0C1119]' : 'border-[#E4E6EA]')}>
                <button type="button" onClick={() => onOpen(v.id)} aria-label={t('ds_action_open_version', { name: v.name })} className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]" aria-current={current ? 'true' : undefined}>
                  <div className="grid h-24 place-items-center overflow-hidden bg-[#0C1119]">
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : <RoomSketch className="h-full w-full p-3 text-white/60" />}
                  </div>
                </button>
                <div className="space-y-1 px-2.5 py-2">
                  {renaming === v.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onRename(v.id, draft); setRenaming(null); }} className="flex gap-1">
                      <input
                        autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80}
                        aria-label={t('ds_version_name')}
                        className="h-8 min-w-0 flex-1 rounded-md border border-[#D5D9E0] px-2 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                      />
                      <button type="submit" className={SMALL} aria-label={t('ds_action_save')}><Check className="h-4 w-4" aria-hidden="true" /></button>
                    </form>
                  ) : (
                    <p className="flex items-center gap-1.5 text-[14px] font-semibold leading-snug">
                      {current ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(38_92%_50%)]" aria-hidden="true" /> : null}
                      <span className="min-w-0 break-words">{v.name}</span>
                    </p>
                  )}
                  <p className="text-[13px] text-[#4A5263]">
                    {t(ORIGIN_KEY[v.origin] ?? 'ds_origin_user')} · {relativeTimeFrom(v.updated_at, lang)}
                  </p>
                  <div className="-ms-1 flex flex-wrap gap-0.5">
                    <button type="button" className={SMALL} disabled={busy} onClick={() => onDuplicate(v.id)} title={t('ds_action_duplicate_version')} aria-label={t('ds_action_duplicate_version_named', { name: v.name })}>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className={SMALL} disabled={busy} onClick={() => onBranch(v.id)} title={t('ds_action_branch')} aria-label={t('ds_action_branch_named', { name: v.name })}>
                      <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className={SMALL} onClick={() => { setRenaming(v.id); setDraft(v.name); }} title={t('ds_action_rename')} aria-label={t('ds_action_rename_named', { name: v.name })}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className={SMALL} disabled={busy || current || active.length < 2} onClick={() => onArchive(v.id)} title={t('ds_action_archive')} aria-label={t('ds_action_archive_named', { name: v.name })}>
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="w-full shrink-0 lg:w-72">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_views_title')}</p>
          <form onSubmit={(e) => { e.preventDefault(); onSaveView(viewName.trim() || t('ds_view_default_name', { n: String(views.length + 1) })); setViewName(''); }} className="flex gap-1.5">
            <input
              value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={60}
              placeholder={t('ds_views_name_placeholder')} aria-label={t('ds_views_name_placeholder')}
              className="h-9 min-w-0 flex-1 rounded-md border border-[#D5D9E0] px-2 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            />
            <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#0C1119] px-3 text-[13px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
              <Camera className="h-4 w-4" aria-hidden="true" />{t('ds_action_save_view')}
            </button>
          </form>
          {views.length === 0 ? (
            <p className="mt-2 text-[13px] text-[#4A5263]">{t('ds_views_empty')}</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {views.map((view) => (
                <li key={view.id} className="inline-flex items-center rounded-full border border-[#D5D9E0]">
                  <button type="button" onClick={() => onView(view)} className="rounded-s-full px-3 py-1 text-[13px] font-medium hover:bg-[#F1F2F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
                    {view.name}
                  </button>
                  <button type="button" onClick={() => onDeleteView(view.id)} aria-label={t('ds_action_delete_view', { name: view.name })} className="rounded-e-full px-1.5 py-1 text-[#4A5263] hover:bg-[#F1F2F4] hover:text-[#0C1119]">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[13px] leading-snug text-[#4A5263]">{t('ds_views_hint')}</p>
        </div>
      </div>
    </section>
  );
}

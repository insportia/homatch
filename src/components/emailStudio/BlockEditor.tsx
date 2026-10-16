import React, { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  ADDABLE_BLOCKS, LIMITS, LOCKED_BLOCKS, addBlock, createBlock, moveBlock, removeBlock, reorderBlock, updateBlock,
  type BlockType, type EmailBlock, type EmailContent,
} from '@/emailStudio/blocks';
import { asEmailLang, type TemplateId } from '@/emailStudio/templates';
import { FIELD, FOCUS, ICON_BUTTON, INK, INK_SOFT, LABEL, QUIET_BUTTON } from './styles';

const BLOCK_LABEL: Record<BlockType, string> = {
  logo: 'es_block_logo', headline: 'es_block_headline', text: 'es_block_text', hero: 'es_block_hero',
  gallery: 'es_block_gallery', specs: 'es_block_specs', price: 'es_block_price', location: 'es_block_location',
  cta: 'es_block_cta', divider: 'es_block_divider', contact: 'es_block_contact', footer: 'es_block_footer',
  unsubscribe: 'es_block_unsubscribe',
};

const AUTO_BLOCKS: BlockType[] = ['logo', 'specs', 'price', 'location', 'divider'];

function PhotoPicker({
  images, selected, multiple, onToggle, label,
}: {
  images: string[];
  selected: number[];
  multiple: boolean;
  onToggle: (index: number) => void;
  label: string;
}) {
  const { t } = useLanguage();
  if (!images.length) return <p className={cn('text-sm', INK_SOFT)}>{t('es_no_photos')}</p>;
  return (
    <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-wrap gap-2">
      {images.map((src, i) => {
        const on = selected.includes(i);
        const disabled = multiple && !on && selected.length >= LIMITS.gallery;
        return (
          <button
            key={src}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            aria-label={t('es_photo_n', { n: i + 1 })}
            disabled={disabled}
            onClick={() => onToggle(i)}
            className={cn(
              'relative h-16 w-20 overflow-hidden rounded-lg border-2 bg-[hsl(40_20%_94%)]',
              on ? 'border-[hsl(38_92%_50%)]' : 'border-transparent hover:border-[hsl(38_60%_70%)]',
              disabled && 'cursor-not-allowed opacity-40', FOCUS,
            )}
          >
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            {on ? (
              <span className="absolute end-1 top-1 rounded bg-[hsl(38_92%_54%)] px-1 text-2xs font-bold text-[#161309]">
                {multiple ? selected.indexOf(i) + 1 : '✓'}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The visual editor: subject, preheader and the block list. */
export function BlockEditor({
  content, onChange, templateId, emailLang, images, disabled,
}: {
  content: EmailContent;
  onChange: (next: EmailContent) => void;
  templateId: TemplateId;
  emailLang: string;
  images: string[];
  disabled: boolean;
}) {
  const { t } = useLanguage();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [addType, setAddType] = useState<BlockType>('text');
  const [announce, setAnnounce] = useState('');

  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...content, blocks });
  const move = (index: number, delta: -1 | 1) => {
    const next = moveBlock(content.blocks, index, delta);
    if (next !== content.blocks) {
      setBlocks(next);
      setAnnounce(`${t(BLOCK_LABEL[content.blocks[index].type])}: ${index + 1 + delta}/${next.length}`);
    }
  };
  const lockedCount = content.blocks.filter((b) => (LOCKED_BLOCKS as readonly string[]).includes(b.type)).length;
  const lastMovable = content.blocks.length - lockedCount - 1;

  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null) setBlocks(reorderBlock(content.blocks, dragIndex, index));
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="es-subject" className={LABEL}>{t('es_subject')}</label>
          <input id="es-subject" className={FIELD} value={content.subject} maxLength={LIMITS.subject} disabled={disabled}
            onChange={(e) => onChange({ ...content, subject: e.target.value })} />
        </div>
        <div>
          <label htmlFor="es-preheader" className={LABEL}>{t('es_preheader')}</label>
          <input id="es-preheader" className={FIELD} value={content.preheader} maxLength={LIMITS.preheader} disabled={disabled}
            onChange={(e) => onChange({ ...content, preheader: e.target.value })} />
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{announce}</p>
      <ol className="space-y-2.5" aria-label={t('es_edit_content')}>
        {content.blocks.map((block, index) => {
          const locked = (LOCKED_BLOCKS as readonly string[]).includes(block.type);
          const label = t(BLOCK_LABEL[block.type]);
          const fieldId = `es-block-${block.id}`;
          return (
            <li
              key={block.id}
              draggable={!locked && !disabled}
              onDragStart={(e) => { setDragIndex(index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', block.id); }}
              onDragOver={(e) => { if (dragIndex !== null && !locked) { e.preventDefault(); setOverIndex(index); } }}
              onDragLeave={() => setOverIndex((v) => (v === index ? null : v))}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              className={cn(
                'rounded-xl border bg-white p-3',
                overIndex === index ? 'border-[hsl(38_92%_50%)] border-dashed' : 'border-[hsl(38_28%_88%)]',
                dragIndex === index && 'opacity-60',
                locked && 'bg-[hsl(40_30%_98%)]',
              )}
            >
              <div className="flex items-center gap-2">
                {!locked ? (
                  <span className={cn('hidden cursor-grab sm:inline-flex', INK_SOFT)} title={t('es_drag_handle')} aria-hidden="true">
                    <GripVertical className="h-5 w-5" />
                  </span>
                ) : (
                  <Lock className={cn('h-4 w-4', INK_SOFT)} aria-hidden="true" />
                )}
                <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', INK)} id={`${fieldId}-label`}>{label}</span>
                {locked ? (
                  <span className={cn('text-xs', INK_SOFT)}>{t('es_locked_block')}</span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" className={ICON_BUTTON} disabled={disabled || index === 0} onClick={() => move(index, -1)}
                      aria-label={`${t('es_move_up')}: ${label}`}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={ICON_BUTTON} disabled={disabled || index >= lastMovable} onClick={() => move(index, 1)}
                      aria-label={`${t('es_move_down')}: ${label}`}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={ICON_BUTTON} disabled={disabled} onClick={() => setBlocks(removeBlock(content.blocks, block.id))}
                      aria-label={`${t('es_remove_block')}: ${label}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              {block.type === 'headline' || block.type === 'cta' ? (
                <div className="mt-2.5">
                  <input id={fieldId} aria-labelledby={`${fieldId}-label`} className={FIELD} disabled={disabled}
                    value={block.text ?? ''} maxLength={block.type === 'cta' ? LIMITS.cta : LIMITS.headline}
                    onChange={(e) => setBlocks(updateBlock(content.blocks, block.id, { text: e.target.value }))} />
                  {block.type === 'cta' ? <p className={cn('mt-1.5 text-xs', INK_SOFT)}>{t('es_cta_note')}</p> : null}
                </div>
              ) : null}
              {block.type === 'text' || block.type === 'contact' ? (
                <textarea id={fieldId} aria-labelledby={`${fieldId}-label`} rows={block.type === 'text' ? 4 : 2}
                  className={cn(FIELD, 'mt-2.5 resize-y leading-relaxed')} disabled={disabled}
                  value={block.text ?? ''} maxLength={block.type === 'contact' ? LIMITS.contact : LIMITS.text}
                  onChange={(e) => setBlocks(updateBlock(content.blocks, block.id, { text: e.target.value }))} />
              ) : null}
              {block.type === 'hero' ? (
                <div className="mt-2.5">
                  <PhotoPicker images={images} multiple={false} label={t('es_choose_photo')}
                    selected={block.image !== undefined ? [block.image] : []}
                    onToggle={(i) => !disabled && setBlocks(updateBlock(content.blocks, block.id, { image: i }))} />
                </div>
              ) : null}
              {block.type === 'gallery' ? (
                <div className="mt-2.5">
                  <PhotoPicker images={images} multiple label={t('es_add_photos')} selected={block.images ?? []}
                    onToggle={(i) => {
                      if (disabled) return;
                      const cur = block.images ?? [];
                      const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].slice(0, LIMITS.gallery);
                      setBlocks(updateBlock(content.blocks, block.id, { images: next }));
                    }} />
                </div>
              ) : null}
              {AUTO_BLOCKS.includes(block.type) ? <p className={cn('mt-1.5 text-xs', INK_SOFT)}>{t('es_auto_block_note')}</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 sm:flex-none">
          <label htmlFor="es-add-type" className={LABEL}>{t('es_add_block')}</label>
          <select id="es-add-type" className={cn(FIELD, 'h-12 py-0')} value={addType} disabled={disabled}
            onChange={(e) => setAddType(e.target.value as BlockType)}>
            {ADDABLE_BLOCKS.map((type) => <option key={type} value={type}>{t(BLOCK_LABEL[type])}</option>)}
          </select>
        </div>
        <button type="button" className={cn(QUIET_BUTTON, 'h-12')} disabled={disabled || content.blocks.length >= LIMITS.blocks}
          onClick={() => setBlocks(addBlock(content.blocks, createBlock(addType, `b-${Date.now().toString(36)}`, templateId, asEmailLang(emailLang))))}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('es_add_block')}
        </button>
      </div>
    </div>
  );
}

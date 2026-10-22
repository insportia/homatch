// A small rich-text field for Email Studio: bold, italic, underline, link,
// clear. contentEditable underneath, but everything it emits goes through
// sanitizeInline(), so the stored text can only ever contain the inline
// allowlist the email renderer accepts. The DOM is written only when the value
// changes from OUTSIDE (an AI suggestion accepted, a template loaded), so typing
// never loses the caret.
import React, { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Link2, RemoveFormatting, Underline } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { safeHref, sanitizeInline } from '@/communication/emailDesign';

export function RichTextField({ value, onChange, label, dir = 'auto', minRows = 4 }: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  dir?: 'auto' | 'ltr' | 'rtl';
  minRows?: number;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement | null>(null);
  const emitted = useRef<string>('');
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('https://');

  useEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    el.innerHTML = sanitizeInline(value);
    emitted.current = value;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeInline(el.innerHTML);
    emitted.current = clean;
    onChange(clean);
  };
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    // execCommand is deprecated but still the only cross-browser way to toggle
    // inline formatting on a selection without a full editor dependency.
    document.execCommand(cmd, false, arg);
    emit();
  };
  const saveSelection = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  };
  const applyLink = () => {
    const safe = safeHref(href);
    setLinkOpen(false);
    if (!safe || !savedRange.current) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange.current);
    exec('createLink', safe);
  };

  const btn = 'grid h-8 w-8 place-items-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="rounded-xl ring-1 ring-inset ring-border focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label={t('es_format_toolbar')}>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} aria-label={t('es_bold')}><Bold className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} aria-label={t('es_italic')}><Italic className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} aria-label={t('es_underline')}><Underline className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={btn} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => setLinkOpen((v) => !v)} aria-label={t('es_link')} aria-expanded={linkOpen}><Link2 className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => { exec('removeFormat'); exec('unlink'); }} aria-label={t('es_clear_format')}><RemoveFormatting className="h-4 w-4" aria-hidden="true" /></button>
        {linkOpen && (
          <span className="flex min-w-0 flex-1 items-center gap-1 ps-1">
            <input value={href} onChange={(e) => setHref(e.target.value)} dir="ltr" aria-label={t('es_link_url')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }}
              className="h-8 min-w-0 flex-1 rounded-md bg-background px-2 text-xs ring-1 ring-inset ring-border" />
            <button type="button" onClick={applyLink} className="h-8 rounded-md bg-foreground px-2 text-xs font-semibold text-background">{t('es_apply')}</button>
          </span>
        )}
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        dir={dir}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          /* Paste as plain text: formatting from another app is not ours to keep. */
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        className={cn('max-h-[50dvh] overflow-y-auto px-3 py-2.5 text-sm leading-relaxed focus:outline-none [&_a]:text-[hsl(34_90%_36%)] [&_a]:underline')}
        style={{ minHeight: `${minRows * 1.6}rem` }}
      />
    </div>
  );
}

export default RichTextField;

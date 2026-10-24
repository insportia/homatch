// EMAIL STUDIO — the rich text editor (UX pass §4): select a word or phrase and link it, bold,
// italic, underline, colour, bulleted and numbered lists; edit or remove a link the caret is in.
//
// It edits a contentEditable element and hands back SANITIZED rich text (designer/richText.ts):
// whatever the browser's editing engine produced is rebuilt from tokens, so the stored value can
// only ever contain the safe subset, and the server sanitizes it again on save. Paste is plain
// text (formatting from another site never comes along). The editor shows the text with the
// block's own font, size and colour, so editing happens in place, in the email's look.

import { Bold, Italic, Link2, List, ListOrdered, Palette, RemoveFormatting, Underline, Unlink, X } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { safeRichHref, sanitizeRich } from '@/emailMarketing/designer/richText';
import { cn } from '@/lib/utils';

const SWATCHES = ['#1F2430', '#0C1119', '#6B7280', '#FFFFFF', '#C9973A', '#B08D57', '#1D4ED8', '#2F6B4F', '#6D28D9', '#E4572E', '#D97706', '#B91C1C'];

export interface RichTextEditorProps {
  /** Sanitized rich text (or '' to start from `fallbackHtml`). */
  value: string;
  onChange: (rich: string) => void;
  /** Shown when `value` is empty: legacy markup rendered by the email renderer. */
  fallbackHtml?: string;
  style?: React.CSSProperties;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
  /** Headings: lists make no sense there. */
  inline?: boolean;
  autoFocus?: boolean;
  dir?: 'ltr' | 'rtl';
}

export function RichTextEditor({ value, onChange, fallbackHtml, style, className, placeholder, ariaLabel, inline = false, autoFocus, dir }: RichTextEditorProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const lastEmitted = useRef<string>(value);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [inLink, setInLink] = useState<HTMLAnchorElement | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [state, setState] = useState({ bold: false, italic: false, underline: false, ul: false, ol: false });

  /* Load the value into the element only when it changed from OUTSIDE (undo, HOMI, another block). */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === lastEmitted.current && el.innerHTML) return;
    el.innerHTML = value ? sanitizeRich(value) : (fallbackHtml ?? '');
    lastEmitted.current = value;
  }, [value, fallbackHtml]);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeRich(el.innerHTML);
    lastEmitted.current = clean;
    onChange(clean);
  }, [onChange]);

  const refreshState = useCallback(() => {
    try {
      setState({
        bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline'),
        ul: document.queryCommandState('insertUnorderedList'), ol: document.queryCommandState('insertOrderedList'),
      });
    } catch { /* not supported: buttons simply show as off */ }
    const sel = window.getSelection();
    const node = sel?.anchorNode ?? null;
    const a = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('a') : null;
    setInLink(a && ref.current?.contains(a) ? (a as HTMLAnchorElement) : null);
  }, []);

  useEffect(() => {
    const onSel = () => { if (ref.current && document.activeElement === ref.current) refreshState(); };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [refreshState]);

  const keepSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (saved.current && sel) { sel.removeAllRanges(); sel.addRange(saved.current); }
  };

  const exec = (cmd: string, arg?: string) => {
    restoreSelection();
    try {
      document.execCommand('styleWithCSS', false, cmd === 'foreColor' ? 'true' : 'false');
      document.execCommand(cmd, false, arg);
    } catch { /* an editing command the browser lacks does nothing */ }
    emit();
    refreshState();
  };

  const openLink = () => {
    keepSelection();
    setLinkUrl(inLink?.getAttribute('href') ?? 'https://');
    setLinkError(false);
    setLinkOpen(true);
  };
  const applyLink = () => {
    const href = safeRichHref(linkUrl.trim());
    if (!href) { setLinkError(true); return; }
    restoreSelection();
    if (inLink) {
      inLink.setAttribute('href', href);
    } else {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        /* Nothing selected: the address itself becomes the linked text. */
        try { document.execCommand('insertHTML', false, `<a href="${href.replace(/"/g, '&quot;')}">${href.replace(/</g, '&lt;')}</a>`); } catch { /* ignore */ }
      } else {
        try { document.execCommand('createLink', false, href); } catch { /* ignore */ }
      }
    }
    setLinkOpen(false);
    emit();
    refreshState();
  };
  const removeLink = () => {
    const a = inLink;
    if (a && a.parentNode) {
      while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
      a.parentNode.removeChild(a);
    } else exec('unlink');
    setLinkOpen(false);
    emit();
    refreshState();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    try { document.execCommand('insertText', false, text); } catch { /* ignore */ }
    emit();
  };

  const Tool = ({ on, label, onClick, children }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" aria-label={label} title={label} aria-pressed={on}
      onMouseDown={(e) => { e.preventDefault(); keepSelection(); }} onClick={onClick}
      className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/75 transition-colors hover:bg-muted hover:text-foreground', on && 'bg-[#0C1119] text-white hover:bg-[#0C1119] hover:text-white')}>
      {children}
    </button>
  );

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1" role="toolbar" aria-label={t('ems_rt_toolbar')}>
        <Tool on={state.bold} label={t('ems_rt_bold')} onClick={() => exec('bold')}><Bold className="h-4 w-4" /></Tool>
        <Tool on={state.italic} label={t('ems_rt_italic')} onClick={() => exec('italic')}><Italic className="h-4 w-4" /></Tool>
        <Tool on={state.underline} label={t('ems_rt_underline')} onClick={() => exec('underline')}><Underline className="h-4 w-4" /></Tool>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        <Tool on={Boolean(inLink)} label={inLink ? t('ems_rt_edit_link') : t('ems_rt_link')} onClick={openLink}><Link2 className="h-4 w-4" /></Tool>
        {inLink ? <Tool label={t('ems_rt_unlink')} onClick={removeLink}><Unlink className="h-4 w-4" /></Tool> : null}
        <div className="relative">
          <Tool label={t('ems_rt_color')} onClick={() => setColorOpen((o) => !o)}><Palette className="h-4 w-4" /></Tool>
          {colorOpen ? (
            <div className="absolute start-0 top-9 z-30 grid w-44 grid-cols-6 gap-1.5 rounded-lg border bg-popover p-2 shadow-lg">
              {SWATCHES.map((c) => (
                <button key={c} type="button" aria-label={c} title={c} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setColorOpen(false); exec('foreColor', c); }}
                  className="h-6 w-6 rounded-full border border-black/10" style={{ backgroundColor: c }} />
              ))}
            </div>
          ) : null}
        </div>
        {!inline ? (<>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <Tool on={state.ul} label={t('ems_rt_bullets')} onClick={() => exec('insertUnorderedList')}><List className="h-4 w-4" /></Tool>
          <Tool on={state.ol} label={t('ems_rt_numbers')} onClick={() => exec('insertOrderedList')}><ListOrdered className="h-4 w-4" /></Tool>
        </>) : null}
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        <Tool label={t('ems_rt_clear')} onClick={() => exec('removeFormat')}><RemoveFormatting className="h-4 w-4" /></Tool>
      </div>

      {linkOpen ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-2 py-2">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input autoFocus value={linkUrl} dir="ltr" inputMode="url" aria-label={t('ems_rt_link_url')} className={cn('h-8 min-w-0 flex-1 basis-40 text-xs', linkError && 'border-red-500')}
            onChange={(e) => { setLinkUrl(e.target.value); setLinkError(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }} />
          <Button type="button" size="sm" className="h-8" onClick={applyLink}>{t('ems_rt_apply')}</Button>
          {inLink ? <Button type="button" size="sm" variant="ghost" className="h-8" onClick={removeLink}>{t('ems_rt_unlink')}</Button> : null}
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={t('ems_cancel')} onClick={() => setLinkOpen(false)}><X className="h-4 w-4" /></Button>
          {linkError ? <p className="w-full text-2xs text-red-700">{t('ems_rt_link_invalid')}</p> : null}
        </div>
      ) : null}

      <div
        ref={ref}
        role="textbox"
        aria-multiline={!inline}
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        dir={dir}
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyUp={refreshState}
        onMouseUp={refreshState}
        onPaste={onPaste}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink(); }
          if (inline && e.key === 'Enter') e.preventDefault();
        }}
        className={cn(
          'min-h-[2.75rem] whitespace-pre-wrap break-words px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_80%_55%)]',
          '[&_a]:underline [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          className,
        )}
        style={style}
      />
    </div>
  );
}

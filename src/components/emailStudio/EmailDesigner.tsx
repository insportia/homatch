// EMAIL STUDIO — the visual email designer. Owner brief §5.
//
// Edits a designer DOCUMENT (src/emailMarketing/designer/document.ts), never HTML. The canvas
// shows each block through the same renderer the server uses (renderBlockHtml — escaped,
// inline-styled, no script), so the canvas is the email. Every control writes a document value
// that normalizeDoc accepts; anything else is impossible to express.
//
// Interaction: drag from the palette or click to insert after the selection; drag blocks to
// reorder, or use the move buttons (keyboard-reachable); Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or
// Ctrl/Cmd+Y redo; Delete removes the selected block; Ctrl/Cmd+D duplicates it.

import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, BookmarkPlus, Columns2, Contact, Copy, Eye, Footprints, Heading, Image as ImageIcon,Layers,
  LayoutTemplate, Link2, Minus, MousePointerClick, MoveVertical, Palette, Redo2, Share2, Trash2, Type, Undo2, UserMinus, X, 
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type Align, type Block, type BlockType, type ColumnsBlock, cloneBlock, createBlock, type EmailDoc, FONT_KEYS, type LeafBlock, normalizeDoc,type Pad, SOCIAL_NETWORKS, type SocialNetwork,
  type Theme, 
} from '@/emailMarketing/designer/document';
import { renderBlockHtml, renderDesignBody } from '@/emailMarketing/designer/render';
import { checkUrl } from '@/emailMarketing/risk/links';
import { cn } from '@/lib/utils';
import { EmailPreviewFrame, findingText } from './shared';

const PALETTE: Array<{ type: BlockType; icon: React.ComponentType<{ className?: string }> }> = [
  { type: 'heading', icon: Heading }, { type: 'text', icon: Type }, { type: 'image', icon: ImageIcon },
  { type: 'button', icon: MousePointerClick }, { type: 'divider', icon: Minus }, { type: 'spacer', icon: MoveVertical },
  { type: 'columns', icon: Columns2 }, { type: 'logo', icon: LayoutTemplate }, { type: 'social', icon: Share2 },
  { type: 'contact', icon: Contact }, { type: 'footer', icon: Footprints }, { type: 'unsubscribe', icon: UserMinus },
];

type Sel = { id: string; col?: 0 | 1; sub?: string } | null;

export interface DesignerSection { id: string; name: string; block: Block }

export interface EmailDesignerProps {
  value: EmailDoc;
  onChange: (doc: EmailDoc) => void;
  rtl?: boolean;
  subject: string;
  previewText?: string | null;
  senderName?: string | null;
  language?: string | null;
  sections?: DesignerSection[];
  onSaveSection?: (block: Block) => void;
  onSaveTemplate?: () => void;
}

const MAX_HISTORY = 80;

export default function EmailDesigner({
  value, onChange, rtl = false, subject, previewText, senderName, language, sections = [], onSaveSection, onSaveTemplate,
}: EmailDesignerProps) {
  const { t } = useLanguage();
  const [sel, setSel] = useState<Sel>(null);
  const [past, setPast] = useState<EmailDoc[]>([]);
  const [future, setFuture] = useState<EmailDoc[]>([]);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [mobilePane, setMobilePane] = useState<'blocks' | 'canvas' | 'props'>('canvas');
  const dragRef = useRef<{ kind: 'new'; type: BlockType } | { kind: 'section'; block: Block } | { kind: 'move'; id: string } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const doc = value;

  const commit = useCallback((next: EmailDoc) => {
    setPast((p) => [...p.slice(-MAX_HISTORY + 1), doc]);
    setFuture([]);
    onChange(normalizeDoc(next));
  }, [doc, onChange]);

  const undo = useCallback(() => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([doc, ...future].slice(0, MAX_HISTORY));
    onChange(prev);
  }, [past, future, doc, onChange]);
  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, doc].slice(-MAX_HISTORY));
    onChange(next);
  }, [past, future, doc, onChange]);

  /* ── selection helpers ─────────────────────────────────────────────────────────────────── */
  const selected: Block | LeafBlock | null = useMemo(() => {
    if (!sel) return null;
    const top = doc.blocks.find((b) => b.id === sel.id) ?? null;
    if (top && top.type === 'columns' && sel.col != null && sel.sub) return top.columns[sel.col].find((b) => b.id === sel.sub) ?? null;
    return top;
  }, [doc, sel]);

  const updateSelected = useCallback((patch: Record<string, unknown>) => {
    if (!sel) return;
    const blocks = doc.blocks.map((b) => {
      if (b.id !== sel.id) return b;
      if (b.type === 'columns' && sel.col != null && sel.sub) {
        const cols = b.columns.map((col, i) => (i === sel.col ? col.map((x) => (x.id === sel.sub ? { ...x, ...patch } as LeafBlock : x)) : col)) as ColumnsBlock['columns'];
        return { ...b, columns: cols };
      }
      return { ...b, ...patch } as Block;
    });
    commit({ ...doc, blocks });
  }, [doc, sel, commit]);

  const updateTheme = (patch: Partial<Theme>) => commit({ ...doc, theme: { ...doc.theme, ...patch } });

  const insertAt = useCallback((index: number, block: Block) => {
    const blocks = [...doc.blocks];
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
    commit({ ...doc, blocks });
    setSel({ id: block.id });
  }, [doc, commit]);

  const indexOfSel = sel ? doc.blocks.findIndex((b) => b.id === sel.id) : -1;
  const addBlock = (type: BlockType) => {
    insertAt(indexOfSel >= 0 ? indexOfSel + 1 : doc.blocks.length, createBlock(type));
    setMobilePane('props');
  };
  const addSection = (block: Block) => insertAt(indexOfSel >= 0 ? indexOfSel + 1 : doc.blocks.length, cloneBlock(block));

  const move = (id: string, dir: -1 | 1) => {
    const i = doc.blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    commit({ ...doc, blocks });
  };
  const duplicate = (id: string) => {
    const i = doc.blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    insertAt(i + 1, cloneBlock(doc.blocks[i]));
  };
  const remove = (id: string, sub?: { col: 0 | 1; sub: string }) => {
    if (sub) {
      commit({ ...doc, blocks: doc.blocks.map((b) => (b.id === id && b.type === 'columns'
        ? { ...b, columns: b.columns.map((c, i) => (i === sub.col ? c.filter((x) => x.id !== sub.sub) : c)) as ColumnsBlock['columns'] } : b)) });
      setSel({ id });
      return;
    }
    commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
    setSel(null);
  };
  const addToColumn = (id: string, col: 0 | 1, type: BlockType) => {
    if (type === 'columns') return;
    const nb = createBlock(type) as LeafBlock;
    nb.padding = { t: 6, r: 0, b: 6, l: 0 };
    commit({ ...doc, blocks: doc.blocks.map((b) => (b.id === id && b.type === 'columns'
      ? { ...b, columns: b.columns.map((c, i) => (i === col ? [...c, nb] : c)) as ColumnsBlock['columns'] } : b)) });
    setSel({ id, col, sub: nb.id });
  };

  /* ── keyboard ──────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo(); }
      else if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') && !typing) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === 'd' && sel && !typing) { e.preventDefault(); duplicate(sel.id); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !typing) {
        e.preventDefault(); remove(sel.id, sel.col != null && sel.sub ? { col: sel.col, sub: sel.sub } : undefined);
      } else if (e.key === 'Escape' && !typing) setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── drag & drop ───────────────────────────────────────────────────────────────────────── */
  const onDropAt = (index: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDropAt(null);
    if (!d) return;
    if (d.kind === 'new') insertAt(index, createBlock(d.type));
    else if (d.kind === 'section') insertAt(index, cloneBlock(d.block));
    else {
      const from = doc.blocks.findIndex((b) => b.id === d.id);
      if (from < 0) return;
      const blocks = [...doc.blocks];
      const [b] = blocks.splice(from, 1);
      blocks.splice(from < index ? index - 1 : index, 0, b);
      commit({ ...doc, blocks });
    }
  };

  const fullBody = useMemo(() => renderDesignBody(doc, { rtl }), [doc, rtl]);

  /* ── render ────────────────────────────────────────────────────────────────────────────── */
  const palette = (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_d_blocks')}</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-2">
          {PALETTE.map(({ type, icon: Icon }) => (
            <button
              key={type} type="button" draggable
              onDragStart={() => { dragRef.current = { kind: 'new', type }; }}
              onDragEnd={() => { dragRef.current = null; setDropAt(null); }}
              onClick={() => addBlock(type)}
              className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border bg-card px-1.5 py-2 text-center text-[12px] leading-tight text-foreground/80 transition-colors hover:border-[hsl(38_70%_60%)] hover:bg-[hsl(38_90%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_80%_55%)]"
            >
              <Icon className="h-4 w-4 text-[hsl(32_60%_38%)]" aria-hidden="true" />
              <span className="[overflow-wrap:anywhere]">{t(`ems_block_${type}`)}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_d_sections')}</p>
        {sections.length ? (
          <div className="space-y-1">
            {sections.map((s) => (
              <button key={s.id} type="button" draggable
                onDragStart={() => { dragRef.current = { kind: 'section', block: s.block }; }}
                onClick={() => addSection(s.block)}
                className="flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-start text-[13px] hover:bg-muted">
                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{s.name}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-xs leading-relaxed text-muted-foreground">{t('ems_d_sections_empty')}</p>}
      </div>
    </div>
  );

  /* A zero-height drop target between blocks, so the canvas shows the email without gaps; the
     hit area overlaps the neighbouring edges and the gold line appears only while dragging over it. */
  const DropLine = ({ index }: { index: number }) => (
    <div className="relative h-0" aria-hidden="true">
      <div
        onDragOver={(e) => { e.preventDefault(); setDropAt(index); }}
        onDragLeave={() => setDropAt((d) => (d === index ? null : d))}
        onDrop={(e) => { e.preventDefault(); onDropAt(index); }}
        className="absolute inset-x-0 -top-2 z-20 flex h-4 items-center"
      >
        <span className={cn('h-1 w-full rounded-full transition-colors', dropAt === index ? 'bg-[hsl(38_85%_55%)]' : 'bg-transparent')} />
      </div>
    </div>
  );

  const canvas = (
    <div className="min-w-0 rounded-2xl border p-3 sm:p-5" style={{ backgroundColor: doc.theme.canvas }} onClick={() => setSel(null)}>
      <div className="mx-auto overflow-hidden shadow-sm" style={{ maxWidth: doc.theme.width, backgroundColor: doc.theme.card, borderRadius: doc.theme.radius }} dir={rtl ? 'rtl' : 'ltr'}>
        {doc.blocks.length === 0 ? (
          <div
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDropAt(0); }}
            className="flex min-h-[18rem] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground"
          >
            <LayoutTemplate className="h-8 w-8 opacity-60" aria-hidden="true" />
            <p className="font-medium text-foreground">{t('ems_d_empty_title')}</p>
            <p className="max-w-xs text-xs">{t('ems_d_empty_body')}</p>
          </div>
        ) : null}
        {doc.blocks.map((b, i) => {
          const isSel = sel?.id === b.id && !sel.sub;
          const empty = (b.type === 'image' || b.type === 'logo') && !b.src;
          return (
            <React.Fragment key={b.id}>
              <DropLine index={i} />
              <div
                role="button" tabIndex={0} aria-label={t(`ems_block_${b.type}`)} aria-pressed={isSel}
                draggable
                onDragStart={(e) => { dragRef.current = { kind: 'move', id: b.id }; e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { dragRef.current = null; setDropAt(null); }}
                onClick={(e) => { e.stopPropagation(); setSel({ id: b.id }); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel({ id: b.id }); setMobilePane('props'); } }}
                className={cn('group relative cursor-pointer outline-none transition-shadow', isSel ? 'ring-2 ring-inset ring-[hsl(38_85%_52%)]' : 'hover:ring-1 hover:ring-inset hover:ring-[hsl(38_70%_70%)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_85%_52%)]')}
              >
                {b.type === 'columns' ? (
                  <div style={{ padding: `${b.padding?.t ?? 8}px ${b.padding?.r ?? 32}px ${b.padding?.b ?? 8}px ${b.padding?.l ?? 32}px`, backgroundColor: b.background ?? undefined }}
                    className="grid gap-3 sm:grid-cols-2">
                    {b.columns.map((col, ci) => (
                      <div key={ci} className="min-w-0 rounded-md border border-dashed border-foreground/15 p-1.5">
                        {col.map((x) => {
                          const subSel = sel?.id === b.id && sel.sub === x.id;
                          return (
                            <div key={x.id} role="button" tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setSel({ id: b.id, col: ci as 0 | 1, sub: x.id }); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setSel({ id: b.id, col: ci as 0 | 1, sub: x.id }); } }}
                              className={cn('rounded outline-none', subSel ? 'ring-2 ring-[hsl(38_85%_52%)]' : 'hover:ring-1 hover:ring-[hsl(38_70%_70%)]')}
                              // Safe: the email renderer escapes every value; no script can be expressed in a design document.
                              dangerouslySetInnerHTML={{ __html: renderBlockHtml(x, doc.theme, rtl) }} />
                          );
                        })}
                        <Select onValueChange={(v) => addToColumn(b.id, ci as 0 | 1, v as BlockType)}>
                          <SelectTrigger className="mt-1 h-7 text-xs" aria-label={t('ems_d_add_to_column')} onClick={(e) => e.stopPropagation()}><SelectValue placeholder={t('ems_d_add_to_column')} /></SelectTrigger>
                          <SelectContent>
                            {PALETTE.filter((p) => p.type !== 'columns').map((p) => <SelectItem key={p.type} value={p.type}>{t(`ems_block_${p.type}`)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                ) : empty ? (
                  <div className="m-3 flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-foreground/20 bg-foreground/[0.02] text-xs text-muted-foreground">
                    <ImageIcon className="h-5 w-5" aria-hidden="true" />{t('ems_d_image_empty')}
                  </div>
                ) : (
                  // Safe: the email renderer escapes every value; no script can be expressed in a design document.
                  <div dangerouslySetInnerHTML={{ __html: renderBlockHtml(b, doc.theme, rtl) }} />
                )}
                {/* Block toolbar: visible on hover, focus and selection. */}
                <div className={cn('absolute end-1.5 top-1.5 z-10 flex gap-0.5 rounded-md border bg-white/95 p-0.5 shadow-sm transition-opacity', isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}>
                  <ToolBtn label={t('ems_d_move_up')} onClick={() => move(b.id, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></ToolBtn>
                  <ToolBtn label={t('ems_d_move_down')} onClick={() => move(b.id, 1)} disabled={i === doc.blocks.length - 1}><ArrowDown className="h-3.5 w-3.5" /></ToolBtn>
                  <ToolBtn label={t('ems_d_duplicate')} onClick={() => duplicate(b.id)}><Copy className="h-3.5 w-3.5" /></ToolBtn>
                  {onSaveSection ? <ToolBtn label={t('ems_d_save_section')} onClick={() => onSaveSection(b)}><BookmarkPlus className="h-3.5 w-3.5" /></ToolBtn> : null}
                  <ToolBtn label={t('ems_d_delete')} onClick={() => remove(b.id)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></ToolBtn>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {doc.blocks.length ? <DropLine index={doc.blocks.length} /> : null}
      </div>
    </div>
  );

  const props = selected ? (
    <BlockProperties
      block={selected} onPatch={updateSelected} onClose={() => setSel(null)}
      onRemove={() => sel && remove(sel.id, sel.col != null && sel.sub ? { col: sel.col, sub: sel.sub } : undefined)}
    />
  ) : <ThemeProperties theme={doc.theme} onPatch={updateTheme} />;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2.5 py-2">
        <div className="inline-flex gap-0.5">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={undo} disabled={!past.length} aria-label={t('ems_d_undo')}>
            <Undo2 className="h-4 w-4" /><span className="hidden sm:inline">{t('ems_d_undo')}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={redo} disabled={!future.length} aria-label={t('ems_d_redo')}>
            <Redo2 className="h-4 w-4" /><span className="hidden sm:inline">{t('ems_d_redo')}</span>
          </Button>
        </div>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('ems_d_mode')}>
          {(['edit', 'preview'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs', mode === m ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'edit' ? <Palette className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{t(`ems_d_mode_${m}`)}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground md:inline">{t('ems_d_blocks_count', { n: doc.blocks.length })}</span>
          {onSaveTemplate ? (
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onSaveTemplate}>
              <BookmarkPlus className="h-4 w-4" />{t('ems_d_save_template')}
            </Button>
          ) : null}
        </div>
      </div>

      {mode === 'preview' ? (
        <EmailPreviewFrame subject={subject} html={doc.blocks.length ? fullBody.html : null} text={fullBody.text}
          senderName={senderName} language={language} previewText={previewText} />
      ) : (
        <>
          {/* Mobile and tablet: one pane at a time. */}
          <div className="xl:hidden">
            <Tabs value={mobilePane} onValueChange={(v) => setMobilePane(v as typeof mobilePane)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="blocks">{t('ems_d_pane_blocks')}</TabsTrigger>
                <TabsTrigger value="canvas">{t('ems_d_pane_canvas')}</TabsTrigger>
                <TabsTrigger value="props">{selected ? t('ems_d_pane_block') : t('ems_d_pane_style')}</TabsTrigger>
              </TabsList>
              <TabsContent value="blocks" className="mt-3">{palette}</TabsContent>
              <TabsContent value="canvas" className="mt-3">{canvas}</TabsContent>
              <TabsContent value="props" className="mt-3 rounded-xl border bg-card p-3">{props}</TabsContent>
            </Tabs>
          </div>
          {/* Desktop: palette · canvas · properties. */}
          <div className="hidden min-w-0 gap-4 xl:grid xl:grid-cols-[12.5rem_minmax(0,1fr)_18rem] 2xl:grid-cols-[14rem_minmax(0,1fr)_20rem]">
            <aside className="min-w-0"><div className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto pe-1">{palette}</div></aside>
            <div className="min-w-0">{canvas}</div>
            <aside className="min-w-0"><div className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border bg-card p-3">{props}</div></aside>
          </div>
        </>
      )}
    </div>
  );
}

function ToolBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-foreground/70 hover:bg-muted hover:text-foreground disabled:opacity-30">
      {children}
    </button>
  );
}

/* ── property controls ─────────────────────────────────────────────────────────────────────── */

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-foreground/80">{label}</Label>
      {children}
      {hint}
    </div>
  );
}

function ColorField({ label, value, onChange, allowEmpty = false }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; allowEmpty?: boolean }) {
  const { t } = useLanguage();
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value ?? '#FFFFFF'} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
        <Input value={text} dir="ltr" className="h-8 font-mono text-xs" placeholder={allowEmpty ? t('ems_d_none') : '#RRGGBB'}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { const v = text.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase()); else if (!v && allowEmpty) onChange(null); else setText(value ?? ''); }} />
        {allowEmpty && value ? <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('ems_d_clear')} onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /></Button> : null}
      </div>
    </Field>
  );
}

function NumberField({ label, value, min, max, onChange, suffix }: { label: string; value: number | undefined; min: number; max: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <Input type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} className="h-8 text-xs"
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n)))); }} />
        {suffix ? <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function AlignField({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  const { t } = useLanguage();
  const opts: Array<[Align, React.ComponentType<{ className?: string }>]> = [['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]];
  return (
    <Field label={t('ems_d_align')}>
      <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('ems_d_align')}>
        {opts.map(([a, Icon]) => (
          <button key={a} type="button" aria-pressed={value === a} aria-label={t(`ems_d_align_${a}`)} onClick={() => onChange(a)}
            className={cn('inline-flex h-7 w-8 items-center justify-center rounded-md', value === a ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </Field>
  );
}

function UrlField({ label, value, onChange, kind = 'a', text }: { label: string; value: string | null | undefined; onChange: (v: string) => void; kind?: 'a' | 'img'; text?: string }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const findings = draft.trim() ? checkUrl(draft.trim(), { kind, text }) : [];
  const accepted = kind === 'img' ? /^https:\/\//i.test(draft.trim()) : /^(https:\/\/|mailto:|tel:)/i.test(draft.trim());
  return (
    <Field label={label} hint={
      <div className="space-y-0.5">
        {draft.trim() && !accepted ? <p className="text-[11px] text-red-700">{t(kind === 'img' ? 'ems_d_url_https_image' : 'ems_d_url_https')}</p> : null}
        {findings.map((f) => (
          <p key={f.code} className={cn('flex items-start gap-1 text-[11px]', f.severity === 'BLOCK' ? 'text-red-700' : 'text-amber-800')}>
            <Link2 className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />{findingText(t, f)}
          </p>
        ))}
      </div>
    }>
      <Input value={draft} dir="ltr" inputMode="url" placeholder="https://" className="h-8 text-xs"
        onChange={(e) => setDraft(e.target.value)} onBlur={() => onChange(draft.trim())} />
    </Field>
  );
}

const MERGE_FIELDS = ['{{first_name|}}', '{{name|}}'];

function TextField({ label, value, onChange, rows = 5, max }: { label: string; value: string; onChange: (v: string) => void; rows?: number; max: number }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  const insert = (s: string) => {
    const el = ref.current;
    const pos = el ? el.selectionStart : draft.length;
    const next = (draft.slice(0, pos) + s + draft.slice(pos)).slice(0, max);
    setDraft(next); onChange(next);
  };
  return (
    <Field label={label} hint={
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {MERGE_FIELDS.map((m) => (
          <button key={m} type="button" onClick={() => insert(m)} className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground" dir="ltr">{m}</button>
        ))}
        <span className="ms-auto text-[10px] text-muted-foreground">{t('ems_d_markup_hint')}</span>
      </div>
    }>
      <Textarea ref={ref} value={draft} rows={rows} maxLength={max} className="text-sm"
        onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onChange(draft); }} />
    </Field>
  );
}

function PaddingField({ value, onChange }: { value: Pad | undefined; onChange: (p: Pad) => void }) {
  const { t } = useLanguage();
  const p = value ?? { t: 8, r: 32, b: 8, l: 32 };
  return (
    <Field label={t('ems_d_padding')}>
      <div className="grid grid-cols-4 gap-1">
        {(['t', 'r', 'b', 'l'] as const).map((k) => (
          <Input key={k} type="number" min={0} max={80} aria-label={t(`ems_d_pad_${k}`)} value={p[k]} className="h-8 px-1.5 text-center text-xs"
            onChange={(e) => onChange({ ...p, [k]: Math.min(80, Math.max(0, Number(e.target.value) || 0)) })} />
        ))}
      </div>
    </Field>
  );
}

function FontField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useLanguage();
  return (
    <Field label={t('ems_d_font')}>
      <Select value={value ?? 'inherit'} onValueChange={(v) => onChange(v === 'inherit' ? undefined : v)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{t('ems_d_font_inherit')}</SelectItem>
          {FONT_KEYS.map((f) => <SelectItem key={f} value={f}>{t(`ems_d_font_${f}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function WeightField({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
  const { t } = useLanguage();
  return (
    <Field label={t('ems_d_weight')}>
      <Select value={String(value ?? '')} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('ems_d_font_inherit')} /></SelectTrigger>
        <SelectContent>
          {[400, 500, 600, 700, 800].map((w) => <SelectItem key={w} value={String(w)}>{t(`ems_d_weight_${w}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function BlockProperties({ block, onPatch, onClose, onRemove }: { block: Block | LeafBlock; onPatch: (p: Record<string, unknown>) => void; onClose: () => void; onRemove: () => void }) {
  const { t } = useLanguage();
  const b = block as Block;
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t(`ems_block_${b.type}`)}</p>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t('ems_d_delete')} onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t('ems_d_close')} onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {b.type === 'heading' ? (<>
        <TextField label={t('ems_d_text')} value={b.text} max={300} rows={2} onChange={(v) => onPatch({ text: v })} />
        <Field label={t('ems_d_level')}>
          <Select value={String(b.level)} onValueChange={(v) => onPatch({ level: Number(v) })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{[1, 2, 3].map((l) => <SelectItem key={l} value={String(l)}>{t(`ems_d_level_${l}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t('ems_d_size')} value={b.fontSize} min={14} max={48} suffix="px" onChange={(n) => onPatch({ fontSize: n })} />
          <WeightField value={b.fontWeight} onChange={(n) => onPatch({ fontWeight: n })} />
        </div>
        <FontField value={b.fontFamily} onChange={(v) => onPatch({ fontFamily: v })} />
        <ColorField label={t('ems_d_text_color')} value={b.color} allowEmpty onChange={(v) => onPatch({ color: v })} />
      </>) : null}

      {b.type === 'text' ? (<>
        <TextField label={t('ems_d_text')} value={b.text} max={5000} rows={7} onChange={(v) => onPatch({ text: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t('ems_d_size')} value={b.fontSize} min={11} max={28} suffix="px" onChange={(n) => onPatch({ fontSize: n })} />
          <WeightField value={b.fontWeight} onChange={(n) => onPatch({ fontWeight: n })} />
        </div>
        <FontField value={b.fontFamily} onChange={(v) => onPatch({ fontFamily: v })} />
        <ColorField label={t('ems_d_text_color')} value={b.color} allowEmpty onChange={(v) => onPatch({ color: v })} />
      </>) : null}

      {b.type === 'image' || b.type === 'logo' ? (<>
        <UrlField label={t('ems_d_image_url')} value={b.src} kind="img" onChange={(v) => onPatch({ src: v })} />
        <Field label={t('ems_d_alt')}><Input value={b.alt} maxLength={200} className="h-8 text-xs" onChange={(e) => onPatch({ alt: e.target.value })} /></Field>
        <UrlField label={t('ems_d_link_optional')} value={b.href ?? ''} onChange={(v) => onPatch({ href: v || null })} />
        <NumberField label={t('ems_d_width')} value={b.width} min={40} max={b.type === 'logo' ? 300 : 600} suffix="px" onChange={(n) => onPatch({ width: n })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        {b.type === 'image' ? <NumberField label={t('ems_d_radius')} value={b.radius} min={0} max={40} suffix="px" onChange={(n) => onPatch({ radius: n })} /> : null}
      </>) : null}

      {b.type === 'button' ? (<>
        <Field label={t('ems_d_label')}><Input value={b.label} maxLength={80} className="h-8 text-sm" onChange={(e) => onPatch({ label: e.target.value })} /></Field>
        <UrlField label={t('ems_d_link')} value={b.href} text={b.label} onChange={(v) => onPatch({ href: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <ColorField label={t('ems_d_button_color')} value={b.buttonColor} onChange={(v) => v && onPatch({ buttonColor: v })} />
          <ColorField label={t('ems_d_text_color')} value={b.textColor} onChange={(v) => v && onPatch({ textColor: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t('ems_d_radius')} value={b.radius} min={0} max={40} suffix="px" onChange={(n) => onPatch({ radius: n })} />
          <NumberField label={t('ems_d_size')} value={b.fontSize ?? 15} min={12} max={22} suffix="px" onChange={(n) => onPatch({ fontSize: n })} />
        </div>
        <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_full_width')}</span><Switch checked={Boolean(b.fullWidth)} onCheckedChange={(v) => onPatch({ fullWidth: v })} /></label>
      </>) : null}

      {b.type === 'divider' ? (<>
        <ColorField label={t('ems_d_color')} value={b.color} onChange={(v) => v && onPatch({ color: v })} />
        <NumberField label={t('ems_d_thickness')} value={b.thickness} min={1} max={6} suffix="px" onChange={(n) => onPatch({ thickness: n })} />
      </>) : null}

      {b.type === 'spacer' ? <NumberField label={t('ems_d_height')} value={b.height} min={4} max={120} suffix="px" onChange={(n) => onPatch({ height: n })} /> : null}

      {b.type === 'social' ? <SocialEditor links={b.links} onChange={(links) => onPatch({ links })} /> : null}

      {b.type === 'footer' ? (<>
        <TextField label={t('ems_d_text')} value={b.text} max={1000} rows={4} onChange={(v) => onPatch({ text: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <ColorField label={t('ems_d_text_color')} value={b.color} allowEmpty onChange={(v) => onPatch({ color: v })} />
      </>) : null}

      {b.type === 'contact' ? (<>
        {(['name', 'email', 'phone', 'address'] as const).map((k) => (
          <Field key={k} label={t(`ems_d_contact_${k}`)}>
            <Input value={b[k]} dir={k === 'email' || k === 'phone' ? 'ltr' : undefined} className="h-8 text-xs" maxLength={k === 'address' ? 300 : 254}
              onChange={(e) => onPatch({ [k]: e.target.value })} />
          </Field>
        ))}
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
      </>) : null}

      {b.type === 'unsubscribe' ? (<>
        <Field label={t('ems_d_label')} hint={<p className="text-[11px] text-muted-foreground">{t('ems_d_unsubscribe_hint')}</p>}>
          <Input value={b.text} maxLength={200} placeholder={t('ems_d_unsubscribe_default')} className="h-8 text-xs" onChange={(e) => onPatch({ text: e.target.value })} />
        </Field>
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
      </>) : null}

      {b.type === 'columns' ? (<>
        <Field label={t('ems_d_ratio')}>
          <Select value={b.ratio} onValueChange={(v) => onPatch({ ratio: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{['50-50', '40-60', '60-40'].map((r) => <SelectItem key={r} value={r}>{r.replace('-', ' / ')}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <NumberField label={t('ems_d_gap')} value={b.gap} min={0} max={40} suffix="px" onChange={(n) => onPatch({ gap: n })} />
        <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_stack_mobile')}</span><Switch checked={b.stackOnMobile} onCheckedChange={(v) => onPatch({ stackOnMobile: v })} /></label>
      </>) : null}

      <div className="space-y-3 border-t pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_d_section_style')}</p>
        <ColorField label={t('ems_d_background')} value={b.background} allowEmpty onChange={(v) => onPatch({ background: v })} />
        <PaddingField value={b.padding} onChange={(p) => onPatch({ padding: p })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t('ems_d_border')} value={b.borderWidth ?? 0} min={0} max={8} suffix="px" onChange={(n) => onPatch({ borderWidth: n })} />
          <ColorField label={t('ems_d_border_color')} value={b.borderColor} allowEmpty onChange={(v) => onPatch({ borderColor: v })} />
        </div>
        <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_hide_mobile')}</span><Switch checked={Boolean(b.hideOnMobile)} onCheckedChange={(v) => onPatch({ hideOnMobile: v, hideOnDesktop: v ? false : b.hideOnDesktop })} /></label>
        <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_hide_desktop')}</span><Switch checked={Boolean(b.hideOnDesktop)} onCheckedChange={(v) => onPatch({ hideOnDesktop: v, hideOnMobile: v ? false : b.hideOnMobile })} /></label>
      </div>
    </div>
  );
}

function SocialEditor({ links, onChange }: { links: Array<{ network: SocialNetwork; url: string }>; onChange: (l: Array<{ network: SocialNetwork; url: string }>) => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="space-y-1 rounded-lg border p-2">
          <div className="flex items-center gap-1.5">
            <Select value={l.network} onValueChange={(v) => onChange(links.map((x, j) => (j === i ? { ...x, network: v as SocialNetwork } : x)))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SOCIAL_NETWORKS.map((n) => <SelectItem key={n} value={n}>{t(`ems_social_${n}`)}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('ems_d_delete')} onClick={() => onChange(links.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
          <UrlField label={t('ems_d_link')} value={l.url} onChange={(v) => onChange(links.map((x, j) => (j === i ? { ...x, url: v } : x)))} />
        </div>
      ))}
      {links.length < 9 ? (
        <Button type="button" variant="outline" size="sm" className="h-8 w-full" onClick={() => onChange([...links, { network: 'website', url: '' }])}>{t('ems_d_add_social')}</Button>
      ) : null}
    </div>
  );
}

function ThemeProperties({ theme, onPatch }: { theme: Theme; onPatch: (p: Partial<Theme>) => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3.5">
      <div>
        <p className="text-sm font-semibold">{t('ems_d_theme')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('ems_d_theme_hint')}</p>
      </div>
      <ColorField label={t('ems_d_canvas')} value={theme.canvas} onChange={(v) => v && onPatch({ canvas: v })} />
      <ColorField label={t('ems_d_card')} value={theme.card} onChange={(v) => v && onPatch({ card: v })} />
      <ColorField label={t('ems_d_text_color')} value={theme.text} onChange={(v) => v && onPatch({ text: v })} />
      <ColorField label={t('ems_d_muted')} value={theme.muted} onChange={(v) => v && onPatch({ muted: v })} />
      <ColorField label={t('ems_d_accent')} value={theme.accent} onChange={(v) => v && onPatch({ accent: v })} />
      <ColorField label={t('ems_d_link_color')} value={theme.link} onChange={(v) => v && onPatch({ link: v })} />
      <Field label={t('ems_d_font')}>
        <Select value={theme.fontFamily} onValueChange={(v) => onPatch({ fontFamily: v as Theme['fontFamily'] })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{FONT_KEYS.map((f) => <SelectItem key={f} value={f}>{t(`ems_d_font_${f}`)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label={t('ems_d_width')} value={theme.width} min={480} max={680} suffix="px" onChange={(n) => onPatch({ width: n })} />
        <NumberField label={t('ems_d_radius')} value={theme.radius} min={0} max={28} suffix="px" onChange={(n) => onPatch({ radius: n })} />
      </div>
    </div>
  );
}

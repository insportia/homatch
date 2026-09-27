// HOMATCH Admin — type what you want, get where it is.
//
// Two kinds of answer, in one box:
//
//   RECORDS  a pasted identifier — a six-digit property reference, a uuid
//            (user, match, conversation, campaign, signal, notification,
//            announcement) or an email — resolved by admin_lookup, an
//            admin-only SQL function where every probe is an equality on an
//            index. It opens the page that manages that record.
//   PAGES    the navigation registry, which is a few dozen rows, so it is
//            instant and cannot be wrong about where something lives. Its
//            real job is the jargon: typing "cartesia" lands on Voice.
//
// Free text is never sent to the database from here; only something shaped
// like an identifier is, so the box stays instant for everything else.

import { CornerDownLeft, Database, Loader2, Search } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { labelFor } from '@/admin/labels';
import { searchAdmin } from '@/admin/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { adminLookup, looksLikeIdentifier, type LookupHit } from '@/services/adminControl';

export function AdminSearch({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [records, setRecords] = React.useState<LookupHit[]>([]);
  const [looking, setLooking] = React.useState(false);

  const pages = React.useMemo(() => searchAdmin(query, t), [query, t]);

  /* A fresh box every time it opens: the last thing somebody searched for
     is rarely the next thing they want. */
  React.useEffect(() => {
    if (open) { setQuery(''); setActive(0); setRecords([]); }
  }, [open]);

  React.useEffect(() => { setActive(0); }, [query]);

  React.useEffect(() => {
    const q = query.trim();
    if (!looksLikeIdentifier(q)) { setRecords([]); setLooking(false); return; }
    let live = true;
    setLooking(true);
    const timer = window.setTimeout(() => {
      adminLookup(q)
        .then((r) => { if (live) setRecords(r ?? []); })
        .catch(() => { if (live) setRecords([]); })
        .finally(() => { if (live) setLooking(false); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query]);

  const items = React.useMemo(() => [
    ...records.map((r) => ({ key: `r:${r.kind}:${r.id}`, path: r.path, record: r })),
    ...pages.map((p) => ({ key: `p:${p.item.path}`, path: p.item.path, page: p })),
  ], [records, pages]);

  const go = React.useCallback((path: string) => {
    onOpenChange(false);
    navigate(path);
  }, [navigate, onOpenChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); go(items[active].path); }
  };

  const empty = query.trim() !== '' && items.length === 0 && !looking;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{t('admin_search_open')}</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('admin_cc_search_placeholder')}
            aria-label={t('admin_cc_search_placeholder')}
            className="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
          {looking && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
        </div>

        <div className="max-h-[min(60vh,22rem)] overflow-y-auto p-1.5" role="listbox" aria-label={t('admin_search_open')}>
          {query.trim() === '' ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('admin_cc_search_hint')}</p>
          ) : empty ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-foreground">{t('admin_search_empty')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('admin_cc_search_hint')}</p>
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={it.key}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it.path)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start transition-colors',
                  i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                )}
              >
                {'record' in it && it.record ? (
                  <>
                    <Database className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {it.record.reference ? `#${it.record.reference} ` : ''}{it.record.label ?? it.record.id}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {labelFor(t, 'lookupKind', it.record.kind)}{it.record.detail ? ` · ${it.record.detail}` : ''}
                      </span>
                    </span>
                  </>
                ) : 'page' in it && it.page ? (
                  <>
                    <it.page.item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t(it.page.item.labelKey)}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{t(it.page.group.labelKey)}</span>
                    </span>
                  </>
                ) : null}
                {i === active && (
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

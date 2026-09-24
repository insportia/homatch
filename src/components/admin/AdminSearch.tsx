// HOMATCH Admin — type what you want, get where it is.
//
// This is not a database search and is not trying to be. It searches the
// navigation registry, which is a few dozen rows, so it is instant and
// cannot be wrong about where something lives.
//
// Its real job is the jargon. The navigation deliberately says "Voice"
// rather than "TTS" and "AI Call Center" rather than "Vapi" — but the
// person who already knows the provider's name should not be punished for
// knowing it. Typing "cartesia" lands on Voice. Typing "resend" lands on
// Email. The keyword lists in navigation.ts exist for exactly that.

import { CornerDownLeft, Search } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { searchAdmin } from '@/admin/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export function AdminSearch({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);

  const results = React.useMemo(() => searchAdmin(query, t), [query, t]);

  /* A fresh box every time it opens: the last thing somebody searched for
     is rarely the next thing they want. */
  React.useEffect(() => {
    if (open) { setQuery(''); setActive(0); }
  }, [open]);

  React.useEffect(() => { setActive(0); }, [query]);

  const go = React.useCallback((path: string) => {
    onOpenChange(false);
    navigate(path);
  }, [navigate, onOpenChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active].item.path); }
  };

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
            placeholder={t('admin_search_placeholder')}
            aria-label={t('admin_search_placeholder')}
            className="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[min(60vh,22rem)] overflow-y-auto p-1.5" role="listbox" aria-label={t('admin_search_open')}>
          {query.trim() === '' ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('admin_search_hint')}</p>
          ) : results.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-foreground">{t('admin_search_empty')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('admin_search_hint')}</p>
            </div>
          ) : (
            results.map(({ item, group }, i) => (
              <button
                key={item.path}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item.path)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start transition-colors',
                  i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                )}
              >
                <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t(item.labelKey)}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{t(group.labelKey)}</span>
                </span>
                {i === active && (
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

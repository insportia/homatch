// A searchable multi-select (Popover + Command) — the workspace's country and language
// pickers. The search matches every text an option carries (e.g. the Georgian AND the
// English country name, and the ISO code), case-insensitively and by plain containment, which
// is the only rule that works across Mkhedruli, Cyrillic, Arabic and Hebrew alike.

import { Check, ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiOption {
  value: string;
  label: string;
  /** Extra text the search matches (other-language names, codes). */
  search?: string;
  count?: number | null;
  leading?: string;
}

export function matchesQuery(option: MultiOption, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return `${option.label} ${option.search ?? ''} ${option.value}`.toLocaleLowerCase().includes(q);
}

export function MultiSelect({
  label, options, selected, onChange, searchPlaceholder, emptyText, clearText, testId, formatCount,
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder: string;
  emptyText: string;
  clearText: string;
  testId: string;
  formatCount?: (n: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /* Selected first, then options with results, then the rest — each in the given order. */
  const shown = useMemo(() => {
    const hit = options.filter((o) => matchesQuery(o, query));
    const rank = (o: MultiOption) => (selected.includes(o.value) ? 0 : (o.count ?? 0) > 0 ? 1 : 2);
    return hit.map((o, i) => [o, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([o]) => o).slice(0, 300);
  }, [options, query, selected]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testId} aria-haspopup="listbox" aria-expanded={open}
          className={cn(
            'flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-white px-3 text-start text-sm font-semibold',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]',
            selected.length ? 'border-[hsl(var(--gold-border))] text-[hsl(218_45%_14%)]' : 'border-[hsl(var(--border))] text-[hsl(224_14%_30%)]',
          )}>
          <span className="min-w-0 truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {selected.length ? (
              <span className="rounded-full bg-[hsl(var(--gold-soft))] px-2 py-0.5 text-2xs font-bold tabular-nums text-[hsl(var(--gold-ink))]" dir="ltr">{selected.length}</span>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0" data-testid={`${testId}-panel`}>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={searchPlaceholder} data-testid={`${testId}-search`} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {shown.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o.value)} data-option={o.value}
                    className="min-h-10 gap-2" aria-selected={on}>
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-[hsl(34_90%_40%)] bg-[hsl(38_92%_54%)] text-[#161309]' : 'border-[hsl(var(--border))]')}>
                      {on ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                    </span>
                    {o.leading ? <span aria-hidden="true">{o.leading}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.count != null ? (
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground" dir="ltr">{formatCount ? formatCount(o.count) : o.count}</span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {selected.length ? (
            <button type="button" onClick={() => onChange([])}
              className="flex min-h-10 items-center justify-center gap-1.5 border-t text-sm font-semibold text-[hsl(var(--gold-ink))] hover:bg-[hsl(42_100%_98%)]">
              <X className="h-3.5 w-3.5" aria-hidden="true" />{clearText}
            </button>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

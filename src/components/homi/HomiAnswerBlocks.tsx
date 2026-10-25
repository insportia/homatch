import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalloutTone, HomiAnswerBlock } from '@/lib/homi/answerBlocks';

/*
 * THE DESIGNED PARTS OF A HOMI ANSWER.
 *
 * Drawn from validated blocks (lib/homi/answerBlocks.ts): key figures as
 * tiles, one callout, a comparison that stacks instead of scrolling sideways
 * on a 390px phone, and numbered steps. Plain text only, so nothing here can
 * carry markup or a link. Logical properties throughout, so Arabic and Hebrew
 * mirror correctly.
 */

const CALLOUT: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  tip: { box: 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.08)]', icon: 'text-[hsl(var(--gold-ink))]', Icon: Lightbulb },
  warning: { box: 'border-amber-500/35 bg-amber-500/[0.08]', icon: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle },
  note: { box: 'border-sky-500/30 bg-sky-500/[0.07]', icon: 'text-sky-600 dark:text-sky-400', Icon: Info },
};

function Block({ block }: { block: HomiAnswerBlock }) {
  if (block.type === 'figures') {
    return (
      <div className={cn('grid gap-2', block.items.length === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2')} data-homi-block="figures">
        {block.items.map((item, i) => (
          <div key={i} className="min-w-0 rounded-xl border border-border bg-background px-3.5 py-3 shadow-sm">
            <p className="break-words text-[13px] leading-snug text-muted-foreground">{item.label}</p>
            <p className="mt-1 break-words text-lg font-bold leading-tight tabular-nums text-foreground">{item.value}</p>
            {item.hint && <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">{item.hint}</p>}
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'callout') {
    const c = CALLOUT[block.tone];
    return (
      <div className={cn('flex gap-3 rounded-xl border px-3.5 py-3', c.box)} data-homi-block="callout" role="note">
        <c.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', c.icon)} aria-hidden="true" />
        <div className="min-w-0">
          {block.title && <p className="mb-0.5 text-sm font-semibold text-foreground">{block.title}</p>}
          <p className="break-words text-sm leading-relaxed text-foreground">{block.text}</p>
        </div>
      </div>
    );
  }

  if (block.type === 'compare') {
    const cols = block.columns.length;
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-background" data-homi-block="compare">
        {block.title && <p className="border-b border-border px-3.5 py-2.5 text-sm font-semibold text-foreground">{block.title}</p>}
        <div className={cn('grid gap-2 border-b border-border bg-secondary/50 px-3.5 py-2', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {block.columns.map((c, i) => (
            <span key={i} className="min-w-0 break-words text-[13px] font-semibold text-foreground">{c}</span>
          ))}
        </div>
        <ul className="divide-y divide-border">
          {block.rows.map((row, i) => (
            <li key={i} className="px-3.5 py-2.5">
              <p className="mb-1 break-words text-xs text-muted-foreground">{row.label}</p>
              <div className={cn('grid gap-2', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
                {row.values.map((v, j) => (
                  <span key={j} className="min-w-0 break-words text-sm font-medium tabular-nums text-foreground">{v}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background px-3.5 py-3" data-homi-block="steps">
      {block.title && <p className="mb-2 text-sm font-semibold text-foreground">{block.title}</p>}
      <ol className="space-y-2">
        {block.items.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#0C1119] text-xs font-bold text-[hsl(38_92%_60%)]" aria-hidden="true">{i + 1}</span>
            <span className="min-w-0 break-words pt-0.5 text-sm leading-relaxed text-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HomiAnswerBlocks({ blocks, className }: { blocks: HomiAnswerBlock[]; className?: string }) {
  if (!blocks.length) return null;
  return (
    <div className={cn('space-y-2.5', className)}>
      {blocks.map((b, i) => <Block key={`${b.type}-${i}`} block={b} />)}
    </div>
  );
}

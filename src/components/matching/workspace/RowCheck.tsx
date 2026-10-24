import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A 44px selection target with a real checkbox inside (keyboard, screen readers, Playwright .check()). */
export function RowCheck({ checked, onChange, label, indeterminate = false, testId = 'mw-row-check' }: {
  checked: boolean;
  onChange: () => void;
  label: string;
  indeterminate?: boolean;
  testId?: string;
}) {
  return (
    <label className="relative -m-1.5 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" checked={checked}
        ref={(el) => { if (el) el.indeterminate = indeterminate && !checked; }}
        onChange={onChange} aria-label={label} data-testid={testId} />
      <span aria-hidden="true" className={cn(
        'flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(38_92%_50%)] peer-focus-visible:ring-offset-2',
        checked || indeterminate ? 'border-[hsl(34_90%_40%)] bg-[hsl(38_92%_54%)] text-[#161309]' : 'border-[hsl(218_20%_70%)] bg-white',
      )}>
        {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : indeterminate ? <Minus className="h-3.5 w-3.5" strokeWidth={3} /> : null}
      </span>
    </label>
  );
}

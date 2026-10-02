// The Meta Ads builder's button: the shared Button, except that it grows with
// its label instead of clipping it. Georgian (and Russian, Turkish) labels
// wrap to two lines on a phone; the base Button's fixed h-10 / h-9 would cut
// the second line off. Here the height is a minimum (44 px — the touch
// target), text wraps at word boundaries and stays centred, and an enabled or
// disabled button keeps the same geometry. Icon-only buttons are unchanged.
import * as React from 'react';
import { Button as Base, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, size, ...props }, ref) => (
  <Base ref={ref} size={size}
    className={cn(size !== 'icon' && 'h-auto min-h-11 whitespace-normal py-2 text-center leading-snug [overflow-wrap:break-word] [word-break:normal]', className)}
    {...props} />
));
Button.displayName = 'MetaButton';

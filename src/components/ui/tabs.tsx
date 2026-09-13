import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

/*
 * WHY THE TAB LABELS WERE SITTING ON TOP OF EACH OTHER ON A PHONE.
 *
 * TabsList was `inline-flex h-9`, the trigger was `whitespace-nowrap`, and
 * neither carried `shrink-0`. Flex children shrink by default, so on a 390px
 * screen five triggers were each squeezed to a fifth of the rail while their
 * text refused to wrap -- so each label overflowed its own box and ran across
 * its neighbour. Adding `overflow-x-auto` to the list, which several screens
 * had done, changed nothing: there was no overflow to scroll, because the
 * boxes had obediently shrunk to fit.
 *
 * Two fixes, in the primitive rather than in each screen that hit it:
 *
 *   The trigger does not shrink. Now the row is genuinely wider than the
 *   phone, `overflow-x-auto` has something to do, and the rail scrolls.
 *
 *   The list has a MINIMUM height rather than a fixed one, so a caller who
 *   wants labels to wrap instead of scroll gets a taller rail rather than a
 *   clipped one.
 *
 * Georgian is what made this urgent: dr_tab_documents is "დოკუმენტები", and
 * there is no width at which five of those fit across a 390px phone.
 */
const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex min-h-9 max-w-full items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // min-h-8 rather than a bare py-1: a 44px-tall rail on a phone is a
      // tap target, and a 26px one is a dare.
      "inline-flex min-h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-gold data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }

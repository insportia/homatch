import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A table that survives a phone.
 *
 * It already scrolled sideways rather than overflowing the page, which is
 * what stops a wide table breaking the layout. Two things were still
 * missing, and both of them are about whether anyone can actually reach
 * the columns that are off screen:
 *
 *   KEYBOARD  A scroll container with nothing focusable inside it cannot
 *             be scrolled from a keyboard at all. The columns past the
 *             right edge were simply unreachable without a mouse or a
 *             touchscreen. tabIndex makes the region itself focusable,
 *             which is what the arrow keys then scroll.
 *
 *   DISCOVERY A table that is cut off at the edge, with no shadow and no
 *             partial column showing, looks like a table that ends there.
 *             The scroll-x-shadow utility fades in a shadow at whichever
 *             edge still has content behind it — pure CSS, driven by the
 *             background-attachment trick, so it costs no scroll handler.
 *
 * `aria-label` should be passed by the caller; the region is announced as
 * a landmark, and an unnamed landmark is noise.
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div
    role="region"
    tabIndex={0}
    aria-label={props["aria-label"]}
    className={cn(
      "scroll-x-shadow relative w-full overflow-auto rounded-md",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    )}
  >
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm [font-variant-numeric:tabular-nums]", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-3 text-left align-middle text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-3.5 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

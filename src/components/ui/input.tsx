import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        /*
         * h-11 on touch, h-10 from md.
         *
         * It was h-9 everywhere: 36px, against a fingertip that needs
         * about 44. A mis-tap in a form is worse than a mis-tap on a
         * link, because it lands in a DIFFERENT FIELD and the customer
         * types several words before noticing. From md there is a mouse,
         * and 40px keeps dense screens dense.
         *
         * text-base is 17px and md:text-sm is 16px, both at or above the
         * threshold Safari zooms below — so neither size makes the page
         * jump when a field is focused.
         */
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

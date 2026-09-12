import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/**
 * A media query as a boolean, for the cases where CSS alone will not do.
 *
 * The document workspace needs this rather than `hidden lg:block`: the
 * inline reader FETCHES the extracted text when it mounts, so rendering it
 * hidden on a phone would buy tens of kilobytes per document that nobody is
 * going to look at. Deciding in JS keeps it unmounted instead.
 *
 * Starts false and corrects after mount, so the server-less first paint is
 * the narrow layout — which is the safe direction to be wrong in.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}

/** The `lg` breakpoint, where a two-pane workspace starts to make sense. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}

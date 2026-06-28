import { useEffect, useState } from 'react'

/**
 * Reage a uma media query CSS. Ex: useMediaQuery('(min-width: 1024px)').
 * Usado para decidir comportamento de layout (sidebar fixa no desktop x drawer no mobile).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    // Re-sincroniza caso a query (ou o viewport) tenha mudado entre render e efeito.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

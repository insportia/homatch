// The last metre of a readiness deep link (lib/metaAds/readiness.ts): once the
// step is on screen, find the field, open its fold if it is folded, scroll it
// into the middle of the screen, focus its first control and highlight it
// briefly. Bounded: it waits at most ~40 frames for the step to render.
const FOCUSABLE = 'input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

function pick(field: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-mm-field="${CSS.escape(field)}"]`)];
  // Several creatives: the first one whose field is still empty is the one to fix.
  return all.find((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.value.trim()) ?? all[0] ?? null;
}

export function focusField(field: string, tries = 40): void {
  if (typeof document === 'undefined') return;
  const el = pick(field);
  if (!el) { if (tries > 0) requestAnimationFrame(() => focusField(field, tries - 1)); return; }
  const fold = el.querySelector<HTMLButtonElement>(':scope > div > [data-mm-fold][aria-expanded="false"]');
  if (fold) { fold.click(); requestAnimationFrame(() => land(el)); return; }
  land(el);
}

function land(el: HTMLElement) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  const control = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  if (control) control.focus({ preventScroll: true });
  else { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  el.setAttribute('data-mm-highlight', '');
  const prev = el.style.boxShadow;
  el.style.boxShadow = '0 0 0 3px hsl(var(--gold))';
  el.style.transition = 'box-shadow .3s';
  window.setTimeout(() => { el.style.boxShadow = prev; el.removeAttribute('data-mm-highlight'); }, 2400);
}

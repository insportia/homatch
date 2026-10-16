// HOMATCH Verify — the report's content in the customer's language.
//
// Wraps the report. When the language is not Georgian it attaches the DOM
// translation layer (src/verify/translation/domTranslation.ts) to the report's
// root: every rendered text that contains Georgian letters — stored prose,
// deterministic copy, sentences the browser computes — is replaced in place by
// its translation once known, and requested from verify-synthesis `translate`
// otherwise (src/verify/translation/translator.ts: memory + sessionStorage,
// debounced batches). Georgian stays visible until the translation arrives:
// the page is never blocked, only a small "translating…" status shows.
//
// The root is the nearest [data-report-translation-root] (the Verify page and
// the case page mark theirs, so the chrome around the report is covered too),
// else the element this component wraps. A nested ReportTranslation defers to
// the outer one, so a page is never translated twice.
//
// `useReportTranslation().tr(text)` is for content that never reaches the DOM
// as text (a clipboard value, a document title): the translation when known,
// else the original while it is requested.

import React from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { isTranslationLang, MAX_CALL_CHARS, type TranslationLang } from '@/verify/translation/textTranslation';
import { ReportTranslator, type StorageLike } from '@/verify/translation/translator';
import { attachDomTranslation, attachPortalTranslation } from '@/verify/translation/domTranslation';

interface Ctx { translator: ReportTranslator | null }
const ReportTranslationContext = React.createContext<Ctx | null>(null);

const identity = (s: string) => s;

/** tr(text) for the current report; identity in Georgian or outside a report. */
export function useReportTranslation(): { tr: (text: string) => string; active: boolean } {
  const ctx = React.useContext(ReportTranslationContext);
  const t = ctx?.translator ?? null;
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => (t ? t.subscribe(bump) : undefined), [t]);
  return React.useMemo(() => ({ tr: t ? (s: string) => t.tr(s) : identity, active: !!t }), [t]);
}

function sessionStore(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

const isJobId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** One `translate` request to verify-synthesis. Any failure answers nothing; the translator retries later. */
export function translationSender(jobId: string, lang: TranslationLang) {
  return async (texts: string[]): Promise<Record<string, string>> => {
    let total = 0;
    const capped = texts.filter((t) => (total += t.length) <= MAX_CALL_CHARS);
    const { data, error } = await supabase.functions.invoke('verify-synthesis', { body: { action: 'translate', jobId, lang, texts: capped } });
    const out = (data as { translations?: unknown } | null)?.translations;
    if (error || !out || typeof out !== 'object') return {};
    return out as Record<string, string>;
  };
}

export function ReportTranslation({
  jobId,
  prefetch,
  children,
}: {
  jobId: string | null | undefined;
  /** Texts worth translating before they are even rendered (the report's prose). */
  prefetch?: () => Iterable<string>;
  children: React.ReactNode;
}) {
  const { lang, t } = useLanguage();
  const outer = React.useContext(ReportTranslationContext);
  const anchor = React.useRef<HTMLSpanElement>(null);
  const target = isTranslationLang(lang) ? lang : null;
  const own = !outer;

  const translator = React.useMemo(
    () => (own && target && isJobId(jobId) ? new ReportTranslator({ lang: target, send: translationSender(jobId, target), storage: sessionStore() }) : null),
    [own, target, jobId],
  );
  React.useEffect(() => () => translator?.stop(), [translator]);

  // Attach before paint, so what is already known never flashes in Georgian.
  React.useLayoutEffect(() => {
    const a = anchor.current;
    if (!translator || !a) return undefined;
    const root = a.closest('[data-report-translation-root]') ?? a.previousElementSibling ?? a.parentElement;
    if (!root) return undefined;
    const detachRoot = attachDomTranslation(root, translator);
    // Report content shown through a portal (the gallery lightbox).
    const detachPortals = attachPortalTranslation(root.ownerDocument, translator);
    return () => { detachPortals(); detachRoot(); };
  }, [translator]);

  const active = translator ?? outer?.translator ?? null;
  const prefetchRef = React.useRef(prefetch);
  prefetchRef.current = prefetch;
  React.useEffect(() => {
    if (!active || !prefetchRef.current) return;
    try { active.prefetch(prefetchRef.current()); } catch { /* an optimisation only */ }
  }, [active]);

  const [pending, setPending] = React.useState(0);
  React.useEffect(() => {
    if (!translator) { setPending(0); return undefined; }
    const update = () => setPending(translator.pending);
    update();
    return translator.subscribePending(update);
  }, [translator]);

  const ctx = React.useMemo<Ctx>(() => ({ translator: active }), [active]);
  return (
    <ReportTranslationContext.Provider value={ctx}>
      {children}
      {own ? <span ref={anchor} hidden data-report-translation-anchor="" /> : null}
      {own && translator && pending > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              data-no-translate=""
              data-report-translating=""
              className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-40 flex justify-center px-4"
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--gold-ink,38_92%_50%))]" aria-hidden="true" />
                {t('verify_tr_translating')}
              </span>
            </div>,
            document.body,
          )
        : null}
    </ReportTranslationContext.Provider>
  );
}

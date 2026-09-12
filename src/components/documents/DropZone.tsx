import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMotion } from '@/hooks/useMotion';
import { DURATION, EASING } from '@/lib/motion';

/**
 * WHERE A CONTRACT COMES IN.
 *
 * This replaced a button. A button is a perfectly good way to open a file
 * picker, and it is the wrong shape for the thing people actually do with a
 * contract, which is drag it out of an email or a folder and let go.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not validate, upload, bill, or analyse. It hands a File to `onFile`
 * and that is the whole of its responsibility — the same `pick` that the
 * button called, with the same validation and the same upload behind it. A
 * drop zone is a way of choosing a file, and choosing a file is not the same
 * event as paying for an analysis.
 *
 * THE DRAG COUNTER
 *
 * `dragleave` fires every time the pointer crosses into a CHILD element, so
 * the naive version flickers between "hovering" and "not hovering" as you
 * move over the icon and the text inside it. Counting enter and leave and
 * treating zero as "gone" is what makes the highlight hold steady.
 */
export function DropZone({
  onFile, busy = false, accept, error,
}: {
  /** Receives the chosen file. Validation and upload live with the caller. */
  onFile: (file: File) => void;
  /** True while something is uploading or being read. */
  busy?: boolean;
  /** MIME types for the file picker's filter. */
  accept: string;
  /** Already-translated rejection message, when the last choice failed. */
  error?: string | null;
}) {
  const { t } = useLanguage();
  const level = useMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const take = useCallback((files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  /*
   * Stop the BROWSER handling a missed drop.
   *
   * Drop a PDF anywhere else on the page and the browser navigates to it,
   * throwing away whatever the customer was doing. That is a bad outcome for
   * a near miss, so the window refuses drops it did not ask for.
   */
  useEffect(() => {
    const swallow = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const open = () => { if (!busy) inputRef.current?.click(); };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />

      {/* A button, not a div with a click handler: it is one action, it needs
          to be reachable by keyboard, and the file picker must be opened by a
          real user gesture. */}
      <button
        type="button"
        onClick={open}
        disabled={busy}
        aria-describedby="dropzone-hint"
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          // Tells the OS this is a copy, which changes the cursor.
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          if (!busy) take(e.dataTransfer.files);
        }}
        className={[
          'group relative flex w-full flex-col items-center justify-center gap-3',
          'overflow-hidden rounded-[1.1rem] border border-dashed px-6 py-9 text-center',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          busy ? 'cursor-wait' : 'cursor-pointer',
          over
            ? 'border-gold bg-gold-soft'
            : 'border-border bg-secondary/40 hover:border-gold/60 hover:bg-gold-soft/40',
        ].join(' ')}
        style={{
          transition: level === 'none'
            ? 'none'
            : `border-color ${DURATION.control}ms ${EASING.move}, background-color ${DURATION.control}ms ${EASING.move}`,
        }}
      >
        <DocumentMark busy={busy} over={over} />

        <span className="flex flex-col gap-1">
          <span className="font-display text-lg font-bold tracking-[-0.01em] text-foreground">
            {busy ? t('dr_docs_reading') : t('dr_docs_drop_title')}
          </span>
          <span className="text-sm text-ink-soft">
            {busy ? t('dr_docs_reading_hint') : t('dr_docs_drop_lead')}
          </span>
        </span>

        {!busy && (
          <span className="inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-card px-4 py-2 text-sm font-semibold">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('dr_docs_upload')}
          </span>
        )}
      </button>

      <p id="dropzone-hint" className="mt-2 text-sm leading-relaxed text-muted-foreground break-words">
        {t('dr_docs_hint')}
      </p>
      {error ? <p className="mt-1 text-sm text-destructive break-words">{error}</p> : null}
    </div>
  );
}

/**
 * The page-with-clauses mark, and what it does while a document is being read.
 *
 * The three bars are a document's lines, and the sweep passing over them is
 * the thing being read. It is decoration, but it is decoration that says
 * something true: work is happening, and it is happening TO THIS, not
 * somewhere else.
 *
 * At 'none' the sweep does not run and the spinner is the whole answer —
 * which is why the spinner is always present rather than being the
 * alternative to the animation.
 */
function DocumentMark({ busy, over }: { busy: boolean; over: boolean }) {
  const level = useMotion();
  const animate = busy && level !== 'none';

  return (
    <span
      className={[
        'relative grid h-14 w-14 shrink-0 place-items-center rounded-[0.9rem]',
        'border border-border bg-card',
      ].join(' ')}
      style={{
        transform: over && level !== 'none' ? 'translateY(-2px) scale(1.04)' : 'none',
        transition: level === 'none' ? 'none' : `transform ${DURATION.control}ms ${EASING.enter}`,
      }}
      aria-hidden="true"
    >
      {busy ? (
        <Loader2 className="h-6 w-6 animate-spin text-gold-ink" strokeWidth={2} />
      ) : (
        <FileText className="h-6 w-6 text-foreground" strokeWidth={1.75} />
      )}

      {/* The sweep. Positioned over the mark, clipped by its rounded corners,
          and present only while there is genuinely something to read. */}
      {animate && (
        <span
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.9rem]"
        >
          <span className="hm-scan absolute inset-x-0 h-1/3" />
        </span>
      )}
    </span>
  );
}

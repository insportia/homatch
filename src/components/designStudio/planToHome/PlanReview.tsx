// "IS THIS YOUR HOME?" — the reading, shown as a clean plan, confirmed in a few taps.
//
// HOMATCH shows what it understood (rooms with their names and sizes, doors,
// windows, stairs, the balcony and porch) and asks ONLY the questions its
// evidence could not settle — each one a tap, never a CAD tool. Anything can
// still be corrected by tapping it on the plan. Sizes come from the drawing's
// own printed dimensions, checked against each other; how well they agree is
// said in one plain line.

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, DoorOpen, Footprints, Layers, Maximize2, Sun, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FloorPlanDocument, RoomKind, RoomPolygon } from '@/services/developer/floorplan';
import type { ConstraintReport, PlanAnswer, PlanQuestion } from '@/lib/designStudio/planToHome';
import { cn } from '@/lib/utils';
import { PlanDrawing, type PlanSelection } from './PlanDrawing';

const KINDS: RoomKind[] = ['LIVING', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'WC', 'HALL', 'CORRIDOR', 'STORAGE', 'BALCONY', 'TERRACE'];
const CHIP = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const chip = (on: boolean) => cn(CHIP, on ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'border-[#D5D9E0] bg-white text-[#0C1119] hover:border-[#0C1119]');

/** Metres as a person reads them; feet too when the drawing is in feet. */
export function sizeText(w: number, d: number, imperial: boolean): string {
  const m = `${w.toFixed(2)} × ${d.toFixed(2)} m`;
  if (!imperial) return m;
  const ft = (x: number) => {
    const inches = Math.round(x / 0.0254);
    const f = Math.floor(inches / 12); const i = inches % 12;
    return i ? `${f}′${i}″` : `${f}′`;
  };
  return `${m} · ${ft(w)} × ${ft(d)}`;
}

function extentPx(poly: Array<{ x: number; y: number }>) {
  const xs = poly.map((p) => p.x); const ys = poly.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export interface ReviewChange {
  answers: PlanAnswer[];
  rejected: string[];
}

export function PlanReview({
  doc, imageUrl, constraints, questions, answers, rejected, imperial, onChange, onContinue, busy, advanced,
}: {
  /** The reading with the customer's answers already applied. */
  doc: FloorPlanDocument;
  imageUrl: string | null;
  constraints: ConstraintReport | null;
  questions: PlanQuestion[];
  answers: PlanAnswer[];
  rejected: string[];
  imperial: boolean;
  onChange: (next: ReviewChange) => void;
  onContinue: () => void;
  busy: boolean;
  /** "Adjust size": the anchors and ceiling, shown only on request. */
  advanced: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'CLEAN' | 'OVERLAY' | 'ORIGINAL'>('CLEAN');
  const [selection, setSelection] = useState<PlanSelection | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const gone = useMemo(() => new Set(rejected), [rejected]);
  const mpp = constraints?.metresPerPx ?? doc.detectedScale ?? null;
  const answered = new Set(answers.map((a) => a.questionId));
  const open = questions.filter((q) => !answered.has(q.id));

  const answer = (a: PlanAnswer) => onChange({ answers: [...answers.filter((x) => x.questionId !== a.questionId), a], rejected });
  const toggleRemove = (id: string) => onChange({ answers, rejected: gone.has(id) ? rejected.filter((x) => x !== id) : [...rejected, id] });

  const rooms = [...doc.rooms, ...doc.balconies].filter((r) => !gone.has(r.id));
  const outdoor = (r: RoomPolygon) => r.kind === 'BALCONY' || r.kind === 'TERRACE';
  const roomName = (r: RoomPolygon) => t(`ds_room_${r.kind.toLowerCase()}`);
  /* A room's size as measured against its printed one (the solver's check), else its extent. */
  const measured = (r: RoomPolygon): [number, number] | null => {
    const c = constraints?.checks.find((x) => x.elementId === r.id && x.measuredM.length === 2);
    if (c) return [c.measuredM[0], c.measuredM[1]];
    if (!mpp) return null;
    const e = extentPx(r.polygon);
    return [e.w * mpp, e.h * mpp];
  };
  const roomSize = (r: RoomPolygon) => {
    const m = measured(r);
    return m ? sizeText(m[0], m[1], imperial) : null;
  };
  const footprint = useMemo(() => {
    const pts = doc.footprint?.length ? doc.footprint : doc.walls.filter((w) => w.kind === 'EXTERIOR').flatMap((w) => [w.start, w.end]);
    return pts.length && mpp ? extentPx(pts) : null;
  }, [doc, mpp]);
  const counts = {
    rooms: doc.rooms.filter((r) => !gone.has(r.id) && !outdoor(r)).length,
    doors: doc.doors.filter((o) => !gone.has(o.id)).length,
    windows: doc.windows.filter((o) => !gone.has(o.id)).length,
    stairs: (doc.stairs ?? []).filter((s) => !gone.has(s.id)).length,
    outdoor: rooms.filter(outdoor).length,
  };

  const sel = selection;
  const selRoom = sel?.kind === 'room' ? rooms.find((r) => r.id === sel.id) ?? [...doc.rooms, ...doc.balconies].find((r) => r.id === sel.id) : null;
  /* A correction by tapping is an answer to the question HOMATCH would have asked ("KIND:elementId"). */
  const manual = (kind: 'ROOM_TYPE' | 'OPENING_TYPE', id: string) => `${kind}:${id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="plan-review">
      <div className="relative flex min-h-[44dvh] flex-1 flex-col bg-[#E9ECF0] lg:min-h-0">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto p-2 sm:justify-center" role="tablist" aria-label={t('p2h_view_mode')}>
          {(['CLEAN', 'OVERLAY', 'ORIGINAL'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cn('h-9 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]', mode === m ? 'bg-[#0C1119] text-white' : 'bg-white/70 text-[#0C1119] hover:bg-white')}
              data-testid={`plan-mode-${m.toLowerCase()}`}>
              {t(`p2h_view_${m.toLowerCase()}`)}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          <div className="mx-auto max-w-[760px] overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            <PlanDrawing
              doc={doc} imageUrl={imageUrl} mode={mode} selection={selection} onSelect={setSelection} rejected={gone} metresPerPx={mpp}
              roomLabel={(r) => { const m = measured(r); return { name: roomName(r), size: m ? `${m[0].toFixed(1)} × ${m[1].toFixed(1)} m` : null }; }}
            />
          </div>
          <p className="mx-auto mt-2 max-w-[760px] text-center text-2xs text-[#5B6472]">{t('p2h_tap_to_fix')}</p>
        </div>
      </div>

      <aside className="w-full shrink-0 overflow-y-auto border-s border-[#D5D9E0] bg-white lg:w-[26rem]" aria-label={t('p2h_review_title')}>
        <div className="space-y-5 p-5">
          <div>
            <h2 className="font-display text-xl font-semibold">{t('p2h_review_title')}</h2>
            {footprint && mpp ? (
              <p className="mt-1 text-[15px] text-[#0C1119]" data-testid="plan-overall">
                {t('p2h_overall', { size: sizeText(footprint.w * mpp, footprint.h * mpp, imperial) })}
              </p>
            ) : null}
            {constraints && constraints.checks.length ? (
              <p className="mt-1 text-[13px] text-[#4A5263]" data-testid="plan-dims-agree">
                {t('p2h_dims_checked', { n: String(constraints.checks.filter((c) => c.used).length), pct: constraints.medianResidualPct.toFixed(1) })}
              </p>
            ) : null}
            <ul className="mt-3 flex flex-wrap gap-1.5 text-[13px]" aria-label={t('p2h_found')}>
              <li className="inline-flex items-center gap-1 rounded-full bg-[#F1F3F6] px-2.5 py-1"><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />{t('p2h_count_rooms', { n: String(counts.rooms) })}</li>
              <li className="inline-flex items-center gap-1 rounded-full bg-[#F1F3F6] px-2.5 py-1"><DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />{t('p2h_count_doors', { n: String(counts.doors) })}</li>
              <li className="inline-flex items-center gap-1 rounded-full bg-[#F1F3F6] px-2.5 py-1"><Layers className="h-3.5 w-3.5" aria-hidden="true" />{t('p2h_count_windows', { n: String(counts.windows) })}</li>
              {counts.stairs ? <li className="inline-flex items-center gap-1 rounded-full bg-[#F1F3F6] px-2.5 py-1"><Footprints className="h-3.5 w-3.5" aria-hidden="true" />{t('p2h_count_stairs', { n: String(counts.stairs) })}</li> : null}
              {counts.outdoor ? <li className="inline-flex items-center gap-1 rounded-full bg-[#F1F3F6] px-2.5 py-1"><Sun className="h-3.5 w-3.5" aria-hidden="true" />{t('p2h_count_outdoor', { n: String(counts.outdoor) })}</li> : null}
            </ul>
          </div>

          {open.length ? (
            <section aria-labelledby="p2h-q" className="space-y-2.5">
              <h3 id="p2h-q" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[hsl(32_78%_34%)]">{t('p2h_questions', { n: String(open.length) })}</h3>
              {open.map((q) => (
                <div key={q.id} className="rounded-xl border border-[hsl(38_80%_80%)] bg-[hsl(42_100%_97%)] p-3" data-testid="plan-question" data-kind={q.kind}>
                  <button type="button" className="text-start text-[15px] font-medium underline-offset-4 hover:underline" onClick={() => setSelection(selectionFor(q, doc))}>
                    {questionText(q, t, doc)}
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {q.kind === 'OPENING_TYPE' ? q.options.map((o) => (
                      <button key={o} type="button" className={chip(o === q.suggested)} onClick={() => answer({ questionId: q.id, kind: 'OPENING_TYPE', value: o })}>{t(`p2h_opening_${o.toLowerCase()}`)}</button>
                    )) : null}
                    {q.kind === 'ROOM_TYPE' ? [q.suggested, ...KINDS.filter((k) => k !== q.suggested)].slice(0, 6).map((k) => (
                      <button key={k} type="button" className={chip(k === q.suggested)} onClick={() => answer({ questionId: q.id, kind: 'ROOM_TYPE', value: k })}>{t(`ds_room_${k.toLowerCase()}`)}</button>
                    )) : null}
                    {q.kind === 'DIMENSION' ? (
                      <>
                        <button type="button" className={chip(true)} onClick={() => answer({ questionId: q.id, kind: 'DIMENSION', value: q.suggestedM })}>{t('p2h_dim_as_printed', { text: q.text })}</button>
                        <button type="button" className={chip(false)} onClick={() => answer({ questionId: q.id, kind: 'DIMENSION', value: Array.isArray(q.suggestedM) ? [0, 0] : 0 })}>{t('p2h_dim_ignore')}</button>
                      </>
                    ) : null}
                    {q.kind === 'OUTDOOR' || q.kind === 'IS_WALL' || q.kind === 'STAIRS' ? (
                      <>
                        <button type="button" className={chip(q.suggested)} onClick={() => answer({ questionId: q.id, kind: q.kind, value: true })}>{t('p2h_yes')}</button>
                        <button type="button" className={chip(!q.suggested)} onClick={() => answer({ questionId: q.id, kind: q.kind, value: false })}>{t('p2h_no')}</button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <p className="flex items-center gap-2 rounded-xl bg-[hsl(152_45%_95%)] px-3 py-2.5 text-[14px] text-[hsl(152_55%_24%)]" data-testid="plan-no-questions">
              <Check className="h-4 w-4" aria-hidden="true" />{t('p2h_no_questions')}
            </p>
          )}

          {sel ? (
            <section className="rounded-xl border border-[#0C1119] p-3" aria-live="polite" data-testid="plan-selection">
              {sel.kind === 'room' && selRoom ? (
                <>
                  <p className="text-[15px] font-semibold">{roomName(selRoom)}{selRoom.label ? <span className="ms-1.5 font-normal text-[#4A5263]">· {selRoom.label}</span> : null}</p>
                  {roomSize(selRoom) ? <p className="text-[13px] text-[#4A5263]">{roomSize(selRoom)}</p> : null}
                  <p className="mt-2 text-[13px] font-medium">{t('p2h_what_room')}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {KINDS.map((k) => (
                      <button key={k} type="button" className={chip(selRoom.kind === k)} onClick={() => answer({ questionId: manual('ROOM_TYPE', selRoom.id), kind: 'ROOM_TYPE', value: k })}>{t(`ds_room_${k.toLowerCase()}`)}</button>
                    ))}
                  </div>
                </>
              ) : null}
              {sel.kind === 'door' || sel.kind === 'window' ? (
                <>
                  <p className="text-[15px] font-semibold">{t(sel.kind === 'door' ? 'p2h_this_door' : 'p2h_this_window')}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(['DOOR', 'WINDOW', 'OPENING', 'WALL'] as const).map((o) => (
                      <button key={o} type="button" className={chip((sel.kind === 'door' && o === 'DOOR') || (sel.kind === 'window' && o === 'WINDOW'))}
                        onClick={() => { answer({ questionId: manual('OPENING_TYPE', sel.id), kind: 'OPENING_TYPE', value: o }); if (o === 'WALL') setSelection(null); }}>
                        {t(`p2h_opening_${o.toLowerCase()}`)}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {sel.kind === 'wall' ? <p className="text-[15px] font-semibold">{t('p2h_this_wall')}</p> : null}
              {sel.kind === 'stairs' ? <p className="text-[15px] font-semibold">{t('p2h_these_stairs')}</p> : null}
              <button type="button" onClick={() => { toggleRemove(sel.id); }} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D5D9E0] px-3 text-[14px] font-medium hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" data-testid="plan-remove">
                <Trash2 className="h-4 w-4" aria-hidden="true" />{t(gone.has(sel.id) ? 'p2h_restore' : sel.kind === 'room' ? 'p2h_not_a_room' : sel.kind === 'wall' ? 'p2h_not_a_wall' : sel.kind === 'stairs' ? 'p2h_not_stairs' : 'p2h_not_there')}
              </button>
            </section>
          ) : null}

          <section aria-labelledby="p2h-rooms">
            <h3 id="p2h-rooms" className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#4A5263]">{t('ds_panel_rooms')}</h3>
            <ul className="divide-y divide-[#EEF0F3] rounded-xl border border-[#E4E6EA]">
              {rooms.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelection({ kind: 'room', id: r.id })}
                    className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]', selection?.id === r.id && 'bg-[#F4F5F7]')}
                    data-testid="plan-room-row">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{roomName(r)}{r.label ? <span className="font-normal text-[#5B6472]"> · {r.label}</span> : null}</span>
                      {roomSize(r) ? <span className="block text-2xs text-[#5B6472]">{roomSize(r)}</span> : null}
                    </span>
                    {r.dimensionText ? <span className="shrink-0 rounded-md bg-[#F1F3F6] px-1.5 py-0.5 text-2xs text-[#4A5263]" title={t('p2h_printed')}>{r.dimensionText}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <div>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}
              className="inline-flex items-center gap-1 text-[14px] font-medium text-[#4A5263] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
              <ChevronDown className={cn('h-4 w-4 transition-transform', showAdvanced && 'rotate-180')} aria-hidden="true" />{t('p2h_adjust_size')}
            </button>
            {showAdvanced ? <div className="mt-3">{advanced}</div> : null}
          </div>
        </div>
        <div className="sticky bottom-0 border-t border-[#E4E6EA] bg-white/95 p-4 backdrop-blur">
          <button type="button" onClick={onContinue} disabled={busy}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-5 text-[16px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50"
            data-testid="plan-continue">
            {t(open.length ? 'p2h_continue_anyway' : 'p2h_continue')}
          </button>
        </div>
      </aside>
    </div>
  );
}

function selectionFor(q: PlanQuestion, doc: FloorPlanDocument): PlanSelection | null {
  const id = q.elementId;
  if ([...doc.rooms, ...doc.balconies].some((r) => r.id === id)) return { kind: 'room', id };
  if (doc.doors.some((o) => o.id === id)) return { kind: 'door', id };
  if (doc.windows.some((o) => o.id === id)) return { kind: 'window', id };
  if (doc.walls.some((w) => w.id === id)) return { kind: 'wall', id };
  if ((doc.stairs ?? []).some((s) => s.id === id)) return { kind: 'stairs', id };
  return null;
}

function questionText(q: PlanQuestion, t: (k: string, v?: Record<string, string>) => string, doc: FloorPlanDocument): string {
  const room = [...doc.rooms, ...doc.balconies].find((r) => r.id === q.elementId);
  const name = room ? (room.label ?? t(`ds_room_${room.kind.toLowerCase()}`)) : '';
  switch (q.kind) {
    case 'OPENING_TYPE': return t('p2h_q_opening');
    case 'ROOM_TYPE': return t('p2h_q_room', { label: name });
    case 'DIMENSION': return t('p2h_q_dimension', { label: name || q.elementId, text: q.text });
    case 'OUTDOOR': return t('p2h_q_outdoor', { label: name });
    case 'IS_WALL': return t('p2h_q_wall');
    case 'STAIRS': return t('p2h_q_stairs');
    default: return '';
  }
}

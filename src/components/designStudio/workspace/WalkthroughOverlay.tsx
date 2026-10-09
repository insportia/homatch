// HOMATCH DESIGN STUDIO — THE WALKTHROUGH, AROUND THE PERSON IN IT.
//
// Everything a visitor needs while occupying the home, and nothing more:
//
//   · where they are, the rooms, the guided tour, back to the entrance
//   · the whole home as ONE walk: at each real doorway of the room they are
//     in, the name of the room behind it (TourNavigation); a tap walks them
//     through that doorway. Back, the plan, any room, the entrance, exit —
//     always one tap away
//   · what they are pointing at, and what they can do with it — only when
//     it is in reach, as a quiet hint with the actions, never a HUD
//   · desktop: W A S D, mouse look (the mouse is captured on a click, Esc
//     releases it and opens the menu), click or E to use, Shift to walk a
//     little faster; drag a door or drawer to move it by hand
//   · touch: the LEFT thumb walks (a stick appears where it lands), the
//     RIGHT thumb looks — at the same time — and a tap uses what it touches
//   · first-time controls, the menu, settings, the time of day, Live Here
//
// Movement and looking never pass through React: the stick writes to the
// controller and moves its knob through a ref. React hears only what a
// person notices (the room changed, something came into reach).
//
// Shared by the editor and the public share viewer, so it takes a
// translate function over keys both bundles carry.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Footprints, Keyboard, Map as MapIcon, Maximize, MoreHorizontal, Moon, Mouse, Pause, Play, RotateCcw, Settings2, Sparkles, Sun, Sunset, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AimHint, SceneController, TimeOfDayEnv, WalkPose } from '@/components/designStudio/canvas/SceneController';
import type { WalkModel } from '@/lib/designStudio/navigation';
import type { SpaceModel } from '@/lib/designStudio/space';
import { roomShot } from '@/lib/designStudio/cameraDirector';
import { doorPointsFrom, planTour, type DoorPoint } from '@/lib/designStudio/tour';
import { DoorMarkers, PlanSheet, type MarkerHandle } from './TourNavigation';
import { DEFAULT_SETTINGS, normalizeSettings, type PlayerSettings, type Posture } from '@/lib/designStudio/player';
import {
  availableExperiences, planExperience, resolveStep, type Experience, type ResolvedStep, type SceneFacts,
} from '@/lib/designStudio/liveHere';
import type { ActionCode } from '@/lib/designStudio/interactions';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const SETTINGS_KEY = 'hm_walk_settings_v1';
const TUTORIAL_KEY = (touch: boolean) => `hm_walk_tutorial_v1_${touch ? 'touch' : 'desktop'}`;
const readStore = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const writeStore = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* private mode: fine */ } };

const ENVS: Array<{ id: TimeOfDayEnv; Icon: typeof Sun }> = [
  { id: 'DAY', Icon: Sun }, { id: 'SUNSET', Icon: Sunset }, { id: 'EVENING', Icon: Moon }, { id: 'NIGHT', Icon: Moon },
];

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const quiet = cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] font-medium text-white/85 ring-1 ring-white/20 hover:bg-white/10', ring);
const panel = 'pointer-events-auto rounded-2xl bg-[#0C1119]/95 p-5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur';
const primary = cn('inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-semibold text-[#0C1119] hover:bg-white/90', ring);
const secondary = cn('inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-medium text-white ring-1 ring-white/25 hover:bg-white/10', ring);

export interface WalkthroughOverlayProps {
  controller: SceneController | null;
  tr: Translate;
  rooms: Array<{ id: string; name: string }>;
  touch: boolean;
  onRoom: (roomId: string) => void;
  onReset: () => void;
  onExit: () => void;
  /** The exit button's words ("Exit walkthrough", or "Overview" on a share). */
  exitLabel: string;
  touring?: boolean;
  onTour?: () => void;
  onFullscreen?: () => void;
  /** Extra buttons in the top bar (the editor's Photo and Share). */
  actions?: React.ReactNode;
  /** The page hears which room the visitor is in (the guided tour continues from it). */
  onRoomChange?: (roomId: string | null) => void;
  /**
   * The whole-home tour: the space and the walk model of THIS walk. With them, the real doorways of the room the
   * visitor is in carry the names of the rooms behind them (reachable rooms only), Back and the plan appear, and
   * only reachable rooms are offered.
   */
  space?: SpaceModel | null;
  walkModel?: WalkModel | null;
}

const DOOR_HINT_MS = 7000;
const BACK_DEPTH = 24;

export function WalkthroughOverlay(props: WalkthroughOverlayProps) {
  const { controller: c, tr, rooms, touch } = props;
  const [room, setRoom] = useState<string | null>(null);
  const [aim, setAim] = useState<AimHint | null>(null);
  const [posture, setPosture] = useState<Posture>('STANDING');
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<null | 'CONTROLS' | 'SETTINGS' | 'LIVE' | 'TIME'>(null);
  const [tutorial, setTutorial] = useState(() => readStore(TUTORIAL_KEY(touch)) !== 'hidden');
  const [env, setEnv] = useState<TimeOfDayEnv>(() => c?.environment ?? 'DAY');
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    try { return normalizeSettings(JSON.parse(readStore(SETTINGS_KEY) ?? '{}')); } catch { return DEFAULT_SETTINGS; }
  });
  const menuOpenRef = useRef(false);
  const markers = useRef<MarkerHandle | null>(null);
  const goDoorRef = useRef<(d: DoorPoint) => void>(() => {});
  const roomChange = useRef(props.onRoomChange);
  roomChange.current = props.onRoomChange;
  menuOpenRef.current = menu || !!sheet || tutorial;

  // Attach to the running walk: the controller reports, React listens.
  useEffect(() => {
    if (!c) return;
    c.setPlayerSettings(settings);
    c.setWalkCallbacks({
      onRoom: (id) => { setRoom(id); roomChange.current?.(id); },
      onAim: setAim,
      onPosture: setPosture,
      onLock: setLocked,
      onMenu: () => { if (!menuOpenRef.current) setMenu(true); },
      // A click with the mouse captured lands at the screen centre: a doorway's name there is taken.
      onClickPoint: (x, y) => {
        if (menuOpenRef.current) return false;
        const d = markers.current?.at(x, y);
        if (!d) return false;
        goDoorRef.current(d);
        return true;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  const changeSettings = (next: Partial<PlayerSettings>) => {
    const s = normalizeSettings({ ...settings, ...next });
    setSettings(s);
    c?.setPlayerSettings(s);
    writeStore(SETTINGS_KEY, JSON.stringify(s));
  };

  const resume = useCallback(() => {
    setMenu(false);
    setSheet(null);
    // Back to looking with the mouse (this click is the gesture the browser needs).
    if (!touch) c?.lockPointer();
  }, [c, touch]);

  const closeTutorial = (forever: boolean) => {
    if (forever) writeStore(TUTORIAL_KEY(touch), 'hidden');
    setTutorial(false);
  };

  const chooseEnv = (e: TimeOfDayEnv) => {
    setEnv(e);
    c?.setEnvironment(e);
  };

  const live = useLiveHere(c);
  const roomName = room ? rooms.find((r) => r.id === room)?.name ?? null : null;

  // ── The whole-home tour ──
  const { space, walkModel } = props;
  const plan = useMemo(() => (space && walkModel ? planTour(space, walkModel, c?.camera.aspect ?? 16 / 9) : null), [space, walkModel, c]);
  const names = useMemo(() => new Map(rooms.map((r) => [r.id, r.name] as const)), [rooms]);
  const doors = useMemo(() => (plan ? doorPointsFrom(plan, room) : []), [plan, room]);
  const history = useRef<WalkPose[]>([]);
  const [canBack, setCanBack] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // The secondary actions, folded into one menu so the walk keeps the screen.
  const [more, setMore] = useState(false);
  const [doorHint, setDoorHint] = useState<'WAIT' | 'SHOW' | 'DONE'>('WAIT');
  // Where the visitor stood before a move: Back walks them there again.
  const remember = () => {
    const me = c?.playerState();
    if (!c || !me) return;
    history.current.push({ position: me.pos, target: { x: me.pos.x + Math.cos(me.yaw) * 2, y: me.pos.y + Math.sin(me.yaw) * 2 }, fov: c.camera.fov });
    if (history.current.length > BACK_DEPTH) history.current.shift();
    setCanBack(true);
  };
  const stopTour = () => { if (props.touring) props.onTour?.(); };
  const goDoor = (d: DoorPoint) => {
    if (!c) return;
    stopTour();
    remember();
    setDoorHint('DONE');
    void c.routeTo(d.landing, { through: true });
  };
  goDoorRef.current = goDoor;
  // A room from the chips or the plan: the same collision-safe route through the doors, at the doorway pace (a far
  // room is a few seconds away, never a slow trek); without the tour, the page's own way there.
  const goRoom = (id: string) => {
    remember();
    const pose = c && space && walkModel ? roomShot(space, walkModel, id, c.camera.aspect) : null;
    if (c && pose) { stopTour(); void c.routeTo(pose, { through: true }); } else props.onRoom(id);
  };
  const back = () => {
    const to = history.current.pop();
    setCanBack(history.current.length > 0);
    if (to && c) { stopTour(); void c.routeTo(to, { through: true }); }
  };
  const reset = () => { remember(); props.onReset(); };
  useEffect(() => {
    if (doorHint !== 'WAIT' || !doors.length) return undefined;
    setDoorHint('SHOW');
    const t = window.setTimeout(() => setDoorHint('DONE'), DOOR_HINT_MS);
    return () => window.clearTimeout(t);
  }, [doors.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const seated = posture === 'SEATED' || posture === 'LYING' || posture === 'SITTING_DOWN' || posture === 'LYING_DOWN';
  const overlayOpen = menu || !!sheet || tutorial;

  return (
    <>
      {/* ── Top: where you are, and the few things you might want ── */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-stretch gap-2">
        <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center gap-1.5 rounded-xl bg-[#0C1119]/80 px-3 py-1.5 text-white shadow-lg ring-1 ring-white/10 backdrop-blur sm:gap-2">
          <Footprints className="h-4 w-4 shrink-0 text-[hsl(38_92%_62%)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-[14px]" aria-live="polite">
            <span className="sr-only">{tr('ds_walk_title')} · </span>
            <span className="font-semibold">{roomName || tr('ds_walk_title')}</span>
          </p>
          {plan && space ? (
            <button type="button" onClick={() => { c?.releasePointer(); setMore(false); setPlanOpen((v) => !v); }} aria-pressed={planOpen} className={quiet} aria-label={tr('ds_walk_plan')} data-testid="walk-plan-open">
              <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{tr('ds_walk_plan')}</span>
            </button>
          ) : null}
          <div className="relative">
            <button type="button" onClick={() => { c?.releasePointer(); setMore((v) => !v); }} aria-expanded={more} aria-haspopup="true" className={quiet} aria-label={tr('ds_walk_more')} data-testid="walk-more">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            {more ? (
              <div role="group" aria-label={tr('ds_walk_more')} data-testid="walk-more-menu"
                onClick={(e) => { if ((e.target as HTMLElement).closest('button')) setMore(false); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMore(false); } }}
                className="absolute end-0 top-10 z-30 flex w-60 flex-col gap-0.5 rounded-xl bg-[#0C1119]/95 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur [&>button]:w-full [&>button]:justify-start [&>button]:ring-0 [&_span.hidden]:!inline [&_span.sr-only]:!hidden">
                {props.onTour ? (
                  <button type="button" onClick={props.onTour} aria-pressed={!!props.touring} className={quiet}>
                    {props.touring ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />}
                    <span>{props.touring ? tr('ds_walk_tour_pause') : tr('ds_walk_tour_play')}</span>
                  </button>
                ) : null}
                <button type="button" onClick={() => { c?.releasePointer(); setSheet('LIVE'); }} className={quiet} data-testid="walk-live">
                  <Sparkles className="h-3.5 w-3.5 text-[hsl(38_92%_62%)]" aria-hidden="true" />
                  <span>{tr('ds_live_title')}</span>
                </button>
                <button type="button" onClick={() => { c?.releasePointer(); setSheet('TIME'); }} className={quiet} data-testid="walk-time">
                  {React.createElement(ENVS.find((x) => x.id === env)?.Icon ?? Sun, { className: 'h-3.5 w-3.5', 'aria-hidden': true })}
                  <span>{tr('ds_env_title')}</span>
                </button>
                {plan ? (
                  <button type="button" onClick={back} disabled={!canBack} className={cn(quiet, 'disabled:opacity-40')} data-testid="walk-back">
                    <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
                    <span>{tr('ds_walk_back')}</span>
                  </button>
                ) : null}
                <button type="button" onClick={reset} className={quiet} data-testid="walk-entrance">
                  <RotateCcw className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
                  <span>{tr('ds_walk_reset')}</span>
                </button>
                <button type="button" onClick={() => { c?.releasePointer(); setSheet('CONTROLS'); }} className={quiet} data-testid="walk-controls">
                  <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{tr('ds_ctrl_help')}</span>
                </button>
                {props.onFullscreen ? (
                  <button type="button" onClick={props.onFullscreen} className={quiet}>
                    <Maximize className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tr('ds_walk_fullscreen')}</span>
                  </button>
                ) : null}
                {props.actions}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={props.onExit} className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-white px-2.5 text-[13px] font-semibold text-[#0C1119] hover:bg-white/90', ring)}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{props.exitLabel}</span>
            <span className="sr-only sm:hidden">{props.exitLabel}</span>
          </button>
        </div>
      </div>

      {/* ── The real doorways of this room, named after where they lead ── */}
      {plan ? (
        <DoorMarkers c={c} walk={walkModel ?? null} doors={doors} names={names} tr={tr} onGo={goDoor} handle={markers}
          hidden={overlayOpen || seated || !!live.run} />
      ) : null}
      {doorHint === 'SHOW' && !overlayOpen && !live.run ? (
        <p role="status" className="pointer-events-none absolute start-1/2 top-28 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-[#0C1119]/85 px-4 py-2 text-center text-[13px] text-white shadow-lg ring-1 ring-white/15 rtl:translate-x-1/2" data-testid="walk-door-hint">
          {tr('ds_walk_door_hint')}
        </p>
      ) : null}
      {planOpen && plan && space && !overlayOpen ? (
        <PlanSheet c={c} space={space} plan={plan} names={names} room={room} tr={tr}
          onRoom={(id) => { setPlanOpen(false); goRoom(id); }} onClose={() => setPlanOpen(false)} />
      ) : null}

      {/* ── The eye: a quiet centre point while the mouse is captured ── */}
      {locked && !overlayOpen ? (
        <span aria-hidden="true" className={cn('pointer-events-none absolute start-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/30 transition-all rtl:translate-x-1/2',
          aim ? 'h-2.5 w-2.5 bg-[hsl(38_92%_62%)]' : 'h-1.5 w-1.5 bg-white/90')} />
      ) : null}

      {/* ── What is in reach, and what you can do with it ── */}
      {!overlayOpen && (aim || seated) ? (
        <div className={cn('pointer-events-auto absolute start-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#0C1119]/85 py-1.5 pe-1.5 ps-3.5 text-[14px] text-white shadow-lg ring-1 ring-white/15 backdrop-blur rtl:translate-x-1/2',
          touch ? 'bottom-40' : 'bottom-16')} role="status" aria-live="polite" data-testid="walk-hint">
          {aim ? (
            <>
              <span className="truncate">{tr(`ds_ix_${aim.role.toLowerCase()}`)}</span>
              {aim.actions.slice(0, 3).map((a) => (
                <button key={a} type="button" onClick={() => { c?.performAimed(a); }} data-action={a}
                  className={cn('h-8 shrink-0 rounded-full bg-white px-3.5 text-[13px] font-semibold text-[#0C1119] hover:bg-white/90', ring)}>
                  {tr(`ds_act_${a}`)}
                </button>
              ))}
              {/* Seated and reaching for something (the TV from the sofa): getting up stays one tap away. */}
              {seated ? (
                <button type="button" onClick={() => c?.standIfSeated()} data-action="STAND_UP"
                  className={cn('h-8 shrink-0 rounded-full px-3 text-[13px] font-medium text-white ring-1 ring-white/30 hover:bg-white/10', ring)}>
                  {tr('ds_act_STAND_UP')}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <span className="truncate">{tr(posture === 'LYING' || posture === 'LYING_DOWN' ? 'ds_walk_lying' : 'ds_walk_seated')}</span>
              <button type="button" onClick={() => c?.standIfSeated()} data-action="STAND_UP"
                className={cn('h-8 shrink-0 rounded-full bg-white px-3.5 text-[13px] font-semibold text-[#0C1119] hover:bg-white/90', ring)}>
                {tr('ds_act_STAND_UP')}
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* ── Live Here: the moment in progress ── */}
      {live.run && !menu ? <LiveCard live={live} tr={tr} touch={touch} /> : null}

      {/* ── Touch: the left thumb walks ── */}
      {touch && !overlayOpen ? <StickZone controller={c} label={tr('ds_walk_joystick')} /> : null}

      {/* ── Desktop: how to start looking ── */}
      {!touch && !locked && !overlayOpen && !live.run ? (
        <p className="pointer-events-none absolute bottom-3 start-1/2 z-10 -translate-x-1/2 rounded-md bg-[#0C1119]/80 px-3 py-1.5 text-[13px] text-white/90 rtl:translate-x-1/2">
          {tr('ds_ctrl_click_to_look')}
        </p>
      ) : null}

      {/* ── First time here ── */}
      {tutorial ? <Tutorial tr={tr} touch={touch} onClose={closeTutorial} /> : null}
      {sheet === 'CONTROLS' ? <Tutorial tr={tr} touch={touch} onClose={() => setSheet(null)} again /> : null}

      {/* ── Esc: paused ── */}
      {menu && !sheet ? (
        <Dialog label={tr('ds_menu_title')} onClose={resume}>
          <h2 className="text-lg font-semibold">{tr('ds_menu_title')}</h2>
          <div className="mt-4 grid gap-2">
            <button type="button" className={primary} onClick={resume} autoFocus data-testid="walk-resume">{tr('ds_menu_resume')}</button>
            <button type="button" className={secondary} onClick={() => setSheet('LIVE')}><Sparkles className="h-4 w-4" aria-hidden="true" />{tr('ds_live_title')}</button>
            <button type="button" className={secondary} onClick={() => setSheet('CONTROLS')}><Keyboard className="h-4 w-4" aria-hidden="true" />{tr('ds_ctrl_help')}</button>
            <button type="button" className={secondary} onClick={() => setSheet('SETTINGS')}><Settings2 className="h-4 w-4" aria-hidden="true" />{tr('ds_menu_settings')}</button>
            <EnvPicker tr={tr} env={env} onChoose={chooseEnv} />
            <button type="button" className={secondary} onClick={() => { setMenu(false); props.onExit(); }}><X className="h-4 w-4" aria-hidden="true" />{props.exitLabel}</button>
          </div>
        </Dialog>
      ) : null}

      {sheet === 'SETTINGS' ? (
        <Dialog label={tr('ds_set_title')} onClose={() => setSheet(null)}>
          <h2 className="text-lg font-semibold">{tr('ds_set_title')}</h2>
          <div className="mt-4 grid gap-4 text-[14px]">
            <Slider label={tr('ds_set_look')} min={0.5} max={2} step={0.1} value={settings.lookSensitivity} onChange={(v) => changeSettings({ lookSensitivity: v })} />
            <Slider label={tr('ds_set_speed')} min={0.8} max={1.25} step={0.05} value={settings.speed} onChange={(v) => changeSettings({ speed: v })} />
            <Toggle label={tr('ds_set_invert')} checked={settings.invertY} onChange={(v) => changeSettings({ invertY: v })} />
            <Toggle label={tr('ds_set_invert_x')} checked={settings.invertX} onChange={(v) => changeSettings({ invertX: v })} />
            <Toggle label={tr('ds_set_reduced')} checked={settings.reducedMotion} onChange={(v) => changeSettings({ reducedMotion: v })} />
          </div>
          <button type="button" className={cn(primary, 'mt-5 w-full')} onClick={() => setSheet(null)}>{tr('ds_set_done')}</button>
        </Dialog>
      ) : null}

      {sheet === 'TIME' ? (
        <Dialog label={tr('ds_env_title')} onClose={() => setSheet(null)}>
          <h2 className="text-lg font-semibold">{tr('ds_env_title')}</h2>
          <div className="mt-4"><EnvPicker tr={tr} env={env} onChoose={(e) => { chooseEnv(e); setSheet(null); }} /></div>
        </Dialog>
      ) : null}

      {sheet === 'LIVE' ? (
        <Dialog label={tr('ds_live_title')} onClose={() => setSheet(null)}>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-5 w-5 text-[hsl(38_92%_62%)]" aria-hidden="true" />{tr('ds_live_title')}</h2>
          <p className="mt-1 text-[14px] text-white/70">{tr('ds_live_intro')}</p>
          <div className="mt-4 grid gap-2" data-testid="live-list">
            {live.available.length ? live.available.map((x) => (
              <button key={x.id} type="button" className={cn(secondary, 'justify-start')} data-experience={x.id}
                onClick={() => { setSheet(null); setMenu(false); live.start(x); }}>
                {tr(x.titleKey)}
              </button>
            )) : <p className="text-[14px] text-white/70">{tr('ds_live_none')}</p>}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────

function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/35 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className={cn(panel, 'w-full max-w-sm')}>{children}</div>
    </div>
  );
}

function EnvPicker({ tr, env, onChoose }: { tr: Translate; env: TimeOfDayEnv; onChoose: (e: TimeOfDayEnv) => void }) {
  return (
    <div role="radiogroup" aria-label={tr('ds_env_title')} className="grid grid-cols-4 gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/15">
      {ENVS.map(({ id, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={env === id} onClick={() => onChoose(id)} data-env={id}
          className={cn('inline-flex h-9 items-center justify-center gap-1 rounded-full text-2xs font-medium', ring,
            env === id ? 'bg-white text-[#0C1119]' : 'text-white/85 hover:bg-white/10')}>
          <Icon className={cn('h-3.5 w-3.5', id === 'NIGHT' ? 'fill-current' : '')} aria-hidden="true" />
          <span className="truncate">{tr(`ds_env_${id}`)}</span>
        </button>
      ))}
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const id = useMemo(() => `s-${label.replace(/\W+/g, '-')}`, [label]);
  return (
    <label htmlFor={id} className="grid gap-1.5">
      <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-white/60">{value.toFixed(2)}×</span></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[hsl(38_92%_56%)]" />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[hsl(38_92%_56%)]" />
    </label>
  );
}

function Key({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <kbd className={cn('inline-grid h-9 place-items-center rounded-lg bg-white/10 px-2 font-sans text-[13px] font-semibold text-white shadow-[inset_0_-2px_0_rgba(255,255,255,0.12)] ring-1 ring-white/25',
      wide ? 'min-w-[3.5rem]' : 'w-9')}>{children}</kbd>
  );
}

/** First-time controls (and the Controls sheet): shapes, not paragraphs. */
function Tutorial({ tr, touch, onClose, again }: { tr: Translate; touch: boolean; onClose: (forever: boolean) => void; again?: boolean }) {
  return (
    <Dialog label={tr('ds_ctrl_title')} onClose={() => onClose(false)}>
      <h2 className="text-lg font-semibold">{tr('ds_ctrl_title')}</h2>
      {touch ? (
        <div className="mt-4 grid grid-cols-2 gap-3 text-center text-[13px]" data-testid="tutorial-touch">
          <div className="grid justify-items-center gap-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
            <span className="relative grid h-16 w-16 place-items-center rounded-full ring-2 ring-white/40">
              <span className="h-7 w-7 animate-[pulse_1.6s_ease-in-out_infinite] rounded-full bg-white/85" />
            </span>
            <span className="font-semibold">{tr('ds_ctrl_left_thumb')}</span>
            <span className="text-white/70">{tr('ds_ctrl_move')}</span>
          </div>
          <div className="grid justify-items-center gap-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
            <span className="grid h-16 w-16 place-items-center"><span className="h-3 w-12 animate-[pulse_1.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-white/10 via-white/80 to-white/10" /></span>
            <span className="font-semibold">{tr('ds_ctrl_right_thumb')}</span>
            <span className="text-white/70">{tr('ds_ctrl_look')}</span>
          </div>
          <div className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
            <span className="h-4 w-4 rounded-full bg-[hsl(38_92%_62%)]" aria-hidden="true" />
            <span className="font-semibold">{tr('ds_ctrl_tap')}</span>
            <span className="text-white/70">· {tr('ds_ctrl_interact')}</span>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 text-[13px]" data-testid="tutorial-desktop">
          <Row keys={<><span className="grid grid-cols-3 gap-1"><span /><Key>W</Key><span /><Key>A</Key><Key>S</Key><Key>D</Key></span></>} text={tr('ds_ctrl_move')} />
          <Row keys={<span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/25"><Mouse className="h-4 w-4" aria-hidden="true" /></span>} text={tr('ds_ctrl_look')} />
          <Row keys={<Key wide>{tr('ds_ctrl_click')}</Key>} text={tr('ds_ctrl_interact')} />
          <Row keys={<Key wide>Shift</Key>} text={tr('ds_ctrl_faster')} />
          <Row keys={<Key wide>Esc</Key>} text={tr('ds_ctrl_menu')} />
          <p className="text-white/65">{tr('ds_ctrl_drag_part')}</p>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className={cn(primary, 'flex-1')} onClick={() => onClose(false)} autoFocus data-testid="tutorial-ok">{tr('ds_ctrl_got_it')}</button>
        {again ? null : <button type="button" className={secondary} onClick={() => onClose(true)} data-testid="tutorial-hide">{tr('ds_ctrl_dont_show')}</button>}
      </div>
    </Dialog>
  );
}

function Row({ keys, text }: { keys: React.ReactNode; text: string }) {
  return <div className="flex items-center gap-3"><span className="flex min-w-[7.5rem] justify-center">{keys}</span><span className="text-white/85">{text}</span></div>;
}

/**
 * The left-thumb stick: it appears where the thumb lands in the left part of
 * the screen and follows it; the knob moves through a ref, never React
 * state. A short tap without movement uses what it touched.
 */
function StickZone({ controller, label }: { controller: SceneController | null; label: string }) {
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<{ id: number; x: number; y: number; t: number; moved: number } | null>(null);
  const R = 46;

  const show = (x: number, y: number) => {
    const b = base.current;
    const rect = zone.current?.getBoundingClientRect();
    if (!b || !rect) return;
    b.style.display = 'grid';
    b.style.left = `${x - rect.left - 56}px`;
    b.style.top = `${y - rect.top - 56}px`;
  };
  const move = (e: React.PointerEvent) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    let dx = e.clientX - a.x;
    let dy = e.clientY - a.y;
    a.moved = Math.max(a.moved, Math.hypot(dx, dy));
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    controller?.setWalkStick(dx / R, dy / R);
  };
  const end = (e: React.PointerEvent) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    controller?.setWalkStick(0, 0);
    if (knob.current) knob.current.style.transform = 'translate(0px, 0px)';
    if (base.current) base.current.style.display = 'none';
    // A quick, still touch is a tap on what is under it; any stick movement is walking, never an interaction.
    if (a.moved < 6 && performance.now() - a.t < 300) controller?.tapAt(e.clientX, e.clientY);
  };

  return (
    <div ref={zone} role="application" aria-label={label} data-testid="stick-zone"
      // Physically LEFT in every language (RTL too): thumbs, like games, do not mirror.
      className="absolute bottom-0 left-0 top-28 z-10 w-[45%] touch-none select-none"
      onPointerDown={(e) => {
        if (active.current) return;
        active.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        show(e.clientX, e.clientY);
      }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div ref={base} className="pointer-events-none absolute hidden h-28 w-28 place-items-center rounded-full bg-[#0C1119]/30 ring-1 ring-white/35 backdrop-blur-sm" style={{ display: 'none' }}>
        <div ref={knob} className="h-12 w-12 rounded-full bg-white/85 shadow-md" />
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-6 left-6 h-16 w-16 rounded-full ring-1 ring-white/25" />
    </div>
  );
}

// ── Live Here: running an experience against the real scene ────────────

interface LiveRun {
  exp: Experience;
  index: number;
  total: number;
  status: 'WALKING' | 'READY' | 'BLOCKED' | 'FINISHED';
  step: ResolvedStep | null;
  /** Whether the step's action is on offer right now (coffee must brew before you drink). */
  enabled: boolean;
}

function facts(c: SceneController): SceneFacts {
  return { machines: c.interactiveStates(), seats: c.seatables() };
}

function useLiveHere(c: SceneController | null) {
  const [run, setRun] = useState<LiveRun | null>(null);
  const [available, setAvailable] = useState<Experience[]>([]);
  const cancelled = useRef(0);

  // What this home offers (recomputed when the list is opened or a run ends).
  useEffect(() => {
    if (!c) return;
    const from = c.playerState()?.pos ?? { x: 0, y: 0 };
    setAvailable(availableExperiences(facts(c), from));
  }, [c, run === null]);

  const stop = useCallback(() => { cancelled.current += 1; setRun(null); }, []);

  const start = useCallback(async (exp: Experience) => {
    if (!c) return;
    const token = ++cancelled.current;
    const alive = () => cancelled.current === token;
    const from = c.playerState()?.pos ?? { x: 0, y: 0 };
    const steps = planExperience(exp, facts(c), from);
    let prefer: string | null = null;
    for (let i = 0; i < steps.length && alive(); i += 1) {
      const here = c.playerState()?.pos ?? from;
      const r = resolveStep(steps[i], facts(c), here, prefer);
      if (!r) continue;
      if (r.kind === 'ENV') { c.setEnvironment(r.env); continue; }
      setRun({ exp, index: i, total: steps.length, status: 'WALKING', step: r, enabled: false });
      const arrived = await c.approach(r.kind === 'ACT' ? { key: r.key, objectId: r.objectId ?? undefined } : { objectId: r.objectId });
      if (!alive()) return;
      if (!arrived) { setRun({ exp, index: i, total: steps.length, status: 'BLOCKED', step: r, enabled: false }); return; }
      if (r.kind === 'ACT') {
        prefer = r.key;
        c.debugAim(r.key);
        const before = facts(c).machines.find((m) => m.key === r.key)?.state;
        // Wait for the visitor to take the step (the card's button, E, a tap, a drag).
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (!alive()) return resolve();
            const m = facts(c).machines.find((x) => x.key === r.key);
            const enabled = !!m?.actions.includes(r.action);
            setRun((cur) => (cur && cur.exp === exp ? { ...cur, status: 'READY', step: r, enabled } : cur));
            if (m && m.state !== before && !m.actions.includes(r.action)) return resolve();
            window.setTimeout(tick, 250);
          };
          tick();
        });
      } else {
        setRun({ exp, index: i, total: steps.length, status: 'READY', step: r, enabled: true });
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (!alive()) return resolve();
            const p = c.playerState()?.posture;
            if (p === 'SEATED' || p === 'LYING') return resolve();
            window.setTimeout(tick, 250);
          };
          tick();
        });
      }
    }
    if (!alive()) return;
    setRun({ exp, index: steps.length, total: steps.length, status: 'FINISHED', step: null, enabled: false });
    window.setTimeout(() => { if (alive()) setRun(null); }, 3500);
  }, [c]);

  const act = useCallback(() => {
    const r = run?.step;
    if (!c || !r) return;
    if (r.kind === 'ACT') c.act(r.key, r.action);
    else if (r.kind === 'SEAT') c.sitOn(r.objectId, r.posture);
  }, [c, run]);

  return { run, available, start, stop, act };
}

function LiveCard({ live, tr, touch }: { live: ReturnType<typeof useLiveHere>; tr: Translate; touch: boolean }) {
  const r = live.run!;
  const step = r.step;
  const actionLabel = (a: ActionCode) => tr(`ds_act_${a}`);
  return (
    <div className={cn('pointer-events-auto absolute end-3 z-20 w-72 max-w-[calc(100%-1.5rem)] rounded-2xl bg-[#0C1119]/95 p-4 text-white shadow-xl ring-1 ring-white/10 backdrop-blur',
      touch ? 'top-28' : 'bottom-16')} role="status" aria-live="polite" data-testid="live-card" data-status={r.status}>
      <p className="flex items-center gap-2 text-[13px] font-semibold text-[hsl(38_92%_62%)]"><Sparkles className="h-4 w-4" aria-hidden="true" />{tr(r.exp.titleKey)}</p>
      {r.status === 'FINISHED' ? (
        <p className="mt-2 text-[15px]">{tr('ds_live_finished')}</p>
      ) : (
        <>
          <p className="mt-1 text-2xs text-white/60">{tr('ds_live_step', { n: r.index + 1, total: r.total })}</p>
          {r.status === 'WALKING' ? <p className="mt-2 text-[15px]">{tr('ds_live_walking')}</p> : null}
          {r.status === 'BLOCKED' ? <p className="mt-2 text-[15px]">{tr('ds_live_blocked')}</p> : null}
          {r.status === 'READY' && step && step.kind !== 'ENV' ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate text-[15px]">{step.kind === 'ACT' ? tr(`ds_ix_${step.role.toLowerCase()}`) : tr('ds_ix_seat')}</span>
              <button type="button" disabled={!r.enabled} onClick={live.act} data-testid="live-act"
                className={cn('h-9 shrink-0 rounded-full bg-white px-4 text-[13px] font-semibold text-[#0C1119] hover:bg-white/90 disabled:opacity-50', ring)}>
                {step.kind === 'ACT' ? actionLabel(step.action) : actionLabel(step.posture === 'LIE' ? 'LIE_DOWN' : 'SIT')}
              </button>
            </div>
          ) : null}
          <button type="button" onClick={live.stop} className={cn('mt-3 text-[13px] text-white/70 underline-offset-2 hover:underline', ring)}>{tr('ds_live_stop')}</button>
        </>
      )}
    </div>
  );
}

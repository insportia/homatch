// HOMATCH — A SHARED HOME, FOR ANYONE WITH THE LINK.
//
// A standalone presentation of ONE frozen design: no account, no editor, no
// dashboard, nothing that can change anything. It reads exactly one public
// function (ds_public_share) with the link's token and renders the result
// with the same engine the owner designed in: real walls and openings, the
// frozen furniture and materials, the Camera Director's shots and tour, and
// the same collision-safe walkthrough.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Footprints, Globe, Home, Loader2 } from 'lucide-react';
import { SceneController } from '@/components/designStudio/canvas/SceneController';
import { WalkthroughOverlay } from '@/components/designStudio/workspace/WalkthroughOverlay';
import { assetFromRow, materialFromRow, type CatalogAsset, type CatalogMaterial } from '@/lib/designStudio/catalog';
import { entryShot, roomGraph, roomShot, tourOrder } from '@/lib/designStudio/cameraDirector';
import { normalizeDesignState, type DesignState } from '@/lib/designStudio/designState';
import { summarizeDesign } from '@/lib/designStudio/designSummary';
import { buildWalkModel, type WalkModel } from '@/lib/designStudio/navigation';
import { chooseQuality, readDeviceSignals } from '@/lib/designStudio/quality';
import { buildSpaceModel, type SpaceModel } from '@/lib/designStudio/space';
import type { GeneratedScene } from '@/lib/floorplan/geometry';
import { cn } from '@/lib/utils';
import { SHARE_LANGS, SHARE_STRINGS, type ShareLang } from './strings';

const LANG_KEY = 'homatch_lang';
const RTL = new Set<ShareLang>(['ar', 'he']);
const LANG_NAMES: Record<ShareLang, string> = { en: 'English', ka: 'ქართული', ru: 'Русский', tr: 'Türkçe', ar: 'العربية', he: 'עברית' };
const TOUR_STEP_MS = 7000;
const TOUR_GLIDE_MS = 2400;

type Status = 'REVOKED' | 'EXPIRED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'ERROR';

interface SharePayload {
  status: 'ACTIVE';
  shareType: 'WALKTHROUGH' | 'DESIGN';
  title: string;
  geometryState: string | null;
  scene: GeneratedScene;
  state: unknown;
  assets: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
}

/** /w/<token> (walkthrough) or /d/<token> (design), or ?w=<token> where a host has no rewrite. */
export function tokenFromLocation(loc: Pick<Location, 'pathname' | 'search'> = window.location): string | null {
  const m = /^\/[wd]\/([A-Za-z0-9_-]{43})\/?$/.exec(loc.pathname);
  if (m) return m[1];
  const q = new URLSearchParams(loc.search).get('w');
  return q && /^[A-Za-z0-9_-]{43}$/.test(q) ? q : null;
}

function initialLang(): ShareLang {
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored && (SHARE_LANGS as readonly string[]).includes(stored)) return stored as ShareLang;
  } catch { /* storage blocked: fall through */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return (SHARE_LANGS as readonly string[]).includes(nav) ? nav as ShareLang : 'en';
}

async function fetchShare(token: string): Promise<SharePayload | { status: Status }> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/ds_public_share`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) return { status: 'ERROR' };
    const body = await res.json() as { status?: string };
    if (body?.status === 'ACTIVE') return body as SharePayload;
    if (body?.status === 'REVOKED' || body?.status === 'EXPIRED' || body?.status === 'NOT_FOUND' || body?.status === 'UNAVAILABLE') {
      return { status: body.status };
    }
    return { status: 'ERROR' };
  } catch {
    return { status: 'ERROR' };
  }
}

const KIND_KEY: Record<string, string> = {
  LIVING: 'ds_room_living', BEDROOM: 'ds_room_bedroom', KITCHEN: 'ds_room_kitchen', BATHROOM: 'ds_room_bathroom', WC: 'ds_room_wc',
  HALL: 'ds_room_hall', CORRIDOR: 'ds_room_corridor', STORAGE: 'ds_room_storage', BALCONY: 'ds_room_balcony', TERRACE: 'ds_room_terrace',
};

export function ShareViewer() {
  const [lang, setLang] = useState<ShareLang>(initialLang);
  const say = useCallback((k: string) => SHARE_STRINGS[lang][k] ?? SHARE_STRINGS.en[k] ?? k, [lang]);
  const token = useMemo(() => tokenFromLocation(), []);
  const [load, setLoad] = useState<{ phase: 'LOADING' } | { phase: 'STATE'; status: Status } | { phase: 'READY'; data: SharePayload }>({ phase: 'LOADING' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    try { window.localStorage.setItem(LANG_KEY, lang); } catch { /* not remembered, still shown */ }
  }, [lang]);

  useEffect(() => {
    if (!token) { setLoad({ phase: 'STATE', status: 'NOT_FOUND' }); return; }
    let live = true;
    setLoad({ phase: 'LOADING' });
    fetchShare(token).then((r) => {
      if (!live) return;
      if (r.status === 'ACTIVE') setLoad({ phase: 'READY', data: r as SharePayload });
      else setLoad({ phase: 'STATE', status: r.status as Status });
    });
    return () => { live = false; };
  }, [token, attempt]);

  const picker = <LanguagePicker lang={lang} onLang={setLang} label={say('share_language')} />;

  if (load.phase === 'LOADING') {
    return (
      <Screen>
        {picker}
        <Brand />
        <p className="mt-6 flex items-center gap-2 text-[15px] text-white/80" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{say('share_loading')}
        </p>
      </Screen>
    );
  }
  if (load.phase === 'STATE') {
    const k = load.status.toLowerCase();
    return (
      <Screen>
        {picker}
        <Brand />
        <h1 className="mt-8 max-w-md text-center font-display text-2xl font-semibold text-white">{say(`share_${k}_title`)}</h1>
        <p className="mt-2 max-w-md text-center text-[15px] leading-relaxed text-white/70">{say(`share_${k}_body`)}</p>
        {load.status === 'ERROR' ? (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-6 h-11 rounded-lg bg-white px-5 text-[15px] font-semibold text-[#0C1119]">{say('share_retry')}</button>
        ) : null}
      </Screen>
    );
  }
  return <Presentation data={load.data} say={say} picker={picker} />;
}

function Presentation({ data, say, picker }: { data: SharePayload; say: (k: string) => string; picker: React.ReactNode }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const walkRef = useRef<WalkModel | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [walking, setWalking] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const [touring, setTouring] = useState(false);
  // What the visitor points at. Opening things here is temporary: it never
  // reaches the shared design, and a reload starts from the frozen state.
  const [aim, setAim] = useState<{ role: string; open: boolean } | null>(null);

  const space: SpaceModel = useMemo(() => buildSpaceModel(data.scene), [data.scene]);
  const state: DesignState = useMemo(() => normalizeDesignState(data.state), [data.state]);
  const assets = useMemo(() => new Map<string, CatalogAsset>(data.assets.map((r) => { const a = assetFromRow(r); return [a.code, a]; })), [data.assets]);
  const materials = useMemo(() => new Map<string, CatalogMaterial>(data.materials.map((r) => { const m = materialFromRow(r); return [m.id, m]; })), [data.materials]);
  const tour = useMemo(() => tourOrder(space, roomGraph(space)), [space]);
  const names = useMemo(() => {
    const count = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const r of space.rooms) count.set(r.kind, (count.get(r.kind) ?? 0) + 1);
    return new Map(space.rooms.map((r) => {
      const n = (seen.get(r.kind) ?? 0) + 1;
      seen.set(r.kind, n);
      const base = say(KIND_KEY[r.kind] ?? 'ds_room_unknown');
      return [r.id, (count.get(r.kind) ?? 0) > 1 ? `${base} ${n}` : base] as const;
    }));
  }, [space, say]);
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => { document.title = `${data.title} · HOMATCH`; }, [data.title]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let controller: SceneController;
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('no webgl');
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      controller = new SceneController(mount, chooseQuality(readDeviceSignals()), { reducedMotion: reduced });
    } catch {
      setWebgl(false);
      return undefined;
    }
    controller.loadSpace(space);
    controller.applyDesign(state, assets, materials);
    controller.frameAll(false);
    controllerRef.current = controller;
    if (import.meta.env.MODE === 'harness') (window as unknown as { __dsScene?: SceneController }).__dsScene = controller;
    walkRef.current = buildWalkModel(space, state.objects, assets);
    return () => { controller.dispose(); controllerRef.current = null; };
  }, [space, state, assets, materials]);

  const aspect = () => controllerRef.current?.camera.aspect ?? 16 / 9;
  const isDesign = data.shareType === 'DESIGN';
  const summary = useMemo(() => summarizeDesign(state, space, assets, materials), [state, space, assets, materials]);
  const [focus, setFocus] = useState<string | null>(null);
  const focusOn = (id: string | null) => {
    setFocus(id);
    const c = controllerRef.current;
    const r = id ? space.rooms.find((x) => x.id === id) : null;
    if (c) { if (r) c.focusRoom(r); else c.frameAll(); }
  };
  const enter = (roomId: string | null = null) => {
    const c = controllerRef.current;
    const walk = walkRef.current;
    if (!c || !walk) return;
    const pose = roomId ? roomShot(space, walk, roomId, aspect()) : entryShot(space, walk, aspect());
    if (!pose) return;
    c.enterWalkthrough(walk, pose, setRoom, setAim);
    setWalking(true);
  };
  const leave = () => {
    controllerRef.current?.exitWalkthrough();
    const r = focus ? space.rooms.find((x) => x.id === focus) : null;
    if (r) controllerRef.current?.focusRoom(r); else controllerRef.current?.frameAll();
    setWalking(false);
    setTouring(false);
    setAim(null);
  };
  const goRoom = (id: string, glide = 0) => {
    const c = controllerRef.current;
    const walk = walkRef.current;
    if (!c || !walk) return;
    const pose = roomShot(space, walk, id, aspect());
    if (pose) c.walkTo(pose, glide);
  };

  // The guided tour: the Camera Director's rooms, in the order a visitor
  // meets them, gliding from one shot to the next. Any input takes over.
  useEffect(() => {
    if (!touring || !walking) return undefined;
    let i = Math.max(0, tour.indexOf(room ?? '') + 1);
    const step = () => { goRoom(tour[i % tour.length], TOUR_GLIDE_MS); i += 1; };
    step();
    const timer = setInterval(step, TOUR_STEP_MS);
    const stop = (e: Event) => {
      if (e instanceof KeyboardEvent && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      setTouring(false);
    };
    window.addEventListener('keydown', stop);
    mountRef.current?.addEventListener('pointerdown', stop);
    const mount = mountRef.current;
    return () => { clearInterval(timer); window.removeEventListener('keydown', stop); mount?.removeEventListener('pointerdown', stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touring, walking, tour]);

  return (
    <div className="fixed inset-0 bg-[#0C1119] text-white">
      <div ref={mountRef} className="absolute inset-0" role="application" aria-label={data.title} />
      {!webgl ? (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-[15px] text-white/85">{say('share_webgl')}</div>
      ) : null}

      {walking ? (
        <WalkthroughOverlay
          labels={{
            title: say('ds_walk_title'), reset: say('ds_walk_reset'), exit: say('share_overview'), rooms: say('ds_walk_rooms'),
            joystick: say('ds_walk_joystick'), helpKeys: say('share_help_keys'),
            tourPlay: say('share_tour_play'), tourPause: say('share_tour_pause'), fullscreen: say('share_fullscreen'),
            open: say('share_open'), close: say('share_close'),
            roles: { DOOR: say('share_ix_door'), WINDOW: say('share_ix_window'), WARDROBE: say('share_ix_wardrobe'), CABINET: say('share_ix_cabinet'), DRAWER: say('share_ix_drawer'), APPLIANCE: say('share_ix_appliance') },
          }}
          aim={aim}
          onInteract={() => controllerRef.current?.toggleAimed()}
          roomName={room ? names.get(room) ?? null : null}
          rooms={tour.map((id) => ({ id, name: names.get(id) ?? '' }))}
          currentRoomId={room}
          touch={touch || window.innerWidth < 768}
          onRoom={(id) => { setTouring(false); goRoom(id); }}
          onReset={() => { setTouring(false); const c = controllerRef.current; const w = walkRef.current; const p = w ? entryShot(space, w, aspect()) : null; if (c && p) c.walkTo(p); }}
          onExit={leave}
          onStick={(x, y) => controllerRef.current?.setWalkStick(x, y)}
          touring={touring}
          onTour={() => setTouring((v) => !v)}
          onFullscreen={canFullscreen ? () => { void document.documentElement.requestFullscreen?.().catch(() => {}); } : undefined}
        />
      ) : webgl && isDesign ? (
        <DesignPanel
          title={data.title}
          estimated={data.geometryState === 'ESTIMATED'}
          say={say}
          rooms={tour.map((id) => ({ id, name: names.get(id) ?? '' }))}
          summary={summary}
          focus={focus}
          onFocus={focusOn}
          onWalk={(id) => enter(id)}
        />
      ) : webgl ? (
        <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-[#0C1119] via-[#0C1119]/85 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-24">
          <div className="w-full max-w-xl text-center">
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_62%)]">{say('share_brand_line')}</p>
            <h1 className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">{data.title}</h1>
            {data.geometryState === 'ESTIMATED' ? <p className="mt-2 text-[14px] text-white/65">{say('share_estimated')}</p> : null}
            <button type="button" onClick={() => enter()}
              className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-[16px] font-semibold text-[#0C1119] shadow-lg hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
              <Footprints className="h-5 w-5" aria-hidden="true" />{say('share_enter')}
            </button>
            <p className="mt-4 text-2xs text-white/50">{say('share_preview_note')}</p>
          </div>
        </div>
      ) : null}
      {!walking ? picker : null}
      {!walking ? <div className="absolute start-4 top-4"><Brand small /></div> : null}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-[#0C1119] px-6 text-white">{children}</main>;
}

function Brand({ small = false }: { small?: boolean }) {
  return (
    <p className={cn('font-display font-semibold tracking-[0.28em] text-white/90', small ? 'text-[13px]' : 'text-[18px]')} aria-label="HOMATCH">
      HOMATCH
    </p>
  );
}

function LanguagePicker({ lang, onLang, label }: { lang: ShareLang; onLang: (l: ShareLang) => void; label: string }) {
  return (
    <label className="absolute end-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[13px] text-white ring-1 ring-white/20 backdrop-blur">
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={lang} onChange={(e) => onLang(e.target.value as ShareLang)} className="bg-transparent text-[13px] text-white outline-none [&>option]:text-[#0C1119]">
        {SHARE_LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
      </select>
    </label>
  );
}

/**
 * THE DESIGN PRESENTATION: the home in 3D (drag to turn), each room's
 * finishes and furniture, and a way in at eye level. Nothing can be edited.
 */
function DesignPanel({
  title, estimated, say, rooms, summary, focus, onFocus, onWalk,
}: {
  title: string;
  estimated: boolean;
  say: (k: string) => string;
  rooms: Array<{ id: string; name: string }>;
  summary: ReturnType<typeof summarizeDesign>;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onWalk: (roomId: string | null) => void;
}) {
  const room = focus ? summary.rooms.find((r) => r.roomId === focus) : null;
  const finish = (label: string, f: { color: string | null; materialName: string | null } | null) => (
    <div className="flex items-center gap-2 text-[14px]">
      <span className="w-20 shrink-0 text-white/60">{label}</span>
      {f?.color ? <span className="h-5 w-5 shrink-0 rounded ring-1 ring-white/25" style={{ backgroundColor: f.color }} aria-hidden="true" /> : null}
      <span className="min-w-0 truncate">{f ? (f.materialName ?? f.color) : say('share_unchanged')}</span>
    </div>
  );
  return (
    <aside
      aria-label={say('share_details')}
      className="absolute inset-x-0 bottom-0 max-h-[52dvh] overflow-y-auto rounded-t-2xl bg-[#0C1119]/92 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 ring-1 ring-white/10 backdrop-blur md:top-16 md:bottom-4 md:end-4 md:start-auto md:max-h-none md:w-[22rem] md:rounded-2xl"
    >
      <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_62%)]">{say('share_brand_line')}</p>
      <h1 className="mt-1 font-display text-2xl font-semibold leading-tight">{title}</h1>
      {estimated ? <p className="mt-1 text-[13px] text-white/60">{say('share_estimated')}</p> : null}
      {summary.palette.length ? (
        <div className="mt-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-white/55">{say('share_palette')}</p>
          <div className="mt-1.5 flex gap-1" aria-hidden="true">
            {summary.palette.map((c) => <span key={c} className="h-5 flex-1 rounded ring-1 ring-white/20" style={{ backgroundColor: c }} />)}
          </div>
        </div>
      ) : null}
      <nav aria-label={say('ds_walk_rooms')} className="mt-4 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onFocus(null)} aria-pressed={!focus}
          className={cn('inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium ring-1', !focus ? 'bg-white text-[#0C1119] ring-white' : 'text-white ring-white/25 hover:bg-white/10')}>
          <Home className="h-3.5 w-3.5" aria-hidden="true" />{say('share_whole_home')}
        </button>
        {rooms.map((r) => (
          <button key={r.id} type="button" onClick={() => onFocus(r.id)} aria-pressed={focus === r.id}
            className={cn('h-8 rounded-full px-3 text-[13px] font-medium ring-1', focus === r.id ? 'bg-white text-[#0C1119] ring-white' : 'text-white ring-white/25 hover:bg-white/10')}>
            {r.name}
          </button>
        ))}
      </nav>
      {room ? (
        <section className="mt-4 space-y-2" aria-label={rooms.find((r) => r.id === room.roomId)?.name}>
          {finish(say('share_walls'), room.walls)}
          {finish(say('share_floor'), room.floor)}
          <div className="text-[14px]">
            <p className="text-white/60">{say('share_furniture')}</p>
            {room.furniture.length ? (
              <ul className="mt-1 space-y-0.5">
                {room.furniture.map((f) => <li key={f.name}>{f.count > 1 ? `${f.name} × ${f.count}` : f.name}</li>)}
              </ul>
            ) : <p className="mt-1 text-white/50">{say('share_no_furniture')}</p>}
          </div>
        </section>
      ) : (
        <p className="mt-4 text-[13px] text-white/55">{say('share_design_hint')}</p>
      )}
      <button type="button" onClick={() => onWalk(room ? room.roomId : null)}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-[#0C1119] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
        <Footprints className="h-4 w-4" aria-hidden="true" />{say(room ? 'share_walk_room' : 'share_enter')}
      </button>
      <p className="mt-3 text-2xs text-white/45">{say('share_preview_note')}</p>
    </aside>
  );
}

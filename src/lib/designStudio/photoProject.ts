// Design Studio — A PHOTO PROJECT, as the browser sees it.
//
// The server reads all of a project's photos once (design-studio-reconstruct/
// photos → photoRead.ts) and stores the understanding on the reconstruction
// row. These are its shapes (mirrored from the server's photoRead.ts; the
// server validates, the browser only reads) and the flow record the page
// keeps beside it (corrections.flow), so a reload, a closed tab or another
// device resumes on the right screen.

export type PhotoRoomKind =
  | 'LIVING' | 'KITCHEN' | 'KITCHEN_LIVING' | 'DINING' | 'BEDROOM' | 'KIDS_ROOM' | 'BATHROOM' | 'WC' | 'HALL' | 'CORRIDOR'
  | 'OFFICE' | 'WARDROBE' | 'LAUNDRY' | 'BALCONY' | 'TERRACE' | 'STAIRCASE' | 'STUDIO' | 'COMMERCIAL' | 'OTHER';

export interface PhotoQuestion {
  id: string;
  kind: 'ROOM_PURPOSE' | 'SAME_ROOM' | 'KEEP_ELEMENT';
  question: string;
  options: Array<{ id: string; label: string }>;
  suggested: string;
  roomId: string | null;
  photos: number[];
}

export interface PhotoRoom {
  id: string;
  kind: PhotoRoomKind;
  label: string;
  photos: number[];
  primaryPhoto: number;
  fixed: string[];
  condition: string;
  confidence: number;
}

export interface PhotoUnderstanding {
  kind: 'PHOTO_UNDERSTANDING';
  version: string;
  usable: boolean;
  unusable: string | null;
  summary: string;
  rooms: PhotoRoom[];
  photos: Array<{ index: number; roomId: string | null; usable: boolean; unusable: string | null }>;
  questions: PhotoQuestion[];
  heroRoomId: string | null;
}

export interface PhotoAnswer { questionId: string; value: string }

/** Where the customer is, kept on the reconstruction (corrections.flow). */
export interface PhotoFlowRecord {
  kind: 'PHOTOS';
  step: 'READING' | 'QUESTION' | 'STYLE' | 'QUALITY' | 'GENERATING' | 'DONE';
  answers: PhotoAnswer[];
  look?: { style: string; quality: string } | null;
  /** The design run's key (designRun.ts): the same key is the same design, never paid twice. */
  runKey?: string | null;
  confirmedCredits?: number | null;
  specJobId?: string | null;
  designVersionId?: string | null;
  masterRenderId?: string | null;
  masterAttempt?: number | null;
  startedAt?: string | null;
}

export const isPhotoUnderstanding = (v: unknown): v is PhotoUnderstanding =>
  !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'PHOTO_UNDERSTANDING' && Array.isArray((v as { rooms?: unknown }).rooms);

/** The questions still to ask, in order (one at a time). */
export function openQuestions(u: PhotoUnderstanding | null, answers: PhotoAnswer[]): PhotoQuestion[] {
  if (!u) return [];
  const done = new Set(answers.map((a) => a.questionId));
  return u.questions.filter((q) => !done.has(q.id));
}

/** Rooms other than the one already designed, in the order the photos showed them. */
export function otherRooms(u: PhotoUnderstanding | null, designedRoomIds: string[]): PhotoRoom[] {
  if (!u) return [];
  const done = new Set(designedRoomIds);
  return u.rooms.filter((r) => !done.has(r.id));
}

/** The room the first design shows. */
export const heroRoom = (u: PhotoUnderstanding | null): PhotoRoom | null =>
  (u ? u.rooms.find((r) => r.id === u.heroRoomId) ?? u.rooms[0] ?? null : null);

/** The step a resumed project opens on, from what the SERVER has (never restarting finished work). */
export function resumeStep(input: {
  status: 'QUEUED' | 'READING' | 'READ' | 'FAILED' | 'BUILT';
  understood: boolean;
  flow: PhotoFlowRecord | null;
  questionsLeft: number;
}): PhotoFlowRecord['step'] | 'FAILED' {
  if (input.flow?.step === 'DONE') return 'DONE';
  if (input.flow?.step === 'GENERATING') return 'GENERATING';
  if (input.status === 'FAILED' && !input.understood) return 'FAILED';
  if (!input.understood) return 'READING';
  if (input.questionsLeft > 0) return 'QUESTION';
  if (input.flow?.step === 'QUALITY') return 'QUALITY';
  return 'STYLE';
}

const ROOM_KEYS = new Set(['balcony', 'bathroom', 'bedroom', 'corridor', 'hall', 'kitchen', 'living', 'storage', 'terrace', 'wc']);
const ROOM_ALIAS: Record<string, string> = { kitchen_living: 'living', dining: 'living', kids_room: 'bedroom', wardrobe: 'storage', laundry: 'storage' };
/** The translation key for a room's kind (a kind with no word of its own reads as a room). */
export function roomKindKey(kind: string): string {
  const k = kind.toLowerCase();
  const word = ROOM_ALIAS[k] ?? k;
  return `ds_room_${ROOM_KEYS.has(word) ? word : 'unknown'}`;
}

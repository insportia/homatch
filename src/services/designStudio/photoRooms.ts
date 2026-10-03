// Design Studio — THE ROOMS OF A WHOLE-HOME PHOTO, FOUND AGAIN.
//
// A photo project read before whole-home views were understood has one room
// for a picture that shows the whole flat. The server reads the same photos
// once more (nothing is uploaded again) and, when it finds more rooms, gives
// the design a child version on the new reading; asking again is the same
// child, never a second reading.
//
//   design-studio-reconstruct/photo-rooms { projectId, language }
//     → { state: 'DONE', rooms, versionId } | { state: 'SAME', rooms }

import { supabase } from '@/db/supabase';

export type PhotoRoomsAnswer = { state: 'DONE' | 'SAME'; rooms: number | null } | { error: string };

export async function findPhotoRooms(projectId: string, language: string): Promise<PhotoRoomsAnswer> {
  const { data, error } = await supabase.functions.invoke('design-studio-reconstruct/photo-rooms', { body: { projectId, language } });
  if (error) {
    try {
      const b = await (error as { context?: Response }).context?.json?.();
      return { error: String(b?.error ?? 'FAILED') };
    } catch { return { error: 'FAILED' }; }
  }
  const d = data as { state?: string; rooms?: number | null } | null;
  return d?.state === 'DONE' || d?.state === 'SAME' ? { state: d.state, rooms: d.rooms ?? null } : { error: 'FAILED' };
}

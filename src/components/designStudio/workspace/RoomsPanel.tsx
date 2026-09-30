import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SpaceModel } from '@/lib/designStudio/space';
import type { GeometryState } from '@/lib/designStudio/types';
import { cn } from '@/lib/utils';
import { formatArea } from './labels';

/** The rooms of the space, as a list: the keyboard route to everything the plan offers. */
export function RoomsPanel({
  space, names, state, activeRoomId, onRoom,
}: {
  space: SpaceModel | null;
  names: Map<string, string>;
  state: GeometryState;
  activeRoomId: string | null;
  onRoom: (roomId: string) => void;
}) {
  const { t } = useLanguage();
  if (!space) {
    return <p className="px-4 py-4 text-[14px] leading-relaxed text-[#4A5263]">{t('ds_rooms_unavailable_model')}</p>;
  }
  return (
    <ul className="px-2 py-2" aria-label={t('ds_panel_rooms')}>
      {space.rooms.map((room) => {
        const active = room.id === activeRoomId;
        return (
          <li key={room.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onRoom(room.id)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-start text-[15px] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                active ? 'bg-[hsl(41_88%_91%)] font-semibold text-[#0C1119]' : 'text-[#0C1119] hover:bg-[#F4F5F7]',
              )}
            >
              <span className="min-w-0 break-words">{names.get(room.id)}</span>
              <span className="shrink-0 text-[13px] font-normal text-[#4A5263]">{formatArea(room.areaM2, state, t)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

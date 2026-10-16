/*
 * Georgian portal labels for building status and condition, as SS.ge and MyHome print
 * them. A label not listed here stays unknown: nothing is guessed from a near miss.
 *
 * SS.ge sent these labels from the start but the adapter kept them only as evidence text
 * (production search f5121176, 2026-10-11: 94 SS.ge listings, every one with
 * buildingStatus null although 94/94 carried "ძველი/ახალი აშენებული" or "მშენებარე").
 * The normaliser reads them from that evidence too, so listings already in the shared
 * pool get their facts without a new source request.
 */
import type { BuildingStatus, RenovationStatus } from './taxonomy.ts';

const fold = (label: unknown) => (typeof label === 'string' ? label.trim().replace(/\s+/g, ' ') : '');

const BUILDING: Record<string, BuildingStatus> = {
  'ძველი აშენებული': 'OLD_BUILD',
  'ახალი აშენებული': 'NEW_BUILD',
  'მშენებარე': 'UNDER_CONSTRUCTION',
};

/* "მიმდინარე რემონტი" (renovation under way) is deliberately absent: it is neither finished nor a frame. */
const CONDITION: Record<string, RenovationStatus> = {
  'ახალი რემონტით': 'RENOVATED',
  'ძველი რემონტით': 'RENOVATED',
  'გარემონტებული': 'RENOVATED',
  'ახალი გარემონტებული': 'RENOVATED',
  'ძველი გარემონტებული': 'RENOVATED',
  'თეთრი კარკასი': 'WHITE_FRAME',
  'თეთრი პლიუსი': 'WHITE_FRAME',
  'მწვანე კარკასი': 'GREEN_FRAME',
  'შავი კარკასი': 'BLACK_FRAME',
  'სარემონტო': 'NEEDS_RENOVATION',
};

export const buildingStatusFromLabel = (label: unknown): BuildingStatus | null => BUILDING[fold(label)] ?? null;
export const renovationStatusFromLabel = (label: unknown): RenovationStatus | null => CONDITION[fold(label)] ?? null;

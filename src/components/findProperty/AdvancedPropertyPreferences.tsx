import type { SearchSummary } from '@/services/marketplaceSearch';
import type { T } from './format';

type AdvancedPreferences = { floorPreferences: SearchSummary['brief']['floorPreferences']; floorRange: SearchSummary['brief']['floorRange']; maxBuildingAge: number | null; elevatorRequired: boolean };

export function AdvancedPropertyPreferences({ brief, onAdvanced, onOlderBuildings, t }: { brief: SearchSummary['brief']; onAdvanced: (value: AdvancedPreferences) => void; onOlderBuildings: (acceptable: boolean) => void; t: T }) {
  const advanced = { floorPreferences: brief.floorPreferences, floorRange: brief.floorRange ?? null,
    maxBuildingAge: brief.maxBuildingAge ?? null, elevatorRequired: brief.mustHave.includes('ELEVATOR') };
  const update = (patch: Partial<typeof advanced>) => onAdvanced({ ...advanced, ...patch });
  const input = 'h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <details className="rounded-2xl border border-[hsl(var(--gold-border))] bg-card px-4 sm:px-5">
    <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring">{t('fpa_advanced')}</summary>
    <div className="space-y-4 border-t border-border py-4">
      <p className="text-xs leading-relaxed text-muted-foreground">{t('fpa_advanced_note')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['NOT_FIRST', 'NOT_LAST'] as const).map((code) => <label key={code} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={brief.floorPreferences.includes(code)} onChange={(e) => update({ floorPreferences: e.target.checked ? [...brief.floorPreferences.filter((p) => p !== code), code] : brief.floorPreferences.filter((p) => p !== code) })} className="h-5 w-5 accent-[#0C1119]" />{t(`fpa_${code}`)}</label>)}
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={advanced.elevatorRequired} onChange={(e) => update({ elevatorRequired: e.target.checked })} className="h-5 w-5 accent-[#0C1119]" />{t('fpa_elevator_required')}</label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={!brief.buildingStatuses || brief.buildingStatuses.value.includes('ANY') || brief.buildingStatuses.value.includes('OLD_BUILD')} onChange={(e) => onOlderBuildings(e.target.checked)} className="h-5 w-5 accent-[#0C1119]" />{t('fpa_old_buildings')}</label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(['min', 'max'] as const).map((bound) => <label key={bound} className="space-y-1.5 text-xs font-medium">{t(`fpa_floor_${bound}`)}<input type="number" min={-5} max={200} step={1} value={brief.floorRange?.[bound] ?? ''} onChange={(e) => update({ floorRange: { min: brief.floorRange?.min ?? null, max: brief.floorRange?.max ?? null, [bound]: e.target.value === '' ? null : Number(e.target.value) } })} className={input} /></label>)}
        <label className="col-span-2 space-y-1.5 text-xs font-medium sm:col-span-1">{t('fpa_building_age')}<input type="number" min={0} max={300} step={1} value={advanced.maxBuildingAge ?? ''} onChange={(e) => update({ maxBuildingAge: e.target.value === '' ? null : Number(e.target.value) })} className={input} /></label>
      </div>
    </div>
  </details>;
}

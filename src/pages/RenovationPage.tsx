// HOMATCH — Renovation planner.
//
// All arithmetic happens in src/renovation/calculations, which is pure,
// deterministic and unit-tested. This page collects inputs, calls those
// functions, and explains the result. It never computes a cost itself, and
// neither does any model: the AI's role in renovation is to help configure
// assumptions and explain them, never to produce a number.
//
// THE PRICING GATE
// ----------------
// Costs are shown ONLY when loadCustomerPriceBook() returns PRICED — which
// means verified items inside a published price-book version. Today it
// returns INSUFFICIENT_PRICE_DATA, so this page shows the plan, the phases
// and the timeline (all of which are real and useful) and explains plainly
// that we will not quote a number from prices nobody has checked.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Info, Hammer, Save } from 'lucide-react';

import { estimateQuantities, roomsFromKnownProperty, type Condition } from '@/renovation/calculations/quantities';
import { calculateEstimate, type RenovationLevel, type Estimate } from '@/renovation/calculations/estimate';
import { estimateTimeline, toCalendarWeeks, type TimelineResult } from '@/renovation/calculations/timeline';
import { loadCustomerPriceBook, saveScenario, type PricingAvailability } from '@/services/renovationPricing';
import { getDealRoom } from '@/services/dealRooms';

const CONDITIONS: { value: Condition; key: string }[] = [
  { value: 'BLACK_FRAME', key: 'reno_condition_black' },
  { value: 'GREEN_FRAME', key: 'reno_condition_green' },
  { value: 'OLD_RENOVATION', key: 'reno_condition_old' },
  { value: 'USABLE_RENOVATION', key: 'reno_condition_good' },
];

const LEVELS: RenovationLevel[] = ['BUDGET', 'STANDARD', 'UPPER_STANDARD', 'PREMIUM'];

const RenovationPage: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomId = params.get('room');

  const [area, setArea] = useState(70);
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(1);
  const [condition, setCondition] = useState<Condition>('BLACK_FRAME');
  const [level, setLevel] = useState<RenovationLevel>('STANDARD');

  const [pricing, setPricing] = useState<PricingAvailability | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCustomerPriceBook()
      .then(setPricing)
      // A pricing lookup failure is treated exactly like insufficient data:
      // both mean we must not show a number.
      .catch(() => setPricing({ state: 'INSUFFICIENT_PRICE_DATA', verifiedCount: 0, reason: 'lookup_failed' }));
  }, []);

  // Prefill the area from the deal room's Verify snapshot when we have one, so
  // the buyer does not retype something we already established.
  useEffect(() => {
    if (!roomId) return;
    getDealRoom(roomId)
      .then((r) => {
        const snap = (r?.verify_snapshot ?? {}) as { area?: string | null };
        const parsed = Number.parseFloat(String(snap.area ?? ''));
        if (Number.isFinite(parsed) && parsed > 5) setArea(Math.round(parsed));
      })
      .catch(() => undefined);
  }, [roomId]);

  /** Quantities and timeline are ALWAYS computable — they depend on geometry
   * and sequencing, not on prices. This is why the page stays useful even
   * with no verified price data at all. */
  const plan = useMemo(() => {
    const safeArea = Math.min(Math.max(area || 0, 10), 1000);
    const rooms = roomsFromKnownProperty({ totalArea: safeArea, bedrooms, bathrooms, hasBalcony: true });
    const quantities = estimateQuantities({ totalArea: safeArea, condition, rooms });
    const timeline: TimelineResult = estimateTimeline(condition, safeArea, level);
    return { safeArea, quantities, timeline };
  }, [area, bedrooms, bathrooms, condition, level]);

  const estimate: Estimate | null = useMemo(() => {
    if (pricing?.state !== 'PRICED') return null;
    try {
      return calculateEstimate(pricing.book, {
        quantities: plan.quantities,
        condition,
        totalArea: plan.safeArea,
        level,
        materialTier: 'typical',
        includeSoftCosts: true,
      });
    } catch {
      // The engine refuses an unusable book rather than inventing a number;
      // that refusal is a correct outcome, not an error to surface.
      return null;
    }
  }, [pricing, plan, condition, level]);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveScenario({
        roomId,
        name: `${plan.safeArea} m² · ${level}`,
        inputs: { area: plan.safeArea, bedrooms, bathrooms, condition, level },
        result: estimate
          ? { display: estimate.display, perSqm: estimate.perSqm, timeline: plan.timeline }
          : { timeline: plan.timeline },
        priceBookVersionId: pricing?.state === 'PRICED' ? pricing.versionId : null,
        estimateState: estimate ? 'PRICED' : 'INSUFFICIENT_PRICE_DATA',
      });
      toast.success(t('reno_saved'));
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Hammer className="h-6 w-6 shrink-0" aria-hidden="true" />
            {t('reno_title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('reno_subtitle')}</p>
        </header>

        <Card>
          <CardContent className="pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="reno-area">{t('reno_area')}</Label>
              <Input
                id="reno-area"
                type="number"
                inputMode="numeric"
                min={10}
                max={1000}
                value={area}
                onChange={(e) => setArea(Number(e.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reno-rooms">{t('reno_rooms')}</Label>
              <Input
                id="reno-rooms"
                type="number"
                inputMode="numeric"
                min={0}
                max={10}
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reno-condition">{t('reno_condition')}</Label>
              <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
                <SelectTrigger id="reno-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {t(c.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reno-level">{t('reno_level')}</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as RenovationLevel)}>
                <SelectTrigger id="reno-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l.replace(/_/g, ' ').toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* The gate. When there is no verified price data we say so in full
            sentences rather than showing a zero or a spinner forever. */}
        {pricing && pricing.state !== 'PRICED' ? (
          <Card className="border-amber-300 dark:border-amber-800">
            <CardContent className="pt-5">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('reno_insufficient_title')}
              </h2>
              <p className="text-sm leading-relaxed mt-2">{t('reno_insufficient_body')}</p>
            </CardContent>
          </Card>
        ) : null}

        {estimate ? (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <h2 className="text-base font-semibold">{t('reno_title')}</h2>
              <p className="text-2xl font-semibold">
                {estimate.display.typical.toLocaleString()} GEL
              </p>
              <p className="text-sm text-muted-foreground">
                {estimate.display.rangeLow.toLocaleString()} – {estimate.display.rangeHigh.toLocaleString()} GEL
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-base font-semibold">{t('reno_timeline')}</h2>
            <p className="text-sm">
              {toCalendarWeeks(plan.timeline.typicalDays)} {t('reno_weeks')}
            </p>
            <div className="space-y-2 pt-1">
              <h3 className="text-sm font-medium">{t('reno_phases')}</h3>
              <ul className="space-y-1.5">
                {plan.timeline.phases.map((p) => (
                  <li key={p.key} className="text-sm flex flex-wrap items-baseline gap-2">
                    <span className="min-w-0 break-words">{p.label}</span>
                    <Badge variant="outline" className="shrink-0">
                      {p.days}d
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {plan.quantities.assumptions.length > 0 && (
          <Card>
            <CardContent className="pt-5 space-y-2">
              <h2 className="text-base font-semibold">{t('reno_assumptions')}</h2>
              <ul className="space-y-1.5">
                {plan.quantities.assumptions.map((a) => (
                  <li key={a.key} className="text-sm text-muted-foreground break-words">
                    {a.description}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={onSave} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {t('reno_save')}
          </Button>
          {roomId ? (
            <Button variant="outline" onClick={() => navigate(`/deal-rooms/${roomId}`)}>
              {t('dr_tab_summary')}
            </Button>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
};

export default RenovationPage;

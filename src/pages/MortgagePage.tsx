// src/pages/MortgagePage.tsx — HOMATCH Mortgage / Home Financing.
//
// Product intent (mandate): feel like a human financing advisor. Complex
// math happens entirely in src/mortgage/calculations (DETERMINISTIC MATH
// ONLY, unit tested — see src/mortgage/calculations/__tests__). This file
// only collects input, calls those pure functions, and explains the
// resulting numbers in plain language. It never computes a payment,
// total, LTV, PTI, or effective rate itself.
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calculator, Home, Info, Landmark, TrendingDown, TrendingUp, BadgeCheck, Save } from 'lucide-react';
import { toast } from 'sonner';
import { logActivity } from '@/services/api';
import {
  getActivePtiRules,
  getActiveLtvRules,
  getActiveSubsidyPrograms,
  saveMortgageScenario,
} from '@/services/mortgageApi';
import {
  runFullMortgageCalculation,
  compareTerms,
  computeAffordability,
  validateMortgageInput,
} from '@/mortgage/calculations';
import type {
  MortgageInput,
  MortgageCalculationResult,
  TermComparisonRow,
  AffordabilityResult,
  MortgageRule,
  PtiLimitRuleData,
  LtvLimitRuleData,
  SubsidyProgramRuleData,
} from '@/mortgage/types';

const CURRENCIES = ['GEL', 'USD', 'EUR'];
const TERM_YEAR_OPTIONS = [5, 10, 15, 20, 25, 30];

// ── "Full picture" disclosures — always shown, not gated on a calculation.
// The whole point of this feature per the product mandate: people should
// leave understanding the things a bank pitch tends to skip over (capped
// early-repayment fees, why FX loans carry stricter limits, real closing
// costs, insurance that's sometimes presented as more mandatory than it
// is, and the legal ceiling on total cost) — not just a monthly number.
const HIDDEN_TOPICS = [
  { key: 'early_repayment', titleKey: 'mortgage_hidden_early_repayment_title', bodyKey: 'mortgage_hidden_early_repayment_body' },
  { key: 'fx_risk',         titleKey: 'mortgage_hidden_fx_risk_title',         bodyKey: 'mortgage_hidden_fx_risk_body' },
  { key: 'closing_costs',   titleKey: 'mortgage_hidden_closing_costs_title',   bodyKey: 'mortgage_hidden_closing_costs_body' },
  { key: 'insurance',       titleKey: 'mortgage_hidden_insurance_title',       bodyKey: 'mortgage_hidden_insurance_body' },
  { key: 'legal_cap',       titleKey: 'mortgage_hidden_legal_cap_title',       bodyKey: 'mortgage_hidden_legal_cap_body' },
];

interface MortgagePrefillState {
  propertyId?: string;
  price?: number;
  currency?: string;
}

function fmt(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString()} ${currency}`;
  }
}

/** Small inline accuracy chip — the mandate's "distinguish estimate vs
 * calculated vs official vs user-provided vs AI everywhere" requirement,
 * applied at the point of display rather than trusted to prose alone. */
function AccuracyChip({ kind, t }: { kind: 'calculated' | 'official' | 'user' | 'estimate'; t: (k: string) => string }) {
  const label = {
    calculated: t('mortgage_accuracy_calculated'),
    official: t('mortgage_accuracy_official'),
    user: t('mortgage_accuracy_user_provided'),
    estimate: t('mortgage_accuracy_estimate'),
  }[kind];
  return <Badge variant="outline" className="text-[10px] font-normal normal-case">{label}</Badge>;
}

export default function MortgagePage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { context?: MortgagePrefillState } | null)?.context;

  const [propertyPrice, setPropertyPrice] = useState<string>(prefill?.price ? String(prefill.price) : '');
  const [currency, setCurrency] = useState<string>(prefill?.currency || 'GEL');
  const [downPayment, setDownPayment] = useState<string>('');
  const [termYears, setTermYears] = useState<string>('20');
  const [nominalRate, setNominalRate] = useState<string>('');

  // Advanced ("I know more details about my bank offer")
  const [advOpen, setAdvOpen] = useState(false);
  const [effectiveRateFromBank, setEffectiveRateFromBank] = useState('');
  const [originationFeePercent, setOriginationFeePercent] = useState('');
  const [monthlyFeeFlat, setMonthlyFeeFlat] = useState('');
  const [insuranceAnnualFlat, setInsuranceAnnualFlat] = useState('');
  const [valuationFeeFlat, setValuationFeeFlat] = useState('');
  const [gracePeriodMonths, setGracePeriodMonths] = useState('');

  // Affordability (optional)
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [existingDebt, setExistingDebt] = useState('');
  const [ptiRules, setPtiRules] = useState<MortgageRule<PtiLimitRuleData>[]>([]);
  const [ltvRules, setLtvRules] = useState<MortgageRule<LtvLimitRuleData>[]>([]);
  const [subsidyRules, setSubsidyRules] = useState<MortgageRule<SubsidyProgramRuleData>[]>([]);

  const [result, setResult] = useState<MortgageCalculationResult | null>(null);
  const [lastInput, setLastInput] = useState<MortgageInput | null>(null);
  const [termRows, setTermRows] = useState<TermComparisonRow[] | null>(null);
  const [affordability, setAffordability] = useState<AffordabilityResult | null>(null);
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // activity_events.user_id is NOT NULL and FK's to public.users(id) — this
  // page is public (works signed-out), so every analytics call must be a
  // deliberate no-op for a signed-out visitor rather than passing a
  // placeholder value that would violate that constraint.
  const track = (eventType: Parameters<typeof logActivity>[1], propertyId?: string) => {
    if (!homatchUser) return;
    logActivity(homatchUser.id, eventType, propertyId).catch(() => {});
  };

  useEffect(() => {
    track('MORTGAGE_PAGE_OPENED');
    if (prefill?.propertyId) {
      track('PROPERTY_MORTGAGE_OPENED', prefill.propertyId);
    }
    // Knowledge-base rules are public ACTIVE data (RLS-enforced) — safe to
    // load for a signed-out visitor too, so the calculator's PTI/LTV and
    // subsidy sections work before sign-in.
    getActivePtiRules().then(setPtiRules).catch(() => {});
    getActiveLtvRules().then(setLtvRules).catch(() => {});
    getActiveSubsidyPrograms().then(setSubsidyRules).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downPaymentPercentPreview = useMemo(() => {
    const price = Number(propertyPrice);
    const dp = Number(downPayment);
    if (!price || !dp) return null;
    return (dp / price) * 100;
  }, [propertyPrice, downPayment]);

  function buildInput(): MortgageInput {
    return {
      propertyPrice: Number(propertyPrice),
      propertyCurrency: currency,
      downPayment: Number(downPayment),
      termMonths: Number(termYears) * 12,
      nominalAnnualRatePercent: Number(nominalRate),
      effectiveAnnualRatePercentFromBank: effectiveRateFromBank ? Number(effectiveRateFromBank) : undefined,
      originationFeePercent: originationFeePercent ? Number(originationFeePercent) : undefined,
      monthlyFeeFlat: monthlyFeeFlat ? Number(monthlyFeeFlat) : undefined,
      mandatoryInsuranceAnnualFlat: insuranceAnnualFlat ? Number(insuranceAnnualFlat) : undefined,
      valuationFeeFlat: valuationFeeFlat ? Number(valuationFeeFlat) : undefined,
      gracePeriodMonths: gracePeriodMonths ? Number(gracePeriodMonths) : undefined,
      propertyId: prefill?.propertyId,
      propertyPriceSnapshotAt: prefill?.propertyId ? new Date().toISOString() : undefined,
    };
  }

  function handleCalculate() {
    setValidationError(null);
    const input = buildInput();

    // Validate BEFORE calculating — every calculation function in
    // src/mortgage/calculations assumes pre-validated input and throws
    // otherwise (see amortization.ts's own header comment), so the UI is
    // the layer responsible for catching a bad value and explaining it in
    // plain language rather than ever showing a stack trace or a broken
    // NaN/Infinity result.
    const errors = validateMortgageInput(input);
    if (errors.length) {
      setResult(null);
      setLastInput(null);
      setTermRows(null);
      setValidationError(t(errors[0].messageKey));
      return;
    }

    const calc = runFullMortgageCalculation(input);
    setResult(calc);
    setLastInput(input);
    const terms = compareTerms(input);
    setTermRows(terms);
    setShowFullSchedule(false);

    if (monthlyIncome) {
      const aff = computeAffordability(
        calc,
        { monthlyNetIncome: Number(monthlyIncome), incomeCurrency: currency, existingMonthlyDebtObligations: existingDebt ? Number(existingDebt) : undefined },
        currency,
        ptiRules,
        ltvRules
      );
      setAffordability(aff);
      track('MORTGAGE_AFFORDABILITY_CHECKED');
    } else {
      setAffordability(null);
    }

    track('MORTGAGE_CALCULATED', prefill?.propertyId);
    track('MORTGAGE_TERM_COMPARED');
    if (subsidyRules.length) {
      track('MORTGAGE_SUBSIDY_CHECKED');
    }
  }

  async function handleSaveScenario() {
    if (!homatchUser || !result || !lastInput) return;
    setSaving(true);
    try {
      const ruleVersionIds = [
        ...(affordability?.matchedPtiRuleId ? [affordability.matchedPtiRuleId] : []),
        ...(affordability?.matchedLtvRuleId ? [affordability.matchedLtvRuleId] : []),
      ];
      const saved = await saveMortgageScenario({
        userId: homatchUser.id,
        propertyId: prefill?.propertyId ?? null,
        input: lastInput,
        result,
        affordability,
        ruleVersionIds,
      });
      if (saved) {
        toast.success(t('mortgage_scenario_saved_toast'));
        track('MORTGAGE_SCENARIO_SAVED', prefill?.propertyId);
      } else {
        toast.error(t('mortgage_error_generic'));
      }
    } finally {
      setSaving(false);
    }
  }

  const canCalculate = Boolean(propertyPrice && downPayment && termYears && nominalRate);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Landmark className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">{t('mortgage_page_title')}</h1>
              <p className="text-sm text-muted-foreground">{t('mortgage_page_subtitle')}</p>
            </div>
          </div>
          {prefill?.propertyId && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/60 rounded-lg px-3 py-2">
              <Home className="h-3.5 w-3.5 shrink-0" />
              <span>{t('mortgage_prefilled_from_property')}</span>
            </div>
          )}
        </div>

        {/* ── Initial screen: the ONLY fields shown before "Calculate" ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide">{t('mortgage_input_title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('mortgage_label_property_price')}</Label>
                <div className="flex gap-2">
                  <Input type="number" inputMode="decimal" min={0} value={propertyPrice}
                    onChange={e => setPropertyPrice(e.target.value)} placeholder="150000" />
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-24 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('mortgage_label_down_payment')}</Label>
                <Input type="number" inputMode="decimal" min={0} value={downPayment}
                  onChange={e => setDownPayment(e.target.value)} placeholder="30000" />
                {downPaymentPercentPreview !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t('mortgage_down_payment_percent_preview', { pct: downPaymentPercentPreview.toFixed(1) })}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t('mortgage_label_term')}</Label>
                <Select value={termYears} onValueChange={setTermYears}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TERM_YEAR_OPTIONS.map(y => (
                      <SelectItem key={y} value={String(y)}>{t('mortgage_years_value', { years: y })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('mortgage_label_nominal_rate')}</Label>
                <Input type="number" inputMode="decimal" step="0.01" min={0} value={nominalRate}
                  onChange={e => setNominalRate(e.target.value)} placeholder="12.5" />
              </div>
            </div>

            <Accordion type="single" collapsible value={advOpen ? 'advanced' : ''} onValueChange={v => setAdvOpen(v === 'advanced')}>
              <AccordionItem value="advanced" className="border-none">
                <AccordionTrigger className="text-sm text-muted-foreground py-2">
                  {t('mortgage_advanced_toggle')}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid sm:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('mortgage_label_effective_rate_bank')}</Label>
                      <Input type="number" step="0.01" value={effectiveRateFromBank} onChange={e => setEffectiveRateFromBank(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('mortgage_label_origination_fee_percent')}</Label>
                      <Input type="number" step="0.01" value={originationFeePercent} onChange={e => setOriginationFeePercent(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('mortgage_label_monthly_fee')}</Label>
                      <Input type="number" step="0.01" value={monthlyFeeFlat} onChange={e => setMonthlyFeeFlat(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('mortgage_label_insurance_annual')}</Label>
                      <Input type="number" step="0.01" value={insuranceAnnualFlat} onChange={e => setInsuranceAnnualFlat(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('mortgage_label_valuation_fee')}</Label>
                      <Input type="number" step="0.01" value={valuationFeeFlat} onChange={e => setValuationFeeFlat(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('mortgage_label_grace_period')}</Label>
                      <Input type="number" step="1" value={gracePeriodMonths} onChange={e => setGracePeriodMonths(e.target.value)} />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Optional affordability inputs — never required to calculate */}
            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('mortgage_label_monthly_income')}</Label>
                <Input type="number" step="0.01" value={monthlyIncome} onChange={e => setMonthlyIncome(e.target.value)} placeholder={t('mortgage_optional_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('mortgage_label_existing_debt')}</Label>
                <Input type="number" step="0.01" value={existingDebt} onChange={e => setExistingDebt(e.target.value)} placeholder={t('mortgage_optional_placeholder')} />
              </div>
            </div>

            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}

            <Button className="w-full gap-2" disabled={!canCalculate} onClick={handleCalculate}>
              <Calculator className="h-4 w-4" /> {t('mortgage_calculate_button')}
            </Button>
          </CardContent>
        </Card>

        {result && lastInput && (
          <>
            {/* ── Human-readable result summary ── */}
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wide">{t('mortgage_result_title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('mortgage_result_explainer', {
                    loanAmount: fmt(result.loanAmount, result.currency),
                    monthlyPayment: fmt(result.monthlyPayment, result.currency),
                    years: termYears,
                  })}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-secondary/60 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{t('mortgage_metric_monthly_payment')}</span>
                      <AccuracyChip kind="calculated" t={t} />
                    </div>
                    <div className="text-lg font-semibold">{fmt(result.monthlyPayment, result.currency)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-secondary/60 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{t('mortgage_metric_total_repayment')}</span>
                      <AccuracyChip kind="calculated" t={t} />
                    </div>
                    <div className="text-lg font-semibold">{fmt(result.totalRepayment, result.currency)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-secondary/60 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{t('mortgage_metric_total_interest')}</span>
                      <AccuracyChip kind="calculated" t={t} />
                    </div>
                    <div className="text-lg font-semibold">{fmt(result.totalInterest, result.currency)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-secondary/60 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{t('mortgage_metric_ltv')}</span>
                      <AccuracyChip kind="calculated" t={t} />
                    </div>
                    <div className="text-lg font-semibold">{result.ltvPercent !== null ? `${result.ltvPercent.toFixed(1)}%` : '—'}</div>
                  </div>
                </div>

                {/* Nominal vs effective rate — major educational feature */}
                <div className="p-3 rounded-xl border border-border space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('mortgage_effective_rate_title')}</span>
                  </div>
                  {result.effectiveAnnualRatePercent !== null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{result.effectiveAnnualRatePercent.toFixed(2)}%</span>
                      <AccuracyChip kind="calculated" t={t} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t(result.effectiveRateUnavailableReason || 'mortgage_effective_rate_unavailable_generic')}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('mortgage_effective_rate_explainer')}</p>
                </div>

                {homatchUser && (
                  <Button variant="outline" className="w-full gap-2" disabled={saving} onClick={handleSaveScenario}>
                    <Save className="h-4 w-4" /> {saving ? t('mortgage_saving') : t('mortgage_save_scenario')}
                  </Button>
                )}
                {!homatchUser && (
                  <p className="text-xs text-muted-foreground text-center">
                    <button className="underline" onClick={() => navigate('/auth/login')}>{t('mortgage_sign_in_to_save')}</button>
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ── Amortization schedule ── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wide">{t('mortgage_schedule_title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{t('mortgage_schedule_explainer')}</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('mortgage_schedule_col_month')}</TableHead>
                        <TableHead>{t('mortgage_schedule_col_principal')}</TableHead>
                        <TableHead>{t('mortgage_schedule_col_interest')}</TableHead>
                        <TableHead>{t('mortgage_schedule_col_payment')}</TableHead>
                        <TableHead>{t('mortgage_schedule_col_remaining')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(showFullSchedule ? result.amortizationSchedule : [
                        result.amortizationSchedule[0],
                        result.amortizationSchedule[Math.floor(result.amortizationSchedule.length / 2)],
                        result.amortizationSchedule[result.amortizationSchedule.length - 1],
                      ].filter(Boolean)).map(row => (
                        <TableRow key={row.month}>
                          <TableCell>{row.month}</TableCell>
                          <TableCell>{fmt(row.principalPortion, result.currency)}</TableCell>
                          <TableCell>{fmt(row.interestPortion, result.currency)}</TableCell>
                          <TableCell>{fmt(row.totalPayment, result.currency)}</TableCell>
                          <TableCell>{fmt(row.remainingPrincipal, result.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowFullSchedule(v => !v)}>
                  {showFullSchedule ? t('mortgage_schedule_show_summary') : t('mortgage_schedule_show_full')}
                </Button>
              </CardContent>
            </Card>

            {/* ── Term comparison ── */}
            {termRows && termRows.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm uppercase tracking-wide">{t('mortgage_term_compare_title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('mortgage_term_compare_explainer')}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('mortgage_term_compare_col_term')}</TableHead>
                          <TableHead>{t('mortgage_metric_monthly_payment')}</TableHead>
                          <TableHead>{t('mortgage_metric_total_repayment')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {termRows.map(row => (
                          <TableRow key={row.termMonths} className={row.isSelected ? 'bg-primary/5' : ''}>
                            <TableCell className="flex items-center gap-1.5">
                              {t('mortgage_years_value', { years: row.termMonths / 12 })}
                              {row.isSelected && <Badge variant="outline" className="text-[10px] normal-case font-normal">{t('mortgage_term_compare_selected')}</Badge>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {fmt(row.monthlyPayment, result.currency)}
                                {row.monthlyPaymentDeltaVsSelected < 0 && <TrendingDown className="h-3 w-3 text-emerald-600" />}
                                {row.monthlyPaymentDeltaVsSelected > 0 && <TrendingUp className="h-3 w-3 text-amber-600" />}
                              </div>
                            </TableCell>
                            <TableCell>{fmt(row.totalRepayment, result.currency)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Affordability (PTI/LTV) ── */}
            {affordability && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm uppercase tracking-wide">{t('mortgage_affordability_title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-secondary/60 space-y-1">
                      <span className="text-xs text-muted-foreground">{t('mortgage_metric_pti')}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold">{affordability.ptiPercent.toFixed(1)}%</span>
                        {affordability.ptiWithinPublishedLimit === true && <Badge className="bg-emerald-600 text-white border-transparent normal-case font-normal">{t('mortgage_within_limit')}</Badge>}
                        {affordability.ptiWithinPublishedLimit === false && <Badge variant="destructive" className="normal-case font-normal">{t('mortgage_outside_limit')}</Badge>}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-secondary/60 space-y-1">
                      <span className="text-xs text-muted-foreground">{t('mortgage_metric_ltv')}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold">{affordability.ltvPercent !== null ? `${affordability.ltvPercent.toFixed(1)}%` : '—'}</span>
                        {affordability.ltvWithinPublishedLimit === true && <Badge className="bg-emerald-600 text-white border-transparent normal-case font-normal">{t('mortgage_within_limit')}</Badge>}
                        {affordability.ltvWithinPublishedLimit === false && <Badge variant="destructive" className="normal-case font-normal">{t('mortgage_outside_limit')}</Badge>}
                      </div>
                    </div>
                  </div>
                  {(affordability.matchedPtiRuleId || affordability.matchedLtvRuleId) && <AccuracyChip kind="official" t={t} />}
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('mortgage_affordability_disclaimer')}</p>
                </CardContent>
              </Card>
            )}

            {/* ── Government subsidy programs ── */}
            {subsidyRules.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4" /> {t('mortgage_subsidy_title')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {subsidyRules.map(rule => (
                    <div key={rule.id} className="p-3 rounded-xl border border-border space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium">{rule.title}</span>
                        <AccuracyChip kind="official" t={t} />
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{t(rule.humanExplanation)}</p>
                      <p className="text-xs text-muted-foreground">{t('mortgage_subsidy_disclaimer')}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ── The full picture — always visible, not gated on a calculation.
            This is the point of the whole feature: not just a monthly
            number, but the things a bank pitch tends to leave out. ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide flex items-center gap-2">
              <Info className="h-4 w-4" /> {t('mortgage_hidden_section_title')}
            </CardTitle>
            <p className="text-xs text-muted-foreground pt-1">{t('mortgage_hidden_section_subtitle')}</p>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible>
              {HIDDEN_TOPICS.map(topic => (
                <AccordionItem key={topic.key} value={topic.key}>
                  <AccordionTrigger className="text-sm text-left">{t(topic.titleKey)}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                    {t(topic.bodyKey)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <p className="text-[11px] text-muted-foreground pt-3 leading-relaxed">{t('mortgage_hidden_disclaimer')}</p>
          </CardContent>
        </Card>

        <p className="text-[11px] text-muted-foreground text-center leading-relaxed pb-4">
          {t('mortgage_global_disclaimer')}
        </p>
      </div>
    </AppLayout>
  );
}

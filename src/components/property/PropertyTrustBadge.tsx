// PropertyTrustBadge — shown on property detail and match cards
import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Shield, ShieldAlert, ShieldCheck, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { getPropertyTrustScore } from '@/services/api3';
import type { PropertyTrustScore } from '@/types/phase3';

const RISK_LABELS: Record<string, string> = {
  price_conflict: 'Price conflict across sources',
  area_conflict: 'Area discrepancy detected',
  location_conflict: 'Location data inconsistency',
  duplicate_images: 'Duplicate images detected',
  data_stale: 'Data may be stale',
  cadastral_mismatch: 'Cadastral mismatch',
};

interface Props {
  propertyId: string;
  compact?: boolean;
}

export function PropertyTrustBadge({ propertyId, compact = false }: Props) {
  const { t } = useLanguage();
  const [score, setScore] = useState<PropertyTrustScore | null>(null);

  useEffect(() => {
    getPropertyTrustScore(propertyId).then(setScore).catch(() => {});
  }, [propertyId]);

  if (!score) return null;

  const risks = Object.entries({
    price_conflict: score.price_conflict,
    area_conflict: score.area_conflict,
    location_conflict: score.location_conflict,
    duplicate_images: score.duplicate_images,
    data_stale: score.data_stale,
    cadastral_mismatch: score.cadastral_mismatch,
  }).filter(([, v]) => v).map(([k]) => RISK_LABELS[k] ?? k);

  const hasRisks = risks.length > 0;
  const scoreColor = score.score >= 75 ? 'text-green-400' : score.score >= 50 ? 'text-primary' : 'text-red-400';
  const Icon = hasRisks ? ShieldAlert : ShieldCheck;
  const badgeVariant = hasRisks ? 'outline' : 'outline';
  const badgeClass = hasRisks
    ? 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10'
    : 'border-green-500/40 text-green-400 bg-green-500/10';

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${badgeClass}`}>
            <Icon className="h-3 w-3" />
            {score.score}
            {hasRisks && <AlertTriangle className="h-2.5 w-2.5 ml-0.5" />}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="start">
          <TrustPopoverContent score={score} risks={risks} scoreColor={scoreColor} t={t} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
          <div className="flex items-center gap-1.5 p-2 bg-secondary rounded-lg border border-border">
            <Shield className={`h-4 w-4 ${scoreColor}`} />
            <div>
              <p className="text-[10px] text-muted-foreground">{t('trust_score')}</p>
              <p className={`text-sm font-bold ${scoreColor}`}>{score.score}/100</p>
            </div>
            {hasRisks && <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 ml-1" />}
            <Info className="h-3.5 w-3.5 text-muted-foreground ml-0.5" />
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <TrustPopoverContent score={score} risks={risks} scoreColor={scoreColor} t={t} />
      </PopoverContent>
    </Popover>
  );
}

function TrustPopoverContent({ score, risks, scoreColor, t }: {
  score: PropertyTrustScore;
  risks: string[];
  scoreColor: string;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Shield className={`h-5 w-5 ${scoreColor}`} />
        <div>
          <p className="text-sm font-semibold">{t('trust_score')}: <span className={scoreColor}>{score.score}/100</span></p>
          <p className="text-xs text-muted-foreground capitalize">{score.confidence.toLowerCase().replace('_', ' ')} confidence</p>
        </div>
      </div>

      {risks.length === 0
        ? (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            {t('trust_no_risks')}
          </div>
        )
        : (
          <div className="space-y-1.5">
            {risks.map(r => (
              <div key={r} className="flex items-start gap-2 text-xs text-yellow-400">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        )
      }

      <p className="text-[10px] text-muted-foreground border-t border-border pt-2 leading-relaxed">
        {t('trust_disclaimer')}
      </p>
    </div>
  );
}

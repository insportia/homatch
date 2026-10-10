// HOMATCH Verify — "The people behind it": the professional team as cards.
//
// Built by peopleCards() (src/verify/reportPresentation.ts): the municipal
// documents' team, public credits, the developer and the financing partner,
// merged by name. The privacy rule is held there: a private individual is
// never shown outside a professional role.

import React from 'react';
import { Building2, HardHat, Landmark, PenTool, User2, BadgeCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { peopleCards, type TeamEntryLike, type ProjectTeamLike, type PersonCard } from '@/verify/reportPresentation';
import { TEAM_ROLE_KEY } from './BuyerIntelligenceCards';

const ROLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DEVELOPER: Building2,
  ARCHITECT: PenTool,
  CO_ARCHITECT: PenTool,
  LANDSCAPE_ARCHITECT: PenTool,
  INTERIOR_DESIGNER: PenTool,
  CONTRACTOR: HardHat,
  TECHNICAL_SUPERVISOR: HardHat,
  FINANCING: Landmark,
};

function roleLabel(card: PersonCard, t: (k: string) => string): string {
  return card.roles
    .map((r) => {
      if (r === 'FINANCING') return t('vrx_team_role_financing');
      if (r === 'CREDITED') return card.roleText || t('vbi_team_role_other');
      return TEAM_ROLE_KEY[r] ? t(TEAM_ROLE_KEY[r]) : t('vbi_team_role_other');
    })
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');
}

export const PeopleBehind: React.FC<{
  team?: TeamEntryLike[] | null;
  projectTeam?: ProjectTeamLike[] | null;
  developer?: string | null;
  financingPartner?: string | null;
}> = ({ team, projectTeam, developer, financingPartner }) => {
  const { t } = useLanguage();
  const cards = React.useMemo(
    () => peopleCards({ team, projectTeam, developer, financingPartner }),
    [team, projectTeam, developer, financingPartner],
  );
  if (!cards.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={t('vbi_team_title')}>
      {cards.map((c, i) => {
        const Icon = ROLE_ICON[c.roles[0]] ?? (c.organization ? Building2 : User2);
        return (
          <li
            key={`${c.name}-${i}`}
            className="group relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-[0_12px_32px_-18px_hsl(222_47%_11%/0.35)] motion-reduce:transition-none"
          >
            <span className="absolute inset-y-0 start-0 w-[3px] bg-[hsl(var(--gold-border))] opacity-70 group-hover:opacity-100" aria-hidden="true" />
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(222_47%_11%)] text-[hsl(38_92%_62%)]" aria-hidden="true">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <p className="text-2xs font-semibold uppercase tracking-[0.04em] text-[hsl(var(--gold-ink))] break-words">{roleLabel(c, t)}</p>
                <p className="text-[15px] font-semibold leading-6 break-words" dir="auto">{c.name}</p>
                {c.official ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                    {t('vbi_team_official')}
                  </p>
                ) : c.publicStatement ? (
                  <p className="text-xs text-muted-foreground">{t('vbi_fin_public_statement')}</p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

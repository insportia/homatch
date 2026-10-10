// HOMATCH Verify — "The people behind it": the professional team as cards.
//
// Built by peopleCards() (src/verify/reportPresentation.ts): the municipal
// documents' team, public credits, the developer and the financing partner,
// merged by name. The privacy rule is held there: a private individual is
// named only in a professional role, or — in the separate "Land & ownership"
// group — when an official municipal document names them as the project's
// land owner, permit applicant or client (owner, 2026-10-10). Never an ID
// number; never presented as the owner of the requested apartment.

import React from 'react';
import { Building2, HardHat, Landmark, PenTool, User2, BadgeCheck, MapPinned } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { peopleCards, yearSpan, OWNERSHIP_ROLES, type TeamEntryLike, type ProjectTeamLike, type PersonCard } from '@/verify/reportPresentation';
import { TEAM_ROLE_KEY } from './BuyerIntelligenceCards';

const OWNERSHIP_KEY: Record<string, string> = {
  PARCEL_OWNER: 'vrx_team_role_parcel_owner',
  APPLICANT: 'vrx_team_role_applicant',
  CO_APPLICANT: 'vrx_team_role_co_applicant',
  CLIENT: 'vrx_team_role_client',
};

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
      if (OWNERSHIP_KEY[r]) return t(OWNERSHIP_KEY[r]);
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
  // A card belongs to the team when it holds any non-ownership role; a pure
  // land / permit party goes to its own group with the not-your-unit note.
  const professional = cards.filter((c) => c.roles.some((r) => !OWNERSHIP_ROLES.has(r)));
  const ownership = cards.filter((c) => !c.roles.some((r) => !OWNERSHIP_ROLES.has(r)));
  return (
    <div className="space-y-5">
      {professional.length ? <CardGrid cards={professional} label={t('vbi_team_title')} t={t} /> : null}
      {ownership.length ? (
        <section aria-labelledby="vrx-ownership" className="space-y-3">
          <h3 id="vrx-ownership" className="flex items-center gap-2 text-sm font-semibold break-words">
            <MapPinned className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('vrx_ownership_title')}
          </h3>
          <p className="text-xs leading-5 text-muted-foreground break-words">{t('vrx_ownership_note')}</p>
          <CardGrid cards={ownership} label={t('vrx_ownership_title')} t={t} />
        </section>
      ) : null}
    </div>
  );
};

function CardGrid({ cards, label, t }: { cards: PersonCard[]; label: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={label}>
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
                {c.ownership && (c.blocks.length || c.firstSeen || c.lastSeen) ? (
                  <p className="text-xs text-muted-foreground break-words">
                    {[
                      c.blocks.length ? t('vrx_ownership_building', { blocks: c.blocks.join(', ') }) : null,
                      c.firstSeen || c.lastSeen ? t('vrx_ownership_period', { span: yearSpan(c.firstSeen ?? c.lastSeen ?? '', c.lastSeen ?? c.firstSeen ?? '') }) : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
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
}

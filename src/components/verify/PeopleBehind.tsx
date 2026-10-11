// HOMATCH Verify — "The people behind it": the professional team as cards.
//
// Built by peopleCards() (src/verify/reportPresentation.ts): the municipal
// documents' team, public credits, the developer and the financing partner,
// merged by name. The privacy rule is held there: a private individual is
// named only in a professional role, or — in the separate "Land & ownership"
// group — when an official municipal document names them as the project's
// land owner, permit applicant or client (owner, 2026-10-10). Never an ID
// number; never presented as the owner of the requested apartment.

//
// V3 (owner, 2026-10-10): when the report carries `projectTeamV2`, the team is
// shown grouped by discipline, each card headed by the role EXACTLY as the
// official document words it, with its case, document and date, and an
// expandable list of every documented role. Older reports keep the cards
// above. The ownership group is the same in both.

import React from 'react';
import { Building2, HardHat, Landmark, PenTool, User2, BadgeCheck, MapPinned, Layers, Mountain, Trees, ShieldCheck, Users, ChevronDown, Cable, Palette, FileSignature, Globe2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  peopleCards,
  teamGroupsV2,
  caseCount,
  yearSpan,
  TEAM_GROUP_DUTY_KEY,
  OWNERSHIP_ROLES,
  TEAM_GROUP_KEY,
  type TeamEntryLike,
  type ProjectTeamLike,
  type PersonCard,
  type TeamCardV2,
  type TeamGroup,
  type TeamRoleV2,
} from '@/verify/reportPresentation';
import { TEAM_ROLE_KEY } from './BuyerIntelligenceCards';
import { OfficialLink } from './OfficialLink';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const nameKey = (s: string): string => s.toLowerCase().replace(/["„“”'«»]/g, '').replace(/(^|\s)(შპს|სს|llc|ltd|jsc)(?=\s|$)/giu, ' ').replace(/\s+/g, ' ').trim();

const GROUP_ICON: Record<TeamGroup, React.ComponentType<{ className?: string }>> = {
  DEVELOPER: Building2,
  ARCHITECTURE: PenTool,
  STRUCTURAL: Layers,
  GEOTECHNICAL: Mountain,
  ENGINEERING: Cable,
  DESIGN: Palette,
  APPLICANTS: FileSignature,
  LANDSCAPE: Trees,
  CONSTRUCTION_ORG: HardHat,
  SAFETY: ShieldCheck,
  OTHER: Users,
};

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
  /** The discipline-grouped team with documented wording (absent in older reports). */
  teamV2?: unknown;
  /** The developer company's registered directors — named as such, never as designers. */
  directors?: string[] | null;
}> = ({ team, projectTeam, developer, financingPartner, teamV2, directors }) => {
  const { t } = useLanguage();
  const cards = React.useMemo(
    () => peopleCards({ team, projectTeam, developer, financingPartner }),
    [team, projectTeam, developer, financingPartner],
  );
  const groups = React.useMemo(() => teamGroupsV2(teamV2), [teamV2]);
  const v2Names = React.useMemo(() => new Set(groups.flatMap((g) => g.cards.map((c) => nameKey(c.name)))), [groups]);
  const directorKeys = React.useMemo(() => new Set((directors ?? []).map((d) => nameKey(String(d ?? ''))).filter(Boolean)), [directors]);
  if (!cards.length && !groups.length) return null;
  // A card belongs to the team when it holds any non-ownership role; a pure
  // land / permit party goes to its own group with the not-your-unit note.
  const professional = cards.filter((c) => c.roles.some((r) => !OWNERSHIP_ROLES.has(r)));
  const ownership = cards.filter((c) => !c.roles.some((r) => !OWNERSHIP_ROLES.has(r)) && !v2Names.has(nameKey(c.name)));
  // With the v2 team, the legacy cards add only what v2 does not hold: the
  // financing partner (a public statement) and a developer v2 did not name.
  const extras = groups.length
    ? professional.filter((c) => !v2Names.has(nameKey(c.name)) && (
        c.roles.every((r) => r === 'FINANCING')
        || (!groups.some((g) => g.group === 'DEVELOPER') && c.roles.every((r) => r === 'FINANCING' || r === 'DEVELOPER'))
      ))
    : [];
  return (
    <div className="space-y-8">
      {groups.length ? (
        <>
          {groups.map((g) => <TeamGroupSection key={g.group} group={g.group} cards={g.cards} directors={directorKeys} />)}
          {extras.length ? <CardGrid cards={extras} label={t('vbi_team_title')} t={t} /> : null}
        </>
      ) : professional.length ? <CardGrid cards={professional} label={t('vbi_team_title')} t={t} /> : null}
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

/* ───────────────────────── V3: grouped, documented team ───────────────────────── */

function TeamGroupSection({ group, cards, directors }: { group: TeamGroup; cards: TeamCardV2[]; directors: Set<string> }) {
  const { t } = useLanguage();
  const Icon = GROUP_ICON[group];
  const hid = `vrx-team-${group.toLowerCase()}`;
  const duty = TEAM_GROUP_DUTY_KEY[group];
  return (
    <section aria-labelledby={hid} className="space-y-3" data-team-group={group}>
      <div className="space-y-1">
        <h3 id={hid} className="flex items-center gap-2.5 text-sm font-semibold break-words">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]" aria-hidden="true">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">{t(TEAM_GROUP_KEY[group])}</span>
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{cards.length}</span>
        </h3>
        {duty ? <p className="ps-[2.375rem] text-xs leading-5 text-muted-foreground break-words">{t(duty)}</p> : null}
      </div>
      <ul className={`grid grid-cols-1 items-start gap-3 sm:grid-cols-2 ${cards.length >= 3 ? 'lg:grid-cols-3' : ''}`} aria-label={t(TEAM_GROUP_KEY[group])}>
        {cards.map((c, i) => <TeamCard key={`${c.name}-${i}`} card={c} id={`${hid}-${i}`} director={directors.has(nameKey(c.name))} />)}
      </ul>
    </section>
  );
}

/** The role a reader is told: the role's name when the record only had a form label. */
function useRoleText() {
  const { t } = useLanguage();
  return (r: TeamRoleV2): string => (r.labelKey ? t(r.labelKey) : r.roleText);
}

/** Case № · document · date — the line that makes a role checkable. */
function SourceLine({ role, className }: { role: TeamRoleV2; className?: string }) {
  const { t } = useLanguage();
  const date = dmy(role.date);
  const parts = [
    role.caseRef ? t('verify_v3_case_ref', { ref: `\u2066${role.caseRef}\u2069` }) : null,
    date ? `\u2066${date}\u2069` : null,
  ].filter(Boolean) as string[];
  // "TAS 1101896" restates the case number beside it; only a real title is shown.
  const title = role.documentTitle && !/^TAS\s*\d+$/i.test(role.documentTitle) ? role.documentTitle : null;
  if (!parts.length && !title && !role.sourceUrl) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ''}`}>
      {parts.length || title ? (
        <p className="text-xs leading-5 text-muted-foreground break-words">
          {title ? <span className="text-foreground/75" dir="auto">{title}</span> : null}
          {title && parts.length ? <span aria-hidden="true"> · </span> : null}
          {parts.join(' · ')}
        </p>
      ) : null}
      {role.sourceUrl ? <OfficialLink href={role.sourceUrl} /> : null}
    </div>
  );
}

function TeamCard({ card, id, director }: { card: TeamCardV2; id: string; director: boolean }) {
  const { t } = useLanguage();
  const roleText = useRoleText();
  const [open, setOpen] = React.useState(false);
  const Icon = card.organizationKind ? Building2 : User2;
  const h = card.headline;
  const cases = caseCount(card);
  const span = card.firstSeen || card.lastSeen ? yearSpan(card.firstSeen ?? card.lastSeen ?? '', card.lastSeen ?? card.firstSeen ?? '') : null;
  // Every OTHER documented role, in the reader's words, de-duplicated.
  const others = [...new Set(card.roles.map(roleText).filter((x) => x !== roleText(h)))].slice(0, 3);
  return (
    <li className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 transition-shadow duration-300 hover:shadow-[0_12px_32px_-18px_hsl(222_47%_11%/0.35)] motion-reduce:transition-none">
      <span className="absolute inset-y-0 start-0 w-[3px] bg-[hsl(var(--gold-border))] opacity-70 group-hover:opacity-100" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(222_47%_11%)] text-[hsl(38_92%_62%)]" aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[15px] font-semibold leading-6 break-words" dir="auto">{card.name}</p>
          {/* The role — the documented wording, or the role's name when the record held only a form label. */}
          <p className="text-sm font-medium leading-5 text-[hsl(var(--gold-ink))] break-words" dir="auto">{roleText(h)}</p>
          {others.length ? <p className="text-xs leading-5 text-foreground/70 break-words" dir="auto">{t('verify_p0_team_also', { roles: others.join(' · ') })}</p> : null}
          {card.organization ? <p className="text-xs leading-5 text-foreground/75 break-words" dir="auto">{card.organization}</p> : null}
        </div>
      </div>
      {director ? (
        <p className="mt-2.5 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs leading-5 text-foreground/80 break-words">{t('verify_p0_team_director_note')}</p>
      ) : null}
      {h.scope ? <p className="mt-2.5 text-sm leading-6 text-foreground/85 break-words" dir="auto">{h.scope}</p> : null}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {cases ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-2xs font-medium tabular-nums text-foreground/80">{t('verify_p0_team_cases', { count: String(cases) })}</span> : null}
        {span ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-2xs font-medium tabular-nums text-foreground/80"><bdi dir="ltr">{span}</bdi></span> : null}
      </div>
      <SourceLine role={h} className="mt-2" />
      {card.official ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
          {t('vbi_team_official')}
        </p>
      ) : (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Globe2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('verify_p0_team_public_source')}
        </p>
      )}
      {card.roles.length > 1 ? (
        <div className="mt-auto pt-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-roles`}
            onClick={() => setOpen((o) => !o)}
            className="-mx-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))]"
          >
            {t(open ? 'verify_v3_team_roles_hide' : 'verify_p0_team_evidence_show', { count: String(card.roles.length) })}
            <ChevronDown className={`h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <div
            id={`${id}-roles`}
            className={`grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            aria-hidden={!open}
            {...(!open ? { inert: '' as unknown as boolean } : {})}
          >
            <ol className="min-h-0 space-y-3 overflow-hidden">
              {card.roles.map((r, i) => (
                <li key={i} className={`border-s-2 border-[hsl(var(--gold-border))] ps-3 ${i === 0 ? 'mt-2' : ''}`}>
                  <p className="text-sm font-medium leading-5 break-words" dir="auto">{roleText(r)}</p>
                  {r.scope ? <p className="text-xs leading-5 text-foreground/80 break-words" dir="auto">{r.scope}</p> : null}
                  <SourceLine role={r} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </li>
  );
}

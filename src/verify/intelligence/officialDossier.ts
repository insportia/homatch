/*
 * THE OFFICIAL DOSSIER — what the case files establish, ready for the report
 * and for the model.
 *
 *   projectTeamV2      every named professional with documented roles and
 *                      provenance (tasProfessionals.ts), merged with the
 *                      consolidated participants and public credits;
 *   technicalSpecs     documented specifications with their standing
 *                      (APPROVED / PROPOSED / UNKNOWN — technicalSpecs.ts);
 *   officialDocuments  the cases and their files, priority cases first;
 *   priorityCases      the two newest cases in full (people, specs, pending
 *                      status, attachment list) — bounded, never dropped —
 *                      so the narrative can say what the latest papers ask.
 *
 * Deterministic and pure. `nowIso` is the job's completion time, never the
 * wall clock, so a rebuilt report reads the same as the first one.
 */

import { readCaseSources, caseDecisionState, caseSubject, FINAL_OUTCOMES, type CaseSource } from './tasCaseSources.ts';
import { extractTasProfessionals, buildProjectTeamV2, type TeamMemberV2 } from './tasProfessionals.ts';
import { extractTechnicalSpecs, type TechnicalSpec } from './technicalSpecs.ts';
import { buildOfficialDocuments, fileKind, type OfficialDocument } from './officialDocuments.ts';
import { officialHistoryView, type TasIntelligence } from './tasIntelligence.ts';
import { projectTeamFrom } from './reportGaps.ts';

export interface PriorityCaseDigest {
  priority: 1 | 2;
  caseRef: string | null;
  date: string | null;
  statusText: string | null;
  /** APPROVED / NEGATIVE from its own read decisions; UNDER_REVIEW / UNDECIDED otherwise. */
  standing: 'APPROVED' | 'NEGATIVE' | 'UNDER_REVIEW' | 'UNDECIDED';
  deadline: string | null;
  subject: string | null;
  decisions: Array<{ number: string | null; outcome: string; date: string | null }>;
  people: Array<{ name: string; roleText: string; group: string }>;
  specs: Array<{ label: string; value: string; status: string }>;
  attachments: Array<{ fileName: string; kind: string; pages: number | null; read: boolean }>;
  attachmentsTotal: number;
  publicUrl: string | null;
}

export interface OfficialDossier {
  projectTeamV2: TeamMemberV2[];
  technicalSpecs: TechnicalSpec[];
  officialDocuments: OfficialDocument[];
  priorityCases: PriorityCaseDigest[];
}

const READ = new Set(['READ_TEXT', 'LOW_TEXT']);

function priorityDigest(c: CaseSource, team: TeamMemberV2[], specs: TechnicalSpec[], nowDay: string | null): PriorityCaseDigest {
  const decisions = c.motions
    .filter((m) => m.decision && FINAL_OUTCOMES.has(m.decision.outcome) && !(nowDay && (m.decision.issueDate ?? m.date ?? '') > nowDay))
    .map((m) => ({ number: m.decision!.number ?? m.decisionNumber, outcome: m.decision!.outcome, date: m.decision!.issueDate ?? m.date }));
  const people: PriorityCaseDigest['people'] = [];
  for (const m of team)
    for (const r of m.roles)
      if (r.caseRef && r.caseRef === c.caseRef && people.length < 30 && !people.some((p) => p.name === m.name && p.roleText === r.roleText))
        people.push({ name: m.name, roleText: r.roleText, group: m.group });
  return {
    priority: c.priority as 1 | 2,
    caseRef: c.caseRef,
    date: c.date,
    statusText: c.status,
    standing: caseDecisionState(c, nowDay),
    deadline: c.deadline,
    subject: caseSubject(c),
    decisions,
    people,
    specs: specs.filter((s) => s.caseRef === c.caseRef).slice(0, 40).map((s) => ({ label: s.label, value: s.value, status: s.status })),
    attachments: c.attachments.slice(0, 40).map((a) => ({ fileName: a.fileName ?? 'ფაილი', kind: fileKind(a.fileName, a.format), pages: a.pages, read: READ.has(a.outcome ?? '') || a.hasText })),
    attachmentsTotal: c.attachments.length,
    publicUrl: c.publicUrl,
  };
}

export function buildOfficialDossier(report: unknown, tas: TasIntelligence | null | undefined, nowIso: string | null = null): OfficialDossier {
  const cases = readCaseSources(report);
  const nowDay = nowIso ? nowIso.slice(0, 10) : null;
  const extracted = extractTasProfessionals(cases);
  const view = tas?.available ? officialHistoryView(tas) : null;
  const officialTeam = view?.team ?? [];
  let publicTeam: ReturnType<typeof projectTeamFrom> = [];
  try {
    publicTeam = projectTeamFrom(report, null);
  } catch {
    publicTeam = [];
  }
  const projectTeamV2 = buildProjectTeamV2(extracted, officialTeam, publicTeam);
  const technicalSpecs = extractTechnicalSpecs(cases, nowIso);
  const officialDocuments = buildOfficialDocuments(cases);
  const priorityCases = cases.filter((c) => c.priority).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, 2)
    .map((c) => priorityDigest(c, projectTeamV2, technicalSpecs, nowDay));
  return { projectTeamV2, technicalSpecs, officialDocuments, priorityCases };
}

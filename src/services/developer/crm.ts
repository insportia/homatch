// HOMATCH FOR DEVELOPERS — leads, the timeline, tasks and viewings.
//
// A lead is created by an RPC and never by an insert. The reason is in the
// contact-boundary migration: dev_leads.contact_id is a plain foreign key, so
// a client able to insert a lead is a client able to assert that an arbitrary
// person is theirs to read. The route in is dev_create_lead, which resolves
// the contact itself.

import { run, runList, rpc, supabase } from './client';
import type {
  DevLead, DevLeadContact, DevActivity, DevTask, DevViewing, LeadStage, LostReason,
  ActivityKind, ActivityProvenance,
} from './types';
import { WORKFLOW_ONLY_STAGES } from './types';

export interface LeadQuery {
  projectId?: string | null;
  stage?: LeadStage[];
  assignedTo?: string | null;
  search?: string;
  /** Only leads whose follow-up is in the past. */
  overdueOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** A lead with its buyer attached, which is how every screen wants it. */
export interface LeadWithContact extends DevLead {
  contact: DevLeadContact | null;
}

export async function listLeads(workspaceId: string, q: LeadQuery = {}): Promise<LeadWithContact[]> {
  let query = supabase.from('dev_leads').select('*').eq('workspace_id', workspaceId);

  if (q.projectId) query = query.eq('project_id', q.projectId);
  if (q.stage && q.stage.length > 0) query = query.in('stage', q.stage);
  if (q.assignedTo) query = query.eq('assigned_to', q.assignedTo);
  if (q.overdueOnly) {
    query = query.lt('next_follow_up_at', new Date().toISOString()).not('stage', 'in', '("LOST","SOLD")');
  }
  query = query
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .range(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 200) - 1);

  const leads = await runList<DevLead>('listLeads', query, workspaceId);
  if (leads.length === 0) return [];

  // Buyer identity comes from the view, which applies dev_lead_visible() per
  // row. Anything the caller may not see simply arrives without a contact
  // rather than disappearing.
  const contacts = await runList<DevLeadContact>(
    'listLeads.contacts',
    supabase.from('dev_lead_contacts').select('*').in('lead_id', leads.map((l) => l.id)),
    workspaceId,
  );
  const byLead = new Map(contacts.map((c) => [c.lead_id, c]));

  const searchTerm = q.search?.trim().toLowerCase();
  const joined = leads.map((lead) => ({ ...lead, contact: byLead.get(lead.id) ?? null }));
  if (!searchTerm) return joined;

  // Buyer search is filtered here rather than in the query because the name
  // lives behind a view the parent select cannot reach into.
  return joined.filter((l) => {
    const c = l.contact;
    return (
      c?.full_name?.toLowerCase().includes(searchTerm) ||
      c?.phone?.toLowerCase().includes(searchTerm) ||
      c?.email?.toLowerCase().includes(searchTerm) ||
      l.source?.toLowerCase().includes(searchTerm)
    );
  });
}

export async function getLead(leadId: string): Promise<LeadWithContact> {
  const lead = await run<DevLead>(
    'getLead', supabase.from('dev_leads').select('*').eq('id', leadId).single(), leadId);
  const contacts = await runList<DevLeadContact>(
    'getLead.contact',
    supabase.from('dev_lead_contacts').select('*').eq('lead_id', leadId), leadId);
  return { ...lead, contact: contacts[0] ?? null };
}

export interface CreateLeadInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  projectId?: string | null;
  source?: string | null;
  assignedTo?: string | null;
  language?: string | null;
  country?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export async function createLead(workspaceId: string, input: CreateLeadInput): Promise<string> {
  return rpc<string>('dev_create_lead', {
    p_workspace: workspaceId,
    p_full_name: input.fullName,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_project_id: input.projectId ?? null,
    p_source: input.source ?? null,
    p_assigned_to: input.assignedTo ?? null,
    p_language: input.language ?? null,
    p_country: input.country ?? null,
    p_budget_min: input.budgetMin ?? null,
    p_budget_max: input.budgetMax ?? null,
    p_currency: input.currency ?? null,
    p_notes: input.notes ?? null,
  }, workspaceId);
}

export async function updateLead(leadId: string, patch: Partial<DevLead>): Promise<DevLead> {
  // Stage is not patchable from here; it has its own function so that the
  // change is recorded on the timeline and the workflow-only stages refuse.
  const { stage, ...safe } = patch;
  return run<DevLead>(
    'updateLead',
    supabase.from('dev_leads').update(safe).eq('id', leadId).select().single(),
    leadId,
  );
}

export async function updateLeadContact(leadId: string, patch: {
  fullName?: string | null; phone?: string | null; email?: string | null;
  language?: string | null; country?: string | null;
}): Promise<void> {
  await rpc<void>('dev_update_contact', {
    p_lead_id: leadId,
    p_full_name: patch.fullName ?? null,
    p_phone: patch.phone ?? null,
    p_email: patch.email ?? null,
    p_language: patch.language ?? null,
    p_country: patch.country ?? null,
  }, leadId);
}

/** RESERVATION, CONTRACT and SOLD are refused — those are set by the deal workflow. */
export async function setLeadStage(
  leadId: string, stage: LeadStage, lostReason?: LostReason | null, lostNote?: string | null,
): Promise<void> {
  if (WORKFLOW_ONLY_STAGES.includes(stage)) {
    const { DevError } = await import('./client');
    throw new DevError('dev_err_stage_workflow_only', `stage ${stage} is workflow-only`, null);
  }
  await rpc<void>('dev_set_lead_stage', {
    p_lead_id: leadId, p_stage: stage,
    p_lost_reason: lostReason ?? null, p_lost_note: lostNote ?? null,
  }, leadId);
}

export async function reassignLead(leadId: string, toUserId: string): Promise<void> {
  await rpc<void>('dev_reassign_lead', { p_lead_id: leadId, p_to_user: toUserId }, leadId);
}

// ── The timeline ───────────────────────────────────────────────────────────

export async function listActivities(leadId: string, limit = 200): Promise<DevActivity[]> {
  return runList<DevActivity>(
    'listActivities',
    supabase.from('dev_activities').select('*')
      .eq('lead_id', leadId).order('occurred_at', { ascending: false }).limit(limit),
    leadId,
  );
}

export async function listWorkspaceActivity(
  workspaceId: string, limit = 50,
): Promise<DevActivity[]> {
  return runList<DevActivity>(
    'listWorkspaceActivity',
    supabase.from('dev_activities').select('*')
      .eq('workspace_id', workspaceId).order('occurred_at', { ascending: false }).limit(limit),
    workspaceId,
  );
}

export interface AddActivityInput {
  leadId?: string | null;
  contactId?: string | null;
  unitId?: string | null;
  dealId?: string | null;
  kind: ActivityKind;
  provenance?: ActivityProvenance;
  direction?: 'IN' | 'OUT' | null;
  title: string;
  body?: string | null;
  meta?: Record<string, unknown>;
  occurredAt?: string;
}

/**
 * Anything that happens to a buyer is written here, whichever screen it
 * happened on. That is what makes the timeline one record rather than five
 * modules each keeping their own.
 */
export async function addActivity(
  workspaceId: string, input: AddActivityInput,
): Promise<DevActivity> {
  const activity = await run<DevActivity>(
    'addActivity',
    supabase.from('dev_activities').insert({
      workspace_id: workspaceId,
      lead_id: input.leadId ?? null,
      contact_id: input.contactId ?? null,
      unit_id: input.unitId ?? null,
      deal_id: input.dealId ?? null,
      kind: input.kind,
      provenance: input.provenance ?? 'MANUAL',
      direction: input.direction ?? null,
      title: input.title,
      body: input.body ?? null,
      meta: input.meta ?? {},
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    }).select().single(),
    workspaceId,
  );

  if (input.leadId) {
    await run(
      'addActivity.touchLead',
      supabase.from('dev_leads')
        .update({ last_activity_at: activity.occurred_at })
        .eq('id', input.leadId).select('id'),
      input.leadId,
    );
  }
  return activity;
}

/** A disposition is the outcome of a conversation, recorded with it. */
export async function recordDisposition(
  workspaceId: string, leadId: string, disposition: string, note?: string | null,
): Promise<void> {
  await run(
    'recordDisposition',
    supabase.from('dev_leads').update({ disposition }).eq('id', leadId).select('id'),
    leadId,
  );
  await addActivity(workspaceId, {
    leadId, kind: 'NOTE', provenance: 'MANUAL',
    title: `Disposition: ${disposition}`, body: note ?? null,
    meta: { disposition },
  });
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export async function listTasks(
  workspaceId: string, opts: { leadId?: string; assignedTo?: string; openOnly?: boolean } = {},
): Promise<DevTask[]> {
  let query = supabase.from('dev_tasks').select('*').eq('workspace_id', workspaceId);
  if (opts.leadId) query = query.eq('lead_id', opts.leadId);
  if (opts.assignedTo) query = query.eq('assigned_to', opts.assignedTo);
  if (opts.openOnly) query = query.eq('status', 'OPEN');
  return runList<DevTask>(
    'listTasks',
    query.order('due_at', { ascending: true, nullsFirst: false }).limit(200),
    workspaceId,
  );
}

export async function createTask(
  workspaceId: string, input: Partial<DevTask> & { title: string },
): Promise<DevTask> {
  return run<DevTask>(
    'createTask',
    supabase.from('dev_tasks').insert({ ...input, workspace_id: workspaceId }).select().single(),
    workspaceId,
  );
}

export async function completeTask(taskId: string): Promise<DevTask> {
  return run<DevTask>(
    'completeTask',
    supabase.from('dev_tasks')
      .update({ status: 'DONE', completed_at: new Date().toISOString() })
      .eq('id', taskId).select().single(),
    taskId,
  );
}

// ── Viewings ───────────────────────────────────────────────────────────────

export async function listViewings(
  workspaceId: string, opts: { leadId?: string; from?: string; to?: string; assignedTo?: string } = {},
): Promise<DevViewing[]> {
  let query = supabase.from('dev_viewings').select('*').eq('workspace_id', workspaceId);
  if (opts.leadId) query = query.eq('lead_id', opts.leadId);
  if (opts.assignedTo) query = query.eq('assigned_to', opts.assignedTo);
  if (opts.from) query = query.gte('scheduled_at', opts.from);
  if (opts.to) query = query.lte('scheduled_at', opts.to);
  return runList<DevViewing>(
    'listViewings', query.order('scheduled_at', { ascending: true }).limit(300), workspaceId);
}

export async function scheduleViewing(
  workspaceId: string, input: Partial<DevViewing> & { lead_id: string; scheduled_at: string },
): Promise<DevViewing> {
  const viewing = await run<DevViewing>(
    'scheduleViewing',
    supabase.from('dev_viewings').insert({ ...input, workspace_id: workspaceId }).select().single(),
    workspaceId,
  );
  await addActivity(workspaceId, {
    leadId: input.lead_id, unitId: input.unit_id ?? null,
    kind: 'VIEWING', provenance: 'HOMATCH',
    title: 'Viewing scheduled', meta: { viewing_id: viewing.id, mode: viewing.mode },
  });
  // The pipeline should reflect it without anybody dragging a card — but a
  // lead that is already reserved or under contract must not be dragged
  // BACKWARDS by somebody booking a second viewing, and dev_set_lead_stage
  // refuses to move a lead into or out of those stages at all.
  //
  // That refusal is expected here and is not an error worth showing: the
  // viewing itself is already saved, which is the part the person asked for.
  // Anything else that comes back still throws, because a viewing that
  // silently failed to advance a NEW lead is a bug we would never hear about.
  const advanceable = !['RESERVATION', 'CONTRACT', 'PAYMENT_PENDING', 'SOLD', 'LOST']
    .includes((await getLead(input.lead_id)).stage);
  if (advanceable) {
    await setLeadStage(input.lead_id, 'VIEWING_SCHEDULED');
  }
  return viewing;
}

export async function updateViewing(
  viewingId: string, patch: Partial<DevViewing>,
): Promise<DevViewing> {
  return run<DevViewing>(
    'updateViewing',
    supabase.from('dev_viewings').update(patch).eq('id', viewingId).select().single(),
    viewingId,
  );
}

/** Completing a viewing asks for its outcome; the outcome is the point of it. */
export async function completeViewing(
  workspaceId: string, viewing: DevViewing, disposition: string, notes?: string | null,
): Promise<void> {
  await updateViewing(viewing.id, { status: 'COMPLETED', disposition, notes: notes ?? null });
  await addActivity(workspaceId, {
    leadId: viewing.lead_id, unitId: viewing.unit_id,
    kind: 'VIEWING', provenance: 'HOMATCH',
    title: `Viewing completed — ${disposition}`, body: notes ?? null,
    meta: { viewing_id: viewing.id, disposition },
  });
}

// ── Units a buyer is interested in ─────────────────────────────────────────

export interface LeadUnitLink {
  id: string; lead_id: string; unit_id: string;
  interest: 'SUGGESTED' | 'INTERESTED' | 'SHORTLISTED' | 'REJECTED';
  note: string | null; created_at: string;
}

export async function listLeadUnits(leadId: string): Promise<LeadUnitLink[]> {
  return runList<LeadUnitLink>(
    'listLeadUnits',
    supabase.from('dev_lead_units').select('*').eq('lead_id', leadId).order('created_at'),
    leadId,
  );
}

export async function linkLeadUnit(
  workspaceId: string, leadId: string, unitId: string,
  interest: LeadUnitLink['interest'] = 'INTERESTED',
): Promise<void> {
  await run(
    'linkLeadUnit',
    supabase.from('dev_lead_units')
      .upsert({ workspace_id: workspaceId, lead_id: leadId, unit_id: unitId, interest },
              { onConflict: 'lead_id,unit_id' })
      .select('id'),
    leadId,
  );
}

export async function unlinkLeadUnit(leadId: string, unitId: string): Promise<void> {
  await run(
    'unlinkLeadUnit',
    supabase.from('dev_lead_units').delete()
      .eq('lead_id', leadId).eq('unit_id', unitId).select('id'),
    leadId,
  );
}

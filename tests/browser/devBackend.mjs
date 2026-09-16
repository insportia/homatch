// A STATEFUL BACKEND FOR THE DEVELOPER ACCEPTANCE RUN.
//
// WHY THIS EXISTS AND WHAT IT IS NOT
//
// The other browser gates answer "does the screen come up". This one has to
// answer something harder: click, open, type, submit, save, RELOAD, and see
// the right thing still there. A stub that answers every read with `[]` can
// never show that, because nothing the interface writes is ever read back.
//
// So this holds state. It is a small PostgREST-shaped store that inserts,
// updates, filters, orders and pages, plus handlers for the workflow RPCs
// that mirror what production actually does.
//
// IT IS NOT THE DATABASE, AND IT IS NOT EVIDENCE ABOUT THE DATABASE.
// Every RPC handler below is a re-implementation, and a re-implementation can
// only ever prove that the INTERFACE sends the right thing and renders what
// comes back. The behaviour of the real functions — the capability checks, the
// status guards, the refusal to overwrite a signed figure — is proven against
// production separately, as an authenticated user with RLS live. Where the two
// could disagree, the database is the answer and this file is not.
//
// The numbers the handlers return are the ones production returned during
// those runs, so what the interface renders here is what it renders there.

/**
 * @param {{ empty?: boolean }} [options]
 *   `empty: true` starts with an account and NOTHING else — no workspace, no
 *   membership, no project, no apartments. That is the state production is
 *   actually in, and the only state in which the first-run screens can be
 *   seen at all: with a workspace already seeded, onboarding is skipped and
 *   every empty state is unreachable.
 */
export function makeBackend(options = {}) {
  const empty = options.empty === true;
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);
  let seq = 0;
  const uuid = () => {
    seq += 1;
    const n = String(seq).padStart(12, '0');
    return `00000000-0000-4000-8000-${n}`;
  };

  const WS = '00000000-0000-4000-8000-0000000000ws'.replace('ws', '01');
  const PROJECT = uuid();
  const BUILDING = uuid();

  /** The tables the Developer OS reads and writes. */
  const db = {
    users: [{
      id: 'u1', auth_id: 'u1', email: 'harness@example.test', is_admin: false,
      preferred_language: 'en', full_name: 'Harness User', created_at: now(),
    }],
    dev_workspaces: empty ? [] : [{
      id: WS, owner_id: 'u1', name: 'Harness Developments',
      slug: 'harness-developments', country: 'GE', city: 'Tbilisi',
      default_currency: 'USD', status: 'ACTIVE', feature_flags: {},
      brand_logo_url: null, brand_color: null, website: null, legal_name: null,
      developer_profile_id: null, created_at: now(), updated_at: now(),
    }],
    dev_members: empty ? [] : [{
      // status matters: listMyWorkspaces filters on ACTIVE, and a row without
      // it is a membership the product correctly refuses to see.
      id: uuid(), workspace_id: WS, user_id: 'u1', role: 'OWNER',
      status: 'ACTIVE', title: null, invited_by: null,
      created_at: now(), updated_at: now(),
    }],
    dev_team: empty ? [] : [{
      workspace_id: WS, user_id: 'u1', role: 'OWNER',
      full_name: 'Harness User', email: 'harness@example.test', title: null,
    }],
    dev_projects: empty ? [] : [{
      id: PROJECT, workspace_id: WS, name: 'Vera Heights', slug: 'vera-heights',
      country: 'GE', city: 'Tbilisi', district: 'Vera', address: 'Vera 12',
      description: 'Twelve apartments over three floors.',
      project_type: 'RESIDENTIAL', construction_status: 'UNDER_CONSTRUCTION',
      handover_date: '2027-06-30', currency: 'USD', amenities: [],
      legal_info: null, cover_image_url: null, master_plan_url: null,
      brochure_url: null, is_published: true, published_at: now(),
      latitude: null, longitude: null, registry_project_id: null,
      created_by: 'u1', created_at: now(), updated_at: now(),
    }],
    dev_buildings: empty ? [] : [{
      id: BUILDING, workspace_id: WS, project_id: PROJECT, name: 'Block A',
      code: 'A', floors_count: 3, facade_image_url: null, sort_order: 0,
      created_at: now(), updated_at: now(),
    }],
    dev_unit_types: [], dev_units: [], dev_floors: [], dev_unit_events: [],
    dev_leads: [], dev_lead_contacts: [], dev_lead_units: [], dev_activities: [],
    dev_tasks: [], dev_viewings: [], dev_offers: [], dev_reservations: [],
    dev_deals: [], dev_payment_schedule: [], dev_payments: [], dev_payment_plans: [],
    dev_documents: [], dev_commissions: [], dev_handovers: [], dev_notifications: [],
    dev_ad_connections: [], dev_broker_invites: [], dev_share_links: [],
    dev_share_events: [], dev_audit_log: [], dev_walkthroughs: [],
    dev_export_templates: [], dev_member_invites: [], dev_sales_ledger: [],
    outreach_contacts: [],
    dt_assets: [], dt_templates: [], dt_scenes: [], dt_experiences: [], dt_events: [],
  };

  // Twelve apartments, two layouts — the shape the import produces.
  for (const level of (empty ? [] : [5, 6, 7])) {
    for (let n = 1; n <= 4; n += 1) {
      const two = n <= 2;
      const code = two ? 'T2' : 'T3';
      let type = db.dev_unit_types.find((t) => t.code === code);
      if (!type) {
        type = {
          id: uuid(), workspace_id: WS, project_id: PROJECT, code,
          name: two ? 'Two bedroom' : 'Three bedroom',
          bedrooms: two ? 2 : 3, rooms: two ? 3 : 4,
          area_total: two ? 68.5 : 92, area_internal: null, area_balcony: null,
          description: null, floor_plan_url: null, template_id: null,
          created_by: 'u1', created_at: now(), updated_at: now(),
        };
        db.dev_unit_types.push(type);
      }
      const price = two ? 137000 : 184000;
      const area = two ? 68.5 : 92;
      db.dev_units.push({
        id: uuid(), workspace_id: WS, project_id: PROJECT, building_id: BUILDING,
        floor_id: null, unit_number: `A-${level * 100 + n}`, floor_level: level,
        status: 'AVAILABLE', unit_type: code, unit_type_id: type.id,
        bedrooms: two ? 2 : 3, rooms: two ? 3 : 4,
        area_total: area, area_internal: null, area_balcony: two ? 6 : 9,
        area_terrace: null, orientation: n % 2 ? 'South' : 'North',
        view_text: level === 7 ? 'Park' : 'Courtyard', ceiling_height: 3,
        condition: 'WHITE_FRAME', parking: null, storage: null,
        floor_plan_url: null, photos: [], video_url: null,
        price, currency: 'USD',
        price_per_sqm: Math.round((price / area) * 100) / 100,
        payment_plan_id: null, notes: null, hotspot: null,
        is_published: true, published_at: now(), sort_order: n,
        created_by: 'u1', created_at: now(), updated_at: now(),
      });
    }
  }

  if (!empty) db.dev_payment_plans.push({
    id: uuid(), workspace_id: WS, project_id: PROJECT, name: 'Standard 30/40/30',
    milestones: [
      { label: 'On signing', percent: 30, offset_days: 0 },
      { label: 'At topping out', percent: 40, offset_days: 120 },
      { label: 'On handover', percent: 30, offset_days: 300 },
    ],
    is_default: true, created_by: 'u1', created_at: now(), updated_at: now(),
  });

  // ── PostgREST-shaped filtering ───────────────────────────────────────────

  function coerce(raw) {
    if (raw === 'null') return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
    return raw.replace(/^"|"$/g, '');
  }

  function applyFilter(rows, column, spec) {
    const [op, ...rest] = spec.split('.');
    const raw = rest.join('.');
    switch (op) {
      case 'eq': return rows.filter((r) => String(r[column]) === String(coerce(raw)));
      case 'neq': return rows.filter((r) => String(r[column]) !== String(coerce(raw)));
      case 'is': return rows.filter((r) => (raw === 'null' ? r[column] == null : !!r[column]));
      case 'gte': return rows.filter((r) => Number(r[column]) >= Number(raw));
      case 'lte': return rows.filter((r) => Number(r[column]) <= Number(raw));
      case 'gt': return rows.filter((r) => Number(r[column]) > Number(raw));
      case 'lt': return rows.filter((r) => Number(r[column]) < Number(raw));
      case 'in': {
        const list = raw.replace(/^\(|\)$/g, '').split(',').map((v) => String(coerce(v)));
        return rows.filter((r) => list.includes(String(r[column])));
      }
      case 'ilike': {
        const needle = raw.replace(/%/g, '').toLowerCase();
        return rows.filter((r) => String(r[column] ?? '').toLowerCase().includes(needle));
      }
      default: return rows;
    }
  }

  function select(table, params) {
    let rows = [...(db[table] ?? [])];
    for (const [key, value] of params.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      if (key === 'or') {
        const parts = value.replace(/^\(|\)$/g, '').split(',');
        const seen = new Set();
        const matched = [];
        for (const part of parts) {
          const [col, ...spec] = part.split('.');
          for (const r of applyFilter(rows, col, spec.join('.'))) {
            if (!seen.has(r.id)) { seen.add(r.id); matched.push(r); }
          }
        }
        rows = matched;
        continue;
      }
      rows = applyFilter(rows, key, value);
    }

    const order = params.get('order');
    if (order) {
      for (const clause of order.split(',').reverse()) {
        const [col, dir] = clause.split('.');
        const asc = dir !== 'desc';
        rows.sort((a, b) => {
          const x = a[col]; const y = b[col];
          if (x === y) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x > y ? 1 : -1) * (asc ? 1 : -1);
        });
      }
    }
    return rows;
  }

  /** `dev_units(unit_number)` style embeds, resolved by convention. */
  const EMBEDS = {
    dev_units: (row) => db.dev_units.find((u) => u.id === row.unit_id) ?? null,
    dev_projects: (row) => db.dev_projects.find((p) => p.id === row.project_id) ?? null,
    dev_deals: (row) => db.dev_deals.find((d) => d.id === row.deal_id) ?? null,
  };

  function withEmbeds(rows, selectSpec) {
    if (!selectSpec || !selectSpec.includes('(')) return rows;
    const names = [...selectSpec.matchAll(/([a-z_]+)\(/g)].map((m) => m[1]);
    return rows.map((row) => {
      const out = { ...row };
      for (const name of names) {
        if (EMBEDS[name]) out[name] = EMBEDS[name](row);
      }
      return out;
    });
  }

  // ── The workflow RPCs ────────────────────────────────────────────────────

  const RPC = {
    /*
     * Onboarding's one write, shaped like the real one: the caller becomes the
     * OWNER of a workspace that did not exist, an ACTIVE membership is created
     * for THEM and nobody else, and an audit row records it. The production
     * function is SECURITY DEFINER and derives the user from the verified
     * token rather than from anything the client sends, which is the half
     * this cannot model and which is proven against the database instead.
     */
    dev_create_workspace: (args) => {
      const name = String(args.p_name ?? '').trim();
      if (!name) return { __error: 'A workspace needs a name.' };
      const id = uuid();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
      db.dev_workspaces.push({
        id, owner_id: 'u1', name, slug,
        country: args.p_country ?? null, city: args.p_city ?? null,
        default_currency: args.p_currency ?? 'USD', status: 'ACTIVE',
        feature_flags: {}, brand_logo_url: null, brand_color: null,
        website: null, legal_name: null, developer_profile_id: null,
        created_at: now(), updated_at: now(),
      });
      db.dev_members.push({
        id: uuid(), workspace_id: id, user_id: 'u1', role: 'OWNER',
        status: 'ACTIVE', title: null, invited_by: null,
        created_at: now(), updated_at: now(),
      });
      db.dev_team.push({
        workspace_id: id, user_id: 'u1', role: 'OWNER',
        full_name: 'Harness User', email: 'harness@example.test', title: null,
      });
      db.dev_audit_log.push({
        id: uuid(), workspace_id: id, actor_id: 'u1', entity_type: 'workspace',
        entity_id: id, action: 'CREATED', before_state: null,
        after_state: { name }, created_at: now(),
      });
      return id;
    },

    /*
     * The import, which is how a developer's first apartments arrive: the
     * building and the floor come out of the spreadsheet's own columns, so
     * "Block A / 5 / A-501" creates the building and the floor as well as the
     * apartment. Production does this in one transaction; a sheet that breaks
     * on row 400 leaves no rows behind at all.
     */
    dev_import_units: (args) => {
      const project = db.dev_projects.find((p) => p.id === args.p_project_id);
      if (!project) return { __error: 'Unknown project.' };
      const rows = Array.isArray(args.p_rows) ? args.p_rows : [];
      let inserted = 0;
      let updated = 0;
      const errors = [];
      rows.forEach((row, i) => {
        const number = String(row.unit_number ?? '').trim();
        if (!number) { errors.push({ row: i + 1, message: 'No unit number.' }); return; }
        const buildingName = String(row.building ?? '').trim() || 'Building';
        let building = db.dev_buildings.find(
          (b) => b.project_id === project.id && b.name === buildingName);
        if (!building) {
          building = {
            id: uuid(), workspace_id: project.workspace_id, project_id: project.id,
            name: buildingName, code: buildingName.slice(0, 4), floors_count: 0,
            facade_image_url: null, sort_order: db.dev_buildings.length,
            created_at: now(), updated_at: now(),
          };
          db.dev_buildings.push(building);
        }
        const level = row.floor_level === undefined || row.floor_level === ''
          ? null : Number(row.floor_level);
        if (level !== null && Number.isFinite(level)) {
          const seen = db.dev_floors.find(
            (fl) => fl.building_id === building.id && fl.level === level);
          if (!seen) {
            db.dev_floors.push({
              id: uuid(), workspace_id: project.workspace_id, project_id: project.id,
              building_id: building.id, level, name: `Floor ${level}`,
              plan_image_url: null, created_at: now(), updated_at: now(),
            });
          }
          building.floors_count = db.dev_floors.filter(
            (fl) => fl.building_id === building.id).length;
        }
        const existing = db.dev_units.find(
          (u) => u.project_id === project.id && u.unit_number === number);
        if (existing) {
          if (args.p_mode === 'UPSERT') { Object.assign(existing, { updated_at: now() }); updated += 1; }
          else errors.push({ row: i + 1, message: 'Already here.' });
          return;
        }
        const price = row.price === undefined || row.price === '' ? null : Number(row.price);
        const area = row.area_total === undefined || row.area_total === ''
          ? null : Number(row.area_total);
        db.dev_units.push({
          id: uuid(), workspace_id: project.workspace_id, project_id: project.id,
          building_id: building.id, floor_id: null, unit_number: number,
          floor_level: level, status: 'AVAILABLE', unit_type: null, unit_type_id: null,
          bedrooms: row.bedrooms ? Number(row.bedrooms) : null,
          rooms: row.rooms ? Number(row.rooms) : null,
          area_total: area, area_internal: null, area_balcony: null, area_terrace: null,
          orientation: null, view_text: null, ceiling_height: null, condition: null,
          parking: null, storage: null, floor_plan_url: null, photos: [], video_url: null,
          price, currency: project.currency ?? 'USD',
          price_per_sqm: price && area ? Math.round((price / area) * 100) / 100 : null,
          payment_plan_id: null, notes: null, hotspot: null,
          is_published: false, published_at: null, sort_order: db.dev_units.length,
          created_by: 'u1', created_at: now(), updated_at: now(),
        });
        inserted += 1;
      });
      return { inserted, updated, skipped: errors.length, errors };
    },

    dev_claim_invites: () => 0,
    dev_expire_reservations: () => 0,
    dev_expire_offers: () => 0,
    dev_generate_notifications: () => 0,
    dt_studio_projects: () => null,
    dt_studio_costs: () => null,
    dev_share_resolve: () => ({ error: 'NOT_FOUND' }),
    dev_buyer_room: () => ({ error: 'NOT_FOUND' }),
    dt_experience_manifest: () => ({ error: 'NOT_FOUND' }),
    dev_public_project: () => ({ error: 'NOT_FOUND' }),

    dev_workspace_overview: () => {
      const units = db.dev_units;
      const leads = db.dev_leads;
      return {
        units: {
          total: units.length,
          available: units.filter((u) => u.status === 'AVAILABLE').length,
          reserved: units.filter((u) => u.status === 'RESERVED').length,
          negotiation: units.filter((u) => u.status === 'NEGOTIATION').length,
          contract_pending: units.filter((u) => u.status === 'CONTRACT_PENDING').length,
          sold: units.filter((u) => u.status === 'SOLD').length,
          value_available: units.filter((u) => u.status === 'AVAILABLE')
            .reduce((s, u) => s + Number(u.price ?? 0), 0),
        },
        leads: {
          total: leads.length,
          new: leads.filter((l) => l.stage === 'NEW').length,
          active: leads.filter((l) => !['LOST', 'SOLD'].includes(l.stage)).length,
          negotiation: leads.filter((l) => l.stage === 'NEGOTIATION').length,
          overdue_follow_ups: 0,
        },
        viewings: { today: 0, upcoming: db.dev_viewings.length },
        reservations: {
          active: db.dev_reservations.filter((r) => r.status === 'ACTIVE').length,
          expiring_soon: 0, expired_unresolved: 0,
        },
        sales: {
          this_month: db.dev_deals.length,
          value_this_month: db.dev_deals.reduce((s, d) => s + Number(d.sale_price ?? 0), 0),
          contracted_value: db.dev_deals.reduce((s, d) => s + Number(d.sale_price ?? 0), 0),
        },
        money: {
          collected: confirmedTotal(), collected_this_month: confirmedTotal(),
          awaiting_confirmation: recordedTotal(),
        },
        schedule: { overdue_count: 0, overdue_amount: 0, due_30d: 0 },
        tasks: { open: db.dev_tasks.filter((t) => !t.completed_at).length, overdue: 0 },
        documents: {
          needs_review: db.dev_documents.filter(
            (d) => d.status === 'EXTRACTED' || d.status === 'UPLOADED').length,
        },
      };
    },

    dev_create_lead: (a) => {
      const contact = {
        id: uuid(), full_name: a.p_full_name, phone: a.p_phone,
        email: a.p_email, language: a.p_language, country: a.p_country,
      };
      db.outreach_contacts.push(contact);
      const lead = {
        id: uuid(), workspace_id: a.p_workspace, contact_id: contact.id,
        project_id: a.p_project_id, stage: 'NEW', disposition: null,
        assigned_to: 'u1', source: a.p_source, campaign_id: null,
        budget_min: a.p_budget_min, budget_max: a.p_budget_max,
        currency: a.p_currency ?? 'USD', preferences: {}, score: null,
        score_factors: {}, lost_reason: null, lost_note: null,
        next_follow_up_at: null, last_activity_at: now(), notes: a.p_notes,
        created_by: 'u1', created_at: now(), updated_at: now(),
      };
      db.dev_leads.push(lead);
      db.dev_lead_contacts.push({
        lead_id: lead.id, workspace_id: a.p_workspace, contact_id: contact.id,
        full_name: contact.full_name, phone: contact.phone, email: contact.email,
        language: contact.language, country: contact.country,
      });
      return lead.id;
    },

    dev_update_contact: (a) => {
      const link = db.dev_lead_contacts.find((c) => c.lead_id === a.p_lead_id);
      const contact = db.outreach_contacts.find((c) => c.id === link?.contact_id);
      for (const [k, v] of [['full_name', a.p_full_name], ['phone', a.p_phone],
        ['email', a.p_email], ['language', a.p_language], ['country', a.p_country]]) {
        if (v != null) { if (link) link[k] = v; if (contact) contact[k] = v; }
      }
      return null;
    },

    dev_set_lead_stage: (a) => {
      const lead = db.dev_leads.find((l) => l.id === a.p_lead_id);
      if (lead) {
        db.dev_activities.push({
          id: uuid(), workspace_id: lead.workspace_id, lead_id: lead.id,
          unit_id: null, deal_id: null, contact_id: lead.contact_id,
          kind: 'STAGE_CHANGE', provenance: 'HOMATCH', direction: null,
          title: `Stage ${String(a.p_stage).toLowerCase()}`, body: null,
          meta: { from: lead.stage, to: a.p_stage }, actor_id: 'u1',
          occurred_at: now(), created_at: now(),
        });
        lead.stage = a.p_stage;
      }
      return null;
    },

    /*
     * The case the pre-merge pass found broken. Nought per cent is a real
     * discount of nothing, never NULL — mirroring the corrected SQL.
     */
    dev_create_offer: (a) => {
      const unit = db.dev_units.find((u) => u.id === a.p_unit_id);
      const base = Number(unit.price);
      const disc = a.p_discount_amount != null
        ? Number(a.p_discount_amount)
        : a.p_discount_pct != null
          ? Math.round(base * Number(a.p_discount_pct)) / 100
          : 0;
      const pct = a.p_discount_pct != null
        ? Number(a.p_discount_pct)
        : disc > 0 ? Math.round((disc * 100 / base) * 100) / 100 : 0;
      for (const o of db.dev_offers) {
        if (o.lead_id === a.p_lead_id && o.unit_id === a.p_unit_id
            && ['DRAFT', 'SENT', 'VIEWED'].includes(o.status)) o.status = 'SUPERSEDED';
      }
      const offer = {
        id: uuid(), workspace_id: unit.workspace_id, lead_id: a.p_lead_id,
        unit_id: unit.id, base_price: base, discount_pct: pct,
        discount_amount: disc, final_price: base - disc, currency: unit.currency,
        deposit_amount: a.p_deposit_amount, payment_plan_id: a.p_payment_plan_id,
        schedule: [], valid_until: a.p_valid_until, status: 'DRAFT',
        sent_at: null, viewed_at: null, accepted_at: null, notes: a.p_notes,
        created_by: 'u1', created_at: now(), updated_at: now(),
      };
      db.dev_offers.push(offer);
      return offer.id;
    },

    dev_set_offer_status: (a) => {
      const o = db.dev_offers.find((x) => x.id === a.p_offer_id);
      if (o) {
        o.status = a.p_status;
        if (a.p_status === 'SENT') o.sent_at = now();
        if (a.p_status === 'ACCEPTED') o.accepted_at = now();
      }
      return null;
    },

    dev_reserve_unit: (a) => {
      const unit = db.dev_units.find((u) => u.id === a.p_unit_id);
      if (['RESERVED', 'CONTRACT_PENDING', 'SOLD'].includes(unit.status)) {
        return { __error: `Unit ${unit.unit_number} is not available.` };
      }
      const lead = db.dev_leads.find((l) => l.id === a.p_lead_id);
      const res = {
        id: uuid(), workspace_id: unit.workspace_id, unit_id: unit.id,
        lead_id: a.p_lead_id, offer_id: a.p_offer_id, amount: a.p_amount,
        currency: a.p_currency ?? 'USD', reserved_at: now(),
        expires_at: a.p_expires_at, status: 'ACTIVE', assigned_to: 'u1',
        broker_id: null, source: lead?.source ?? null, notes: a.p_notes,
        cancelled_reason: null, created_by: 'u1',
        created_at: now(), updated_at: now(),
      };
      db.dev_reservations.push(res);
      unit.status = 'RESERVED';
      if (lead) lead.stage = 'RESERVATION';
      db.dev_unit_events.push({
        id: uuid(), unit_id: unit.id, workspace_id: unit.workspace_id,
        from_status: 'AVAILABLE', to_status: 'RESERVED', actor_id: 'u1',
        created_at: now(),
      });
      return res.id;
    },

    dev_convert_reservation: (a) => {
      const res = db.dev_reservations.find((r) => r.id === a.p_reservation_id);
      const unit = db.dev_units.find((u) => u.id === res.unit_id);
      const lead = db.dev_leads.find((l) => l.id === res.lead_id);
      res.status = 'CONVERTED';
      unit.status = 'CONTRACT_PENDING';
      if (lead) lead.stage = 'CONTRACT';
      const deal = {
        id: uuid(), workspace_id: unit.workspace_id, unit_id: unit.id,
        lead_id: res.lead_id, project_id: unit.project_id, reservation_id: res.id,
        offer_id: res.offer_id, assigned_to: 'u1', broker_id: null,
        source: lead?.source ?? null, contract_number: a.p_contract_number,
        contract_date: a.p_contract_date, sale_date: null,
        list_price: Number(unit.price), discount_amount: 0,
        sale_price: Number(a.p_sale_price), currency: unit.currency,
        payment_plan_id: a.p_payment_plan_id, status: 'CONTRACT_PENDING',
        contract_status: 'DRAFT', contract_signed_at: null,
        payment_method: null, handover_target_date: null,
        notes: null, created_by: 'u1', created_at: now(), updated_at: now(),
      };
      db.dev_deals.push(deal);
      buildSchedule(deal, a.p_payment_plan_id);
      refreshLedger();
      return deal.id;
    },

    dev_set_contract_status: (a) => {
      const d = db.dev_deals.find((x) => x.id === a.p_deal_id);
      if (d) {
        d.contract_status = a.p_status;
        if (a.p_status === 'SIGNED') d.contract_signed_at = a.p_signed_on ?? today();
      }
      return null;
    },

    dev_mark_deal_sold: (a) => {
      const d = db.dev_deals.find((x) => x.id === a.p_deal_id);
      const unit = db.dev_units.find((u) => u.id === d.unit_id);
      const lead = db.dev_leads.find((l) => l.id === d.lead_id);
      d.status = 'CONTRACTED';
      d.sale_date = a.p_sale_date ?? today();
      unit.status = 'SOLD';
      if (lead) lead.stage = 'SOLD';
      refreshLedger();
      return null;
    },

    dev_confirm_payment: (a) => {
      const p = db.dev_payments.find((x) => x.id === a.p_payment_id);
      if (p) {
        p.status = 'CONFIRMED';
        p.confirmed_at = now();
        p.confirmed_by = 'u1';
        const row = db.dev_payment_schedule.find((s) => s.id === p.schedule_id);
        if (row) {
          row.paid_amount = Number(row.paid_amount) + Number(p.amount);
          row.status = Number(row.paid_amount) >= Number(row.amount) ? 'PAID' : 'PARTIAL';
        }
        refreshLedger();
      }
      return null;
    },

    /*
     * The safety property the whole product turns on: a corrected price never
     * rewrites the signed plan, and the gap it leaves is reported.
     */
    dev_apply_extraction: (a) => {
      const doc = db.dev_documents.find((d) => d.id === a.p_document_id);
      const deal = db.dev_deals.find((d) => d.id === doc?.deal_id);
      const applied = []; const skipped = []; const warnings = [];
      const f = a.p_fields ?? {};

      if (deal && f.sale_price != null && f.sale_price !== '') {
        const proposed = Number(f.sale_price);
        if (deal.sale_price != null && Number(deal.sale_price) !== proposed && !a.p_overwrite) {
          skipped.push({
            field: 'sale_price', existing: deal.sale_price,
            proposed, reason: 'DIFFERS_FROM_EXISTING',
          });
        } else {
          applied.push({ field: 'sale_price', from: deal.sale_price, to: proposed });
          deal.sale_price = proposed;
          const total = db.dev_payment_schedule
            .filter((s) => s.deal_id === deal.id)
            .reduce((s, r) => s + Number(r.amount), 0);
          if (total && total !== proposed) {
            warnings.push({
              kind: 'SCHEDULE_TOTAL_MISMATCH', sale_price: proposed,
              schedule_total: total, difference: total - proposed,
            });
          }
          refreshLedger();
        }
      }

      if (deal && doc && ['PAYMENT_RECEIPT', 'BANK_CONFIRMATION'].includes(doc.doc_type)
          && f.amount != null && f.amount !== '') {
        if (db.dev_payments.some((p) => p.document_id === doc.id)) {
          skipped.push({
            field: 'amount', proposed: Number(f.amount),
            reason: 'PAYMENT_ALREADY_RECORDED',
          });
        } else {
          const payment = {
            id: uuid(), workspace_id: doc.workspace_id, deal_id: deal.id,
            schedule_id: null, amount: Number(f.amount), currency: deal.currency,
            paid_at: f.paid_at ?? today(), method: f.method ?? 'BANK_TRANSFER',
            reference: f.reference ?? null, document_id: doc.id,
            status: 'RECORDED', confirmed_by: null, confirmed_at: null,
            rejected_reason: null,
            notes: `Recorded from ${doc.title} — awaiting confirmation.`,
            created_by: 'u1', created_at: now(), updated_at: now(),
          };
          db.dev_payments.push(payment);
          applied.push({
            field: 'payment', to: payment.amount, payment_id: payment.id,
            note: 'RECORDED, still needs finance confirmation',
          });
        }
      }

      if (doc && applied.length > 0) {
        doc.status = 'CONFIRMED';
        doc.confirmed_at = now();
        doc.confirmed_by = 'u1';
      }
      return { applied, skipped, warnings };
    },

    dev_reject_extraction: (a) => {
      const doc = db.dev_documents.find((d) => d.id === a.p_document_id);
      if (doc) { doc.status = 'REJECTED'; doc.extraction_error = a.p_reason; }
      return null;
    },

    dev_create_share_link: (a) => {
      const link = {
        id: uuid(), workspace_id: WS, token: `tok-${uuid().slice(-8)}`,
        target_type: a.p_target_type, target_id: a.p_target_id,
        visibility: 'UNLISTED', label: a.p_label ?? null, lead_id: a.p_lead_id,
        contact_id: null, expires_at: a.p_expires_at, revoked_at: null,
        view_count: 0, last_viewed_at: null, created_by: 'u1', created_at: now(),
      };
      db.dev_share_links.push(link);
      return link;
    },

    dev_dashboard: () => {
      const units = db.dev_units;
      const deals = db.dev_deals.filter((d) => d.status !== 'CANCELLED');
      const sched = db.dev_payment_schedule;
      return {
        inventory: {
          total: units.length,
          available: units.filter((u) => u.status === 'AVAILABLE').length,
          reserved: units.filter((u) => u.status === 'RESERVED').length,
          on_hold: units.filter((u) => u.status === 'ON_HOLD').length,
          negotiation: units.filter((u) => u.status === 'NEGOTIATION').length,
          contract_pending: units.filter((u) => u.status === 'CONTRACT_PENDING').length,
          sold: units.filter((u) => u.status === 'SOLD').length,
          value_available: units.filter((u) => u.status === 'AVAILABLE')
            .reduce((s, u) => s + Number(u.price ?? 0), 0),
          area_available: units.filter((u) => u.status === 'AVAILABLE')
            .reduce((s, u) => s + Number(u.area_total ?? 0), 0),
        },
        sales: {
          count: deals.length,
          value: deals.reduce((s, d) => s + Number(d.sale_price ?? 0), 0),
          avg_value: deals.length
            ? deals.reduce((s, d) => s + Number(d.sale_price ?? 0), 0) / deals.length : null,
          discount_given: deals.reduce((s, d) => s + Number(d.discount_amount ?? 0), 0),
        },
        money: { collected: confirmedTotal(), awaiting_confirmation: recordedTotal() },
        receivables: {
          overdue_count: sched.filter((s) => s.status === 'OVERDUE').length,
          overdue_amount: sched.filter((s) => s.status === 'OVERDUE')
            .reduce((s, r) => s + (Number(r.amount) - Number(r.paid_amount)), 0),
          due_30d: sched.filter((s) => ['PENDING', 'PARTIAL'].includes(s.status))
            .reduce((s, r) => s + (Number(r.amount) - Number(r.paid_amount)), 0),
          outstanding_total: sched.filter((s) => s.status !== 'PAID')
            .reduce((s, r) => s + (Number(r.amount) - Number(r.paid_amount)), 0),
        },
        funnel: {
          leads: db.dev_leads.length,
          qualified: db.dev_leads.filter((l) => !['NEW', 'LOST'].includes(l.stage)).length,
          viewing: 0,
          reserved: db.dev_leads.filter(
            (l) => ['RESERVATION', 'CONTRACT', 'PAYMENT_PENDING', 'SOLD'].includes(l.stage)).length,
          sold: db.dev_leads.filter((l) => l.stage === 'SOLD').length,
          lost: 0,
        },
        by_project: db.dev_projects.map((p) => ({
          project_id: p.id, name: p.name,
          available: units.filter((u) => u.project_id === p.id && u.status === 'AVAILABLE').length,
          sold: units.filter((u) => u.project_id === p.id && u.status === 'SOLD').length,
          total: units.filter((u) => u.project_id === p.id).length,
        })),
        by_salesperson: deals.length ? [{
          user_id: 'u1', sales: deals.length,
          value: deals.reduce((s, d) => s + Number(d.sale_price ?? 0), 0),
        }] : [],
        by_source: deals.length ? [{
          source: deals[0].source ?? 'UNRECORDED', sales: deals.length,
          value: deals.reduce((s, d) => s + Number(d.sale_price ?? 0), 0),
        }] : [],
        commissions: { pending: 0, approved: 0, paid: 0 },
        handover: { pending: 0, overdue: 0, completed: 0 },
      };
    },

    dt_analytics: () => ({
      since: new Date(0).toISOString(),
      totals: {
        opens: 0, unit_views: 0, floorplan_views: 0,
        walkthroughs: 0, contact_requests: 0, visitors: 0,
      },
      by_origin: [], top_units: [], daily: [],
    }),
  };

  function confirmedTotal() {
    return db.dev_payments.filter((p) => p.status === 'CONFIRMED')
      .reduce((s, p) => s + Number(p.amount), 0);
  }
  function recordedTotal() {
    return db.dev_payments.filter((p) => p.status === 'RECORDED')
      .reduce((s, p) => s + Number(p.amount), 0);
  }

  function buildSchedule(deal, planId) {
    const plan = db.dev_payment_plans.find((p) => p.id === planId)
      ?? db.dev_payment_plans[0];
    if (!plan) return;
    plan.milestones.forEach((m, i) => {
      const due = new Date();
      due.setDate(due.getDate() + Number(m.offset_days ?? 0));
      db.dev_payment_schedule.push({
        id: uuid(), workspace_id: deal.workspace_id, deal_id: deal.id,
        seq: i + 1, label: m.label,
        due_date: due.toISOString().slice(0, 10),
        amount: Math.round(Number(deal.sale_price) * Number(m.percent)) / 100,
        currency: deal.currency, status: 'PENDING', paid_amount: 0,
        created_at: now(), updated_at: now(),
      });
    });
  }

  /** The ledger is derived, exactly as the view is. */
  function refreshLedger() {
    db.dev_sales_ledger = db.dev_deals.map((d) => {
      const unit = db.dev_units.find((u) => u.id === d.unit_id);
      const project = db.dev_projects.find((p) => p.id === d.project_id);
      const contact = db.dev_lead_contacts.find((c) => c.lead_id === d.lead_id);
      const paid = db.dev_payments
        .filter((p) => p.deal_id === d.id && p.status === 'CONFIRMED')
        .reduce((s, p) => s + Number(p.amount), 0);
      const next = db.dev_payment_schedule
        .filter((s) => s.deal_id === d.id && s.status !== 'PAID')
        .sort((a, b) => a.seq - b.seq)[0];
      return {
        deal_id: d.id, workspace_id: d.workspace_id,
        project: project?.name ?? null, building: 'Block A',
        unit_number: unit?.unit_number ?? '', floor_level: unit?.floor_level ?? null,
        area_total: unit?.area_total ?? null, unit_type: unit?.unit_type ?? null,
        bedrooms: unit?.bedrooms ?? null,
        buyer: contact?.full_name ?? null, buyer_phone: contact?.phone ?? null,
        buyer_email: contact?.email ?? null, sales_manager: 'Harness User',
        lead_source: d.source, broker: null, reserved_at: null,
        contract_number: d.contract_number, contract_date: d.contract_date,
        sale_date: d.sale_date, list_price: d.list_price,
        discount_amount: d.discount_amount, sale_price: Number(d.sale_price),
        currency: d.currency,
        sale_price_per_sqm: unit?.area_total
          ? Math.round((Number(d.sale_price) / Number(unit.area_total)) * 100) / 100 : null,
        paid, outstanding: Number(d.sale_price) - paid,
        next_payment_due: next?.due_date ?? null,
        next_payment_amount: next ? Number(next.amount) - Number(next.paid_amount) : null,
        payment_status: paid >= Number(d.sale_price) ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING',
        deal_status: d.status, unit_status: unit?.status ?? 'AVAILABLE',
        notes: d.notes, unit_id: d.unit_id, lead_id: d.lead_id,
        project_id: d.project_id,
      };
    });
  }

  return { db, select, withEmbeds, RPC, uuid, now, WS, PROJECT, BUILDING, refreshLedger };
}

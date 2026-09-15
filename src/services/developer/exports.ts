// HOMATCH FOR DEVELOPERS — the sales file a developer's management already
// reads, produced from the deals rather than typed a second time.
//
// §42 AND WHAT A CUSTOMER'S TEMPLATE IS ALLOWED TO CONTRIBUTE
//
// Developers have their own spreadsheet formats, and the point of a custom
// template is that the file that comes out looks like the one they already
// circulate. What is taken from their workbook is the HEADER TEXT and the
// COLUMN ORDER, mapped onto fields Homatch actually has. Nothing else.
//
// No formulas from their file are kept, no macros are read, no embedded
// content is re-emitted. An uploaded template is parsed for its first row,
// that row becomes a list of strings, and the strings are paired with field
// names by a person looking at a mapping screen. The workbook itself is never
// stored and never opened again.

import { run, runList, supabase } from './client';
import { buildWorkbook, toCsv, downloadBlob, safeFileName } from '@/lib/xlsx';
import type { SheetColumn, CellValue, ColumnFormat } from '@/lib/xlsx';
import type { SalesLedgerRow, DevUnit } from './types';

export interface ExportTemplate {
  id: string;
  workspace_id: string;
  name: string;
  kind: 'SALES_LEDGER' | 'INVENTORY' | 'PAYMENTS' | 'CRM';
  columns: Array<{ header: string; field: string; format?: ColumnFormat }>;
  is_default: boolean;
  created_at: string;
}

/**
 * Every field the sales ledger can put in a column, with the format it should
 * carry. This is also the list a mapping screen offers, which is why the
 * labels are written for a person rather than derived from the column name.
 */
export const LEDGER_FIELDS: Array<{ field: keyof SalesLedgerRow; label: string; format: ColumnFormat }> = [
  { field: 'project', label: 'Project', format: 'text' },
  { field: 'building', label: 'Building', format: 'text' },
  { field: 'unit_number', label: 'Unit', format: 'text' },
  { field: 'floor_level', label: 'Floor', format: 'integer' },
  { field: 'unit_type', label: 'Type', format: 'text' },
  { field: 'bedrooms', label: 'Bedrooms', format: 'integer' },
  { field: 'area_total', label: 'Area (m²)', format: 'number' },
  { field: 'buyer', label: 'Buyer', format: 'text' },
  { field: 'buyer_phone', label: 'Buyer phone', format: 'text' },
  { field: 'buyer_email', label: 'Buyer email', format: 'text' },
  { field: 'sales_manager', label: 'Sales manager', format: 'text' },
  { field: 'lead_source', label: 'Lead source', format: 'text' },
  { field: 'broker', label: 'Broker', format: 'text' },
  { field: 'reserved_at', label: 'Reservation date', format: 'date' },
  { field: 'contract_number', label: 'Contract number', format: 'text' },
  { field: 'contract_date', label: 'Contract date', format: 'date' },
  { field: 'sale_date', label: 'Sale date', format: 'date' },
  { field: 'list_price', label: 'List price', format: 'currency' },
  { field: 'discount_amount', label: 'Discount', format: 'currency' },
  { field: 'sale_price', label: 'Sale price', format: 'currency' },
  { field: 'currency', label: 'Currency', format: 'text' },
  { field: 'sale_price_per_sqm', label: 'Price / m²', format: 'currency' },
  { field: 'paid', label: 'Paid', format: 'currency' },
  { field: 'outstanding', label: 'Outstanding', format: 'currency' },
  { field: 'next_payment_due', label: 'Next payment', format: 'date' },
  { field: 'next_payment_amount', label: 'Next amount', format: 'currency' },
  { field: 'payment_status', label: 'Payment status', format: 'text' },
  { field: 'deal_status', label: 'Deal status', format: 'text' },
  { field: 'unit_status', label: 'Unit status', format: 'text' },
  { field: 'notes', label: 'Notes', format: 'text' },
];

/** The shape a developer's sales file usually has, used when no template exists. */
export const DEFAULT_LEDGER_COLUMNS: SheetColumn[] = [
  'project', 'building', 'unit_number', 'floor_level', 'area_total', 'buyer',
  'buyer_phone', 'sales_manager', 'lead_source', 'broker', 'reserved_at',
  'contract_number', 'contract_date', 'sale_date', 'list_price', 'discount_amount',
  'sale_price', 'currency', 'sale_price_per_sqm', 'paid', 'outstanding',
  'next_payment_due', 'payment_status', 'deal_status', 'notes',
].map((field) => {
  const meta = LEDGER_FIELDS.find((f) => f.field === field);
  return { header: meta?.label ?? field, field, format: meta?.format ?? 'text' };
});

export const INVENTORY_COLUMNS: SheetColumn[] = [
  { header: 'Unit', field: 'unit_number', format: 'text' },
  { header: 'Building', field: 'building_name', format: 'text' },
  { header: 'Floor', field: 'floor_level', format: 'integer' },
  { header: 'Type', field: 'unit_type', format: 'text' },
  { header: 'Bedrooms', field: 'bedrooms', format: 'integer' },
  { header: 'Rooms', field: 'rooms', format: 'integer' },
  { header: 'Area (m²)', field: 'area_total', format: 'number' },
  { header: 'Balcony (m²)', field: 'area_balcony', format: 'number' },
  { header: 'Orientation', field: 'orientation', format: 'text' },
  { header: 'View', field: 'view_text', format: 'text' },
  { header: 'Price', field: 'price', format: 'currency' },
  { header: 'Currency', field: 'currency', format: 'text' },
  { header: 'Price / m²', field: 'price_per_sqm', format: 'currency' },
  { header: 'Status', field: 'status', format: 'text' },
  { header: 'Published', field: 'is_published', format: 'text' },
  { header: 'Notes', field: 'notes', format: 'text' },
];

export interface ExportContext {
  workspaceName: string;
  projectName?: string | null;
  /** Human-readable description of the filters that produced these rows. */
  filters?: string[];
}

function subtitles(context: ExportContext): string[] {
  const lines = [`Developer: ${context.workspaceName}`];
  if (context.projectName) lines.push(`Project: ${context.projectName}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  // The filters are printed because a sales report with no statement of what
  // it covers is a number somebody will later disagree with and be unable to
  // check (§81).
  for (const filter of context.filters ?? []) lines.push(filter);
  return lines;
}

export function ledgerColumns(template?: ExportTemplate | null): SheetColumn[] {
  if (!template || template.columns.length === 0) return DEFAULT_LEDGER_COLUMNS;
  return template.columns.map((c) => {
    const meta = LEDGER_FIELDS.find((f) => f.field === c.field);
    return { header: c.header, field: c.field, format: c.format ?? meta?.format ?? 'text' };
  });
}

export function exportLedgerXlsx(
  rows: SalesLedgerRow[], context: ExportContext, template?: ExportTemplate | null,
): void {
  const columns = ledgerColumns(template);
  const blob = buildWorkbook([{
    name: 'Sales',
    title: `${context.workspaceName} — sales`,
    subtitles: subtitles(context),
    columns,
    rows: rows as unknown as Array<Record<string, CellValue>>,
    // Only money columns that are actually present get a total.
    totals: ['sale_price', 'paid', 'outstanding', 'discount_amount']
      .filter((f) => columns.some((c) => c.field === f)),
  }]);
  downloadBlob(blob, safeFileName(`${context.workspaceName} sales`, 'xlsx'));
}

export function exportLedgerCsv(
  rows: SalesLedgerRow[], context: ExportContext, template?: ExportTemplate | null,
): void {
  const columns = ledgerColumns(template);
  const csv = toCsv(columns, rows as unknown as Array<Record<string, CellValue>>);
  // The BOM is what makes Excel on Windows read a UTF-8 CSV as UTF-8 rather
  // than as the system codepage, which is the difference between a Georgian
  // buyer's name and a row of question marks.
  downloadBlob(
    new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }),
    safeFileName(`${context.workspaceName} sales`, 'csv'));
}

export interface InventoryExportRow extends Record<string, CellValue> {
  unit_number: string;
}

export function exportInventoryXlsx(
  units: DevUnit[], buildingNames: Map<string, string>, context: ExportContext,
): void {
  const rows: InventoryExportRow[] = units.map((u) => ({
    unit_number: u.unit_number,
    building_name: u.building_id ? buildingNames.get(u.building_id) ?? null : null,
    floor_level: u.floor_level,
    unit_type: u.unit_type,
    bedrooms: u.bedrooms,
    rooms: u.rooms,
    area_total: u.area_total,
    area_balcony: u.area_balcony,
    orientation: u.orientation,
    view_text: u.view_text,
    price: u.price,
    currency: u.currency,
    price_per_sqm: u.price_per_sqm,
    status: u.status,
    is_published: u.is_published ? 'Yes' : 'No',
    notes: u.notes,
  }));

  const blob = buildWorkbook([{
    name: 'Inventory',
    title: `${context.projectName ?? context.workspaceName} — inventory`,
    subtitles: subtitles(context),
    columns: INVENTORY_COLUMNS,
    rows,
    totals: ['price'],
  }]);
  downloadBlob(blob, safeFileName(`${context.projectName ?? context.workspaceName} inventory`, 'xlsx'));
}

// ── Templates ──────────────────────────────────────────────────────────────

export async function listTemplates(
  workspaceId: string, kind?: ExportTemplate['kind'],
): Promise<ExportTemplate[]> {
  let query = supabase.from('dev_export_templates').select('*').eq('workspace_id', workspaceId);
  if (kind) query = query.eq('kind', kind);
  return runList<ExportTemplate>('listTemplates', query.order('name'), workspaceId);
}

export async function saveTemplate(
  workspaceId: string,
  input: { id?: string; name: string; kind: ExportTemplate['kind']; columns: ExportTemplate['columns'] },
): Promise<ExportTemplate> {
  if (input.id) {
    return run<ExportTemplate>(
      'saveTemplate.update',
      supabase.from('dev_export_templates')
        .update({ name: input.name, columns: input.columns })
        .eq('id', input.id).select().single(),
      input.id,
    );
  }
  return run<ExportTemplate>(
    'saveTemplate.insert',
    supabase.from('dev_export_templates')
      .insert({ workspace_id: workspaceId, name: input.name, kind: input.kind, columns: input.columns })
      .select().single(),
    workspaceId,
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  await run('deleteTemplate',
    supabase.from('dev_export_templates').delete().eq('id', id).select('id'), id);
}

/**
 * Guess which Homatch field a customer's header means.
 *
 * A suggestion the person confirms, never an automatic mapping (§72). The
 * dictionary is multilingual because a Georgian developer's sales file has
 * Georgian headers and asking them to rename their columns first would defeat
 * the point of the feature.
 */
const HEADER_HINTS: Array<{ field: string; patterns: RegExp[] }> = [
  { field: 'unit_number', patterns: [/unit/i, /apartment/i, /apt/i, /flat/i, /ბინ/i, /квартир/i, /daire/i, /№/] },
  { field: 'building', patterns: [/building/i, /block/i, /tower/i, /კორპუს/i, /блок/i, /корпус/i, /blok/i] },
  { field: 'floor_level', patterns: [/floor/i, /storey/i, /სართულ/i, /этаж/i, /kat/i] },
  { field: 'area_total', patterns: [/area/i, /m2/i, /m²/i, /sqm/i, /size/i, /ფართ/i, /площад/i, /alan/i] },
  { field: 'area_internal', patterns: [/internal/i, /net area/i, /living area/i] },
  { field: 'area_balcony', patterns: [/balcon/i, /აივან/i, /балкон/i, /balkon/i] },
  { field: 'bedrooms', patterns: [/bed/i, /საძინებ/i, /спальн/i, /yatak/i] },
  { field: 'rooms', patterns: [/room/i, /ოთახ/i, /комнат/i, /oda/i] },
  { field: 'price', patterns: [/price/i, /cost/i, /amount/i, /ფას/i, /цена/i, /стоим/i, /fiyat/i] },
  { field: 'currency', patterns: [/currency/i, /ვალუტ/i, /валют/i] },
  { field: 'unit_type', patterns: [/type/i, /layout/i, /ტიპ/i, /тип/i, /tip/i] },
  { field: 'orientation', patterns: [/orientation/i, /facing/i, /ორიენტ/i, /ориентац/i] },
  { field: 'view_text', patterns: [/view/i, /ხედ/i, /вид/i, /manzara/i] },
  { field: 'notes', patterns: [/note/i, /comment/i, /remark/i, /შენიშვნ/i, /примеч/i, /not/i] },
];

export function suggestFieldForHeader(header: string): string | null {
  const text = header.trim();
  if (!text) return null;
  for (const hint of HEADER_HINTS) {
    if (hint.patterns.some((p) => p.test(text))) return hint.field;
  }
  return null;
}

/** The fields dev_import_units understands. Anything else is ignored on import. */
export const IMPORT_FIELDS = [
  'unit_number', 'building', 'floor_level', 'unit_type', 'bedrooms', 'rooms',
  'area_total', 'area_internal', 'area_balcony', 'orientation', 'view_text',
  'price', 'currency', 'notes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

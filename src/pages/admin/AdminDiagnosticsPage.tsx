import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getAdminImportDiagnostics } from '@/services/api';
import { format } from 'date-fns';
import {
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight,
  AlertTriangle, ImageOff, Layers,
} from 'lucide-react';

const STATUS_ICON: Record<string, React.ElementType> = {
  COMPLETED: CheckCircle2, FAILED: XCircle, PROCESSING: Clock, PENDING: Clock, CACHED: CheckCircle2,
};
const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'text-green-600 dark:text-green-400',
  CACHED: 'text-green-600 dark:text-green-400',
  FAILED: 'text-destructive',
  PROCESSING: 'text-amber-600',
  PENDING: 'text-muted-foreground',
};
const STRATEGY_VARIANT: Record<string, string> = {
  DIRECT: 'bg-muted text-muted-foreground',
  ZENROWS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  SCRAPINGBEE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
};

function FallbackChain({ chain }: { chain: Array<{ strategy: string; status: string | number; size?: number; reason?: string }> }) {
  if (!chain?.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chain.map((step, i) => (
        <TooltipProvider key={i}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex items-center gap-0.5 rounded text-[10px] px-1.5 py-0.5 font-mono cursor-default
                ${typeof step.status === 'number' && step.status >= 200 && step.status < 300
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                  : step.status === 'skipped'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                {step.strategy.toUpperCase()}:{step.status}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-xs">
              <p className="font-semibold uppercase mb-0.5">{step.strategy}</p>
              <p>HTTP {step.status}{step.size !== undefined ? ` · ${(step.size / 1024).toFixed(1)}KB` : ''}</p>
              {step.reason && <p className="text-muted-foreground">{step.reason}</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

function ExpandableRow({ imp }: { imp: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[imp.status as string] ?? Clock;
  const color = STATUS_COLOR[imp.status as string] ?? 'text-muted-foreground';
  const chain = (imp.fallback_chain as Array<{ strategy: string; status: string | number; size?: number; reason?: string }>) ?? [];
  const missing = (imp.missing_critical as string[]) ?? [];

  return (
    <>
      <tr
        className="border-b border-border hover:bg-muted/30 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        {/* expand toggle */}
        <td className="px-3 py-2.5 w-6">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
        {/* URL */}
        <td className="px-3 py-2.5 max-w-[160px]">
          <a href={imp.source_url as string} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[11px] text-primary hover:underline truncate block font-mono">
            {imp.source_url as string ?? '—'}
          </a>
        </td>
        {/* property title */}
        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground max-w-[140px] truncate">
          {(imp as { properties?: { title?: string } }).properties?.title ?? '—'}
        </td>
        {/* strategy */}
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className={`inline-block rounded text-[10px] px-1.5 py-0.5 font-medium
            ${STRATEGY_VARIANT[imp.fetch_strategy as string] ?? 'bg-muted text-muted-foreground'}`}>
            {(imp.fetch_strategy as string) ?? 'DIRECT'}
          </span>
        </td>
        {/* fields / photos */}
        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-center">
          <span className="font-mono">{imp.fields_found as number ?? '—'}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="font-mono">{imp.photos_found as number ?? '—'}</span>
        </td>
        {/* missing critical */}
        <td className="px-3 py-2.5 max-w-[140px]">
          {missing.length === 0
            ? <span className="text-green-600 dark:text-green-400 text-xs">✓ complete</span>
            : <span className="text-amber-600 text-[11px] truncate block">{missing.join(', ')}</span>}
        </td>
        {/* status */}
        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className={`flex items-center gap-1 text-xs font-medium ${color}`}>
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {imp.status as string}
          </div>
        </td>
        {/* date */}
        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
          {imp.created_at ? format(new Date(imp.created_at as string), 'MMM d, HH:mm') : '—'}
        </td>
      </tr>

      {/* expanded detail row */}
      {open && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">

              {/* Fallback chain */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground font-medium uppercase tracking-wide text-[10px] mb-1">
                  <Layers className="h-3 w-3" /> Fallback Chain
                </div>
                <FallbackChain chain={chain} />
              </div>

              {/* HTTP details */}
              <div className="space-y-1">
                <p className="text-muted-foreground font-medium uppercase tracking-wide text-[10px] mb-1">HTTP Details</p>
                <p>Status: <span className="font-mono">{String(imp.http_status ?? '—')}</span></p>
                <p>Response size: <span className="font-mono">
                  {imp.response_size ? `${((imp.response_size as number) / 1024).toFixed(1)} KB` : '—'}
                </span></p>
                <p>Cloudflare blocked: <span className={`font-medium ${imp.cloudflare_blocked ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
                  {imp.cloudflare_blocked ? 'yes' : 'no'}
                </span></p>
              </div>

              {/* Error */}
              {(imp.error_code || imp.error_message) && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-destructive font-medium uppercase tracking-wide text-[10px] mb-1">
                    <AlertTriangle className="h-3 w-3" /> Error
                  </div>
                  <p className="text-destructive font-mono">{String(imp.error_code ?? '')}</p>
                  {imp.error_message && <p className="text-muted-foreground">{imp.error_message as string}</p>}
                </div>
              )}

              {/* Photos */}
              {imp.photos_found !== undefined && imp.photos_found !== null && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground font-medium uppercase tracking-wide text-[10px] mb-1">
                    <ImageOff className="h-3 w-3" /> Photos
                  </div>
                  <p>{imp.photos_found as number > 0
                    ? `${imp.photos_found as number} listing photo(s) extracted`
                    : 'No listing photos found'
                  }</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminDiagnosticsPage() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminImportDiagnostics(200).then(d => setItems(d as Record<string, unknown>[])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold">Import Diagnostics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Per-import pipeline log — provider used, fallback chain, extracted fields, photos
        </p>
      </div>
      <Card>
        <CardHeader className="py-3 px-4 border-b border-border">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fields / Photos = non-null extracted fields / listing photos found
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-6 px-3 py-2.5" />
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">URL</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Property</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Strategy</th>
                  <th className="text-center px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Fields/Photos</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Missing Critical</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={8} className="px-4 py-2">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                  : items.length === 0
                    ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                          No import records yet
                        </td>
                      </tr>
                    )
                    : items.map(imp => <ExpandableRow key={imp.id as string} imp={imp} />)
                }
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';
import { getAdminSources, toggleSourceActive } from '@/services/api';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function AdminSourcesPage() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    getAdminSources(500).then(setSources).finally(() => setLoading(false));
  }, []);

  const toggle = async (id: string, active: boolean) => {
    setSources(s => s.map(x => x.id === id ? { ...x, active } : x));
    try {
      await toggleSourceActive(id, active);
      toast.success(active ? 'Source enabled' : 'Source disabled');
    } catch {
      setSources(s => s.map(x => x.id === id ? { ...x, active: !active } : x));
      toast.error('Failed to update source');
    }
  };

  const filtered = sources.filter(s =>
    !q || s.url?.toLowerCase().includes(q.toLowerCase()) ||
    s.platform?.toLowerCase().includes(q.toLowerCase())
  );

  const qScore = (s: any) => Number(s.quality_score ?? 0);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">Sources</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{sources.length} registered sources — disable poor-quality ones</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input className="pl-9" placeholder="Search by URL or platform…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Source</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Platform</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Quality</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Members</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Last Collected</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Active</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No sources found</td></tr>
                ) : filtered.map(s => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap max-w-[220px]">
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block text-xs">{s.url ?? '—'}</a>
                      {s.display_name && <div className="text-xs text-muted-foreground truncate">{s.display_name}</div>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px]">{s.platform ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(qScore(s) * 10, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{qScore(s).toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {s.member_count != null ? s.member_count.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                      {s.last_collected_at ? format(new Date(s.last_collected_at), 'MMM d, HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Switch checked={!!s.active} onCheckedChange={v => toggle(s.id, v)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import AdminLayout from '@/components/layouts/AdminLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { PlusCircle, Pencil, Trash2, ExternalLink, Loader2 } from 'lucide-react';

interface Placement {
  id: string;
  partner_name: string;
  category: string;
  headline: string;
  sub_headline: string | null;
  cta_label: string;
  destination_url: string;
  placement: string;
  market: string;
  language: string;
  start_date: string | null;
  end_date: string | null;
  enabled: boolean;
  sort_order: number;
}

const EMPTY: Omit<Placement, 'id'> = {
  partner_name: '', category: 'developer', headline: '', sub_headline: '',
  cta_label: 'Learn More', destination_url: '', placement: 'homepage',
  market: 'global', language: 'en', start_date: '', end_date: '',
  enabled: true, sort_order: 0,
};

export default function AdminSponsoredPage() {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Placement | null>(null);
  const [form, setForm] = useState<Omit<Placement, 'id'>>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('sponsored_placements')
      .select('*')
      .order('sort_order', { ascending: true });
    setPlacements(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (p: Placement) => {
    setEditing(p);
    setForm({ ...p, start_date: p.start_date ?? '', end_date: p.end_date ?? '', sub_headline: p.sub_headline ?? '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.partner_name || !form.headline || !form.destination_url) {
      toast.error('Partner name, headline and destination URL are required.');
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      sub_headline: form.sub_headline || null,
    };
    if (editing) {
      const { error } = await supabase.from('sponsored_placements').update(payload).eq('id', editing.id);
      if (error) { toast.error('Failed to update placement'); setSaving(false); return; }
      toast.success('Placement updated');
    } else {
      const { error } = await supabase.from('sponsored_placements').insert(payload);
      if (error) { toast.error('Failed to create placement'); setSaving(false); return; }
      toast.success('Placement created');
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const toggleEnabled = async (p: Placement) => {
    await supabase.from('sponsored_placements').update({ enabled: !p.enabled }).eq('id', p.id);
    setPlacements(prev => prev.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x));
  };

  const remove = async (id: string) => {
    await supabase.from('sponsored_placements').delete().eq('id', id);
    setPlacements(prev => prev.filter(x => x.id !== id));
    toast.success('Placement deleted');
  };

  const f = (k: keyof typeof form, v: string | boolean | number) =>
    setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Sponsored Placements</h1>
          <p className="text-sm text-muted-foreground">Manage partner ads. Every placement must show a visible Sponsored/Ad label.</p>
        </div>
        <Button onClick={openNew} size="sm" className="bg-primary text-primary-foreground gap-2">
          <PlusCircle className="h-4 w-4" /> New Placement
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : placements.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">No sponsored placements yet.</p>
            <Button onClick={openNew} size="sm" className="mt-4 bg-primary text-primary-foreground gap-2">
              <PlusCircle className="h-4 w-4" /> Create First Placement
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {placements.map(p => (
            <Card key={p.id} className={`border-border bg-card ${!p.enabled ? 'opacity-50' : ''}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{p.headline}</span>
                      <Badge variant="secondary" className="text-[10px] border-border">{p.placement}</Badge>
                      <Badge variant="secondary" className="text-[10px] border-border">{p.category}</Badge>
                      {!p.enabled && <Badge variant="secondary" className="text-[10px] text-muted-foreground">Disabled</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.partner_name} · {p.market} · {p.language}</p>
                    {(p.start_date || p.end_date) && (
                      <p className="text-xs text-muted-foreground">
                        {p.start_date ? new Date(p.start_date).toLocaleDateString() : '∞'} → {p.end_date ? new Date(p.end_date).toLocaleDateString() : '∞'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={p.enabled} onCheckedChange={() => toggleEnabled(p)} />
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => window.open(p.destination_url, '_blank')}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Placement' : 'New Sponsored Placement'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Partner Name *</Label>
                <Input value={form.partner_name} onChange={e => f('partner_name', e.target.value)} className="bg-secondary border-border text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={v => f('category', v)}>
                  <SelectTrigger className="bg-secondary border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['developer','agency','mortgage','relocation','legal','other'].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Headline *</Label>
              <Input value={form.headline} onChange={e => f('headline', e.target.value)} className="bg-secondary border-border text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sub-Headline</Label>
              <Input value={form.sub_headline ?? ''} onChange={e => f('sub_headline', e.target.value)} className="bg-secondary border-border text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Destination URL *</Label>
              <Input value={form.destination_url} onChange={e => f('destination_url', e.target.value)} placeholder="https://..." className="bg-secondary border-border text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Placement</Label>
                <Select value={form.placement} onValueChange={v => f('placement', v)}>
                  <SelectTrigger className="bg-secondary border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['homepage','search_results','property_detail','verify','sidebar'].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">CTA Label</Label>
                <Input value={form.cta_label} onChange={e => f('cta_label', e.target.value)} className="bg-secondary border-border text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Market</Label>
                <Input value={form.market} onChange={e => f('market', e.target.value)} placeholder="global" className="bg-secondary border-border text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Language</Label>
                <Input value={form.language} onChange={e => f('language', e.target.value)} placeholder="en" className="bg-secondary border-border text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <Input type="datetime-local" value={form.start_date ?? ''} onChange={e => f('start_date', e.target.value)} className="bg-secondary border-border text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <Input type="datetime-local" value={form.end_date ?? ''} onChange={e => f('end_date', e.target.value)} className="bg-secondary border-border text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={form.enabled} onCheckedChange={v => f('enabled', v)} />
              <Label className="text-sm text-muted-foreground">Enabled</Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

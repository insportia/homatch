import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  CalendarDays, Clock, MapPin, CheckCircle, XCircle, RefreshCw,
  Ban, Check, Home, Plus,
} from 'lucide-react';
import { getViewingRequests, createViewingRequest, updateViewingRequest } from '@/services/api3';
import { getProperties } from '@/services/api';
import type { ViewingRequest } from '@/types/phase3';
import type { Property } from '@/types/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── Status badge ─────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  PENDING:             { label: 'Pending',              className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',   icon: Clock },
  ACCEPTED:            { label: 'Accepted',             className: 'bg-green-500/15 text-green-400 border-green-500/30',      icon: CheckCircle },
  DECLINED:            { label: 'Declined',             className: 'bg-red-500/15 text-red-400 border-red-500/30',            icon: XCircle },
  RESCHEDULE_PROPOSED: { label: 'Reschedule Proposed',  className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',         icon: RefreshCw },
  CANCELLED:           { label: 'Cancelled',            className: 'bg-muted text-muted-foreground border-border',            icon: Ban },
  COMPLETED:           { label: 'Completed',            className: 'bg-primary/15 text-primary border-primary/30',            icon: Check },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium', cfg.className)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Request Card ─────────────────────────────────────────────
function ViewingCard({
  vr, myId, onAction,
}: { vr: ViewingRequest; myId: string; onAction: (id: string, action: string, extra?: Record<string, unknown>) => Promise<void> }) {
  const isOwner = vr.owner_id === myId;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [propDate, setPropDate] = useState('');
  const [propTime, setPropTime] = useState('');
  const [propNote, setPropNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);

  const doAction = async (action: string, extra?: Record<string, unknown>) => {
    setActionLoading(true);
    await onAction(vr.id, action, extra);
    setActionLoading(false);
    setConfirming(null);
    setReschedOpen(false);
  };

  const prop = vr.property as { title?: string; city?: string } | undefined;
  const requester = vr.requester as { full_name?: string; email?: string } | undefined;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={vr.status} />
              {isOwner && (
                <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Your property</span>
              )}
            </div>
            {prop?.title && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground truncate">
                <Home className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{prop.title}</span>
              </div>
            )}
            {prop?.city && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                {prop.city}
              </div>
            )}
            {!isOwner && requester && (
              <p className="text-xs text-muted-foreground">Requester: {requester.full_name ?? requester.email}</p>
            )}
          </div>
          <div className="text-right shrink-0 space-y-0.5">
            <div className="flex items-center gap-1 justify-end text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary" />
              {vr.preferred_date}
            </div>
            {vr.preferred_time && (
              <div className="flex items-center gap-1 justify-end text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {vr.preferred_time}
              </div>
            )}
          </div>
        </div>

        {vr.note && (
          <p className="mt-2 text-xs text-muted-foreground border-l-2 border-border pl-2 italic">"{vr.note}"</p>
        )}

        {vr.status === 'RESCHEDULE_PROPOSED' && vr.proposed_date && (
          <div className="mt-2 p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-xs text-blue-400">
            Proposed: {vr.proposed_date} {vr.proposed_time ?? ''} {vr.propose_note ? `— "${vr.propose_note}"` : ''}
          </div>
        )}

        {/* Actions */}
        {vr.status !== 'CANCELLED' && vr.status !== 'DECLINED' && vr.status !== 'COMPLETED' && (
          <div className="mt-3 flex flex-wrap gap-2">
            {isOwner && vr.status === 'PENDING' && (
              <>
                <Button size="sm" className="h-7 text-xs" onClick={() => setConfirming('accept')} disabled={actionLoading}>
                  <CheckCircle className="h-3 w-3 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setReschedOpen(true)} disabled={actionLoading}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Reschedule
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive border-destructive/30" onClick={() => setConfirming('decline')} disabled={actionLoading}>
                  Decline
                </Button>
              </>
            )}
            {vr.status === 'RESCHEDULE_PROPOSED' && !isOwner && (
              <Button size="sm" className="h-7 text-xs" onClick={() => setConfirming('accept')} disabled={actionLoading}>
                Accept new time
              </Button>
            )}
            {(vr.status === 'PENDING' || vr.status === 'ACCEPTED' || vr.status === 'RESCHEDULE_PROPOSED') && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-muted-foreground" onClick={() => setConfirming('cancel')} disabled={actionLoading}>
                Cancel
              </Button>
            )}
            {vr.status === 'ACCEPTED' && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setConfirming('complete')} disabled={actionLoading}>
                <Check className="h-3 w-3 mr-1" /> Mark Complete
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {/* Confirm dialog */}
      <AlertDialog open={!!confirming} onOpenChange={() => setConfirming(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === 'accept' ? 'Accept viewing?' : confirming === 'decline' ? 'Decline viewing?' : confirming === 'cancel' ? 'Cancel viewing?' : 'Mark complete?'}
            </AlertDialogTitle>
            <AlertDialogDescription>This action will update the viewing request status.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => doAction(confirming!)} disabled={actionLoading}>
              {actionLoading ? 'Processing…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reschedule dialog */}
      <Dialog open={reschedOpen} onOpenChange={setReschedOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader><DialogTitle>Propose New Time</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">New date</label>
              <Input type="date" value={propDate} onChange={e => setPropDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">New time (optional)</label>
              <Input type="time" value={propTime} onChange={e => setPropTime(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Note (optional)</label>
              <Textarea value={propNote} onChange={e => setPropNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReschedOpen(false)}>Cancel</Button>
            <Button onClick={() => doAction('propose_reschedule', { proposed_date: propDate, proposed_time: propTime || undefined, propose_note: propNote || undefined })} disabled={!propDate || actionLoading}>
              Propose
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── New Request Dialog ────────────────────────────────────────
function NewRequestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { homatchUser } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !homatchUser) return;
    getProperties(homatchUser.id).then(p => setProperties(p)).catch(() => {});
  }, [open, homatchUser]);

  const handleCreate = async () => {
    if (!selectedPropertyId || !date) return;
    setLoading(true);
    try {
      await createViewingRequest(selectedPropertyId, date, time || undefined, note || undefined);
      toast.success('Viewing request submitted');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a Viewing</DialogTitle>
          <DialogDescription>Choose a property and your preferred date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Property</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedPropertyId}
              onChange={e => setSelectedPropertyId(e.target.value)}
            >
              <option value="">Select a property…</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.title ?? p.facts?.city ?? p.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Preferred date</label>
            <Input type="date" value={date} min={new Date().toISOString().split('T')[0]} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Preferred time (optional)</label>
            <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Note (optional)</label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Any details for the owner…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!selectedPropertyId || !date || loading}>
            {loading ? 'Submitting…' : 'Submit Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ViewingsPage() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [viewings, setViewings] = useState<ViewingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const data = await getViewingRequests(homatchUser.id, 'both');
      setViewings(data);
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    try {
      await updateViewingRequest(id, action as 'accept' | 'decline' | 'cancel' | 'complete' | 'propose_reschedule', extra);
      toast.success('Viewing updated');
      await load();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const mine = viewings.filter(v => v.requester_id === homatchUser?.id);
  const incoming = viewings.filter(v => v.owner_id === homatchUser?.id);
  const pendingCount = incoming.filter(v => v.status === 'PENDING').length;

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">Viewings</h1>
              <p className="text-sm text-muted-foreground">Manage property viewing requests</p>
            </div>
            <Button onClick={() => setNewOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Request Viewing
            </Button>
          </div>

          <Tabs defaultValue="incoming">
            <TabsList className="w-full md:w-auto">
              <TabsTrigger value="incoming" className="flex-1 md:flex-none">
                Incoming {pendingCount > 0 && <Badge className="ml-1.5 h-4 px-1 text-[10px]">{pendingCount}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="mine" className="flex-1 md:flex-none">
                My Requests {mine.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{mine.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            {['incoming', 'mine'].map(tab => (
              <TabsContent key={tab} value={tab} className="mt-4 space-y-3">
                {loading
                  ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
                  : (tab === 'incoming' ? incoming : mine).length === 0
                    ? (
                      <div className="text-center py-12 text-muted-foreground space-y-3">
                        <CalendarDays className="h-10 w-10 mx-auto opacity-30" />
                        <p className="text-sm">{t('empty_no_viewings_title')}</p>
                        <p className="text-xs text-muted-foreground/70">{t('empty_no_viewings_desc')}</p>
                        <Button size="sm" variant="outline" className="border-border mt-1"
                          onClick={() => setNewOpen(true)}>
                          <Plus className="h-4 w-4 mr-1.5" /> {t('empty_no_viewings_cta')}
                        </Button>
                      </div>
                    )
                    : (tab === 'incoming' ? incoming : mine).map(v => (
                      <ViewingCard key={v.id} vr={v} myId={homatchUser?.id ?? ''} onAction={handleAction} />
                    ))
                }
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <NewRequestDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
      </AppLayout>
    </RouteGuard>
  );
}

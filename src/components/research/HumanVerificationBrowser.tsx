import React, { useState } from 'react';
import { ShieldCheck, Loader2, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/db/supabase';

interface Props {
  cadastralCode?: string;
  targetUrl?: string;
  onVerified?: () => void;
}

export function HumanVerificationBrowser({ cadastralCode, targetUrl, onVerified }: Props) {
  const [loading, setLoading] = useState(false);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [officialUrl, setOfficialUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openVerification = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('browserbase-handoff', {
        body: { cadastralCode, targetUrl },
      });
      if (invokeError) throw invokeError;
      if (!data?.liveViewUrl) throw new Error(data?.error || 'Live browser is unavailable');
      setLiveViewUrl(data.liveViewUrl);
      setOfficialUrl(data.targetUrl || targetUrl || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start verification browser');
    } finally {
      setLoading(false);
    }
  };

  if (liveViewUrl) {
    return (
      <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col">
        <div className="h-14 border-b border-border px-4 flex items-center gap-3 bg-card">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Human verification</p>
            <p className="text-[11px] text-muted-foreground truncate">Complete only the verification requested by the website. Homatch will continue afterward.</p>
          </div>
          {officialUrl && <Button size="sm" variant="outline" onClick={() => window.open(officialUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4 mr-1" />Official page</Button>}
          <Button size="icon" variant="ghost" onClick={() => setLiveViewUrl(null)}><X className="h-5 w-5" /></Button>
        </div>
        <iframe
          title="Homatch secure verification browser"
          src={liveViewUrl}
          className="flex-1 w-full border-0 bg-white"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
        <div className="border-t border-border p-3 bg-card flex justify-end">
          <Button onClick={() => { setLiveViewUrl(null); onVerified?.(); }}>
            <ShieldCheck className="h-4 w-4 mr-2" />Verification completed — continue research
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-amber-500/25 bg-amber-500/5">
      <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">Website verification may be required</p>
          <p className="text-xs text-muted-foreground mt-0.5">Homatch tries automatic website verification first. If it cannot finish a CAPTCHA, open the secure live browser and complete it yourself.</p>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
        <Button onClick={openVerification} disabled={loading} variant="outline">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
          Open verification
        </Button>
      </CardContent>
    </Card>
  );
}

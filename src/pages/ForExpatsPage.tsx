// HOMATCH FOR EXPATS — the door into My Georgia.
//
// Owner direction (2026-10-25): opening For Expats starts DIRECTLY with My
// Georgia. Someone without a finished profile, signed in or not, lands on the
// My Georgia welcome ("საქართველოში თქვენი ახალი ეტაპი იწყება", Start / Later);
// someone with a finished profile lands on their own My Georgia. The guide and
// the places live inside My Georgia (its tabs), not on a page in front of it,
// and Later leads there, so nothing is lost for a visitor without an account.
//
// Old links to the landing page's sections (#needs, #topics, #tools) open
// the guide tab at that section.

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import '@/components/expats/expats.css';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { loadMyGeorgia } from '@/services/myGeorgia';

const START = '/my-georgia/start';
const GUIDE_ANCHORS = new Set(['#needs', '#topics', '#tools']);

export default function ForExpatsPage() {
  const { status, homatchUser } = useAuth();
  const { hash } = useLocation();
  const userId = homatchUser?.id ?? null;
  const [target, setTarget] = React.useState<string | null>(GUIDE_ANCHORS.has(hash) ? `/my-georgia?tab=guide${hash}` : null);

  React.useEffect(() => {
    if (target) return undefined;
    if (status === 'UNAUTHENTICATED') { setTarget(START); return undefined; }
    if (status !== 'AUTHENTICATED') return undefined;
    /* A session whose account row has not arrived yet: give it a moment, then the
       welcome (which resumes a saved profile itself) rather than a spinner for ever. */
    if (!userId) {
      const timer = window.setTimeout(() => setTarget(START), 4000);
      return () => window.clearTimeout(timer);
    }
    let live = true;
    void loadMyGeorgia(userId)
      .then((s) => { if (live) setTarget(s?.completedAt ? '/my-georgia' : START); })
      .catch(() => { if (live) setTarget(START); });
    return () => { live = false; };
  }, [status, userId, target]);

  if (target) return <Navigate to={target} replace />;
  return (
    <AppLayout noPadding>
      <div className="expat-page min-h-[calc(100vh-4rem)] bg-[#0C1119] px-4 py-8 sm:py-14">
        <div aria-hidden="true" className="mx-auto h-64 w-full max-w-[40rem] animate-pulse rounded-3xl bg-white/5 motion-reduce:animate-none" />
      </div>
    </AppLayout>
  );
}

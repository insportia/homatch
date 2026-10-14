import React, { useEffect, useRef } from 'react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { OWNER_SURFACE } from '@/components/customer/surface';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { isImpersonating } from '@/lib/impersonation';

function Workspace() {
  const { session, homatchUser } = useAuth();
  const { lang, t } = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!session || !homatchUser || isImpersonating()) return;
    let disposed = false;
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
    const invoke = async (url: string, body?: unknown) => {
      const { data, error } = await supabase.functions.invoke('publishing-engine', { body: { url, body } });
      if (error || data?.code) throw new Error(data?.code || 'PUBLISHING_REQUEST_FAILED');
      return data;
    };
    const browser = (command: unknown) => new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => { pending.delete(requestId); reject(new Error('RELOAD_HOMATCH_EXTENSION')); }, 60000);
      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: 'HOMATCH_UI', requestId, command }, location.origin);
    });
    const receive = async (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      const m = event.data;
      if (event.source === window && m?.source === 'HOMATCH_CONNECTOR') {
        const item = pending.get(m.requestId);
        if (!item) return;
        pending.delete(m.requestId); window.clearTimeout(item.timer);
        m.response?.ok ? item.resolve(m.response) : item.reject(new Error(m.response?.code || 'CONNECTOR_ERROR'));
        return;
      }
      if (event.source !== frame.current?.contentWindow || m?.source !== 'HOMATCH_PUBLISHING_FRAME' || typeof m.requestId !== 'string' || m.requestId.length > 80) return;
      const reply = (value: object) => { if (!disposed) frame.current?.contentWindow?.postMessage({ source: 'HOMATCH_PUBLISHING_HOST', requestId: m.requestId, ...value }, location.origin); };
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user || data.user.id !== session.user.id || isImpersonating()) throw new Error('AUTH_REQUIRED');
        if (m.kind === 'API') {
          if (m.url === '/session') { reply({ result: { lang } }); return; }
          reply({ result: await invoke(m.url, m.body) });
        } else if (m.kind === 'BROWSER') {
          const authorized = await invoke('/browser', m.command);
          if (authorized.command.action === 'publishAfterConfirmation' && !window.confirm('Publish this reviewed property on MyHome.ge now?')) throw new Error('PUBLICATION_CONFIRMATION_REQUIRED');
          reply({ result: await browser(authorized.command) });
        }
      } catch (error) { reply({ error: error instanceof Error ? error.message : 'REQUEST_FAILED' }); }
    };
    window.addEventListener('message', receive);
    return () => {
      disposed = true; window.removeEventListener('message', receive);
      for (const item of pending.values()) { window.clearTimeout(item.timer); item.reject(new Error('WORKSPACE_CLOSED')); }
      pending.clear();
    };
  }, [session?.user.id, homatchUser?.id, lang]);
  return <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
    {session && homatchUser && !isImpersonating() && <iframe key={homatchUser.id} ref={frame} title={t('dash_add_property')} src="/publishing-engine/index.html" className="w-full min-h-[calc(100dvh-5rem)] border-0" style={{ height: 'calc(100dvh - 5rem)' }} />}
  </AppLayout>;
}

export default function PublishingEnginePage() {
  return <RouteGuard><Workspace /></RouteGuard>;
}

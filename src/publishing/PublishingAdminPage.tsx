import React, { useCallback, useEffect, useState } from 'react';
import { Power, Server, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { publishingRequest } from './api';
import './publishing.css';
interface AdminSnapshot {
  enabled: boolean;
  portals: Array<{
    id: string;
    name: string;
    adapterVersion: string;
    verification: string;
    maintenance: boolean;
    enabled: boolean;
    maxConcurrency: number;
  }>;
  jobCounts: Record<string, number>;
  workers: Array<{
    worker_id: string;
    active_contexts: number;
    rss_bytes: number;
    heartbeat_at: string;
  }>;
  accounts: Array<{ portal_id: string; status: string; count: number }>;
  errors: Array<{ portal_id: string; error_code: string; count: number }>;
}
export default function PublishingAdminPage() {
  const { t, isRTL } = useLanguage();
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(
        await publishingRequest<AdminSnapshot>({
          action: 'admin',
          adminAction: 'snapshot',
        }),
      );
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  const change = async (body: Record<string, unknown>) => {
    if (!window.confirm(t('pub_confirm'))) return;
    setBusy(true);
    try {
      setData(
        await publishingRequest<AdminSnapshot>({ action: 'admin', ...body }),
      );
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="pub-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <header className="pub-center-header">
        <div>
          <p className="pub-eyebrow">HOMATCH</p>
          <h1>{t('pub_admin')}</h1>
        </div>
        <button className="pub-button" onClick={() => void load()}>
          <RefreshCw size={16} />
          {t('pub_refresh')}
        </button>
      </header>
      {error && (
        <p role="alert" className="pub-notice">
          {t('pub_unavailable')}
        </p>
      )}
      {data && (
        <>
          <section className="pub-account-row">
            <Power size={24} />
            <h2 className="pub-account-copy">{t('pub_engine')}</h2>
            <button
              className="pub-button pub-button-gold"
              disabled={busy}
              onClick={() =>
                void change({
                  adminAction: 'kill_switch',
                  enabled: !data.enabled,
                })
              }
            >
              {t(data.enabled ? 'pub_pause' : 'pub_resume')}
            </button>
          </section>
          <section className="pub-account-list">
            <h2>{t('pub_destinations')}</h2>
            {data.portals.map((portal) => (
              <div className="pub-account-row" key={portal.id}>
                <div className="pub-account-copy">
                  <h3>{portal.name}</h3>
                  <p>
                    {t('pub_version')}:{' '}
                    <span dir="ltr">{portal.adapterVersion}</span>
                  </p>
                  <p dir="ltr">
                    {portal.verification} ·{' '}
                    {t('pub_concurrency', { n: portal.maxConcurrency })}
                  </p>
                </div>
                <button
                  className="pub-button"
                  disabled={busy}
                  onClick={() =>
                    void change({
                      adminAction: 'portal_switch',
                      portalId: portal.id,
                      enabled: portal.maintenance,
                    })
                  }
                >
                  {t(portal.maintenance ? 'pub_resume' : 'pub_pause')}
                </button>
              </div>
            ))}
          </section>
          <section className="pub-publications">
            <h2>{t('pub_workers')}</h2>
            {data.workers.map((worker) => (
              <div className="pub-progress-row" key={worker.worker_id}>
                <Server size={17} />
                <strong dir="ltr">{worker.worker_id}</strong>
                <span dir="ltr">
                  {t('pub_contexts', { n: worker.active_contexts })} ·{' '}
                  {(worker.rss_bytes / 1048576).toFixed(1)} MiB
                </span>
                <time dateTime={worker.heartbeat_at}>
                  {worker.heartbeat_at}
                </time>
              </div>
            ))}
          </section>
          <section className="pub-publications">
            <h2>{t('pub_activity')}</h2>
            {Object.entries(data.jobCounts).map(([state, n]) => (
              <div className="pub-progress-row" key={state}>
                <span>
                  {t(
                    state === 'running'
                      ? 'pub_preparing'
                      : state === 'dead_letter'
                        ? 'pub_failed'
                        : state === 'succeeded'
                          ? 'pub_published'
                          : `pub_${state}`,
                  )}
                </span>
                <strong>{n}</strong>
              </div>
            ))}
            {data.errors.map((item) => (
              <div
                className="pub-progress-row"
                key={`${item.portal_id}:${item.error_code}`}
              >
                <strong>{item.portal_id}</strong>
                <code>{item.error_code}</code>
                <span>{item.count}</span>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

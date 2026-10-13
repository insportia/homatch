import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Building2,
  Plus,
  ArrowUpRight,
  RefreshCw,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { listPortfolio } from '@/services/propertyManagement';
import type { Property } from '@/types/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  emptySnapshot,
  originalListingUrl,
  portalEligible,
  publishingRequest,
  publishingStatusKey,
  type PublishingSnapshot,
} from './api';
import { PublishingOrbit } from './PublishingOrbit';
import './publishing.css';
export default function PublishingCenterPage({
  view = 'properties',
}: {
  view?: 'properties' | 'portals' | 'activity';
}) {
  const { homatchUser } = useAuth();
  const { t, isRTL, lang } = useLanguage();
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const { propertyId } = useParams();
  const [properties, setProperties] = useState<Property[]>([]);
  const [snapshot, setSnapshot] = useState<PublishingSnapshot>(emptySnapshot);
  const [selectedProperty, setSelectedProperty] = useState(propertyId ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<
    'publish' | 'update' | 'remove' | null
  >(null);
  const confirmationId = useRef('');
  const selectionDirty = useRef(false);
  const generation = useRef(0);
  const activeRequest = useRef<{
    ownerId: string;
    promise: Promise<unknown>;
  } | null>(null);
  useEffect(() => {
    setProperties([]);
    setSnapshot(emptySnapshot());
    setSelected([]);
    setAvailable(false);
    setLoading(true);
    selectionDirty.current = false;
  }, [homatchUser?.id]);
  useEffect(() => {
    if (propertyId) setSelectedProperty(propertyId);
  }, [propertyId]);
  const refresh = useCallback(
    async (initial = false) => {
      if (!homatchUser) {
        setLoading(false);
        return;
      }
      if (activeRequest.current?.ownerId === homatchUser.id) {
        await activeRequest.current.promise;
        if (!initial) return;
      }
      const current = ++generation.current;
      let deadline = 0;
      const portfolio = Promise.race([
        listPortfolio({ userId: homatchUser.id, view: 'ACTIVE' }),
        new Promise<never>((_, reject) => {
          deadline = window.setTimeout(
            () => reject(new Error('PORTFOLIO_TIMEOUT')),
            20000,
          );
        }),
      ]).finally(() => window.clearTimeout(deadline));
      const pending = Promise.allSettled([
        portfolio,
        publishingRequest<PublishingSnapshot>({ action: 'snapshot' }),
      ]);
      activeRequest.current = { ownerId: homatchUser.id, promise: pending };
      const results = await pending;
      if (activeRequest.current?.promise === pending)
        activeRequest.current = null;
      if (current !== generation.current) return;
      if (results[0].status === 'fulfilled') setProperties(results[0].value);
      if (results[1].status === 'fulfilled') {
        setSnapshot(results[1].value);
        setAvailable(true);
      } else setAvailable(false);
      setLoading(false);
    },
    [homatchUser?.id],
  );
  useEffect(() => {
    void refresh(true);
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!selectedProperty && properties[0])
      setSelectedProperty(properties[0].id);
  }, [properties, selectedProperty]);
  useEffect(() => {
    if (!selectionDirty.current)
      setSelected(
        snapshot.selections.find((s) => s.property_id === selectedProperty)
          ?.portal_ids ?? [],
      );
  }, [snapshot.selections, selectedProperty]);
  useEffect(() => {
    selectionDirty.current = false;
    setSelected(
      snapshot.selections.find((s) => s.property_id === selectedProperty)
        ?.portal_ids ?? [],
    );
  }, [selectedProperty]);
  const property = properties.find((p) => p.id === selectedProperty);
  const jobs = snapshot.jobs.filter((j) => j.property_id === selectedProperty);
  const publications = snapshot.publications.filter(
    (p) => p.property_id === selectedProperty,
  );
  const act = async (body: Record<string, unknown>, success?: string) => {
    setBusy(true);
    setMessage('');
    try {
      await publishingRequest(body);
      if (success) setMessage(success);
      await refresh(true);
      return true;
    } catch {
      setMessage('pub_error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (
      await act(
        {
          action: 'save_selection',
          propertyId: selectedProperty,
          portals: selected,
        },
        'pub_saved',
      )
    )
      selectionDirty.current = false;
  };
  const canOperate = (operation: string) =>
    available &&
    selected.length > 0 &&
    selected.every((id) => {
      if(jobs.some(job=>job.portal_id===id&&job.operation!=='status'&&['queued','running','retry','action_required'].includes(job.state)))return false;
      const portal = snapshot.portals.find((p) => p.id === id);
      const publication = publications.find((p) => p.portal_id === id);
      return (
        portal &&
        portalEligible(portal, snapshot.accounts, operation) &&
        (operation === 'publish'
          ? !publication?.external_id
          : Boolean(publication?.external_id))
      );
    });
  const requestConfirmation = (operation: 'publish' | 'update' | 'remove') => {
    confirmationId.current = crypto.randomUUID();
    setConfirm(operation);
  };
  const submit = async () => {
    if (!confirm) return;
    const operation = confirm;
    if (
      !(await act({
        action: 'save_selection',
        propertyId: selectedProperty,
        portals: selected,
      }))
    )
      return;
    if (
      await act({
        action: 'enqueue',
        propertyId: selectedProperty,
        portals: selected,
        operation,
        confirmationId: confirmationId.current,
      })
    ) {
      selectionDirty.current = false;
      setConfirm(null);
    }
  };
  const orbit = snapshot.portals
    .filter((p) => selected.includes(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      selected: true,
      state:
        jobs.find((j) => j.portal_id === p.id)?.phase ??
        publications.find((pub) => pub.portal_id === p.id)?.status ??
        'preparing',
    }));
  return (
    <div className="pub-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <header className="pub-center-header">
        <div>
          <p className="pub-eyebrow">
            {t('brand_name')} / {t('pub_properties')}
          </p>
          <h1>{t('pub_title')}</h1>
          <p>{t('pub_subtitle')}</p>
        </div>
        <Link to="/property/create" className="pub-button pub-button-gold">
          <Plus size={17} />
          {t('pub_new')}
        </Link>
      </header>
      <nav className="pub-tabs" aria-label={t('pub_title')}>
        {(['properties', 'portals', 'activity'] as const).map((tab) => (
          <Link
            key={tab}
            to={tab === 'properties' ? '/publishing' : `/publishing/${tab}`}
            aria-current={view === tab ? 'page' : undefined}
          >
            {t(`pub_${tab}`)}
          </Link>
        ))}
      </nav>
      <div className="pub-feedback" aria-live="polite">
        {message && <p role="status">{t(message)}</p>}
      </div>
      {!available && !loading && (
        <div className="pub-notice">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>{t('pub_unavailable')}</p>
          <button
            className="pub-icon-button"
            onClick={() => void refresh(true)}
            aria-label={t('pub_refresh')}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          {view === 'properties' && (
            <div className="pub-workspace">
              <aside className="pub-portfolio">
                <h2>{t('pub_choose')}</h2>
                {loading ? (
                  <div
                    className="pub-skeleton"
                    aria-label={t('pub_preparing')}
                  />
                ) : properties.length === 0 ? (
                  <div className="pub-empty">
                    <Building2 size={32} />
                    <h3>{t('pub_empty')}</h3>
                    <p>{t('pub_empty_body')}</p>
                    <Link className="pub-button" to="/property/create">
                      {t('pub_new')}
                    </Link>
                  </div>
                ) : (
                  properties.map((p) => (
                    <button
                      key={p.id}
                      className={`pub-property-row ${p.id === selectedProperty ? 'is-selected' : ''}`}
                      aria-pressed={p.id === selectedProperty}
                      onClick={() => {
                        setSelectedProperty(p.id);
                        navigate(`/publishing/property/${p.id}`, {
                          replace: true,
                        });
                      }}
                    >
                      <span className="pub-property-thumb" aria-hidden="true">
                        <Building2 size={25} />
                      </span>
                      <span>
                        <strong>{p.title || `#${p.homatch_id ?? ''}`}</strong>
                        <small>{p.facts?.city ?? ''}</small>
                      </span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  ))
                )}
              </aside>
              <main className="pub-property-work">
                <div className="pub-property-heading">
                  <div>
                    <p className="pub-eyebrow">{t('pub_destinations')}</p>
                    <h2>{property?.title ?? t('pub_choose')}</h2>
                  </div>
                  {property && (
                    <Link
                      className="pub-text-link"
                      to={`/property/${property.id}/edit`}
                    >
                      {t('pub_edit')}
                      <ArrowUpRight size={15} />
                    </Link>
                  )}
                </div>
                {property && (
                  <>
                    <div className="pub-selection-toolbar">
                      <span>{t('pub_selected', { n: selected.length })}</span>
                      <button
                        onClick={() => {
                          selectionDirty.current = true;
                          setSelected(
                            snapshot.portals
                              .filter((p) =>
                                portalEligible(p, snapshot.accounts),
                              )
                              .map((p) => p.id),
                          );
                        }}
                        disabled={!available || busy}
                      >
                        {t('pub_all')}
                      </button>
                      <button
                        onClick={() => {
                          selectionDirty.current = true;
                          setSelected([]);
                        }}
                        disabled={busy}
                      >
                        {t('pub_none')}
                      </button>
                    </div>
                    <div className="pub-portals-list">
                      {snapshot.portals.map((portal) => {
                        const account = snapshot.accounts.find(
                          (a) => a.portal_id === portal.id,
                        );
                        const connected = account?.status === 'connected';
                        const eligible = portalEligible(
                          portal,
                          snapshot.accounts,
                        );
                        return (
                          <label
                            key={portal.id}
                            className={`pub-portal-row ${selected.includes(portal.id) ? 'is-selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(portal.id)}
                              disabled={
                                busy ||
                                (!eligible && !selected.includes(portal.id))
                              }
                              onChange={(event) => {
                                selectionDirty.current = true;
                                setSelected((old) =>
                                  event.target.checked
                                    ? [...old, portal.id]
                                    : old.filter((id) => id !== portal.id),
                                );
                              }}
                            />
                            <span
                              className="pub-portal-monogram"
                              aria-hidden="true"
                            >
                              {portal.name.slice(0, 1)}
                            </span>
                            <span className="pub-portal-copy">
                              <strong dir="ltr">{portal.name}</strong>
                              <small>
                                {t(
                                  connected
                                    ? 'pub_connected'
                                    : 'pub_disconnected',
                                )}{' '}
                                ·{' '}
                                {t(
                                  portal.permission === 'verified'
                                    ? 'pub_destinations'
                                    : 'pub_restricted',
                                )}
                              </small>
                            </span>
                            <span className="pub-capability">
                              {t(eligible ? 'pub_publish' : 'pub_restricted')}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="pub-operation-bar">
                      <button
                        className="pub-button"
                        disabled={!available || busy}
                        onClick={() => void save()}
                      >
                        {t('pub_save')}
                      </button>
                      <button
                        className="pub-button pub-button-gold"
                        disabled={!canOperate('publish') || busy}
                        onClick={() => requestConfirmation('publish')}
                      >
                        {t('pub_publish')}
                      </button>
                      <button
                        className="pub-button"
                        disabled={!canOperate('update') || busy}
                        onClick={() => requestConfirmation('update')}
                      >
                        {t('pub_update')}
                      </button>
                      <button
                        className="pub-button pub-button-danger"
                        disabled={!canOperate('remove') || busy}
                        onClick={() => requestConfirmation('remove')}
                      >
                        {t('pub_remove')}
                      </button>
                    </div>
                    <p className="pub-helper">{t('pub_missing')}</p>
                    {jobs.length > 0 && (
                      <section
                        className="pub-journey"
                        aria-labelledby="pub-journey-heading"
                      >
                        <div>
                          <p className="pub-eyebrow">{t('pub_live')}</p>
                          <h2 id="pub-journey-heading">{t('pub_journey')}</h2>
                        </div>
                        <PublishingOrbit destinations={orbit} />
                        <div className="pub-progress-list">
                          {jobs.map((job) => (
                            <div key={job.id} className="pub-progress-row">
                              <strong>
                                {snapshot.portals.find(
                                  (p) => p.id === job.portal_id,
                                )?.name ?? job.portal_id}
                              </strong>
                              <span role="status">
                                {t(
                                  publishingStatusKey(
                                    job.state === 'running'
                                      ? job.phase
                                      : job.state === 'succeeded'
                                        ? job.phase
                                        : job.state,
                                  ),
                                )}
                              </span>
                              {[
                                'failed',
                                'dead_letter',
                                'action_required',
                              ].includes(job.state) && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act({ action: 'retry', jobId: job.id })
                                  }
                                >
                                  {t('pub_retry')}
                                </button>
                              )}
                            {['queued', 'retry', 'action_required'].includes(job.state) &&
                                !job.submission_started && (
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void act({
                                        action: 'cancel',
                                        jobId: job.id,
                                      })
                                    }
                                  >
                                    {t('pub_cancel')}
                                  </button>
                                )}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    <section className="pub-publications">
                      <h2>{t('pub_history')}</h2>
                      {publications.length === 0 ? (
                        <p className="pub-helper">{t('pub_no_jobs')}</p>
                      ) : (
                        publications.map((publication) => {
                          const portal = snapshot.portals.find(
                            (p) => p.id === publication.portal_id,
                          );
                          const url = originalListingUrl(
                            publication.external_url,
                            portal?.domain,
                          );
                          return (
                            <div
                              className="pub-progress-row"
                              key={publication.id}
                            >
                              <div>
                                <strong>
                                  {portal?.name ?? publication.portal_id}
                                </strong>
                                <small dir="ltr">
                                  {publication.external_id ?? ''}
                                </small>
                              </div>
                              <span>
                                {t(publishingStatusKey(publication.status))}
                              </span>
                              {url && (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="pub-text-link"
                                >
                                  {t('pub_original')}
                                  <ArrowUpRight size={14} />
                                </a>
                              )}
                            </div>
                          );
                        })
                      )}
                    </section>
                  </>
                )}
              </main>
            </div>
          )}
          {view === 'portals' && (
            <section className="pub-account-list">
              <h2>{t('pub_portals')}</h2>
              {snapshot.portals.map((portal) => {
                const account = snapshot.accounts.find(
                  (a) => a.portal_id === portal.id,
                );
                return (
                  <article className="pub-account-row" key={portal.id}>
                    <span className="pub-portal-monogram" aria-hidden="true">
                      {portal.name.slice(0, 1)}
                    </span>
                    <div className="pub-account-copy">
                      <h3 dir="ltr">{portal.name}</h3>
                      <p>
                        {t(
                          account?.status === 'connected'
                            ? 'pub_connected'
                            : 'pub_disconnected',
                        )}
                      </p>
                      <p>{t('pub_restricted')}</p>
                      {account?.last_connected_at && (
                        <time dateTime={account.last_connected_at}>
                          {new Intl.DateTimeFormat(lang, {
                            dateStyle: 'medium',
                          }).format(new Date(account.last_connected_at))}
                        </time>
                      )}
                    </div>
                    <div className="pub-account-actions">
                      {portal.registration_url &&
                        originalListingUrl(
                          portal.registration_url,
                          portal.domain,
                        ) && (
                          <a
                            className="pub-button"
                            href={portal.registration_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('pub_register')}
                            <ArrowUpRight size={14} />
                          </a>
                        )}
                      {account?.status === 'connected' ? (
                        <button
                          className="pub-button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t('pub_disconnect')))
                              void act({
                                action: 'disconnect',
                                accountId: account.id,
                              });
                          }}
                        >
                          {t('pub_disconnect')}
                        </button>
                      ) : (
                        <button
                          className="pub-button"
                          disabled={
                            portal.permission !== 'verified' ||
                            portal.metadata?.connectionEnabled !== true ||
                            busy
                          }
                          onClick={() =>
                            void act({ action: 'connect', portalId: portal.id })
                          }
                        >
                          {t('pub_connect')}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}
          {view === 'activity' && (
            <section className="pub-activity">
              <h2>{t('pub_activity')}</h2>
              {snapshot.events.length === 0 ? (
                <div className="pub-empty">
                  <Check size={28} />
                  <p>{t('pub_no_jobs')}</p>
                </div>
              ) : (
                snapshot.events.map((event) => (
                  <div key={event.id} className="pub-progress-row">
                    <strong>
                      {snapshot.portals.find((p) => p.id === event.portal_id)
                        ?.name ?? ''}
                    </strong>
                    <span>{t(publishingStatusKey(event.event))}</span>
                    <time dateTime={event.created_at}>
                      {new Intl.DateTimeFormat(lang, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(event.created_at))}
                    </time>
                  </div>
                ))
              )}
            </section>
          )}
        </motion.div>
      </AnimatePresence>
      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent className="pub-confirm" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('pub_confirm')}</DialogTitle>
            <DialogDescription>{t('pub_confirm_body')}</DialogDescription>
          </DialogHeader>
          <ul>
            {selected.map((id) => (
              <li key={id}>
                <Check size={16} aria-hidden="true" />
                {snapshot.portals.find((p) => p.id === id)?.name ?? id}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <button
              className="pub-button"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              {t('pub_cancel')}
            </button>
            <button
              className="pub-button pub-button-gold"
              disabled={busy}
              onClick={() => void submit()}
            >
              {t('pub_confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

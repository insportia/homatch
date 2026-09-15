import React, { useCallback, useEffect, useState } from 'react';
import {
  Link2, Copy, Code2, QrCode, Eye, Trash2, ExternalLink, Box,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Panel, PanelHeader, TableScroll, Th, Td, formatDateTime, formatNumber,
} from './primitives';
import {
  createShareLink, shareUrl, listShareLinks, revokeShareLink,
} from '@/services/developer/inventory';
import { experienceUrl, embedUrl, embedSnippet, qrDataUrl } from '@/services/developer/twin';
import { devErrorText } from '@/services/developer/client';
import type { DevProject, DevShareLink, DevWorkspace } from '@/services/developer/types';

/**
 * ONE PROJECT, EVERY WAY IT CAN BE SHOWN TO SOMEBODY.
 *
 * ALL OF THESE POINT AT THE SAME CANONICAL PROJECT. The public page, the
 * tracked link, the QR code on a hoarding and the iframe on the developer's
 * own website are four routes into one set of rows — so a price corrected at
 * four o'clock is corrected on all four at four o'clock. There is no export,
 * no generated microsite and no per-campaign copy that can quietly go stale,
 * which is the failure mode of every PDF a sales office has ever sent.
 *
 * THE LINKS ARE OURS. No shortener, no third party in the path between a
 * buyer and the apartment, and nothing that stops resolving when somebody
 * else's free tier changes. The QR is generated in this browser by the
 * `qrcode` package already in the project — no QR service, no per-scan cost,
 * and the image never leaves the device that made it.
 *
 * A TRACKED LINK CAN BE REVOKED, and revoking it is immediate: the resolver
 * checks revoked_at before it returns anything. That is what makes it safe to
 * send a price to one buyer.
 */
export function ShareProjectPanel({
  workspace, project,
}: { workspace: DevWorkspace; project: DevProject }) {
  const { t, lang: language } = useLanguage();
  const [links, setLinks] = useState<DevShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Both slugs are nullable in the schema — a workspace created before slugs
   * were required, or a project whose name produced nothing sluggable. The
   * page still renders; it just cannot offer a link it does not have.
   */
  const slugs = workspace.slug && project.slug
    ? { workspaceSlug: workspace.slug, projectSlug: project.slug }
    : null;
  const publicUrl = slugs ? experienceUrl(slugs) : null;
  const iframeUrl = slugs ? embedUrl(slugs) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLinks(await listShareLinks('PROJECT', project.id));
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [project.id, t]);

  useEffect(() => { void load(); }, [load]);

  async function copy(value: string, messageKey: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(messageKey));
    } catch {
      // A browser that refuses clipboard access still shows the value in the
      // field beside the button, so this is a nuisance rather than a failure.
      toast.error(t('dev_share_copy_failed'));
    }
  }

  async function makeTrackedLink() {
    setBusy(true);
    try {
      const link = await createShareLink({ targetType: 'PROJECT', targetId: project.id });
      await copy(shareUrl(link.token), 'dev_share_copied');
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: DevShareLink) {
    setBusy(true);
    try {
      await revokeShareLink(link.id);
      toast.success(t('dev_share_revoked'));
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const live = links.filter((l) => l.revoked_at === null);

  return (
    <div className="space-y-4">
      {/* ── The public page ─────────────────────────────── */}
      <Panel>
        <PanelHeader
          title={t('dev_share_public_title')}
          description={t(
            project.is_published ? 'dev_share_public_body' : 'dev_share_not_published',
          )}
        />
        <div className="space-y-3 p-4 sm:p-5">
          {!publicUrl || !iframeUrl ? (
            /* No slug, no address. Saying so beats rendering a broken link. */
            <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              {t('dev_share_no_slug')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="share-public">{t('dev_share_public_url')}</Label>
                  <Input
                    id="share-public" readOnly value={publicUrl}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => void copy(publicUrl, 'dev_share_copied')}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t('dev_copy')}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {t('dev_open')}
                  </a>
                </Button>
              </div>

              {!project.is_published && (
                <p className="rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {t('dev_share_publish_first')}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={async () => setQr(await qrDataUrl(publicUrl))}
                >
                  <QrCode className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t('dev_share_qr')}
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => void copy(
                    embedSnippet(iframeUrl, project.name), 'dev_share_embed_copied',
                  )}
                >
                  <Code2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t('dev_share_embed')}
                </Button>
              </div>

              {qr && (
                <div className="flex items-start gap-4 rounded-md border border-border p-3">
                  <img src={qr} alt={t('dev_share_qr_alt')} className="h-28 w-28 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{t('dev_share_qr_title')}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {t('dev_share_qr_body')}
                    </p>
                    <a
                      href={qr}
                      download={`${project.slug ?? 'project'}-qr.png`}
                      className="mt-1.5 inline-block text-2xs text-gold-ink underline underline-offset-4"
                    >
                      {t('dev_share_qr_download')}
                    </a>
                  </div>
                </div>
              )}

              <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
                <Box className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                {t('dev_share_canonical_note')}
              </p>
            </>
          )}
        </div>
      </Panel>

      {/* ── Tracked links ────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          title={t('dev_share_tracked_title')}
          description={t('dev_share_tracked_body')}
          action={
            <Button size="sm" onClick={() => void makeTrackedLink()} disabled={busy}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('dev_share_new_link')}
            </Button>
          }
        />

        {loading ? (
          <div className="space-y-2 p-4" role="status" aria-live="polite">
            <span className="sr-only">{t('dev_loading')}</span>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted/70" aria-hidden="true" />
            ))}
          </div>
        ) : live.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-5">
            {t('dev_share_no_links')}
          </p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_share_link')}</Th>
                  <Th className="text-right">{t('dev_share_views')}</Th>
                  <Th>{t('dev_share_last_opened')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {live.map((link) => (
                  <tr key={link.id} className="hover:bg-muted/30">
                    <Td className="max-w-[18rem] truncate font-mono text-xs">
                      {shareUrl(link.token)}
                    </Td>
                    <Td className="text-right">
                      <span className={cn(link.view_count === 0 && 'text-muted-foreground')}>
                        {formatNumber(link.view_count, language)}
                      </span>
                    </Td>
                    <Td className="text-muted-foreground">
                      {link.last_viewed_at
                        ? formatDateTime(link.last_viewed_at, language)
                        : t('dev_share_never_opened')}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => void copy(shareUrl(link.token), 'dev_share_copied')}
                          aria-label={t('dev_copy')}
                          title={t('dev_copy')}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <a
                            href={shareUrl(link.token)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t('dev_open')}
                            title={t('dev_open')}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost" size="sm" disabled={busy}
                          onClick={() => void revoke(link)}
                          aria-label={t('dev_share_revoke')}
                          title={t('dev_share_revoke')}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}

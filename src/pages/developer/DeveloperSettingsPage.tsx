import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Trash2, Mail, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  formatDate,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  listTeam, inviteMember, setMemberRole, removeMember, listPendingInvites,
  updateWorkspace, type PendingInvite,
} from '@/services/developer/workspace';
import { devErrorText } from '@/services/developer/client';
import type { DevMember, DevRole } from '@/services/developer/types';

/**
 * SETTINGS — the company, and who works here.
 *
 * ROLES ARE EXPLAINED, NOT JUST LISTED. "Sales agent" means nothing on its
 * own; what a person choosing it needs to know is that an agent sees the
 * leads assigned to them and cannot reserve a unit. That sentence is next to
 * the role in the picker, because the alternative is a director discovering
 * the boundary when their agent cannot do their job.
 */

const ASSIGNABLE_ROLES: DevRole[] = [
  'ADMIN', 'SALES_DIRECTOR', 'SALES_MANAGER', 'SALES_AGENT',
  'MARKETING_MANAGER', 'FINANCE', 'LEGAL', 'VIEWER',
];

export const SETTINGS_TABS = [
  { path: '/developers/settings', labelKey: 'dev_settings_tab_workspace' },
  { path: '/developers/settings/exports', labelKey: 'dev_settings_tab_exports' },
  { path: '/developers/settings/audit', labelKey: 'dev_settings_tab_audit' },
];

export default function DeveloperSettingsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, role, can, refresh } = useDeveloperWorkspace();

  const [team, setTeam] = useState<DevMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [autoRelease, setAutoRelease] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<DevRole>('SALES_AGENT');
  const [inviting, setInviting] = useState(false);
  const [removingUser, setRemovingUser] = useState<DevMember | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      setName(workspace.name);
      setWebsite(workspace.website ?? '');
      setBrandColor(workspace.brand_color ?? '');
      setAutoRelease(Boolean(workspace.feature_flags?.auto_release_expired_reservations));
      const [members, pending] = await Promise.all([
        listTeam(workspace.id),
        can('team') ? listPendingInvites(workspace.id) : Promise.resolve([]),
      ]);
      setTeam(members);
      setInvites(pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace, can]);

  useEffect(() => { void load(); }, [load]);

  const saveWorkspace = async () => {
    if (!workspace) return;
    setSavingWorkspace(true);
    try {
      await updateWorkspace(workspace.id, {
        name: name.trim() || workspace.name,
        website: website.trim() || null,
        brand_color: brandColor.trim() || null,
        feature_flags: {
          ...workspace.feature_flags,
          auto_release_expired_reservations: autoRelease,
        },
      });
      toast.success(t('dev_saved'));
      await refresh();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSavingWorkspace(false);
    }
  };

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace || !inviteEmail.trim() || inviting) return;
    setInviting(true);
    try {
      const result = await inviteMember(workspace.id, inviteEmail.trim(), inviteRole);
      toast.success(t(result.status === 'ADDED' ? 'dev_member_added' : 'dev_member_invited'));
      setInviteEmail('');
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setInviting(false);
    }
  };

  return (
    <DeveloperShell
      title={t('dev_nav_settings')}
      description={t('dev_settings_subtitle')}
      tabs={<SubNav items={SETTINGS_TABS} />}
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && workspace && (
        <div className="space-y-6">
          <Panel>
            <PanelHeader title={t('dev_settings_company')} />
            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dev-set-name">{t('dev_start_company_label')}</Label>
                  <Input id="dev-set-name" value={name} onChange={(e) => setName(e.target.value)}
                    disabled={!can('team')} maxLength={120} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dev-set-site">{t('dev_settings_website')}</Label>
                  <Input id="dev-set-site" value={website} onChange={(e) => setWebsite(e.target.value)}
                    disabled={!can('team')} inputMode="url" maxLength={200} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dev-set-color">{t('dev_settings_brand_color')}</Label>
                <div className="flex items-center gap-2">
                  <Input id="dev-set-color" value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    disabled={!can('team')} placeholder="#B99A68" maxLength={20} className="max-w-[10rem]" />
                  {brandColor && (
                    <span aria-hidden="true" className="h-8 w-8 rounded-md border border-border"
                      style={{ backgroundColor: brandColor }} />
                  )}
                </div>
                <p className="text-2xs text-muted-foreground">{t('dev_settings_brand_hint')}</p>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <Label htmlFor="dev-set-auto" className="text-sm font-medium">
                    {t('dev_settings_auto_release')}
                  </Label>
                  {/* §135. The default is OFF and the consequence is stated,
                      because an apartment silently returning to the market is
                      how two buyers end up holding the same one. */}
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {t('dev_settings_auto_release_hint')}
                  </p>
                </div>
                <Switch id="dev-set-auto" checked={autoRelease} onCheckedChange={setAutoRelease}
                  disabled={!can('team')} />
              </div>

              {can('team') && (
                <Button onClick={saveWorkspace} disabled={savingWorkspace}>
                  <Save className="mr-2 h-4 w-4" />
                  {savingWorkspace ? t('dev_saving') : t('dev_save')}
                </Button>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title={t('dev_settings_team')}
              description={t('dev_settings_team_body')}
            />

            {can('team') && (
              <form onSubmit={invite} className="flex flex-wrap items-end gap-2 border-b border-border p-4 sm:p-5">
                <div className="min-w-[12rem] flex-1 space-y-1.5">
                  <Label htmlFor="dev-inv-email">{t('dev_invite_email')}</Label>
                  <Input id="dev-inv-email" type="email" value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)} required maxLength={200} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dev-inv-role">{t('dev_invite_role')}</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as DevRole)}>
                    <SelectTrigger id="dev-inv-role" className="w-auto min-w-[11rem]"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-w-sm">
                      {ASSIGNABLE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          <span className="block font-medium">{t(`dev_role_${r.toLowerCase()}`)}</span>
                          <span className="block text-2xs text-muted-foreground">
                            {t(`dev_role_desc_${r.toLowerCase()}`)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {inviting ? t('dev_saving') : t('dev_invite')}
                </Button>
              </form>
            )}

            <TableScroll>
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <Th>{t('dev_member')}</Th>
                    <Th>{t('dev_invite_email')}</Th>
                    <Th>{t('dev_invite_role')}</Th>
                    <Th>{t('dev_member_since')}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {team.map((member) => (
                    <tr key={member.member_id}>
                      <Td className="font-medium">{member.full_name || '—'}</Td>
                      <Td className="text-muted-foreground">{member.email}</Td>
                      <Td>
                        {can('team') && member.role !== 'OWNER' ? (
                          <Select
                            value={member.role}
                            onValueChange={async (v) => {
                              if (!workspace) return;
                              try {
                                await setMemberRole(workspace.id, member.user_id, v as DevRole);
                                toast.success(t('dev_saved'));
                                await load();
                              } catch (e) {
                                toast.error(devErrorText(e, t));
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ASSIGNABLE_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>{t(`dev_role_${r.toLowerCase()}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-muted-foreground">{t(`dev_role_${member.role.toLowerCase()}`)}</span>
                        )}
                      </Td>
                      <Td className="text-muted-foreground">{formatDate(member.created_at, language)}</Td>
                      <Td>
                        {can('team') && member.role !== 'OWNER' && (
                          <div className="flex justify-end">
                            <Button size="icon" variant="ghost" aria-label={t('dev_remove')}
                              onClick={() => setRemovingUser(member)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {invites.map((inv) => (
                    <tr key={inv.id} className="opacity-70">
                      <Td className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="text-muted-foreground">{t('dev_invite_pending')}</span>
                      </Td>
                      <Td className="text-muted-foreground">{inv.email}</Td>
                      <Td className="text-muted-foreground">{t(`dev_role_${inv.role.toLowerCase()}`)}</Td>
                      <Td className="text-muted-foreground">{formatDate(inv.created_at, language)}</Td>
                      <Td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            {invites.length > 0 && (
              <p className="border-t border-border px-4 py-2 text-2xs text-muted-foreground sm:px-5">
                {t('dev_invite_pending_note')}
              </p>
            )}
          </Panel>

          <p className="text-2xs text-muted-foreground">
            {t('dev_your_role')}: <strong>{t(`dev_role_${(role ?? 'viewer').toLowerCase()}`)}</strong>
            {' — '}
            {t(`dev_role_desc_${(role ?? 'viewer').toLowerCase()}`)}
          </p>
        </div>
      )}

      <AlertDialog open={Boolean(removingUser)} onOpenChange={(v) => { if (!v) setRemovingUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dev_remove_member_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dev_remove_member_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('dev_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!workspace || !removingUser) return;
                try {
                  await removeMember(workspace.id, removingUser.user_id);
                  toast.success(t('dev_member_removed'));
                  setRemovingUser(null);
                  await load();
                } catch (e) {
                  toast.error(devErrorText(e, t));
                }
              }}
            >
              {t('dev_remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DeveloperShell>
  );
}

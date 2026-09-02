// Homatch — canonical logged-in Account / Profile page.
// NOTE: this is intentionally separate from DeveloperProfilePage (/developer/:id),
// which represents a real-estate developer *entity*, not the signed-in user.
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { getCreditAccount, getCreditLedger, getMyPayments, updateMyProfile } from '@/services/api';
import type { CreditAccount, CreditLedgerEntry, Payment } from '@/types/types';
import { toast } from 'sonner';
import {
  User as UserIcon, Mail, Phone, Calendar, Shield, Zap, CreditCard, Lock,
  Loader2, Save, ExternalLink, CheckCircle2, KeyRound, Chrome,
} from 'lucide-react';

function initialsOf(name: string | null | undefined, email: string | undefined): string {
  const source = (name && name.trim()) || email || '?';
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function ProfileContent() {
  const { homatchUser, supaUser, session, refreshUser, sendPasswordReset, updatePassword, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [tab, setTab] = useState('overview');

  // ── Overview / editable fields ──────────────────────────────
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (homatchUser) {
      setFullName(homatchUser.full_name ?? '');
      setNickname(homatchUser.nickname ?? '');
      setPhone(homatchUser.phone ?? '');
      setDirty(false);
    }
  }, [homatchUser]);

  const handleSave = async () => {
    if (!homatchUser) return;
    setSaving(true);
    const result = await updateMyProfile(homatchUser.id, {
      full_name: fullName.trim() || null,
      nickname: nickname.trim() || null,
      phone: phone.trim() || null,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error ?? t('profile_save_failed'));
      return;
    }
    await refreshUser();
    setDirty(false);
    toast.success(t('profile_save_success'));
  };

  // ── Identity (Google vs password) ───────────────────────────
  const [identities, setIdentities] = useState<string[] | null>(null);
  useEffect(() => {
    supabase.auth.getUserIdentities().then(({ data }) => {
      setIdentities((data?.identities ?? []).map(i => i.provider));
    });
  }, [session]);
  const hasGoogle = identities?.includes('google') ?? false;
  const hasEmailAuth = identities?.includes('email') ?? false;

  // ── Billing ──────────────────────────────────────────────────
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [billingLoading, setBillingLoading] = useState(true);

  const loadBilling = useCallback(async () => {
    if (!homatchUser) return;
    setBillingLoading(true);
    const [account, entries, pays] = await Promise.all([
      getCreditAccount(homatchUser.id),
      getCreditLedger(homatchUser.id, undefined, 8),
      getMyPayments(homatchUser.id, 8),
    ]);
    setCreditAccount(account);
    setLedger(entries);
    setPayments(pays);
    setBillingLoading(false);
  }, [homatchUser]);

  useEffect(() => { loadBilling(); }, [loadBilling]);

  // ── Security ─────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [resetSending, setResetSending] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) { toast.error(t('reset_pw_too_short')); return; }
    if (newPassword !== confirmPassword) { toast.error(t('reset_pw_mismatch')); return; }
    setPwSaving(true);
    const { error } = await updatePassword(newPassword);
    setPwSaving(false);
    if (error) { toast.error(error); return; }
    setNewPassword(''); setConfirmPassword('');
    toast.success(t('profile_security_pw_updated'));
  };

  const handleSendReset = async () => {
    if (!supaUser?.email) return;
    setResetSending(true);
    const { error } = await sendPasswordReset(supaUser.email);
    setResetSending(false);
    if (error) toast.error(error);
    else toast.success(t('auth_forgot_sent'));
  };

  if (!homatchUser) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const registeredAt = new Date(homatchUser.created_at).toLocaleDateString();
  const balance = Number(creditAccount?.balance ?? 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xl font-semibold text-primary shrink-0 overflow-hidden">
          {homatchUser.avatar_url ? (
            <img src={homatchUser.avatar_url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            initialsOf(nickname || fullName, homatchUser.email)
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground truncate">{nickname || fullName || homatchUser.email}</h1>
          <p className="text-sm text-muted-foreground truncate">{homatchUser.email}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-3 bg-secondary border border-border w-full">
          <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{t('profile_tab_overview')}</TabsTrigger>
          <TabsTrigger value="billing" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{t('profile_tab_billing')}</TabsTrigger>
          <TabsTrigger value="security" className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{t('profile_tab_security')}</TabsTrigger>
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><UserIcon className="h-4 w-4 text-primary" /> {t('profile_section_details')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('profile_field_nickname')}</Label>
                  <Input value={nickname} onChange={e => { setNickname(e.target.value); setDirty(true); }} className="bg-secondary border-border" maxLength={60} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('profile_field_full_name')}</Label>
                  <Input value={fullName} onChange={e => { setFullName(e.target.value); setDirty(true); }} className="bg-secondary border-border" maxLength={120} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('profile_field_phone')}</Label>
                  <Input value={phone} onChange={e => { setPhone(e.target.value); setDirty(true); }} placeholder="+995 5xx xxx xxx" className="bg-secondary border-border" maxLength={30} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5"><Mail className="h-3 w-3" /> {t('profile_field_email')}</Label>
                  <Input value={homatchUser.email} disabled className="bg-secondary/50 border-border text-muted-foreground" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={!dirty || saving} onClick={handleSave} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {t('profile_save')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" /> {t('profile_field_plan')}</span>
                <Badge variant="outline" className="uppercase text-[10px]">{homatchUser.plan ?? 'FREE'}</Badge>
              </div>
              <Separator className="bg-border" />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {t('profile_field_registered')}</span>
                <span className="text-foreground">{registeredAt}</span>
              </div>
              <Separator className="bg-border" />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  {hasGoogle ? <Chrome className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {t('profile_field_login_method')}
                </span>
                <span className="text-foreground text-xs">
                  {hasGoogle && hasEmailAuth ? t('profile_login_both') : hasGoogle ? t('profile_login_google') : t('profile_login_password')}
                </span>
              </div>
              <Separator className="bg-border" />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5"><UserIcon className="h-3.5 w-3.5" /> {t('profile_field_language')}</span>
                <LanguageSwitcher />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Billing ──────────────────────────────────────────── */}
        <TabsContent value="billing" className="mt-4 space-y-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('credits_balance')}</p>
                {billingLoading ? (
                  <div className="h-8 w-24 bg-muted rounded animate-pulse" />
                ) : (
                  <p className="text-3xl font-semibold text-primary">{balance.toFixed(2)}</p>
                )}
              </div>
              <Button size="sm" onClick={() => navigate('/credits')} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                <Zap className="h-3.5 w-3.5" /> {t('profile_manage_billing')}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('credits_ledger_title')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {billingLoading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">{t('general_loading')}</div>
              ) : ledger.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">{t('credits_ledger_empty')}</p>
              ) : (
                <div className="divide-y divide-border/50">
                  {ledger.map((e, i) => (
                    <div key={e.id ?? i} className="flex items-center justify-between py-2 text-xs">
                      <span className="text-muted-foreground">{e.type.replace(/_/g, ' ')}</span>
                      <span className={e.amount < 0 ? 'text-destructive font-medium' : 'text-green-400 font-medium'}>
                        {e.amount < 0 ? '' : '+'}{e.amount.toFixed(2)} CR
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /> {t('profile_payment_history')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {billingLoading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">{t('general_loading')}</div>
              ) : payments.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">{t('profile_no_payments')}</p>
              ) : (
                <div className="divide-y divide-border/50">
                  {payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2 text-xs">
                      <div>
                        <p className="text-foreground">${p.amount_usd.toFixed(2)} — {p.status}</p>
                        <p className="text-muted-foreground/70">{new Date(p.created_at).toLocaleDateString()}</p>
                      </div>
                      {p.receipt_url && (
                        <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                          {t('profile_receipt')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Security ─────────────────────────────────────────── */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> {t('profile_section_password')}</CardTitle>
            </CardHeader>
            <CardContent>
              {hasEmailAuth ? (
                <form onSubmit={handleChangePassword} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('reset_pw_new')}</Label>
                      <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} className="bg-secondary border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('reset_pw_confirm')}</Label>
                      <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={8} className="bg-secondary border-border" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Button type="button" variant="ghost" size="sm" className="border border-border text-xs gap-1.5" disabled={resetSending} onClick={handleSendReset}>
                      {resetSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                      {t('profile_send_reset_email')}
                    </Button>
                    <Button type="submit" size="sm" disabled={pwSaving || !newPassword} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                      {pwSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {t('profile_update_password')}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{t('profile_google_only_desc')}</p>
                  <Button variant="ghost" size="sm" className="border border-border text-xs gap-1.5" disabled={resetSending} onClick={handleSendReset}>
                    {resetSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                    {t('profile_add_password')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-4">
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive border border-border" onClick={() => { signOut(); navigate('/'); }}>
                {t('nav_logout')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RouteGuard>
      <AppLayout>
        <ProfileContent />
      </AppLayout>
    </RouteGuard>
  );
}

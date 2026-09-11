import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { claimAnonymousWork } from '@/services/anonymousSession';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import type { User } from '@/types/types';
import { useLanguage } from '@/contexts/LanguageContext';

interface AuthContextValue {
  session: Session | null;
  supaUser: SupaUser | null;
  homatchUser: User | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [supaUser, setSupaUser] = useState<SupaUser | null>(null);
  const [homatchUser, setHomatchUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { applyProfileLanguage } = useLanguage();

  const fetchHomatchUser = useCallback(async (authId: string) => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle();
    setHomatchUser(data ?? null);
    // Fallback-only: never overrides an explicit choice already made on this
    // device, and only ever applies once per session (see LanguageContext).
    if (data?.preferred_language) applyProfileLanguage(data.preferred_language);
  }, [applyProfileLanguage]);

  const refreshUser = useCallback(async () => {
    if (supaUser) await fetchHomatchUser(supaUser.id);
  }, [supaUser, fetchHomatchUser]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSupaUser(data.session?.user ?? null);
      if (data.session?.user) {
        fetchHomatchUser(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSupaUser(s?.user ?? null);
      if (s?.user) {
        fetchHomatchUser(s.user.id);
        /* WHATEVER THEY DID BEFORE SIGNING IN IS THEIRS NOW.
         *
         * This is the single moment an account exists to hand anonymous work
         * to, and it fires for every route into the product — email, Google, a
         * restored session in a second tab. Claiming here rather than on one
         * page means a visitor who signed up from anywhere still keeps the
         * conversation and the research they already started; nothing is
         * copied and no thread restarts.
         *
         * Safe to run on every event: with no anonymous token it does nothing,
         * and the server treats a repeat claim as success, so a refresh in the
         * middle of the round trip cannot break it. Deliberately not awaited —
         * signing in must never wait on it — and never fatal. */
        void claimAnonymousWork()
          .then((r) => {
            // The conversation and research now belong to this account, but
            // the lists in memory were fetched when it owned nothing. Tell the
            // app to re-read rather than leaving the work invisible until the
            // next reload.
            if (r.claimed && (r.conversations > 0 || r.researchJobs > 0)) {
              window.dispatchEvent(new CustomEvent('homatch:anon-claimed', { detail: r }));
            }
          })
          .catch(() => {
            /* The work stays where it is; nothing the visitor did is lost. */
          });
      } else {
        setHomatchUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [fetchHomatchUser]);

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    // Create homatch user row
    if (data.user) {
      await supabase.from('users').insert({
        auth_id: data.user.id,
        email,
        full_name: fullName ?? null,
      });
      await fetchHomatchUser(data.user.id);
    }
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setHomatchUser(null);
  };

  // Never reveals whether the email actually has an account — Supabase Auth
  // itself returns success regardless, and we don't add our own leak on top.
  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return { error: null };
  };

  return (
    <AuthContext.Provider
      value={{ session, supaUser, homatchUser, loading, signUp, signIn, signInWithGoogle, signOut, refreshUser, sendPasswordReset, updatePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

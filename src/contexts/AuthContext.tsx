import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import type { User } from '@/types/types';

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

  const fetchHomatchUser = useCallback(async (authId: string) => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle();
    setHomatchUser(data ?? null);
  }, []);

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

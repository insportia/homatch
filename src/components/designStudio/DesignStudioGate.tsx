import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { designStudioEnabled } from '@/lib/designStudio/access';

/**
 * Design Studio is not presented until it is switched on for this viewer.
 * A hidden product is a redirect, not a blank page and not a "coming soon"
 * screen — the navigation entry is hidden by the same rule, so the only way
 * here is a typed or remembered URL.
 */
export function DesignStudioGate({ children }: { children: React.ReactNode }) {
  const { homatchUser, loading } = useAuth();
  if (loading) return null;
  if (!designStudioEnabled(homatchUser)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

import React from 'react';
import { designStudioEnabled } from '@/lib/designStudio/access';
import { ServiceUnavailable } from '@/components/serviceControls/ServiceGate';
import { useServiceControls } from '@/lib/serviceControls';

/**
 * Design Studio is not presented while the owner has it paused (Admin → Service
 * Control Center). A typed or remembered URL gets the shared "currently unavailable"
 * page; the studio itself is never mounted, so nothing of it loads or starts.
 */
export function DesignStudioGate({ children }: { children: React.ReactNode }) {
  const snapshot = useServiceControls();
  if (!snapshot.loaded) return null;
  if (!designStudioEnabled(snapshot.services.design_studio.frontend)) return <ServiceUnavailable service="design_studio" />;
  return <>{children}</>;
}

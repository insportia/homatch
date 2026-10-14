import React from 'react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { OWNER_SURFACE } from '@/components/customer/surface';
import { isImpersonating } from '@/lib/impersonation';
import { PublishingWorkspace } from './PublishingWorkspace';

export default function PublishingEnginePage() {
 return <RouteGuard><AppLayout noPadding surfaceClass={OWNER_SURFACE}>{!isImpersonating() && <PublishingWorkspace />}</AppLayout></RouteGuard>;
}

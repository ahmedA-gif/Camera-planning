'use client';

import { Suspense } from 'react';
import { RedirectToDashboard } from '@/components/redirect-to-dashboard';

export const dynamic = 'force-dynamic';

export default function CameraMapPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div></div>}>
      <RedirectToDashboard defaultView="camera-map" />
    </Suspense>
  );
}
'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useView } from '@/components/view-context';

export function ViewInitializer() {
  const { setActiveView } = useView();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams) {
      const view = searchParams.get('view');
      if (view && ['overview', 'scenario', 'camera-map', 'workflow', 'report', 'plan-generator'].includes(view)) {
        setActiveView(view as ReturnType<typeof useView>['activeView']);
      }
    }
  }, [searchParams, setActiveView]);

  return null;
}
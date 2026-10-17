'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface RedirectToDashboardProps {
  defaultView: string;
}

export function RedirectToDashboard({ defaultView }: RedirectToDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const view = searchParams.get('view') || defaultView;
    router.replace(`/?view=${view}`);
  }, [router, searchParams, defaultView]);

  return null;
}
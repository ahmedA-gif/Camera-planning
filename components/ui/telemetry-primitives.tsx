'use client';

import React, { useEffect, useState, type ReactNode } from 'react';

export type TelemetryTone = 'success' | 'danger' | 'warning' | 'info' | 'muted';

const toneClasses: Record<TelemetryTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  muted: 'border-border bg-muted/60 text-muted-foreground',
};

const dotClasses: Record<TelemetryTone, string> = {
  success: 'bg-emerald-500',
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  info: 'bg-cyan-500',
  muted: 'bg-slate-400',
};

export function LiveDot({ tone = 'success', className = '' }: { tone?: TelemetryTone; className?: string }) {
  return (
    <span className={`relative inline-flex h-2 w-2 items-center justify-center ${className}`}>
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotClasses[tone]}`} />
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />
    </span>
  );
}

export function StatusPill({
  tone = 'muted',
  children,
  dot = false,
  className = '',
}: {
  tone?: TelemetryTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase ${toneClasses[tone]} ${className}`}
    >
      {dot && <LiveDot tone={tone} />}
      {children}
    </span>
  );
}

export function useClock() {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return time;
}

export function useLiveValue(initial: number, drift = 1, intervalMs = 4000, min = 0, max = 999) {
  const [value, setValue] = useState(initial);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    if (drift <= 0) return;
    const t = setInterval(() => {
      setValue((prev) => {
        const delta = Math.round((Math.random() - 0.5) * 2 * drift);
        return Math.min(max, Math.max(min, prev + delta));
      });
      setFlash((f) => f + 1);
    }, intervalMs);
    return () => clearInterval(t);
  }, [drift, intervalMs, min, max]);

  return { value, flashKey: flash };
}

export function SectionHeader({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold tracking-wider text-foreground uppercase">{title}</h2>
          {badge}
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

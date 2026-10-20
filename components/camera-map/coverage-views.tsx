'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Move, 
  Compass, 
  Eye, 
  ShieldCheck, 
  Activity, 
  RotateCcw, 
  Play, 
  Pause, 
  ChevronRight, 
  Layers, 
  Sliders, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight, 
  Video 
} from 'lucide-react';
import {
  buildFrame, sideProfile, clamp, DORI_LEVEL, LEVEL_NAMES,
  type CameraPose, type CoverageResult, type DoriMode, type LensSpec, type Pt, type SiteSpec,
  type MappingStandard, MAPPING_STANDARDS, computeTargetMetrics, impliedHorizontalPixels,
  type Vec3, type Obstacle3D, rayAABBIntersection, obstaclesTo3D, evaluateTargetPoint3D,
} from '@/lib/coverage-engine';

export { FrustumSpatialInspector } from './frustum-spatial-inspector';

/* ------------------------------------------------------------------ */
/* Palette & helpers                                                   */
/* ------------------------------------------------------------------ */

export const CAM_COLORS = [
  '#00e5ff', '#ff6b35', '#7fff6b', '#c084fc', '#ffd60a', '#f472b6', '#38bdf8', '#fb923c',
  '#a3e635', '#e879f9', '#34d399', '#fbbf24', '#f87171', '#818cf8', '#2dd4bf', '#f9a8d4',
  '#86efac', '#fde68a', '#93c5fd', '#ddd6fe',
];
export const camColor = (id: number) => CAM_COLORS[(id - 1) % CAM_COLORS.length];

/** Blind, Detect, Observe, Recognize, Identify */
export const LEVEL_RGB: [number, number, number][] = [
  [239, 68, 68], [245, 158, 11], [250, 204, 21], [74, 222, 128], [34, 211, 238],
];
const OVERLAP_RGB: [number, number, number][] = [[239, 68, 68], [20, 184, 166], [74, 222, 128], [168, 85, 247]];

export const MOUNT_SYMBOLS: Record<string, string> = {
  'wall-h': '■',
  'wall-v': '▼',
  'roof-nadir': '●',
  'roof-tilt': '◆',
  'corner': '▲',
  'cross': '◀▶',
  'pole360': '⊕',
  'underside': '●',
};

export const OBSTACLE_TYPE_LABELS: Record<string, { label: string; icon: string; border: string; fill: string; hatch: string }> = {
  rack: { label: 'Storage Rack', icon: '📦', border: '#f59e0b', fill: 'rgba(30,41,59,0.95)', hatch: 'rgba(245,158,11,0.18)' },
  machine: { label: 'Machine / Robot', icon: '🤖', border: '#0284c7', fill: 'rgba(23,37,84,0.95)', hatch: 'rgba(14,165,233,0.22)' },
  conveyor: { label: 'Conveyor Line', icon: '🔄', border: '#06b6d4', fill: 'rgba(15,23,42,0.94)', hatch: 'rgba(6,182,212,0.25)' },
  agv_lane: { label: 'AGV Transit Lane', icon: '🚜', border: '#10b981', fill: 'rgba(6,78,59,0.25)', hatch: 'rgba(16,185,129,0.15)' },
  mezzanine: { label: 'Mezzanine Platform', icon: '🏢', border: '#c084fc', fill: 'rgba(59,7,100,0.65)', hatch: 'rgba(192,132,252,0.2)' },
  column: { label: 'Structural Column', icon: '🏛️', border: '#a855f7', fill: 'rgba(51,65,85,0.96)', hatch: 'rgba(168,85,247,0.22)' },
  hazard: { label: 'Hazard Zone', icon: '⚠️', border: '#f43f5e', fill: 'rgba(69,10,10,0.85)', hatch: 'rgba(244,63,94,0.25)' },
  dock: { label: 'Loading Dock', icon: '🚛', border: '#eab308', fill: 'rgba(23,37,84,0.9)', hatch: 'rgba(234,179,8,0.2)' },
  wall: { label: 'Concrete Wall', icon: '🧱', border: '#ef4444', fill: 'rgba(15,23,42,0.98)', hatch: 'rgba(239,68,68,0.15)' },
  partition: { label: 'Partition Screen', icon: '🛡️', border: '#14b8a6', fill: 'rgba(30,41,59,0.78)', hatch: 'rgba(20,184,166,0.15)' },
};

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export function hexA(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
const rad = (d: number) => (d * Math.PI) / 180;

function niceStep(span: number, ticks = 10) {
  const raw = span / ticks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

function useElementWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f8fafc');
  g.addColorStop(1, '#f1f5f9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function title(ctx: CanvasRenderingContext2D, text: string, sub: string, x: number, y: number) {
  ctx.font = '700 11px ui-sans-serif, system-ui';
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = '#64748b';
  ctx.fillText(sub, x + tw + 10, y);
}

/** Per-cell RGBA image of the coverage grid (1 px per cell; scaled when drawn). */
export function buildHeatImage(res: CoverageResult, need: number, heatMode: 'dori' | 'overlap'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = res.cols;
  c.height = res.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(res.cols, res.rows);
  for (let i = 0; i < res.best.length; i++) {
    const b = res.best[i];
    const o = i * 4;
    if (b === 255) { img.data[o + 3] = 0; continue; }
    let col: [number, number, number], a: number;
    if (heatMode === 'overlap') {
      const n = Math.min(3, res.count[i]);
      col = OVERLAP_RGB[n];
      a = n === 0 ? 0.32 : 0.5;
    } else if (b >= need) { col = LEVEL_RGB[b]; a = 0.55; }
    else if (b > 0) { col = LEVEL_RGB[b]; a = 0.18; }
    else { col = LEVEL_RGB[0]; a = 0.3; }
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface BaseProps {
  result: CoverageResult;
  poses: CameraPose[];
  lens: LensSpec;
  site: SiteSpec;
  mode: DoriMode;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/* ------------------------------------------------------------------ */
/* TOP VIEW — heatmap, exact footprints, drag-to-move                  */
/* ------------------------------------------------------------------ */

export function TopView({
  result, poses, site, mode, selectedId, onSelect, onMove, heatMode,
  selectedObstacleId, onSelectObstacle, onMoveObstacle, isAnimated = true, animSpeed = 1,
}: BaseProps & {
  onMove: (id: number, x: number, y: number) => void;
  heatMode: 'dori' | 'overlap';
  selectedObstacleId?: string | null;
  onSelectObstacle?: (id: string | null) => void;
  onMoveObstacle?: (id: string, x: number, y: number) => void;
  isAnimated?: boolean;
  animSpeed?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(wrapRef);
  const L = site.length, W = site.width;
  const PL = 46, PR = 18, PT = 30, PB = 40;
  const height = width ? clamp(((width - PL - PR) * W) / L + PT + PB, 230, 540) : 300;
  const sx = (width - PL - PR) / L, sy = (height - PT - PB) / W;
  const need = DORI_LEVEL[mode];
  const heat = useMemo(() => (typeof document === 'undefined' ? null : buildHeatImage(result, need, heatMode)), [result, need, heatMode]);
  const [hover, setHover] = useState<{ mx: number; my: number; x: number; y: number } | null>(null);
  const drag = useRef<number | null>(null);
  const dragObstacle = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const draw = useCallback((dash: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ctx = setupCanvas(canvas, width, height);
    background(ctx, width, height);
    const X = (x: number) => PL + x * sx, Y = (y: number) => PT + y * sy;
    const trace = (poly: Pt[]) => { ctx.beginPath(); poly.forEach((p, k) => (k ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)))); ctx.closePath(); };

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PL, PT, L * sx, W * sy);
    if (heat) {
      ctx.imageSmoothingEnabled = (L * sx) / result.cols < 4;
      ctx.drawImage(heat, PL, PT, L * sx, W * sy);
    }

    // grid
    const gx = niceStep(L, 12), gy = niceStep(W, 6);
    ctx.strokeStyle = 'rgba(203,213,225,0.7)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= L + 1e-6; x += gx) { ctx.beginPath(); ctx.moveTo(X(x), PT); ctx.lineTo(X(x), PT + W * sy); ctx.stroke(); }
    for (let y = 0; y <= W + 1e-6; y += gy) { ctx.beginPath(); ctx.moveTo(PL, Y(y)); ctx.lineTo(PL + L * sx, Y(y)); ctx.stroke(); }

    ctx.save();
    ctx.beginPath();
    ctx.rect(PL, PT, L * sx, W * sy);
    ctx.clip();

    // obstacles with rich physical styling
    site.obstacles.forEach(o => {
      const isSelObs = o.id === selectedObstacleId;
      const ox = X(o.x), oy = Y(o.y), ow = Math.max(2, o.w * sx), od = Math.max(2, o.d * sy);
      const meta = OBSTACLE_TYPE_LABELS[o.type || 'rack'] || OBSTACLE_TYPE_LABELS.rack;

      ctx.fillStyle = meta.fill;
      ctx.fillRect(ox, oy, ow, od);
      ctx.strokeStyle = isSelObs ? '#3b82f6' : meta.border;
      ctx.lineWidth = isSelObs ? 2.5 : 1.2;
      ctx.strokeRect(ox, oy, ow, od);

      // Hatching
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, ow, od);
      ctx.clip();
      ctx.strokeStyle = meta.hatch;
      ctx.lineWidth = 1;
      for (let k = -od; k < ow; k += 8) {
        ctx.beginPath();
        ctx.moveTo(ox + k, oy + od);
        ctx.lineTo(ox + k + od, oy);
        ctx.stroke();
      }
      ctx.restore();

      // Label & icon
      if (ow > 28 && od > 10) {
        ctx.fillStyle = isSelObs ? '#93c5fd' : '#e2e8f0';
        ctx.font = '700 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelText = o.name.length > 20 && ow < 100 ? o.name.slice(0, 18) + '…' : o.name;
        ctx.fillText(`${meta.icon} ${labelText}`, ox + ow / 2, oy + od / 2);
        ctx.textBaseline = 'alphabetic';
      }
    });

    // footprints
    poses.forEach((p, i) => {
      const st = result.cameras[i];
      if (!st) return;
      const col = camColor(p.id);
      const sel = p.id === selectedId;
      const det = st.doriFootprints[1];
      if (det.length > 2) {
        trace(det);
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = hexA(col, sel ? 0.6 : 0.28);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const idf = st.doriFootprints[4];
      if (idf.length > 2 && sel) {
        trace(idf);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(14,165,233,0.95)';
        ctx.stroke();
      }
      if (st.footprint.length > 2) {
        trace(st.footprint);
        ctx.fillStyle = hexA(col, sel ? 0.22 : 0.08);
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -dash * 1.5;
        ctx.strokeStyle = hexA(col, sel ? 1 : 0.75);
        ctx.lineWidth = sel ? 2.2 : 1.4;
        ctx.stroke();
        ctx.lineDashOffset = 0;

        // Multi-ring animated optical wave propagating from camera
        if (isAnimated !== false) {
          const cx = X(p.x), cy = Y(p.y);
          ctx.save();
          ctx.beginPath();
          trace(st.footprint);
          ctx.clip();

          for (let wIdx = 0; wIdx < 3; wIdx++) {
            const wavePhase = (dash * 0.035 * (animSpeed || 1) + i * 0.28 + wIdx * 0.33) % 1;
            const waveRadius = 8 + wavePhase * Math.max(60, (st.farReach || 20) * sx);
            ctx.beginPath();
            ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
            ctx.strokeStyle = hexA(col, (1 - wavePhase) * (sel ? 0.8 : 0.4));
            ctx.lineWidth = sel ? 2 : 1.2;
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      ctx.setLineDash([]);
    });
    ctx.restore();

    // bay outline
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(PL, PT, L * sx, W * sy);

    // cameras
    poses.forEach(p => {
      const col = camColor(p.id);
      const sel = p.id === selectedId;
      const cx = X(p.x), cy = Y(p.y);
      const a = rad(p.panDeg);
      const dx = Math.cos(a) * sx, dy = Math.sin(a) * sy;
      const n = Math.hypot(dx, dy) || 1;
      if (p.mount !== 'roof-nadir' && p.mount !== 'pole360') {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (dx / n) * 22, cy + (dy / n) * 22); ctx.stroke();
        ctx.beginPath();
        const tx = cx + (dx / n) * 22, ty = cy + (dy / n) * 22, ang = Math.atan2(dy, dx);
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 6 * Math.cos(ang - 0.5), ty - 6 * Math.sin(ang - 0.5));
        ctx.lineTo(tx - 6 * Math.cos(ang + 0.5), ty - 6 * Math.sin(ang + 0.5));
        ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      }
      // Under-camera dead zone ring (physical occlusion directly beneath high mounts)
      if (p.mount !== 'roof-nadir' && p.tiltDeg < 80) {
        const deadRadius = Math.max(0.6, Math.min(4.5, (p.z - site.targetHeight) * 0.45));
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = sel ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(5, deadRadius * sx), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const r = sel ? 11 : 9;
      ctx.save();
      ctx.shadowBlur = sel ? 22 : 12;
      ctx.shadowColor = col;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2; ctx.strokeStyle = sel ? '#ffffff' : '#0b0d12';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#0b0d12';
      ctx.font = `700 ${p.id > 99 ? 8 : 10}px ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(p.id), cx, cy + 0.5);
      ctx.textBaseline = 'alphabetic';

      // Mount symbol badge
      const sym = MOUNT_SYMBOLS[p.mount] || '●';
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(cx + r * 0.8, cy - r * 0.8, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 7px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sym, cx + r * 0.8, cy - r * 0.8);
      ctx.textBaseline = 'alphabetic';

      if (poses.length <= 24 || sel) {
        ctx.fillStyle = col;
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(`${p.x.toFixed(1)}m`, cx, cy + r + 11);
      }
    });

    // rulers
    ctx.fillStyle = '#64748b';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let x = 0; x <= L + 1e-6; x += gx) ctx.fillText(`${+x.toFixed(1)}m`, X(x), PT + W * sy + 14);
    ctx.textAlign = 'right';
    for (let y = 0; y <= W + 1e-6; y += gy) ctx.fillText(`${+y.toFixed(1)}m`, PL - 6, Y(y) + 3);
    ctx.textAlign = 'center';
    ctx.fillText(`← Bay length ${L} m →`, PL + (L * sx) / 2, height - 6);
    const exag = sy / sx;
    title(ctx, 'TOP VIEW — FLOOR PLAN', `target plane h=${site.targetHeight}m${exag > 1.05 ? ` · width shown ×${exag.toFixed(1)}` : ''}`, PL, 18);
  }, [width, height, heat, poses, result, selectedId, selectedObstacleId, site, sx, sy, L, W, isAnimated, animSpeed]);

  useEffect(() => {
    if (!width) return;
    let raf = 0, dash = 0;
    const loop = () => { dash = (dash + 0.6) % 1000; draw(dash); raf = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [draw, width]);

  const toWorld = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    return { mx, my, x: (mx - PL) / sx, y: (my - PT) / sy };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    let hit: number | null = null, bestD = 16;
    poses.forEach(p => {
      const d = Math.hypot(PL + p.x * sx - w.mx, PT + p.y * sy - w.my);
      if (d < bestD) { bestD = d; hit = p.id; }
    });
    if (hit != null) {
      drag.current = hit;
      dragObstacle.current = null;
      onSelect(hit);
      onSelectObstacle?.(null);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      // Check if clicking inside an obstacle
      const hitObs = site.obstacles.find(o => w.x >= o.x && w.x <= o.x + o.w && w.y >= o.y && w.y <= o.y + o.d);
      if (hitObs) {
        dragObstacle.current = { id: hitObs.id, offsetX: w.x - hitObs.x, offsetY: w.y - hitObs.y };
        drag.current = null;
        onSelectObstacle?.(hitObs.id);
        onSelect(null);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (w.x >= 0 && w.x <= L && w.y >= 0 && w.y <= W) {
        drag.current = null;
        dragObstacle.current = null;
        onSelect(null);
        onSelectObstacle?.(null);
      }
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    if (drag.current != null) {
      onMove(drag.current, +clamp(w.x, 0, L).toFixed(2), +clamp(w.y, 0, W).toFixed(2));
    } else if (dragObstacle.current != null && onMoveObstacle) {
      const obs = site.obstacles.find(o => o.id === dragObstacle.current!.id);
      const obsW = obs ? obs.w : 2;
      const obsD = obs ? obs.d : 2;
      const nx = clamp(w.x - dragObstacle.current.offsetX, 0, L - obsW);
      const ny = clamp(w.y - dragObstacle.current.offsetY, 0, W - obsD);
      onMoveObstacle(dragObstacle.current.id, +nx.toFixed(2), +ny.toFixed(2));
    }
    setHover(w.x >= 0 && w.x <= L && w.y >= 0 && w.y <= W ? w : null);
  };
  const onPointerUp = () => {
    drag.current = null;
    dragObstacle.current = null;
  };

  let tip: React.ReactNode = null;
  if (hover) {
    const hitObs = site.obstacles.find(o => hover.x >= o.x && hover.x <= o.x + o.w && hover.y >= o.y && hover.y <= o.y + o.d);
    if (hitObs) {
      tip = (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-100 shadow-xl backdrop-blur-xs"
          style={{ left: Math.min(hover.mx + 14, width - 210), top: Math.max(4, hover.my - 68) }}
        >
          <div className="text-amber-400 font-bold flex items-center gap-1.5">
            <span>🏗️ {hitObs.name}</span>
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-sans">
              {hitObs.type || 'obstacle'}
            </span>
          </div>
          <div className="text-slate-300 text-[10px]">
            Size: {hitObs.w.toFixed(1)}m × {hitObs.d.toFixed(1)}m · Height: {hitObs.h.toFixed(1)}m
          </div>
          <div className="text-slate-400 text-[10px]">
            Position: ({hitObs.x.toFixed(1)}m, {hitObs.y.toFixed(1)}m) · Occludes Cameras
          </div>
        </div>
      );
    } else {
      const i = clamp(Math.floor(hover.x / result.cellW), 0, result.cols - 1);
      const j = clamp(Math.floor(hover.y / result.cellH), 0, result.rows - 1);
      const idx = j * result.cols + i;
      const b = result.best[idx];
      tip = (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-800 shadow-xl"
          style={{ left: Math.min(hover.mx + 14, width - 170), top: Math.max(4, hover.my - 64) }}
        >
          <div className="text-muted-foreground">x {hover.x.toFixed(2)} m · y {hover.y.toFixed(2)} m</div>
          {b === 255 ? <div className="text-slate-500 font-medium">Inside obstacle</div> : (
            <>
              <div className="font-bold" style={{ color: rgba(LEVEL_RGB[b], 1) }}>{LEVEL_NAMES[b]}{b > 0 ? ` · ${Math.round(result.bestPpm[idx])} px/m` : ''}</div>
              <div className="text-slate-600 font-medium">{result.count[idx]} camera{result.count[idx] === 1 ? '' : 's'} at {mode}</div>
            </>
          )}
        </div>
      );
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <canvas
        ref={canvasRef}
        className="block w-full touch-none rounded-md"
        style={{ cursor: drag.current != null ? 'grabbing' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { setHover(null); }}
      />
      {tip}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SIDE VIEW — exact x–z silhouette of each clipped frustum            */
/* ------------------------------------------------------------------ */

export function SideView({ result, poses, lens, site, mode, selectedId, onSelect }: BaseProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(wrapRef);
  const height = width ? clamp(width * 0.32, 230, 340) : 260;
  const need = DORI_LEVEL[mode];
  const L = site.length;
  const profiles = useMemo(() => poses.map(p => {
    const fr = buildFrame(p, lens, site);
    return { mode: sideProfile(fr, fr.reach[need]), detect: sideProfile(fr, fr.reach[1]) };
  }), [poses, lens, site, need]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ctx = setupCanvas(canvas, width, height);
    background(ctx, width, height);
    const PL = 46, PR = 18, PT = 30, PB = 40;
    const zTop = Math.max(site.mountHeight, ...poses.map(p => p.z), ...site.obstacles.map(o => o.h), 3) * 1.35 + 0.5;
    const sx = (width - PL - PR) / L, sz = (height - PT - PB) / zTop;
    const floorY = PT + zTop * sz;
    const X = (x: number) => PL + x * sx, Z = (z: number) => floorY - z * sz;

    const gz = niceStep(zTop, 5);
    ctx.font = '9px ui-monospace, monospace';
    for (let z = 0; z <= zTop + 1e-6; z += gz) {
      ctx.strokeStyle = 'rgba(203,213,225,0.7)';
      ctx.beginPath(); ctx.moveTo(PL, Z(z)); ctx.lineTo(PL + L * sx, Z(z)); ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.textAlign = 'right'; ctx.fillText(`${+z.toFixed(1)}m`, PL - 6, Z(z) + 3);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(PL, floorY, L * sx, 4);

    ctx.save();
    ctx.beginPath(); ctx.rect(PL, PT - 10, L * sx, floorY - PT + 10); ctx.clip();

    // mount height & target plane
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(100,116,139,0.5)';
    ctx.beginPath(); ctx.moveTo(PL, Z(site.mountHeight)); ctx.lineTo(PL + L * sx, Z(site.mountHeight)); ctx.stroke();
    ctx.strokeStyle = 'rgba(14,165,233,0.7)';
    ctx.beginPath(); ctx.moveTo(PL, Z(site.targetHeight)); ctx.lineTo(PL + L * sx, Z(site.targetHeight)); ctx.stroke();
    ctx.setLineDash([]);

    site.obstacles.forEach(o => {
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.fillRect(X(o.x), Z(o.h), o.w * sx, o.h * sz);
      ctx.strokeStyle = 'rgba(100,116,139,0.6)';
      ctx.strokeRect(X(o.x), Z(o.h), o.w * sx, o.h * sz);
    });

    const trace = (poly: Pt[]) => { ctx.beginPath(); poly.forEach((p, k) => (k ? ctx.lineTo(X(p.x), Z(p.y)) : ctx.moveTo(X(p.x), Z(p.y)))); ctx.closePath(); };
    poses.forEach((p, i) => {
      const col = camColor(p.id);
      const sel = selectedId == null || p.id === selectedId;
      const pr = profiles[i];
      if (!pr) return;
      trace(pr.detect); ctx.fillStyle = hexA(col, sel ? 0.05 : 0.02); ctx.fill();
      trace(pr.mode);
      const g = ctx.createLinearGradient(X(p.x), Z(p.z), X(p.x), floorY);
      g.addColorStop(0, hexA(col, sel ? 0.42 : 0.12));
      g.addColorStop(1, hexA(col, sel ? 0.14 : 0.04));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = hexA(col, sel ? 0.95 : 0.35); ctx.lineWidth = p.id === selectedId ? 2 : 1.2; ctx.stroke();
    });
    ctx.restore();

    poses.forEach(p => {
      const col = camColor(p.id);
      const cx = X(p.x), cy = Z(p.z);
      const fromCeiling = p.mount === 'roof-nadir' || p.mount === 'roof-tilt';
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, fromCeiling ? Z(Math.max(p.z, site.mountHeight) + 0.4) : floorY); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = col;
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.restore();
      ctx.strokeStyle = p.id === selectedId ? '#fff' : '#0b0d12'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#0b0d12'; ctx.font = '700 8px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(p.id), cx, cy + 0.5); ctx.textBaseline = 'alphabetic';
      if (poses.length <= 20) { ctx.fillStyle = hexA(col, 0.85); ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillText(`${p.z.toFixed(1)}m ${p.tiltDeg}°`, cx + 11, cy - 6); }
    });

    const gx = niceStep(L, 12);
    ctx.fillStyle = '#64748b'; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
    for (let x = 0; x <= L + 1e-6; x += gx) ctx.fillText(`${+x.toFixed(1)}m`, X(x), floorY + 18);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(34,211,238,0.8)';
    ctx.fillText(`target plane ${site.targetHeight} m`, PL + 6, Z(site.targetHeight) - 4);
    ctx.fillStyle = '#64748b';
    ctx.fillText('FLOOR 0 m', PL + 6, floorY + 32);
    title(ctx, 'SIDE PROFILE — ELEVATION', `frustum clipped by floor & ${mode} range`, PL, 18);
    void result;
  }, [width, height, poses, profiles, site, selectedId, mode, L, result]);

  const onClick = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const x = ((mx - 46) / (width - 64)) * L;
    let best: number | null = null, bd = Math.max(1, L * 0.02);
    poses.forEach(p => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p.id; } });
    onSelect(best);
  };

  return <div ref={wrapRef} className="w-full"><canvas ref={canvasRef} onClick={onClick} className="block w-full cursor-pointer rounded-md" /></div>;
}

/* ------------------------------------------------------------------ */
/* 3D VIEW — orbitable projection with obstacles and frustums          */
/* ------------------------------------------------------------------ */

export function PerspectiveView({ result, poses, site, mode, selectedId, heatMode }: BaseProps & { heatMode: 'dori' | 'overlap' }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(wrapRef);
  const height = width ? clamp(width * 0.48, 280, 520) : 340;
  const [yaw, setYaw] = useState(-28);
  const [pitch, setPitch] = useState(32);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const need = DORI_LEVEL[mode];
  const L = site.length, W = site.width;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ctx = setupCanvas(canvas, width, height);
    background(ctx, width, height);
    const cy = Math.cos(rad(yaw)), sy = Math.sin(rad(yaw));
    const cp = Math.cos(rad(pitch)), sp = Math.sin(rad(pitch));
    const zMax = Math.max(site.mountHeight, ...poses.map(p => p.z), ...site.obstacles.map(o => o.h));
    const raw = (x: number, y: number, z: number) => {
      const X = x - L / 2, Y = y - W / 2;
      const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy;
      return { sx: x1, sy: y1 * sp - z * cp, near: -y1 * cp + z * sp };
    };
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const x of [0, L]) for (const y of [0, W]) for (const z of [0, zMax]) {
      const q = raw(x, y, z);
      bx0 = Math.min(bx0, q.sx); bx1 = Math.max(bx1, q.sx); by0 = Math.min(by0, q.sy); by1 = Math.max(by1, q.sy);
    }
    const scale = Math.min((width - 60) / (bx1 - bx0 || 1), (height - 70) / (by1 - by0 || 1)) * zoom;
    const ox = width / 2 - ((bx0 + bx1) / 2) * scale, oy = height / 2 + 14 - ((by0 + by1) / 2) * scale;
    const P = (x: number, y: number, z: number) => { const q = raw(x, y, z); return { x: ox + q.sx * scale, y: oy + q.sy * scale, near: q.near }; };
    const poly = (pts: { x: number; y: number }[]) => { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };

    // floor heat (block-sampled at cell centres)
    const bs = Math.max(1, Math.ceil(Math.max(result.cols / 110, result.rows / 45)));
    for (let j = 0; j < result.rows; j += bs) {
      for (let i = 0; i < result.cols; i += bs) {
        const ci = Math.min(result.cols - 1, i + (bs >> 1)), cj = Math.min(result.rows - 1, j + (bs >> 1));
        const idx = cj * result.cols + ci;
        const b = result.best[idx];
        if (b === 255) continue;
        let col: [number, number, number], a: number;
        if (heatMode === 'overlap') { const n = Math.min(3, result.count[idx]); col = OVERLAP_RGB[n]; a = n ? 0.5 : 0.28; }
        else if (b >= need) { col = LEVEL_RGB[b]; a = 0.5; } else if (b > 0) { col = LEVEL_RGB[b]; a = 0.16; } else { col = LEVEL_RGB[0]; a = 0.26; }
        const x0 = i * result.cellW, y0 = j * result.cellH;
        const x1 = Math.min(L, (i + bs) * result.cellW), y1 = Math.min(W, (j + bs) * result.cellH);
        poly([P(x0, y0, 0), P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)]);
        ctx.fillStyle = rgba(col, a);
        ctx.fill();
      }
    }
    // floor outline & ghost walls
    poly([P(0, 0, 0), P(L, 0, 0), P(L, W, 0), P(0, W, 0)]);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(148,163,184,0.6)'; ctx.lineWidth = 1;
    for (const [x, y] of [[0, 0], [L, 0], [L, W], [0, W]]) { const a = P(x, y, 0), b = P(x, y, site.mountHeight); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    poly([P(0, 0, site.mountHeight), P(L, 0, site.mountHeight), P(L, W, site.mountHeight), P(0, W, site.mountHeight)]); ctx.stroke();
    ctx.setLineDash([]);

    // drawables sorted far → near
    type D = { near: number; draw: () => void };
    const items: D[] = [];
    site.obstacles.forEach(o => {
      const c = P(o.x + o.w / 2, o.y + o.d / 2, o.h / 2);
      items.push({
        near: c.near,
        draw: () => {
          const x0 = o.x, x1 = o.x + o.w, y0 = o.y, y1 = o.y + o.d, h = o.h;
          const faces: { n: [number, number, number]; pts: [number, number, number][] }[] = [
            { n: [0, 0, 1], pts: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]] },
            { n: [-1, 0, 0], pts: [[x0, y0, 0], [x0, y1, 0], [x0, y1, h], [x0, y0, h]] },
            { n: [1, 0, 0], pts: [[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]] },
            { n: [0, -1, 0], pts: [[x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]] },
            { n: [0, 1, 0], pts: [[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]] },
          ];
          let baseR = 51, baseG = 65, baseB = 85;
          if (o.type === 'rack') { baseR = 45; baseG = 55; baseB = 72; }
          else if (o.type === 'machine') { baseR = 23; baseG = 37; baseB = 84; }
          else if (o.type === 'conveyor') { baseR = 14; baseG = 116; baseB = 144; }
          else if (o.type === 'agv_lane') { baseR = 6; baseG = 95; baseB = 70; }
          else if (o.type === 'mezzanine') { baseR = 88; baseG = 28; baseB = 135; }
          else if (o.type === 'hazard') { baseR = 159; baseG = 18; baseB = 57; }
          else if (o.type === 'dock') { baseR = 161; baseG = 98; baseB = 7; }
          else if (o.type === 'column') { baseR = 71; baseG = 85; baseB = 105; }

          faces.forEach(f => {
            const n1y = f.n[0] * sy + f.n[1] * cy;
            const facing = -n1y * cp + f.n[2] * sp;
            if (facing <= 0) return;
            poly(f.pts.map(([x, y, z]) => P(x, y, z)));
            const shade = f.n[2] ? 1.35 : 0.65 + 0.35 * facing;
            ctx.fillStyle = `rgba(${Math.min(255, Math.round(baseR * shade))},${Math.min(255, Math.round(baseG * shade))},${Math.min(255, Math.round(baseB * shade))},0.95)`;
            ctx.fill();
            ctx.strokeStyle = f.n[2] ? 'rgba(255,255,255,0.3)' : 'rgba(148,163,184,0.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
          });
        },
      });
    });
    poses.forEach((p, i) => {
      const st = result.cameras[i];
      const col = camColor(p.id);
      const sel = selectedId == null || selectedId === p.id;
      const top = P(p.x, p.y, p.z);
      items.push({
        near: top.near,
        draw: () => {
          const fp = st?.footprint ?? [];
          if (fp.length > 2) {
            const ring = fp.map(q => P(q.x, q.y, site.targetHeight));
            poly(ring); ctx.fillStyle = hexA(col, sel ? 0.22 : 0.06); ctx.fill();
            ctx.strokeStyle = hexA(col, sel ? 0.9 : 0.3); ctx.lineWidth = 1.2; ctx.stroke();
            const spokes = fp.length > 8 ? ring.filter((_, k) => k % Math.ceil(fp.length / 8) === 0) : ring;
            ctx.strokeStyle = hexA(col, sel ? 0.55 : 0.15); ctx.lineWidth = 1;
            spokes.forEach(q => { ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(q.x, q.y); ctx.stroke(); });
          }
          const base = P(p.x, p.y, 0);
          ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
          ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = col;
          ctx.beginPath(); ctx.arc(top.x, top.y, 7, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.restore();
          ctx.strokeStyle = selectedId === p.id ? '#fff' : '#0b0d12'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(top.x, top.y, 7, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#0b0d12'; ctx.font = '700 7px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(p.id), top.x, top.y + 0.5); ctx.textBaseline = 'alphabetic';
          if (poses.length <= 30 || selectedId === p.id) { ctx.fillStyle = col; ctx.font = '9px ui-monospace, monospace'; ctx.fillText(`C${p.id}`, top.x, top.y - 12); }
        },
      });
    });
    items.sort((a, b) => a.near - b.near).forEach(d => d.draw());

    title(ctx, '3D PERSPECTIVE', `${L} × ${W} × ${site.mountHeight} m · drag to orbit · scroll to zoom`, 18, 20);
  }, [width, height, yaw, pitch, zoom, poses, result, site, selectedId, heatMode, need, L, W]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setZoom(z => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.4, 6)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <canvas
        ref={canvasRef}
        className="block w-full touch-none cursor-grab rounded-md active:cursor-grabbing"
        onPointerDown={e => { dragRef.current = { x: e.clientX, y: e.clientY, yaw, pitch }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => {
          const d = dragRef.current;
          if (!d) return;
          setYaw(d.yaw + (e.clientX - d.x) * 0.4);
          setPitch(clamp(d.pitch + (e.clientY - d.y) * 0.3, 8, 89));
        }}
        onPointerUp={() => { dragRef.current = null; }}
      />
      <div className="absolute bottom-2 right-2 flex gap-1">
        {[['Iso', -28, 32], ['Top', 0, 89], ['Front', 0, 10]].map(([label, y, p]) => (
          <button key={label as string} type="button" onClick={() => { setYaw(y as number); setPitch(p as number); setZoom(1); }}
            className="rounded border border-border bg-white/90 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-primary">
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3D BIRD CAMERA VIEW — Overhead CCTV Drone Mapping & Animated Visuals*/
/* ------------------------------------------------------------------ */

function rayIntersectsObstacle(
  p0: [number, number, number],
  p1: [number, number, number],
  o: { x: number; y: number; w: number; d: number; h: number; zBase?: number }
): { hit: boolean; t: number; point?: [number, number, number] } {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  let tmin = 0, tmax = 1;
  const zb = o.zBase ?? 0;
  const bmin = [o.x, o.y, zb];
  const bmax = [o.x + o.w, o.y + o.d, zb + o.h];

  for (let i = 0; i < 3; i++) {
    const p = p0[i], d = [dx, dy, dz][i];
    if (Math.abs(d) < 1e-6) {
      if (p < bmin[i] || p > bmax[i]) return { hit: false, t: 1 };
    } else {
      const invD = 1 / d;
      let t1 = (bmin[i] - p) * invD;
      let t2 = (bmax[i] - p) * invD;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return { hit: false, t: 1 };
    }
  }
  if (tmin <= tmax && tmax > 0 && tmin < 1) {
    const tHit = Math.max(0, tmin);
    return {
      hit: true,
      t: tHit,
      point: [p0[0] + dx * tHit, p0[1] + dy * tHit, p0[2] + dz * tHit],
    };
  }
  return { hit: false, t: 1 };
}

export function BirdCameraView({
  result, poses, lens, site, mode, selectedId, onSelect, heatMode,
  standard: initialStandard = 'dori', onStandardChange,
  onMoveCamera, onPoseChange,
}: BaseProps & {
  heatMode: 'dori' | 'overlap';
  standard?: MappingStandard;
  onStandardChange?: (std: MappingStandard) => void;
  onMoveCamera?: (id: number, x: number, y: number) => void;
  onPoseChange?: (id: number, updates: Partial<CameraPose>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWidth = useElementWidth(canvasWrapRef);
  const height = canvasWidth ? clamp(Math.round(canvasWidth * 0.56), 360, 560) : 400;

  // Camera orientation & view controls
  const [yaw, setYaw] = useState(-20);
  const [pitch, setPitch] = useState(68); // High bird's eye tilt
  const [zoom, setZoom] = useState(1.05);

  // Slow animation & motion controls (0.3x calm speed by default so user clearly understands)
  const [animSpeed, setAnimSpeed] = useState<number>(0.3);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isAutoOrbit, setIsAutoOrbit] = useState<boolean>(false);
  const [isTargetPatrolling, setIsTargetPatrolling] = useState<boolean>(true);
  const [targetType, setTargetType] = useState<'pedestrian' | 'forklift' | 'intruder'>('pedestrian');
  const [standard, setStandard] = useState<MappingStandard>(initialStandard);

  const L = site.length, W = site.width;
  const targetH = targetType === 'forklift' ? 2.3 : 1.8;
  const hpx = useMemo(() => impliedHorizontalPixels(lens), [lens]);

  // Target position state
  const [targetPos, setTargetPos] = useState<{ x: number; y: number; z: number }>({
    x: L * 0.35,
    y: W * 0.45,
    z: targetH,
  });

  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const animTimeRef = useRef<number>(0);
  const camProjectedPointsRef = useRef<Array<{ id: number; x: number; y: number }>>([]);

  // Sync external standard change
  useEffect(() => {
    if (initialStandard && initialStandard !== standard) {
      setStandard(initialStandard);
    }
  }, [initialStandard]);

  const handleStandardSelect = (std: MappingStandard) => {
    setStandard(std);
    onStandardChange?.(std);
  };

  // Multi-height target raycasting (Ankle 0.15m, Torso 1.1m, Head targetH - 0.15m)
  const activeCameraTargetInfo = useMemo(() => {
    let bestCam: CameraPose | null = null;
    let minOccludedDist = Infinity;
    let isOccluded = true;
    let occludingObstacleName: string | null = null;

    poses.forEach(cam => {
      const dist = Math.hypot(cam.x - targetPos.x, cam.y - targetPos.y, cam.z - targetPos.z);
      const pCam: [number, number, number] = [cam.x, cam.y, cam.z];
      const pTarHead: [number, number, number] = [targetPos.x, targetPos.y, targetH - 0.15];
      
      let occludedBy: string | null = null;
      for (const obs of site.obstacles) {
        const hitRes = rayIntersectsObstacle(pCam, pTarHead, obs);
        if (hitRes.hit) {
          occludedBy = obs.name;
          break;
        }
      }

      if (!occludedBy && dist < minOccludedDist) {
        minOccludedDist = dist;
        bestCam = cam;
        isOccluded = false;
        occludingObstacleName = null;
      } else if (isOccluded && dist < minOccludedDist) {
        minOccludedDist = dist;
        bestCam = cam;
        occludingObstacleName = occludedBy;
      }
    });

    const chosenCam = selectedId != null ? (poses.find(p => p.id === selectedId) || bestCam) : bestCam;
    const chosenDist = chosenCam ? Math.hypot(chosenCam.x - targetPos.x, chosenCam.y - targetPos.y, chosenCam.z - targetPos.z) : 10;
    
    // Evaluate 3 vertical anchors for chosen camera
    const anchors: Array<{ name: 'ankle' | 'torso' | 'head'; z: number }> = [
      { name: 'ankle', z: 0.15 },
      { name: 'torso', z: 1.1 },
      { name: 'head', z: targetH - 0.15 },
    ];

    const rayDetails: Array<{
      name: string;
      z: number;
      blocked: boolean;
      hitPoint?: [number, number, number];
      obstacleName?: string;
    }> = [];

    let visibleCount = 0;
    let chosenObstacle: string | null = null;

    if (chosenCam) {
      const pCam: [number, number, number] = [chosenCam.x, chosenCam.y, chosenCam.z];

      anchors.forEach(a => {
        const pTar: [number, number, number] = [targetPos.x, targetPos.y, a.z];
        let nearestHit: { t: number; point?: [number, number, number]; obstacleName?: string } | null = null;

        for (const obs of site.obstacles) {
          const res = rayIntersectsObstacle(pCam, pTar, obs);
          if (res.hit && (!nearestHit || res.t < nearestHit.t)) {
            nearestHit = { t: res.t, point: res.point, obstacleName: obs.name };
          }
        }

        if (nearestHit) {
          if (!chosenObstacle) chosenObstacle = nearestHit.obstacleName || null;
          rayDetails.push({
            name: a.name,
            z: a.z,
            blocked: true,
            hitPoint: nearestHit.point,
            obstacleName: nearestHit.obstacleName,
          });
        } else {
          visibleCount++;
          rayDetails.push({
            name: a.name,
            z: a.z,
            blocked: false,
          });
        }
      });
    }

    const metrics = computeTargetMetrics(chosenDist, hpx, lens.hfovDeg, lens.vfovDeg, targetH);
    const depressionDeg = chosenCam ? (Math.atan2(chosenCam.z - 1.0, Math.hypot(chosenCam.x - targetPos.x, chosenCam.y - targetPos.y)) * 180) / Math.PI : 20;

    return {
      camera: chosenCam,
      distance: chosenDist,
      isOccluded: visibleCount < 3,
      fullyOccluded: visibleCount === 0,
      visibleAnchors: visibleCount,
      rayDetails,
      occludingObstacle: chosenObstacle,
      metrics,
      aiFeasibility: {
        faceId: metrics.ppm >= 280 && depressionDeg <= 30 && visibleCount === 3,
        ppeSafety: metrics.ppm >= 145 && depressionDeg <= 45 && visibleCount >= 2,
        personTrack: metrics.ppm >= 65 && visibleCount >= 2,
      },
    };
  }, [poses, targetPos, site.obstacles, selectedId, hpx, lens, targetH]);

  // Selected camera reference for mover controls
  const currentCam = (selectedId != null ? poses.find(p => p.id === selectedId) : null) || activeCameraTargetInfo.camera || poses[0];

  const handleNudgeCam = (dx: number, dy: number) => {
    if (!currentCam) return;
    const nx = +clamp(currentCam.x + dx, 0, L).toFixed(2);
    const ny = +clamp(currentCam.y + dy, 0, W).toFixed(2);
    if (onMoveCamera) {
      onMoveCamera(currentCam.id, nx, ny);
    } else if (onPoseChange) {
      onPoseChange(currentCam.id, { x: nx, y: ny });
    }
  };

  const handleNudgeCamZ = (dz: number) => {
    if (!currentCam || !onPoseChange) return;
    const nz = +clamp(currentCam.z + dz, 1.5, 20).toFixed(2);
    onPoseChange(currentCam.id, { z: nz });
  };

  const handleRotateCamPan = (dPan: number) => {
    if (!currentCam || !onPoseChange) return;
    const nPan = ((Math.round(currentCam.panDeg + dPan) % 360) + 360) % 360;
    onPoseChange(currentCam.id, { panDeg: nPan });
  };

  const handleRotateCamTilt = (dTilt: number) => {
    if (!currentCam || !onPoseChange) return;
    const nTilt = Math.round(clamp(currentCam.tiltDeg + dTilt, -30, 90));
    onPoseChange(currentCam.id, { tiltDeg: nTilt });
  };

  // Animation & Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasWidth) return;
    let raf = 0;

    const render = () => {
      if (isPlaying) {
        animTimeRef.current += 0.016 * animSpeed;
      }
      const t = animTimeRef.current;

      // Gentle, slow flyover orbit
      if (isAutoOrbit && isPlaying) {
        setYaw(y => (y + 0.04 * animSpeed) % 360);
      }

      // Automated, gentle target patrol route
      if (isTargetPatrolling && isPlaying) {
        const pathX = L * 0.5 + Math.sin(t * 0.22) * (L * 0.32);
        const pathY = W * 0.5 + Math.cos(t * 0.3) * (W * 0.3);
        setTargetPos({ x: clamp(pathX, 2, L - 2), y: clamp(pathY, 2, W - 2), z: targetH });
      }

      const ctx = setupCanvas(canvas, canvasWidth, height);
      background(ctx, canvasWidth, height);

      // 3D Projection Matrix
      const cy = Math.cos(rad(yaw)), sy = Math.sin(rad(yaw));
      const cp = Math.cos(rad(pitch)), sp = Math.sin(rad(pitch));
      const zMax = Math.max(site.mountHeight, ...poses.map(p => p.z), ...site.obstacles.map(o => o.h));

      const raw = (x: number, y: number, z: number) => {
        const X = x - L / 2, Y = y - W / 2;
        const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy;
        return { sx: x1, sy: y1 * sp - z * cp, near: -y1 * cp + z * sp };
      };

      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const x of [0, L]) for (const y of [0, W]) for (const z of [0, zMax]) {
        const q = raw(x, y, z);
        bx0 = Math.min(bx0, q.sx); bx1 = Math.max(bx1, q.sx); by0 = Math.min(by0, q.sy); by1 = Math.max(by1, q.sy);
      }

      const scale = Math.min((canvasWidth - 60) / (bx1 - bx0 || 1), (height - 80) / (by1 - by0 || 1)) * zoom;
      const ox = canvasWidth / 2 - ((bx0 + bx1) / 2) * scale, oy = height / 2 + 10 - ((by0 + by1) / 2) * scale;
      const P = (x: number, y: number, z: number) => {
        const q = raw(x, y, z);
        return { x: ox + q.sx * scale, y: oy + q.sy * scale, near: q.near };
      };
      const poly = (pts: { x: number; y: number }[]) => {
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
      };

      // Store camera projected points for 3D click-to-select
      camProjectedPointsRef.current = poses.map(p => {
        const pt = P(p.x, p.y, p.z);
        return { id: p.id, x: pt.x, y: pt.y };
      });

      // 1. Floor grid & subtle heat
      const bs = Math.max(1, Math.ceil(Math.max(result.cols / 90, result.rows / 40)));
      for (let j = 0; j < result.rows; j += bs) {
        for (let i = 0; i < result.cols; i += bs) {
          const ci = Math.min(result.cols - 1, i + (bs >> 1)), cj = Math.min(result.rows - 1, j + (bs >> 1));
          const idx = cj * result.cols + ci;
          const b = result.best[idx];
          if (b === 255) continue;
          let col: [number, number, number] = LEVEL_RGB[0], a = 0.22;
          if (heatMode === 'overlap') {
            const n = Math.min(3, result.count[idx]);
            col = OVERLAP_RGB[n]; a = n ? 0.42 : 0.22;
          } else if (b >= DORI_LEVEL[mode]) {
            col = LEVEL_RGB[b]; a = 0.45;
          } else if (b > 0) {
            col = LEVEL_RGB[b]; a = 0.15;
          }
          const x0 = i * result.cellW, y0 = j * result.cellH;
          const x1 = Math.min(L, (i + bs) * result.cellW), y1 = Math.min(W, (j + bs) * result.cellH);
          poly([P(x0, y0, 0), P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)]);
          ctx.fillStyle = rgba(col, a);
          ctx.fill();
        }
      }

      // Floor outline & perimeter boundary
      poly([P(0, 0, 0), P(L, 0, 0), P(L, W, 0), P(0, W, 0)]);
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Ceiling boundary reference
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(148,163,184,0.4)';
      ctx.lineWidth = 1;
      for (const [x, y] of [[0, 0], [L, 0], [L, W], [0, W]]) {
        const a = P(x, y, 0), b = P(x, y, site.mountHeight);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      poly([P(0, 0, site.mountHeight), P(L, 0, site.mountHeight), P(L, W, site.mountHeight), P(0, W, site.mountHeight)]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Drawables sorted far → near
      type Drawable = { near: number; draw: () => void };
      const items: Drawable[] = [];

      // 3D Extruded Obstacles
      site.obstacles.forEach(o => {
        const c = P(o.x + o.w / 2, o.y + o.d / 2, o.h / 2);
        items.push({
          near: c.near,
          draw: () => {
            const x0 = o.x, x1 = o.x + o.w, y0 = o.y, y1 = o.y + o.d, h = o.h;
            const faces = [
              { n: [0, 0, 1], pts: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]] },
              { n: [-1, 0, 0], pts: [[x0, y0, 0], [x0, y1, 0], [x0, y1, h], [x0, y0, h]] },
              { n: [1, 0, 0], pts: [[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]] },
              { n: [0, -1, 0], pts: [[x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]] },
              { n: [0, 1, 0], pts: [[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]] },
            ];

            let [bR, bG, bB] = [51, 65, 85];
            if (o.type === 'rack') [bR, bG, bB] = [30, 41, 59];
            else if (o.type === 'machine') [bR, bG, bB] = [15, 23, 42];
            else if (o.type === 'conveyor') [bR, bG, bB] = [14, 116, 144];
            else if (o.type === 'hazard') [bR, bG, bB] = [159, 18, 57];
            else if (o.type === 'dock') [bR, bG, bB] = [161, 98, 7];

            faces.forEach(f => {
              const n1y = f.n[0] * sy + f.n[1] * cy;
              const facing = -n1y * cp + f.n[2] * sp;
              if (facing <= 0) return;
              poly(f.pts.map(([x, y, z]) => P(x, y, z)));
              const shade = f.n[2] ? 1.35 : 0.7 + 0.3 * facing;
              ctx.fillStyle = `rgba(${Math.min(255, Math.round(bR * shade))},${Math.min(255, Math.round(bG * shade))},${Math.min(255, Math.round(bB * shade))},0.96)`;
              ctx.fill();
              ctx.strokeStyle = f.n[2] ? 'rgba(255,255,255,0.3)' : 'rgba(148,163,184,0.45)';
              ctx.lineWidth = 1;
              ctx.stroke();
            });
          },
        });
      });

      // 3D Cameras & Volumetric Radar Cones
      poses.forEach((p, i) => {
        const st = result.cameras[i];
        const col = camColor(p.id);
        const sel = selectedId == null || selectedId === p.id;
        const top = P(p.x, p.y, p.z);

        items.push({
          near: top.near,
          draw: () => {
            const fp = st?.footprint ?? [];
            if (fp.length > 2) {
              const ring = fp.map(q => P(q.x, q.y, site.targetHeight));
              poly(ring);
              ctx.fillStyle = hexA(col, sel ? 0.22 : 0.08);
              ctx.fill();
              ctx.strokeStyle = hexA(col, sel ? 0.9 : 0.35);
              ctx.lineWidth = 1.2;
              ctx.stroke();

              // Concentric radar scan wave pulse (slow and calm)
              const pulsePhase = (t * 0.4 + i * 0.25) % 1;
              const midRing = ring.map(q => ({
                x: top.x + (q.x - top.x) * pulsePhase,
                y: top.y + (q.y - top.y) * pulsePhase,
              }));
              poly(midRing);
              ctx.strokeStyle = hexA(col, (1 - pulsePhase) * (sel ? 0.8 : 0.4));
              ctx.lineWidth = 1.5;
              ctx.stroke();

              // Conical FOV rays
              const spokes = fp.length > 6 ? ring.filter((_, k) => k % Math.ceil(fp.length / 6) === 0) : ring;
              ctx.strokeStyle = hexA(col, sel ? 0.45 : 0.15);
              ctx.lineWidth = 1;
              spokes.forEach(q => {
                ctx.beginPath();
                ctx.moveTo(top.x, top.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
              });
            }

            // Mount dropper pole
            const base = P(p.x, p.y, 0);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();

            // Camera Housing Dome
            ctx.save();
            ctx.shadowBlur = sel ? 20 : 10;
            ctx.shadowColor = col;
            ctx.beginPath();
            ctx.arc(top.x, top.y, sel ? 8.5 : 7, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.restore();

            ctx.strokeStyle = selectedId === p.id ? '#ffffff' : '#0f172a';
            ctx.lineWidth = selectedId === p.id ? 2.5 : 1.5;
            ctx.beginPath(); ctx.arc(top.x, top.y, sel ? 8.5 : 7, 0, Math.PI * 2); ctx.stroke();

            ctx.fillStyle = '#0b0d12';
            ctx.font = '700 8px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(p.id), top.x, top.y + 0.5);

            if (selectedId === p.id || poses.length <= 16) {
              ctx.fillStyle = col;
              ctx.font = '700 9px ui-monospace, monospace';
              ctx.fillText(`C${p.id} (${p.z}m)`, top.x, top.y - 12);
            }
          },
        });
      });

      // Animated Target (Patrolling human / forklift / intruder)
      const targetProj = P(targetPos.x, targetPos.y, targetPos.z);
      const targetBase = P(targetPos.x, targetPos.y, 0);

      items.push({
        near: targetProj.near,
        draw: () => {
          // Ground shadow / tracking ring
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(targetBase.x, targetBase.y, 14, 7, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(15,23,42,0.4)';
          ctx.fill();

          // Pulsing target perimeter ring (slow motion)
          const ringPulse = (t * 0.6) % 1;
          ctx.beginPath();
          ctx.ellipse(targetBase.x, targetBase.y, 14 + ringPulse * 14, 7 + ringPulse * 7, 0, 0, Math.PI * 2);
          ctx.strokeStyle = activeCameraTargetInfo.isOccluded ? 'rgba(239,68,68,0.7)' : 'rgba(34,211,238,0.8)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();

          // Target Body Icon & Pin
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(targetBase.x, targetBase.y); ctx.lineTo(targetProj.x, targetProj.y); ctx.stroke();

          ctx.save();
          ctx.shadowBlur = 18;
          ctx.shadowColor = activeCameraTargetInfo.isOccluded ? '#ef4444' : '#00e5ff';
          ctx.beginPath();
          ctx.arc(targetProj.x, targetProj.y, 9, 0, Math.PI * 2);
          ctx.fillStyle = activeCameraTargetInfo.isOccluded ? '#ef4444' : '#00e5ff';
          ctx.fill();
          ctx.restore();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(targetProj.x, targetProj.y, 9, 0, Math.PI * 2); ctx.stroke();

          // Target Symbol
          ctx.fillStyle = '#0f172a';
          ctx.font = '10px ui-sans-serif, system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const symbol = targetType === 'forklift' ? '🚜' : targetType === 'intruder' ? '⚠️' : '👷';
          ctx.fillText(symbol, targetProj.x, targetProj.y);

          // Target Label Badge
          ctx.fillStyle = '#f8fafc';
          ctx.font = '700 9px ui-monospace, monospace';
          ctx.fillText(
            `TARGET [${targetPos.x.toFixed(1)}m, ${targetPos.y.toFixed(1)}m]`,
            targetProj.x,
            targetProj.y - 14
          );
        },
      });

      // Sort & Draw 3D Entities
      items.sort((a, b) => a.near - b.near).forEach(d => d.draw());

      // 4. Multi-Anchor Laser Raycasts (Ankle, Torso, Head) with Collision Impact Dots
      if (activeCameraTargetInfo.camera && activeCameraTargetInfo.rayDetails) {
        const cam = activeCameraTargetInfo.camera;
        const camP = P(cam.x, cam.y, cam.z);

        activeCameraTargetInfo.rayDetails.forEach(ray => {
          const tarP = P(targetPos.x, targetPos.y, ray.z);

          ctx.save();
          if (ray.blocked && ray.hitPoint) {
            // Blocked ray stops exactly at obstacle collision surface
            const hitP = P(ray.hitPoint[0], ray.hitPoint[1], ray.hitPoint[2]);

            ctx.strokeStyle = 'rgba(239,68,68,0.95)';
            ctx.lineWidth = 1.8;
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ef4444';
            ctx.beginPath(); ctx.moveTo(camP.x, camP.y); ctx.lineTo(hitP.x, hitP.y); ctx.stroke();

            // Glowing Red Collision Impact Marker on Obstacle
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(hitP.x, hitP.y, 4, 0, Math.PI * 2); ctx.fill();

            // Small white center dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(hitP.x, hitP.y, 1.8, 0, Math.PI * 2); ctx.fill();
          } else {
            // Clear Line-of-Sight Laser Ray
            ctx.strokeStyle = 'rgba(34,211,238,0.95)';
            ctx.lineWidth = 2.0;
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#00e5ff';
            ctx.beginPath(); ctx.moveTo(camP.x, camP.y); ctx.lineTo(tarP.x, tarP.y); ctx.stroke();

            // Traveling laser pulse bead
            const laserPhase = (t * 0.5 + (ray.z / 3)) % 1;
            const beadX = camP.x + (tarP.x - camP.x) * laserPhase;
            const beadY = camP.y + (tarP.y - camP.y) * laserPhase;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(beadX, beadY, 3, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        });
      }

      // Title & Overview (discrete corner tag)
      title(
        ctx,
        "3D BIRD'S EYE CAMERA MAPPING",
        `${L}m × ${W}m · H=${site.mountHeight}m`,
        18,
        22
      );

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [
    canvasWidth, height, yaw, pitch, zoom, isAutoOrbit, isTargetPatrolling, isPlaying, animSpeed, targetPos,
    targetType, poses, result, site, selectedId, heatMode, mode, L, W, targetH,
    activeCameraTargetInfo,
  ]);

  // Mouse wheel zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.4, 5));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const metrics = activeCameraTargetInfo.metrics;
  const activeStdDef = MAPPING_STANDARDS[standard] || MAPPING_STANDARDS.dori;

  return (
    <div ref={wrapRef} className="w-full select-none rounded-xl border border-border bg-slate-900 shadow-sm overflow-hidden flex flex-col xl:flex-row">
      {/* Left: Completely Clear & Unobstructed 3D Canvas */}
      <div ref={canvasWrapRef} className="relative flex-1 min-w-0 bg-slate-950 flex flex-col">
        {/* Minimal Sleek Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-950/95 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-mono font-bold text-sky-400 text-[11px]">BIRD 3D VIEW</span>
            <div className="h-3 w-px bg-slate-800 mx-1" />
            <button
              type="button"
              onClick={() => setIsAutoOrbit(v => !v)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                isAutoOrbit ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {isAutoOrbit ? '⏸ Orbiting' : '▶ Orbit'}
            </button>
            <button
              type="button"
              onClick={() => setIsTargetPatrolling(v => !v)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                isTargetPatrolling ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {isTargetPatrolling ? '⏸ Target Moving' : '▶ Patrol Target'}
            </button>
          </div>

          {/* Slow Motion Speed Controls & Angle Presets */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-slate-500">Speed:</span>
            {[
              { label: '0.25x Slow', val: 0.25 },
              { label: '0.5x', val: 0.5 },
              { label: '1.0x', val: 1.0 },
            ].map(sp => (
              <button
                key={sp.val}
                type="button"
                onClick={() => { setAnimSpeed(sp.val); setIsPlaying(true); }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                  animSpeed === sp.val && isPlaying
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {sp.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIsPlaying(p => !p)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                !isPlaying ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>

            <div className="h-3 w-px bg-slate-800 mx-1" />

            {/* Quick Angle Presets */}
            {[
              ['Nadir 89°', 0, 89],
              ['Bird 68°', -20, 68],
              ['Iso 35°', -28, 35],
            ].map(([label, y, p]) => (
              <button
                key={label as string}
                type="button"
                onClick={() => { setYaw(y as number); setPitch(p as number); setZoom(1.05); }}
                className="rounded bg-slate-900 border border-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {label as string}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setZoom(1); setYaw(-20); setPitch(68); }}
              className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300 hover:text-white"
              title="Reset view"
            >
              Reset
            </button>
          </div>
        </div>

        {/* 3D Canvas with Click-to-Select Camera and Orbit */}
        <canvas
          ref={canvasRef}
          className="block w-full touch-none cursor-grab active:cursor-grabbing bg-slate-950"
          onPointerDown={e => {
            dragRef.current = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            const d = dragRef.current;
            if (!d) return;
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
              d.moved = true;
            }
            setYaw(d.yaw + (e.clientX - d.x) * 0.35);
            setPitch(clamp(d.pitch + (e.clientY - d.y) * 0.25, 12, 89));
          }}
          onPointerUp={e => {
            const d = dragRef.current;
            if (d && !d.moved) {
              // Clicked on 3D canvas: test if hit a camera dome
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect) {
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const hit = camProjectedPointsRef.current.find(cp => Math.hypot(cp.x - clickX, cp.y - clickY) < 18);
                if (hit) {
                  onSelect(hit.id);
                }
              }
            }
            dragRef.current = null;
          }}
        />

        {/* Sleek bottom status strip */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/90 border-t border-slate-800 text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Click any camera dome in 3D to select & move · Drag to orbit · Scroll to zoom
          </span>
          <span>Yaw: {Math.round(yaw)}° · Pitch: {Math.round(pitch)}° · Zoom: {zoom.toFixed(2)}x</span>
        </div>
      </div>

      {/* Right: Dedicated Side Tab for Descriptions, Target Analysis & Camera Moving Feature */}
      <div className="w-full xl:w-[360px] shrink-0 bg-slate-900 border-t xl:border-t-0 xl:border-l border-slate-800 p-4 space-y-3.5 overflow-y-auto max-h-[640px]">
        {/* Tab Title */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" />
            <span className="font-bold text-xs text-slate-200">Simulation Side Inspector</span>
          </div>
          <span className="text-[10px] font-mono text-sky-400 px-1.5 py-0.5 rounded bg-sky-950 border border-sky-800">
            Unobstructed View
          </span>
        </div>

        {/* Section 1: Feature to Move Camera */}
        {currentCam && (
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold text-slate-950"
                  style={{ backgroundColor: camColor(currentCam.id) }}
                />
                <span className="text-xs font-bold text-slate-100">
                  Move Camera C{currentCam.id}
                </span>
                <span className="text-[10px] font-mono text-slate-400">({currentCam.mount})</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                ({currentCam.x.toFixed(1)}m, {currentCam.y.toFixed(1)}m, {currentCam.z.toFixed(1)}m)
              </span>
            </div>

            {/* Quick Camera Switcher Chips */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[9px] font-mono text-slate-500 mr-1">Select:</span>
              {poses.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                    p.id === currentCam.id
                      ? 'bg-sky-500 text-white font-bold ring-1 ring-sky-300'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  C{p.id}
                </button>
              ))}
            </div>

            {/* Directional Nudge Pad to Move Camera in Real Time */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-semibold text-slate-300 flex items-center justify-between">
                <span>Nudge Position (X, Y):</span>
                <span className="text-[9px] text-slate-500 font-mono">Steps ±0.5m</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNudgeCam(-0.5, 0)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-slate-200 flex items-center justify-center gap-0.5"
                  title="Move West / Left -0.5m"
                >
                  <ArrowLeft className="w-3 h-3 text-sky-400" /> -0.5m
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeCam(0.5, 0)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-slate-200 flex items-center justify-center gap-0.5"
                  title="Move East / Right +0.5m"
                >
                  +0.5m <ArrowRight className="w-3 h-3 text-sky-400" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeCam(0, -0.5)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-slate-200 flex items-center justify-center gap-0.5"
                  title="Move North / Up -0.5m"
                >
                  <ArrowUp className="w-3 h-3 text-sky-400" /> Up
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeCam(0, 0.5)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-slate-200 flex items-center justify-center gap-0.5"
                  title="Move South / Down +0.5m"
                >
                  Down <ArrowDown className="w-3 h-3 text-sky-400" />
                </button>
              </div>

              {/* Height & Angle Steering */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                  <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-1">
                    <span>Height Z ({currentCam.z.toFixed(1)}m)</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleNudgeCamZ(-0.5)}
                      className="flex-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-mono text-slate-200"
                    >
                      -0.5m
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNudgeCamZ(0.5)}
                      className="flex-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-mono text-slate-200"
                    >
                      +0.5m
                    </button>
                  </div>
                </div>

                <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                  <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-1">
                    <span>Pan ({currentCam.panDeg}°)</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleRotateCamPan(-15)}
                      className="flex-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-mono text-slate-200"
                    >
                      ↺ -15°
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRotateCamPan(15)}
                      className="flex-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-mono text-slate-200"
                    >
                      +15° ↻
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Target & Line-of-Sight Occlusion Status */}
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-sky-400" />
              Target Tracking & Line-of-Sight
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {activeCameraTargetInfo.distance.toFixed(1)}m slant dist
            </span>
          </div>

          {/* Target Type Selector */}
          <div className="flex gap-1">
            {(['pedestrian', 'forklift', 'intruder'] as const).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setTargetType(type)}
                className={`flex-1 py-1 rounded text-[10px] font-mono font-medium transition ${
                  targetType === type ? 'bg-sky-600 text-white font-bold shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {type === 'pedestrian' ? '👷 Worker' : type === 'forklift' ? '🚜 Forklift' : '⚠️ Intruder'}
              </button>
            ))}
          </div>

          {/* Multi-Anchor Occlusion Breakdown & AI Feasibility Badges */}
          <div className="flex items-center justify-between text-[10px] font-mono pt-1 text-slate-400">
            <span>Ray Visibility:</span>
            <span className={`font-bold ${activeCameraTargetInfo.visibleAnchors === 3 ? 'text-emerald-400' : activeCameraTargetInfo.visibleAnchors > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
              {activeCameraTargetInfo.visibleAnchors}/3 Anchors (Head, Torso, Ankle)
            </span>
          </div>

          {activeCameraTargetInfo.isOccluded ? (
            <div className="p-2 rounded-lg bg-rose-950/70 border border-rose-800/80 text-[11px] font-mono text-rose-300 space-y-1">
              <div className="font-bold flex items-center gap-1">
                <span>⚠️</span>
                <span>{activeCameraTargetInfo.fullyOccluded ? 'FULL OCCLUSION' : 'PARTIAL OCCLUSION DETECTED'}</span>
              </div>
              <div className="text-[10px] text-rose-200">
                Blocked by <strong>{activeCameraTargetInfo.occludingObstacle || 'facility structure'}</strong>.
              </div>
            </div>
          ) : (
            <div className="p-2 rounded-lg bg-emerald-950/70 border border-emerald-800/80 text-[11px] font-mono text-emerald-300 space-y-0.5">
              <div className="font-bold flex items-center gap-1">
                <span>✅</span>
                <span>CLEAR DIRECT LINE OF SIGHT</span>
              </div>
              <div className="text-[10px] text-emerald-200">
                All 3 vertical sightline rays unobstructed.
              </div>
            </div>
          )}

          {/* AI Model Feasibility Live Grid */}
          <div className="pt-2 border-t border-slate-800 grid grid-cols-3 gap-1.5 text-center">
            <div>
              <div className="text-[9px] font-mono text-slate-500 mb-0.5">FACE ID</div>
              <span className={`block py-0.5 rounded text-[10px] font-mono font-bold ${activeCameraTargetInfo.aiFeasibility?.faceId ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950/80 text-rose-400 border border-rose-800'}`}>
                {activeCameraTargetInfo.aiFeasibility?.faceId ? 'PASS' : 'FAIL'}
              </span>
            </div>
            <div>
              <div className="text-[9px] font-mono text-slate-500 mb-0.5">PPE SAFETY</div>
              <span className={`block py-0.5 rounded text-[10px] font-mono font-bold ${activeCameraTargetInfo.aiFeasibility?.ppeSafety ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950/80 text-rose-400 border border-rose-800'}`}>
                {activeCameraTargetInfo.aiFeasibility?.ppeSafety ? 'PASS' : 'FAIL'}
              </span>
            </div>
            <div>
              <div className="text-[9px] font-mono text-slate-500 mb-0.5">BYTETRACK</div>
              <span className={`block py-0.5 rounded text-[10px] font-mono font-bold ${activeCameraTargetInfo.aiFeasibility?.personTrack ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : activeCameraTargetInfo.visibleAnchors > 0 ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-rose-950/80 text-rose-400 border border-rose-800'}`}>
                {activeCameraTargetInfo.aiFeasibility?.personTrack ? 'LOCKED' : activeCameraTargetInfo.visibleAnchors > 0 ? 'DEGRADED' : 'LOST'}
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Framework Standards Description & Calculations (in Side Tab!) */}
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Framework & DORI Calculations
            </span>
          </div>

          {/* Framework Selector Chips */}
          <div className="flex flex-wrap gap-1">
            {(['dori', 'oodpcvs', 'johnson', 'dhs_nij', 'french'] as MappingStandard[]).map(s => {
              const isSel = standard === s;
              const label = s === 'dori' ? 'DORI' : s === 'oodpcvs' ? 'OODPCVS (2025)' : s === 'johnson' ? "Johnson's Criteria" : s === 'dhs_nij' ? 'US DHS / NIJ' : 'French (FR)';
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStandardSelect(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition ${
                    isSel ? 'bg-primary text-primary-foreground font-bold shadow-xs' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Metric Details based on Active Standard */}
          <div className="space-y-1.5 text-[11px] font-mono pt-1">
            {standard === 'dori' && (
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Resolution (PPM):</span>
                  <span className="font-bold text-sky-400">{metrics.ppm} px/m</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">EN 62676-4 Level:</span>
                  <span className="font-bold text-emerald-400 uppercase">{metrics.dori.name}</span>
                </div>
              </div>
            )}

            {standard === 'oodpcvs' && (
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">IEC 62676-4:2025 Tier:</span>
                  <span className="font-bold text-violet-400">{metrics.oodpcvs.code}</span>
                </div>
                <div className="text-[10px] text-slate-300">
                  Target Density: <strong>{metrics.ppm} px/m</strong> ({metrics.oodpcvs.name})
                </div>
              </div>
            )}

            {standard === 'johnson' && (
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Thermal Johnson's:</span>
                  <span className="font-bold text-amber-400">{metrics.johnson.linePairs} line pairs</span>
                </div>
                <div className="text-[10px] text-slate-300">
                  Military Thermal Class: <strong className="text-amber-300">{metrics.johnson.level}</strong>
                </div>
              </div>
            )}

            {standard === 'dhs_nij' && (
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">US DHS / NIJ VSH:</span>
                  <span className={`font-bold ${metrics.dhsNij.isForensicLegal ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {metrics.dhsNij.vshPct}% Vertical Screen Height
                  </span>
                </div>
                <div className="text-[10px] text-slate-300">
                  Legal Status: {metrics.dhsNij.isForensicLegal ? '✅ Court-Admissible Forensic Evidence' : '⚠️ Investigative Lead Only (<15%)'}
                </div>
              </div>
            )}

            {standard === 'french' && (
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">French Code Level:</span>
                  <span className="font-bold text-sky-300">{metrics.french.level}</span>
                </div>
              </div>
            )}

            {/* Standard Description in Side Tab */}
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800/80 text-[10px] text-slate-400 leading-relaxed">
              <strong className="text-slate-300 block mb-0.5">{activeStdDef.name}</strong>
              {activeStdDef.description}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


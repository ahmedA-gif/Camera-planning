'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFrame, sideProfile, clamp, DORI_LEVEL, LEVEL_NAMES,
  type CameraPose, type CoverageResult, type DoriMode, type LensSpec, type Pt, type SiteSpec,
} from '@/lib/coverage-engine';

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
}: BaseProps & { onMove: (id: number, x: number, y: number) => void; heatMode: 'dori' | 'overlap' }) {
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

    // obstacles
    site.obstacles.forEach(o => {
      ctx.fillStyle = 'rgba(30,41,59,0.92)';
      ctx.fillRect(X(o.x), Y(o.y), o.w * sx, o.d * sy);
      ctx.strokeStyle = 'rgba(148,163,184,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(X(o.x), Y(o.y), o.w * sx, o.d * sy);
      ctx.save();
      ctx.beginPath(); ctx.rect(X(o.x), Y(o.y), o.w * sx, o.d * sy); ctx.clip();
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      for (let k = -o.d * sy; k < o.w * sx; k += 7) { ctx.beginPath(); ctx.moveTo(X(o.x) + k, Y(o.y) + o.d * sy); ctx.lineTo(X(o.x) + k + o.d * sy, Y(o.y)); ctx.stroke(); }
      ctx.restore();
      if (o.w * sx > 40) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${o.name} · ${o.h}m`, X(o.x + o.w / 2), Y(o.y + o.d / 2) + 3);
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
        ctx.strokeStyle = hexA(col, sel ? 0.5 : 0.22);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const idf = st.doriFootprints[4];
      if (idf.length > 2 && sel) {
        trace(idf);
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(34,211,238,0.9)';
        ctx.stroke();
      }
      if (st.footprint.length > 2) {
        trace(st.footprint);
        ctx.fillStyle = hexA(col, sel ? 0.18 : 0.06);
        ctx.fill();
        ctx.setLineDash(sel ? [7, 4] : []);
        ctx.lineDashOffset = -dash;
        ctx.strokeStyle = hexA(col, sel ? 1 : 0.85);
        ctx.lineWidth = sel ? 2 : 1.3;
        ctx.stroke();
        ctx.lineDashOffset = 0;
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
  }, [width, height, heat, poses, result, selectedId, site, sx, sy, L, W]);

  useEffect(() => {
    if (!width) return;
    let raf = 0, dash = 0;
    if (selectedId == null) { draw(0); return; }
    const loop = () => { dash = (dash + 0.5) % 1000; draw(dash); raf = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [draw, width, selectedId]);

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
      onSelect(hit);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else if (w.x >= 0 && w.x <= L && w.y >= 0 && w.y <= W) onSelect(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    if (drag.current != null) onMove(drag.current, +clamp(w.x, 0, L).toFixed(2), +clamp(w.y, 0, W).toFixed(2));
    setHover(w.x >= 0 && w.x <= L && w.y >= 0 && w.y <= W ? w : null);
  };
  const onPointerUp = () => { drag.current = null; };

  let tip: React.ReactNode = null;
  if (hover) {
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
          faces.forEach(f => {
            const n1y = f.n[0] * sy + f.n[1] * cy;
            const facing = -n1y * cp + f.n[2] * sp;
            if (facing <= 0) return;
            poly(f.pts.map(([x, y, z]) => P(x, y, z)));
            const shade = f.n[2] ? 0.95 : 0.55 + 0.3 * facing;
            ctx.fillStyle = `rgba(${Math.round(51 * shade)},${Math.round(65 * shade)},${Math.round(85 * shade)},0.95)`;
            ctx.fill();
            ctx.strokeStyle = 'rgba(148,163,184,0.45)'; ctx.lineWidth = 1; ctx.stroke();
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

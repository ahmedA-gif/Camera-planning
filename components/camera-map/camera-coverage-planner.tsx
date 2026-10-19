'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, 
  RotateCcw, 
  Download, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Layers, 
  Maximize2,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Share2
} from 'lucide-react';
import type { Camera as ProjectCamera, DetVisionProject } from '@/lib/types';

interface CameraCoveragePlannerProps {
  project?: DetVisionProject;
  onApplyToProject?: (cameras: ProjectCamera[]) => void;
  onClose?: () => void;
}

export const CAM_COLORS = [
  '#00e5ff', '#ff6b35', '#7fff6b', '#c084fc',
  '#ffd60a', '#f472b6', '#38bdf8', '#fb923c',
  '#a3e635', '#e879f9', '#34d399', '#fbbf24',
  '#f87171', '#818cf8', '#2dd4bf', '#f9a8d4',
  '#86efac', '#fde68a', '#bfdbfe', '#ddd6fe'
];

export type MountType = 'wall-h' | 'wall-v' | 'roof-nadir' | 'roof-tilt' | 'corner' | 'cross' | 'pole360' | 'underside';

interface MountInfo {
  label: string;
  tip: string;
  hasTilt: boolean;
  hasAz: boolean;
  colorHint: string;
}

export const MOUNTS: Record<MountType, MountInfo> = {
  'wall-h': {
    label: 'Wall\nHoriz →',
    tip: 'Wall/post mount, lens horizontal along bay length (left or right)',
    hasTilt: false,
    hasAz: false,
    colorHint: '#00e5ff'
  },
  'wall-v': {
    label: 'Wall\nVert ↓',
    tip: 'Wall/pole mount, lens tilted vertically downward from elevated position',
    hasTilt: true,
    hasAz: false,
    colorHint: '#38bdf8'
  },
  'roof-nadir': {
    label: 'Roof\nNadir ↓',
    tip: 'Ceiling/roof mount pointing straight down — circular footprint',
    hasTilt: false,
    hasAz: false,
    colorHint: '#ff6b35'
  },
  'roof-tilt': {
    label: 'Roof\nTilted ↘',
    tip: 'Roof/overhead mount tilted at angle toward a target zone',
    hasTilt: true,
    hasAz: true,
    colorHint: '#7fff6b'
  },
  'corner': {
    label: 'Corner\n45° ↘',
    tip: 'Corner mount, lens pointing 45° diagonally across area',
    hasTilt: false,
    hasAz: true,
    colorHint: '#c084fc'
  },
  'cross': {
    label: 'Cross\nAisle ↔',
    tip: 'Side wall facing perpendicular across the bay width',
    hasTilt: false,
    hasAz: false,
    colorHint: '#ffd60a'
  },
  'pole360': {
    label: 'Pole\n360°',
    tip: 'Pole-top wide/fisheye camera covering all directions',
    hasTilt: false,
    hasAz: false,
    colorHint: '#f472b6'
  },
  'underside': {
    label: 'Under\nside ↑',
    tip: 'Camera mounted beneath a surface pointing upward',
    hasTilt: false,
    hasAz: false,
    colorHint: '#fb923c'
  },
};

export interface CameraConfig {
  id: number;
  pos: number;
  mountType: MountType;
  tilt: number;
  az: number;
}

export interface ComputedCamera {
  id: number;
  pos: number;
  x: number;
  y: number;
  z: number;
  mountType: MountType;
  tilt: number;
  az: number;
  coverStart: number;
  coverEnd: number;
  floorW: number;
  footprint: any;
  desc: string;
  facing: string;
  rangeUsed: number;
  effectiveRange: number;
  fovH: number;
  fovV: number;
}

export interface PlannerGlobals {
  lens: number;
  fovH: number;
  fovV: number;
  rD: number;
  rO: number;
  rR: number;
  rI: number;
  len: number;
  wid: number;
  h: number;
  ov: number;
  mode: 'detect' | 'observe' | 'recognize' | 'identify';
  count: number;
}

export interface PlannerMetrics {
  total: number;
  coverPct: number;
  blindPct: number;
  efficiency: number;
  totalArea: number;
  coveredArea: number;
}

function hexAlpha(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function CameraCoveragePlanner({ project, onApplyToProject, onClose }: CameraCoveragePlannerProps) {
  // Global configuration
  const [lens, setLens] = useState(2.8);
  const [fovH, setFovH] = useState(106);
  const [fovV, setFovV] = useState(56);
  const [rD, setRD] = useState(88);
  const [rO, setRO] = useState(35.2);
  const [rR, setRR] = useState(17.6);
  const [rI, setRI] = useState(8.8);
  
  const [bayLength, setBayLength] = useState(90);
  const [bayWidth, setBayWidth] = useState(10);
  const [mountHeight, setMountHeight] = useState(4);
  const [overlap, setOverlap] = useState(10);
  const [mode, setMode] = useState<'detect' | 'observe' | 'recognize' | 'identify'>('recognize');
  const [cameraCount, setCameraCount] = useState(5);

  // Per-camera configs
  const [camConfigs, setCamConfigs] = useState<CameraConfig[]>([
    { id: 1, pos: 0, mountType: 'wall-h', tilt: 30, az: 0 },
    { id: 2, pos: 22.5, mountType: 'wall-h', tilt: 30, az: 0 },
    { id: 3, pos: 45.0, mountType: 'roof-nadir', tilt: 30, az: 0 },
    { id: 4, pos: 67.5, mountType: 'wall-h', tilt: 30, az: 0 },
    { id: 5, pos: 90.0, mountType: 'wall-h', tilt: 30, az: 0 },
  ]);

  const [expandedCards, setExpandedCards] = useState<Record<number, boolean>>({ 1: true, 2: true });
  const [activeViewTab, setActiveViewTab] = useState<'top' | 'side' | '3d'>('top');
  const [activeDetTab, setActiveDetTab] = useState<'table' | 'list' | 'reco' | 'legend'>('table');
  
  // Results
  const [computedCameras, setComputedCameras] = useState<ComputedCamera[]>([]);
  const [metrics, setMetrics] = useState<PlannerMetrics>({
    total: 5,
    coverPct: 82,
    blindPct: 18,
    efficiency: 16.4,
    totalArea: 900,
    coveredArea: 738
  });
  const [hasCalculated, setHasCalculated] = useState(true);

  // Canvas refs
  const cvTopRef = useRef<HTMLCanvasElement | null>(null);
  const cvSideRef = useRef<HTMLCanvasElement | null>(null);
  const cv3dRef = useRef<HTMLCanvasElement | null>(null);

  // Rebuild camera cards when cameraCount or bayLength changes
  const rebuildCameraCards = useCallback((newCount: number, newLen: number) => {
    setCamConfigs(prev => {
      const next: CameraConfig[] = [];
      for (let i = 1; i <= newCount; i++) {
        const pos = newCount === 1 ? newLen / 2 : ((i - 1) / (newCount - 1)) * newLen;
        const existing = prev.find(c => c.id === i);
        if (existing) {
          next.push({ ...existing, pos });
        } else {
          // Default mount for position
          let defMount: MountType = 'wall-h';
          if (newCount > 2 && i === Math.ceil(newCount / 2)) {
            defMount = 'roof-nadir';
          }
          next.push({
            id: i,
            pos,
            mountType: defMount,
            tilt: 30,
            az: 0
          });
        }
      }
      return next;
    });
  }, []);

  const handleCameraCountChange = (count: number) => {
    const c = Math.max(1, Math.min(75, count));
    setCameraCount(c);
    rebuildCameraCards(c, bayLength);
  };

  const handleBayLengthChange = (len: number) => {
    const l = Math.max(1, len);
    setBayLength(l);
    rebuildCameraCards(cameraCount, l);
  };

  // Compute camera geometry
  const computeAllCameras = useCallback(() => {
    const ranges = {
      detect: rD,
      observe: rO,
      recognize: rR,
      identify: rI
    };
    const effectiveRange = ranges[mode];
    const halfH = (fovH / 2) * Math.PI / 180;
    const halfV = (fovV / 2) * Math.PI / 180;
    const ovRatio = overlap / 100;
    const mid = Math.ceil(cameraCount / 2);

    const processed: ComputedCamera[] = camConfigs.map(cam => {
      let cx = cam.pos;
      let cy = bayWidth / 2;
      let cz = mountHeight;
      let footprint: any = null;
      let coverStart = 0;
      let coverEnd = 0;
      let floorW = 0;
      let desc = '';
      let facing = '';
      let rangeUsed = effectiveRange;

      switch (cam.mountType) {
        case 'wall-h': {
          const dir = cam.id <= mid ? 1 : -1;
          const span = effectiveRange * (1 - ovRatio);
          const detectSpan = ranges.detect;
          if (dir === 1) {
            coverStart = cx;
            coverEnd = Math.min(cx + span, bayLength);
          } else {
            coverEnd = cx;
            coverStart = Math.max(cx - span, 0);
          }
          floorW = bayWidth;
          const floorSpread = effectiveRange * Math.tan(halfH);
          const detSpread = detectSpan * Math.tan(halfH);
          footprint = {
            type: 'cone-h',
            dir, cx, cy, cz,
            len: effectiveRange, spread: floorSpread,
            detLen: detectSpan, detSpread,
            halfH, halfV, effectiveRange, detectSpan
          };
          desc = `Wall-Horizontal, facing ${dir === 1 ? '→ (right)' : '← (left)'}`;
          facing = dir === 1 ? '→' : '←';
          break;
        }

        case 'wall-v': {
          const tiltRad = cam.tilt * Math.PI / 180;
          const groundDist = cz / Math.tan(tiltRad);
          const nearDist = Math.max(0, groundDist - effectiveRange * Math.cos(tiltRad) / 2);
          const farDist = Math.min(effectiveRange, groundDist + effectiveRange * Math.cos(tiltRad));
          coverStart = Math.max(0, cx - farDist);
          coverEnd = Math.min(bayLength, cx + farDist);
          floorW = 2 * farDist * Math.tan(halfH);
          footprint = {
            type: 'cone-tilted',
            cx, cy, cz,
            tilt: cam.tilt, az: 90,
            effectiveRange, halfH, halfV
          };
          desc = `Wall-Vertical, tilt=${cam.tilt}°, ground footprint ~${(2 * farDist).toFixed(1)}m`;
          facing = `↓${cam.tilt}°`;
          rangeUsed = farDist;
          break;
        }

        case 'roof-nadir': {
          const r = cz * Math.tan(halfH);
          coverStart = Math.max(0, cx - r);
          coverEnd = Math.min(bayLength, cx + r);
          floorW = Math.min(bayWidth, 2 * r);
          footprint = { type: 'circle', cx, cy, cz, r, halfH, halfV };
          desc = `Roof Nadir ↓, floor radius=${r.toFixed(2)}m (h=${cz}m, ½FOV=${(fovH / 2).toFixed(1)}°)`;
          facing = '↓';
          rangeUsed = r;
          break;
        }

        case 'roof-tilt': {
          const tiltRad = cam.tilt * Math.PI / 180;
          const azRad = cam.az * Math.PI / 180;
          const nearTiltRad = Math.max(0.01, tiltRad - halfV);
          const farTiltRad = Math.min(Math.PI / 2 - 0.01, tiltRad + halfV);
          const nearD = cz / Math.tan(Math.PI / 2 - nearTiltRad + 0.001);
          const farD = cz / Math.tan(Math.PI / 2 - farTiltRad + 0.001);
          const actualFar = Math.min(effectiveRange, isFinite(farD) ? farD : effectiveRange);
          const actualNear = Math.max(0, isFinite(nearD) ? nearD : 0);
          const dx = Math.sin(azRad);
          const dy = -Math.cos(azRad);
          coverStart = Math.max(0, Math.min(cx + dx * actualNear, cx + dx * actualFar));
          coverEnd = Math.max(0, Math.max(cx + dx * actualNear, cx + dx * actualFar));
          if (coverEnd > bayLength) coverEnd = bayLength;
          if (coverStart < 0) coverStart = 0;
          if (coverStart > coverEnd) { const t = coverStart; coverStart = coverEnd; coverEnd = t; }
          const widthAtFloor = 2 * actualFar * Math.tan(halfH);
          floorW = Math.min(bayWidth, widthAtFloor);
          footprint = {
            type: 'cone-az',
            cx, cy, cz,
            tilt: cam.tilt, az: cam.az,
            near: actualNear, far: actualFar,
            halfH, halfV, dx, dy
          };
          desc = `Roof Tilted ↘, tilt=${cam.tilt}°, az=${cam.az}°, floor range=${actualNear.toFixed(1)}–${actualFar.toFixed(1)}m`;
          facing = `↘${cam.tilt}°`;
          rangeUsed = actualFar;
          break;
        }

        case 'corner': {
          const azRad = cam.az * Math.PI / 180 || (45 * Math.PI / 180);
          const diag = Math.sqrt(bayLength * bayLength + bayWidth * bayWidth);
          const reach = Math.min(effectiveRange, diag * 0.85);
          coverStart = Math.max(0, cx - reach * 0.5);
          coverEnd = Math.min(bayLength, cx + reach * 0.5);
          floorW = bayWidth;
          footprint = {
            type: 'cone-az',
            cx, cy, cz,
            tilt: 15, az: cam.az || 45,
            near: 0, far: reach,
            halfH, halfV,
            dx: Math.cos((cam.az || 45) * Math.PI / 180 - Math.PI / 2),
            dy: Math.sin((cam.az || 45) * Math.PI / 180 - Math.PI / 2)
          };
          desc = `Corner Mount 45°, az=${cam.az || 45}°, reach=${reach.toFixed(1)}m`;
          facing = `↘${cam.az || 45}°`;
          rangeUsed = reach;
          break;
        }

        case 'cross': {
          const fromTop = cam.id % 2 === 1;
          cy = fromTop ? 0 : bayWidth;
          const crossReach = Math.min(bayWidth, effectiveRange);
          const halfSpan = effectiveRange * 0.3;
          coverStart = Math.max(0, cx - halfSpan);
          coverEnd = Math.min(bayLength, cx + halfSpan);
          floorW = crossReach;
          footprint = {
            type: 'cone-cross',
            cx, cy, cz,
            dir: fromTop ? 1 : -1,
            crossReach,
            halfSpan,
            halfH, halfV
          };
          desc = `Cross-Aisle, from ${fromTop ? 'top' : 'bottom'} wall, covers ${crossReach.toFixed(1)}m width`;
          facing = fromTop ? '↓ (across width)' : '↑ (across width)';
          rangeUsed = crossReach;
          break;
        }

        case 'pole360': {
          const r = Math.min(effectiveRange, Math.min(bayLength, bayWidth) / 2 + effectiveRange * 0.4);
          coverStart = Math.max(0, cx - r);
          coverEnd = Math.min(bayLength, cx + r);
          floorW = Math.min(bayWidth, 2 * r);
          footprint = { type: 'circle360', cx, cy, cz, r, halfH };
          desc = `Pole 360°, radius=${r.toFixed(1)}m (effective range=${effectiveRange}m)`;
          facing = '360°';
          rangeUsed = r;
          break;
        }

        case 'underside': {
          cz = 0.5;
          const r = cz + effectiveRange * 0.4;
          coverStart = Math.max(0, cx - r * 0.5);
          coverEnd = Math.min(bayLength, cx + r * 0.5);
          floorW = 2 * r * Math.tan(halfH);
          footprint = {
            type: 'cone-up',
            cx, cy, cz,
            r, halfH, halfV, effectiveRange
          };
          desc = `Underside/Zenith ↑, floor mount h=${cz}m, upward cone`;
          facing = '↑';
          rangeUsed = r;
          break;
        }
      }

      return {
        id: cam.id,
        pos: cam.pos,
        x: cx,
        y: cy,
        z: cz,
        mountType: cam.mountType,
        tilt: cam.tilt,
        az: cam.az,
        coverStart,
        coverEnd,
        floorW,
        footprint,
        desc,
        facing,
        rangeUsed,
        effectiveRange,
        fovH,
        fovV
      };
    });

    // Coverage calculation - merge segments along length
    const segs = processed.map(c => [Math.max(0, c.coverStart), Math.min(bayLength, c.coverEnd)])
      .filter(s => s[1] > s[0]).sort((a, b) => a[0] - b[0]);
    
    let covered = 0;
    let cur: [number, number] | null = null;
    for (const s of segs) {
      if (!cur) {
        cur = [s[0], s[1]];
      } else if (s[0] <= cur[1]) {
        cur[1] = Math.max(cur[1], s[1]);
      } else {
        covered += cur[1] - cur[0];
        cur = [s[0], s[1]];
      }
    }
    if (cur) covered += cur[1] - cur[0];

    const coverPct = Math.min(100, Math.round((covered / bayLength) * 100));
    const blindPct = 100 - coverPct;
    const totalArea = bayLength * bayWidth;
    const coveredArea = Math.round(covered * bayWidth);
    const efficiency = Number((coverPct / processed.length).toFixed(1));

    setComputedCameras(processed);
    setMetrics({
      total: processed.length,
      coverPct,
      blindPct,
      efficiency,
      totalArea,
      coveredArea
    });
    setHasCalculated(true);
  }, [
    camConfigs,
    bayLength,
    bayWidth,
    mountHeight,
    fovH,
    fovV,
    overlap,
    mode,
    rD,
    rO,
    rR,
    rI,
    cameraCount
  ]);

  // Initial calculation and listeners
  useEffect(() => {
    computeAllCameras();
  }, [computeAllCameras]);

  // Canvas drawing routines
  const drawTopView = useCallback(() => {
    const canvas = cvTopRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);

    const PAD = 48;
    const mapW = W - PAD * 2;
    const mapH = H - PAD * 2;
    const sx = mapW / bayLength;
    const sy = mapH / bayWidth;

    // Grid lines
    ctx.strokeStyle = '#181c28';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= bayLength; gx += 10) {
      ctx.beginPath();
      ctx.moveTo(PAD + gx * sx, PAD);
      ctx.lineTo(PAD + gx * sx, PAD + mapH);
      ctx.stroke();
    }
    for (let gy = 0; gy <= bayWidth; gy += 2) {
      ctx.beginPath();
      ctx.moveTo(PAD, PAD + gy * sy);
      ctx.lineTo(PAD + mapW, PAD + gy * sy);
      ctx.stroke();
    }

    // Blind spot base
    ctx.fillStyle = 'rgba(255,71,87,0.07)';
    ctx.fillRect(PAD, PAD, mapW, mapH);

    // Cones
    computedCameras.forEach((cam, idx) => {
      const color = CAM_COLORS[idx % CAM_COLORS.length];
      const fp = cam.footprint;
      if (!fp) return;
      const camX = PAD + cam.x * sx;
      const camY = PAD + cam.y * sy;

      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD, PAD, mapW, mapH);
      ctx.clip();

      switch (fp.type) {
        case 'cone-h': {
          const d = fp.dir;
          // Outer detect
          const dLen = fp.detLen * sx;
          const dSpread = Math.min(fp.detSpread * sy, mapH * 0.6);
          ctx.beginPath();
          ctx.moveTo(camX, camY);
          ctx.lineTo(camX + d * dLen, camY - dSpread);
          ctx.lineTo(camX + d * dLen, camY + dSpread);
          ctx.closePath();
          ctx.fillStyle = 'rgba(239,159,39,0.08)';
          ctx.fill();

          // Effective
          const eLen = fp.len * sx;
          const eSpread = Math.min(fp.spread * sy, mapH * 0.55);
          ctx.beginPath();
          ctx.moveTo(camX, camY);
          ctx.lineTo(camX + d * eLen, camY - eSpread);
          ctx.lineTo(camX + d * eLen, camY + eSpread);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          // Dashed FOV lines
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = hexAlpha(color, 0.4);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(camX, camY);
          ctx.lineTo(camX + d * dLen, camY - dSpread);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(camX, camY);
          ctx.lineTo(camX + d * dLen, camY + dSpread);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = color;
          ctx.font = '9px monospace';
          ctx.textAlign = d === 1 ? 'right' : 'left';
          ctx.fillText(`${fp.len.toFixed(0)}m`, camX + d * eLen - d * 4, camY - eSpread / 2 - 2);
          break;
        }

        case 'circle':
        case 'circle360': {
          const r = fp.r * Math.min(sx, sy);
          // Outer
          ctx.beginPath();
          ctx.arc(camX, camY, r * 1.3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(239,159,39,0.07)';
          ctx.fill();

          // Effective
          ctx.beginPath();
          ctx.arc(camX, camY, r, 0, Math.PI * 2);
          ctx.fillStyle = hexAlpha(color, 0.2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          // Inner
          ctx.beginPath();
          ctx.arc(camX, camY, r * 0.35, 0, Math.PI * 2);
          ctx.strokeStyle = hexAlpha(color, 0.5);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Crosshair
          ctx.strokeStyle = hexAlpha(color, 0.3);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(camX - r, camY); ctx.lineTo(camX + r, camY); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(camX, camY - r); ctx.lineTo(camX, camY + r); ctx.stroke();

          ctx.fillStyle = color;
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`r=${fp.r.toFixed(1)}m`, camX, camY + r + 12);
          break;
        }

        case 'cone-az': {
          const azRad = (fp.az - 90) * Math.PI / 180;
          const farLen = fp.far * sx;
          const nearLen = (fp.near || 0) * sx;
          const halfFovH = fp.halfH;
          const dx = Math.cos(azRad);
          const dy = Math.sin(azRad);
          const px = -dy;
          const py = dx;
          const spreadFar = farLen * Math.tan(halfFovH);
          const spreadNear = nearLen * Math.tan(halfFovH);

          ctx.beginPath();
          if (fp.near > 0.5) {
            ctx.moveTo(camX + dx * nearLen - px * spreadNear, camY + dy * nearLen - py * spreadNear);
            ctx.lineTo(camX + dx * farLen - px * spreadFar, camY + dy * farLen - py * spreadFar);
            ctx.lineTo(camX + dx * farLen + px * spreadFar, camY + dy * farLen + py * spreadFar);
            ctx.lineTo(camX + dx * nearLen + px * spreadNear, camY + dy * nearLen + py * spreadNear);
          } else {
            ctx.moveTo(camX, camY);
            ctx.lineTo(camX + dx * farLen - px * spreadFar, camY + dy * farLen - py * spreadFar);
            ctx.lineTo(camX + dx * farLen + px * spreadFar, camY + dy * farLen + py * spreadFar);
          }
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = hexAlpha(color, 0.5);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(camX, camY);
          ctx.lineTo(camX + dx * farLen, camY + dy * farLen);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }

        case 'cone-tilted':
        case 'cone-cross': {
          const dir = fp.dir || 1;
          const cr = Math.min((fp.crossReach || fp.effectiveRange) * sy, mapH * 0.8);
          const hs = Math.min((fp.halfSpan || 4) * sx, mapW * 0.15);
          ctx.beginPath();
          ctx.moveTo(camX - hs, camY);
          ctx.lineTo(camX, camY + dir * cr);
          ctx.lineTo(camX + hs, camY);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          break;
        }

        case 'cone-up': {
          const rr = fp.r * sx;
          const sp = Math.min(rr * Math.tan(fp.halfH), mapH * 0.35);
          ctx.beginPath();
          ctx.moveTo(camX, camY);
          ctx.lineTo(camX + rr, camY - sp);
          ctx.lineTo(camX + rr, camY + sp);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.15);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    });

    // Area outline
    ctx.strokeStyle = '#2e3650';
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, PAD, mapW, mapH);

    // Ruler marks
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const step = bayLength > 50 ? 10 : bayLength > 20 ? 5 : 2;
    for (let gx = 0; gx <= bayLength; gx += step) {
      const rx = PAD + gx * sx;
      ctx.beginPath();
      ctx.moveTo(rx, PAD + mapH);
      ctx.lineTo(rx, PAD + mapH + 4);
      ctx.strokeStyle = '#2e3650';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(gx + 'm', rx, PAD + mapH + 15);
    }
    ctx.textAlign = 'right';
    for (let gy = 0; gy <= bayWidth; gy += Math.ceil(bayWidth / 4)) {
      ctx.fillText(gy + 'm', PAD - 6, PAD + gy * sy + 4);
    }

    // Camera dots
    computedCameras.forEach((cam, idx) => {
      const color = CAM_COLORS[idx % CAM_COLORS.length];
      const camX = PAD + cam.x * sx;
      const camY = PAD + cam.y * sy;

      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(camX, camY, 10, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#0b0d12';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(camX, camY, 10, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#0b0d12';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cam.id), camX, camY);
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = color;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cam.x.toFixed(1) + 'm', camX, camY + 20);
    });

    // Header label
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TOP VIEW — FLOOR PLAN', PAD, PAD - 10);
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`← Bay Length ${bayLength}m →`, PAD + mapW / 2, H - 4);
  }, [computedCameras, bayLength, bayWidth]);

  const drawSideView = useCallback(() => {
    const canvas = cvSideRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);

    const PL = 50;
    const PR = 20;
    const PT = 28;
    const PB = 42;
    const mapW = W - PL - PR;
    const mapH = H - PT - PB;
    const sx = mapW / bayLength;
    const maxH = Math.max(mountHeight * 1.8, 6);
    const sy = mapH / maxH;
    const floorY = PT + maxH * sy;

    // Grid lines
    for (let gh = 0; gh <= Math.ceil(maxH); gh++) {
      const gy = PT + (maxH - gh) * sy;
      ctx.strokeStyle = '#181c28';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PL, gy);
      ctx.lineTo(PL + mapW, gy);
      ctx.stroke();
      if (gh % 2 === 0 && gh <= Math.ceil(maxH)) {
        ctx.fillStyle = '#64748b';
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(gh + 'm', PL - 6, gy + 3);
      }
    }

    // Floor surface
    ctx.fillStyle = '#1e2333';
    ctx.fillRect(PL, floorY - 2, mapW, 6);
    ctx.fillStyle = '#252c3f';
    ctx.fillRect(PL, floorY + 4, mapW, PB);

    // Cones
    computedCameras.forEach((cam, idx) => {
      const color = CAM_COLORS[idx % CAM_COLORS.length];
      const fp = cam.footprint;
      if (!fp) return;
      const camSX = PL + cam.x * sx;
      const camSY = PT + (maxH - cam.z) * sy;
      const halfV = (fovV / 2) * Math.PI / 180;

      ctx.save();
      ctx.beginPath();
      ctx.rect(PL, PT, mapW, floorY - PT + 4);
      ctx.clip();

      switch (fp.type) {
        case 'cone-h': {
          const d = fp.dir;
          const dL = fp.detLen * sx;
          const dS = dL * Math.tan(halfV);
          ctx.beginPath();
          ctx.moveTo(camSX, camSY);
          ctx.lineTo(camSX + d * dL, camSY - dS);
          ctx.lineTo(camSX + d * dL, camSY + dS);
          ctx.closePath();
          ctx.fillStyle = 'rgba(239,159,39,0.08)';
          ctx.fill();

          const eL = fp.len * sx;
          const eS = eL * Math.tan(halfV);
          ctx.beginPath();
          ctx.moveTo(camSX, camSY);
          ctx.lineTo(camSX + d * eL, camSY - eS);
          ctx.lineTo(camSX + d * eL, camSY + eS);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.18);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
          break;
        }

        case 'roof-nadir':
        case 'circle':
        case 'circle360': {
          const r = fp.r * sx;
          ctx.beginPath();
          ctx.moveTo(camSX, camSY);
          ctx.lineTo(camSX - r, floorY);
          ctx.lineTo(camSX + r, floorY);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.15);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = hexAlpha(color, 0.4);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(camSX, camSY);
          ctx.lineTo(camSX, floorY);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }

        default: {
          const r = cam.z * Math.tan(halfV) * sx;
          ctx.beginPath();
          ctx.moveTo(camSX, camSY);
          ctx.lineTo(camSX - r, floorY);
          ctx.lineTo(camSX + r, floorY);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(color, 0.1);
          ctx.fill();
        }
      }

      // Mounting pole
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(camSX, PT);
      ctx.lineTo(camSX, camSY);
      ctx.strokeStyle = '#2e3650';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Camera dot
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(camSX, camSY, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#0b0d12';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(camSX, camSY, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#0b0d12';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cam.id), camSX, camSY);
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = hexAlpha(color, 0.7);
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(cam.z.toFixed(1) + 'm', camSX + 12, camSY + 3);

      ctx.restore();
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const step2 = bayLength > 50 ? 10 : 5;
    for (let gx = 0; gx <= bayLength; gx += step2) {
      const rx = PL + gx * sx;
      ctx.fillText(gx + 'm', rx, floorY + 16);
    }
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SIDE PROFILE — ELEVATION VIEW', PL, PT - 8);
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('FLOOR LEVEL (0m)', PL + 4, floorY + 30);
  }, [computedCameras, bayLength, mountHeight, fovV]);

  const draw3D = useCallback(() => {
    const canvas = cv3dRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);

    const angle = 30 * Math.PI / 180;
    const scale = Math.min((W - 80) / (bayLength + bayWidth * 0.6), 4.5);
    const ox = 80;
    const oy = H * 0.6;
    const hScale = scale * 1.5;

    function project(x: number, y: number, z: number): [number, number] {
      const px = ox + x * scale - y * Math.cos(angle) * scale * 0.6;
      const py = oy - z * hScale + y * Math.sin(angle) * scale * 0.35;
      return [px, py];
    }

    // Floor grid
    ctx.strokeStyle = '#181c28';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= bayLength; gx += 10) {
      const [ax, ay] = project(gx, 0, 0);
      const [bx, by] = project(gx, bayWidth, 0);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    for (let gy = 0; gy <= bayWidth; gy += 2) {
      const [ax, ay] = project(0, gy, 0);
      const [bx, by] = project(bayLength, gy, 0);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // Floor fill
    const corners3d: [number, number, number][] = [
      [0, 0, 0],
      [bayLength, 0, 0],
      [bayLength, bayWidth, 0],
      [0, bayWidth, 0]
    ];
    ctx.beginPath();
    corners3d.forEach(([x, y, z], i) => {
      const [px, py] = project(x, y, z);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(18,21,30,0.8)';
    ctx.fill();
    ctx.strokeStyle = '#2e3650';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Camera cones & poles
    computedCameras.forEach((cam, idx) => {
      const color = CAM_COLORS[idx % CAM_COLORS.length];
      const [cx, cy] = project(cam.x, cam.y, 0);
      const [cx2, cy2] = project(cam.x, cam.y, cam.z);

      // Floor shadow
      if (cam.footprint) {
        const fp = cam.footprint;
        ctx.save();
        ctx.globalAlpha = 0.25;
        switch (fp.type) {
          case 'cone-h': {
            const d = fp.dir;
            const eLen = fp.len;
            const eSpread = Math.min(fp.spread, bayWidth * 0.6);
            const [p1x, p1y] = project(cam.x, cam.y, 0);
            const [p2x, p2y] = project(cam.x + d * eLen, cam.y - eSpread, 0);
            const [p3x, p3y] = project(cam.x + d * eLen, cam.y + eSpread, 0);
            ctx.beginPath();
            ctx.moveTo(p1x, p1y);
            ctx.lineTo(p2x, p2y);
            ctx.lineTo(p3x, p3y);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            break;
          }
          case 'circle':
          case 'circle360':
          case 'roof-nadir': {
            const r = fp.r || cam.rangeUsed;
            const steps = 20;
            ctx.beginPath();
            for (let a = 0; a < steps; a++) {
              const ang = (a / steps) * Math.PI * 2;
              const [px, py] = project(cam.x + Math.cos(ang) * r, cam.y + Math.sin(ang) * r, 0);
              if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            break;
          }
          case 'cone-az': {
            const azRad = (fp.az - 90) * Math.PI / 180;
            const dx = Math.cos(azRad);
            const dy = Math.sin(azRad);
            const px2 = -dy;
            const py2 = dx;
            const farLen = fp.far || cam.effectiveRange;
            const sp = farLen * Math.tan(fp.halfH);
            const [p1x, p1y] = project(cam.x, cam.y, 0);
            const [p2x, p2y] = project(cam.x + dx * farLen - px2 * sp, cam.y + dy * farLen - py2 * sp, 0);
            const [p3x, p3y] = project(cam.x + dx * farLen + px2 * sp, cam.y + dy * farLen + py2 * sp, 0);
            ctx.beginPath();
            ctx.moveTo(p1x, p1y);
            ctx.lineTo(p2x, p2y);
            ctx.lineTo(p3x, p3y);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            break;
          }
        }
        ctx.restore();
      }

      // Pole
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx2, cy2);
      ctx.strokeStyle = '#2e3650';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Camera Sphere
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(cx2, cy2, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#0b0d12';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx2, cy2, 7, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#0b0d12';
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cam.id), cx2, cy2);
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = color;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('C' + cam.id, cx2, cy2 - 14);
    });

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('3D PERSPECTIVE VIEW', ox, 18);
    ctx.fillStyle = '#64748b';
    ctx.font = '8px monospace';
    ctx.fillText(`${bayLength}m × ${bayWidth}m × ${mountHeight}m`, ox, 32);
  }, [computedCameras, bayLength, bayWidth, mountHeight]);

  // Redraw active view
  useEffect(() => {
    if (activeViewTab === 'top') drawTopView();
    if (activeViewTab === 'side') drawSideView();
    if (activeViewTab === '3d') draw3D();
  }, [activeViewTab, drawTopView, drawSideView, draw3D, computedCameras]);

  // Export report
  const handleExportReport = () => {
    const modeLabel = {
      detect: 'Detection',
      observe: 'Observation',
      recognize: 'Recognition (PPE)',
      identify: 'Identification'
    }[mode];

    let r = `═══════════════════════════════════════════════════════════════════
  CAMERA COVERAGE PLANNER — FULL REPORT v3.0
  Generated: ${new Date().toLocaleString()}
═══════════════════════════════════════════════════════════════════

GLOBAL SPECS
  Lens: ${fovH}° HFOV / ${fovV}° VFOV (${lens}mm)
  Ranges: Detect=${rD}m | Observe=${rO}m | Recognize=${rR}m | Identify=${rI}m
  Overlap: ${overlap}%

AREA
  Length: ${bayLength}m | Width: ${bayWidth}m | Height: ${mountHeight}m
  Total Area: ${metrics.totalArea}m²

MODE: ${modeLabel}   Effective Range: ${{ detect: rD, observe: rO, recognize: rR, identify: rI }[mode]}m

RESULTS
  Total Cameras:  ${metrics.total}
  Coverage:       ${metrics.coverPct}%
  Blind Spots:    ${metrics.blindPct}%
  Efficiency:     ${metrics.efficiency}% per camera
  Status:         ${metrics.blindPct === 0 ? '✓ ZERO BLIND SPOTS' : metrics.blindPct < 10 ? '⚠ MINOR GAPS' : '✗ NEEDS ATTENTION'}

CAMERA POSITIONS (numbered 1 → ${metrics.total}, left to right)
─────────────────────────────────────────────────────────────────
`;
    computedCameras.forEach(c => {
      r += `
  Camera ${c.id.toString().padEnd(3)} | x=${c.x.toFixed(2).padEnd(8)}m | y=${c.y.toFixed(2).padEnd(6)}m | z=${c.z.toFixed(1)}m
    Mount:     ${c.mountType.toUpperCase().padEnd(14)} | Facing: ${c.facing.padEnd(14)}
    Coverage:  ${c.coverStart.toFixed(2)}m → ${c.coverEnd.toFixed(2)}m  (span=${(c.coverEnd - c.coverStart).toFixed(2)}m)
    Calc:      ${c.desc}
${'─'.repeat(65)}`;
    });
    r += `\n\n═══════════════════════════════════════════════════════════════════\n`;
    const blob = new Blob([r], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CameraReport_v3_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reset all
  const handleReset = () => {
    setLens(2.8);
    setFovH(106);
    setFovV(56);
    setRD(88);
    setRO(35.2);
    setRR(17.6);
    setRI(8.8);
    setBayLength(90);
    setBayWidth(10);
    setMountHeight(4);
    setOverlap(10);
    setMode('recognize');
    setCameraCount(5);
    setCamConfigs([
      { id: 1, pos: 0, mountType: 'wall-h', tilt: 30, az: 0 },
      { id: 2, pos: 22.5, mountType: 'wall-h', tilt: 30, az: 0 },
      { id: 3, pos: 45.0, mountType: 'roof-nadir', tilt: 30, az: 0 },
      { id: 4, pos: 67.5, mountType: 'wall-h', tilt: 30, az: 0 },
      { id: 5, pos: 90.0, mountType: 'wall-h', tilt: 30, az: 0 },
    ]);
  };

  // Apply to project
  const handleApplyToCanvas = () => {
    if (!onApplyToProject) return;
    const projectCameras: ProjectCamera[] = computedCameras.map((cam, idx) => {
      const normX = Math.max(0.05, Math.min(0.95, cam.x / bayLength));
      const normY = Math.max(0.05, Math.min(0.95, cam.y / bayWidth));
      
      let orientation = 180;
      if (cam.mountType === 'wall-h') {
        orientation = cam.facing === '→' ? 90 : 270;
      } else if (cam.mountType === 'roof-nadir') {
        orientation = 180;
      } else if (cam.az) {
        orientation = cam.az;
      }

      return {
        id: crypto.randomUUID(),
        name: `CAM-${cam.id} (${cam.mountType.toUpperCase()})`,
        x: normX,
        y: normY,
        orientation_degrees: orientation,
        horizontal_fov_degrees: cam.fovH,
        view_range: Math.min(0.8, Math.max(0.2, cam.rangeUsed / bayLength)),
        resolution_width: 1920,
        resolution_height: 1080,
        status: 'planned',
        target_area: `Bay position ${cam.x.toFixed(1)}m`,
        assigned_use_case_ids: [],
        rationale: cam.desc
      };
    });

    onApplyToProject(projectCameras);
  };

  const toggleCard = (id: number) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const updateCameraMount = (id: number, mount: MountType) => {
    setCamConfigs(prev => prev.map(c => c.id === id ? { ...c, mountType: mount } : c));
  };

  const updateCameraTilt = (id: number, tilt: number) => {
    setCamConfigs(prev => prev.map(c => c.id === id ? { ...c, tilt } : c));
  };

  const updateCameraAz = (id: number, az: number) => {
    setCamConfigs(prev => prev.map(c => c.id === id ? { ...c, az } : c));
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0d12] text-[#e2e8f0] font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 border-b border-[#252c3f] bg-[#12151e]/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-tight text-white flex items-center gap-2">
              Camera Coverage <span className="text-[#00e5ff]">Planner</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#00e5ff]/30 bg-[#00e5ff]/10 text-[#00e5ff]">v3.0</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#ff6b35]/30 bg-[#ff6b35]/10 text-[#ff6b35]">PER-CAMERA MOUNT</span>
            </div>
            <div className="text-[11px] font-mono text-[#64748b]">
              // Per-camera mount · Numbered 1→N left to right · Full geometry calculations
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onApplyToProject && (
            <button
              onClick={handleApplyToCanvas}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00e5ff] text-[#0b0d12] font-bold text-xs hover:bg-[#33ecff] transition-all shadow-lg shadow-cyan-500/20"
              title="Sync these calculated cameras to your interactive Konva project canvas"
            >
              <Share2 className="w-3.5 h-3.5" />
              Sync to Canvas
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-[#252c3f] bg-[#181c28] text-xs font-semibold hover:border-[#00e5ff] text-slate-300 hover:text-white"
            >
              Back to Canvas
            </button>
          )}
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 p-4 overflow-y-auto min-h-0">
        
        {/* Left Column: Controls */}
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Camera Specifications */}
          <div className="bg-[#12151e] border border-[#252c3f] rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#252c3f] text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              <div className="w-2 h-2 rounded-full bg-[#00e5ff]" />
              Camera Specifications
            </div>
            <div className="p-3 space-y-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#00e5ff] mb-1.5 flex items-center gap-1">
                  Lens & FOV
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">Lens (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={lens}
                      onChange={e => setLens(parseFloat(e.target.value) || 2.8)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">H-FOV (°)</label>
                    <input
                      type="number"
                      value={fovH}
                      onChange={e => setFovH(parseFloat(e.target.value) || 106)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">V-FOV (°)</label>
                    <input
                      type="number"
                      value={fovV}
                      onChange={e => setFovV(parseFloat(e.target.value) || 56)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#00e5ff] mb-1.5 flex items-center gap-1">
                  Detection Ranges (m)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">Detect</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rD}
                      onChange={e => setRD(parseFloat(e.target.value) || 88)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">Observe</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rO}
                      onChange={e => setRO(parseFloat(e.target.value) || 35.2)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">Recognize</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rR}
                      onChange={e => setRR(parseFloat(e.target.value) || 17.6)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[#64748b] mb-1">Identify</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rI}
                      onChange={e => setRI(parseFloat(e.target.value) || 8.8)}
                      className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Area & Installation */}
          <div className="bg-[#12151e] border border-[#252c3f] rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#252c3f] text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              <div className="w-2 h-2 rounded-full bg-[#ff6b35]" />
              Area & Installation
            </div>
            <div className="p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Bay Length (m)</label>
                  <input
                    type="number"
                    value={bayLength}
                    onChange={e => handleBayLengthChange(parseFloat(e.target.value) || 90)}
                    className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Bay Width (m)</label>
                  <input
                    type="number"
                    value={bayWidth}
                    onChange={e => setBayWidth(parseFloat(e.target.value) || 10)}
                    className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Mount Height (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={mountHeight}
                    onChange={e => setMountHeight(parseFloat(e.target.value) || 4)}
                    className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Overlap (%)</label>
                  <input
                    type="number"
                    value={overlap}
                    onChange={e => setOverlap(parseFloat(e.target.value) || 10)}
                    className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Monitoring Mode</label>
                  <select
                    value={mode}
                    onChange={e => setMode(e.target.value as any)}
                    className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  >
                    <option value="detect">Detection</option>
                    <option value="observe">Observation</option>
                    <option value="recognize">Recognize (PPE)</option>
                    <option value="identify">Identification</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Camera Count</label>
                  <input
                    type="number"
                    min="1"
                    max="75"
                    value={cameraCount}
                    onChange={e => handleCameraCountChange(parseInt(e.target.value) || 5)}
                    className="w-full bg-[#181c28] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Per-Camera Mount Cards */}
          <div className="bg-[#12151e] border border-[#252c3f] rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#252c3f] text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              <div className="w-2 h-2 rounded-full bg-[#7fff6b]" />
              Per-Camera Mount Positions
            </div>
            <div className="p-3">
              <div className="text-[10px] font-mono text-[#64748b] mb-2 leading-relaxed">
                Each camera below is auto-positioned left→right across the bay length. Select the mount type and adjust tilt/azimuth individually.
              </div>

              <div className="space-y-2">
                {camConfigs.map((cam, idx) => {
                  const color = CAM_COLORS[(cam.id - 1) % CAM_COLORS.length];
                  const info = MOUNTS[cam.mountType];
                  const isExpanded = !!expandedCards[cam.id];

                  return (
                    <div key={cam.id} className="bg-[#181c28] border border-[#252c3f] rounded-md overflow-hidden transition-all">
                      <div
                        onClick={() => toggleCard(cam.id)}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer bg-[#1e2333]/70 hover:bg-[#1e2333]"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-bold text-[#0b0d12] shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {cam.id}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold" style={{ color }}>
                            Camera {cam.id}
                          </div>
                          <div className="text-[10px] font-mono text-[#64748b] truncate">
                            x={cam.pos.toFixed(1)}m | {cam.mountType.toUpperCase()}
                          </div>
                        </div>
                        <div className="text-[#64748b]">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-2.5 border-t border-[#252c3f]/50 space-y-2 bg-[#12151e]/50">
                          <div className="text-[9px] font-mono text-[#64748b]">
                            Auto-position: <span className="text-[#00e5ff]">{cam.pos.toFixed(2)}m</span> from left · {info.tip}
                          </div>

                          {/* Mini mount switcher */}
                          <div className="grid grid-cols-4 gap-1">
                            {(Object.keys(MOUNTS) as MountType[]).map(mKey => {
                              const m = MOUNTS[mKey];
                              const isActive = cam.mountType === mKey;
                              return (
                                <button
                                  key={mKey}
                                  type="button"
                                  onClick={() => updateCameraMount(cam.id, mKey)}
                                  className={`p-1 rounded flex flex-col items-center justify-center text-[8px] font-bold text-center border transition-all ${
                                    isActive
                                      ? 'border-[#00e5ff] bg-[#00e5ff]/10 text-[#00e5ff]'
                                      : 'border-[#252c3f] bg-[#181c28] text-[#94a3b8] hover:border-[#2e3650]'
                                  }`}
                                  title={m.tip}
                                >
                                  <span className="whitespace-pre-line leading-tight">{m.label}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Sliders for tilt / azimuth */}
                          {(info.hasTilt || info.hasAz) && (
                            <div className="pt-1.5 space-y-1.5 border-t border-[#252c3f]/40">
                              {info.hasTilt && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-[#64748b] w-14">Tilt Down</span>
                                  <input
                                    type="range"
                                    min="5"
                                    max="80"
                                    value={cam.tilt}
                                    onChange={e => updateCameraTilt(cam.id, parseFloat(e.target.value))}
                                    className="flex-1 accent-[#00e5ff]"
                                  />
                                  <span className="text-[10px] font-mono text-[#00e5ff] w-8 text-right">{cam.tilt}°</span>
                                </div>
                              )}
                              {info.hasAz && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-[#64748b] w-14">Azimuth</span>
                                  <input
                                    type="range"
                                    min="0"
                                    max="359"
                                    value={cam.az}
                                    onChange={e => updateCameraAz(cam.id, parseFloat(e.target.value))}
                                    className="flex-1 accent-[#00e5ff]"
                                  />
                                  <span className="text-[10px] font-mono text-[#00e5ff] w-8 text-right">{cam.az}°</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1 pb-4">
            <button
              onClick={computeAllCameras}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md bg-[#00e5ff] text-[#0b0d12] font-bold text-xs hover:bg-[#33ecff] transition-all"
            >
              <Zap className="w-4 h-4 fill-current" />
              ⚡ Calculate All Camera Coverage
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleReset}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#181c28] border border-[#252c3f] text-[#94a3b8] hover:text-white hover:border-[#00e5ff] text-xs font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                ↺ Reset
              </button>
              <button
                onClick={handleExportReport}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#181c28] border border-[#252c3f] text-[#94a3b8] hover:text-white hover:border-[#00e5ff] text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                ↓ Export Report
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Visualization & Results */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#12151e] border border-[#252c3f] rounded-lg p-3">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Cameras</div>
              <div className="text-2xl font-mono font-bold text-[#00e5ff] leading-none">{metrics.total}</div>
            </div>
            <div className="bg-[#12151e] border border-[#252c3f] rounded-lg p-3">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Coverage</div>
              <div className="text-2xl font-mono font-bold text-[#7fff6b] leading-none">{metrics.coverPct}%</div>
            </div>
            <div className="bg-[#12151e] border border-[#252c3f] rounded-lg p-3">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Blind Spot</div>
              <div className="text-2xl font-mono font-bold text-[#ff4757] leading-none">{metrics.blindPct}%</div>
            </div>
            <div className="bg-[#12151e] border border-[#252c3f] rounded-lg p-3">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Efficiency</div>
              <div className="text-2xl font-mono font-bold text-[#ffd60a] leading-none">{metrics.efficiency}%</div>
            </div>
          </div>

          {/* Status Alert */}
          {metrics.blindPct === 0 ? (
            <div className="bg-emerald-950/30 border-l-4 border-[#7fff6b] text-[#9ef090] p-3 rounded text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#7fff6b]" />
              ✓ Perfect — zero blind spots achieved with {metrics.total} cameras covering all {bayLength}m × {bayWidth}m.
            </div>
          ) : metrics.blindPct < 10 ? (
            <div className="bg-amber-950/30 border-l-4 border-[#ffd60a] text-[#ffe15a] p-3 rounded text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-[#ffd60a]" />
              ⚠ Only {metrics.blindPct}% blind spots remain. Add 1–2 cameras or increase effective range to fill the gap.
            </div>
          ) : (
            <div className="bg-rose-950/30 border-l-4 border-[#ff4757] text-[#ff7a85] p-3 rounded text-xs font-mono flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0 text-[#ff4757]" />
              ✗ {metrics.blindPct}% coverage gap. Adjust mount types, increase camera count, or use wider FOV lenses.
            </div>
          )}

          {/* Coverage Maps Tabs & Canvas */}
          <div className="bg-[#12151e] border border-[#252c3f] rounded-lg overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#252c3f] px-3 bg-[#181c28]">
              <div className="flex items-center gap-2 py-2 text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                <div className="w-2 h-2 rounded-full bg-[#ff6b35]" />
                Coverage Maps
              </div>
              <div className="flex">
                <button
                  onClick={() => setActiveViewTab('top')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeViewTab === 'top'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  Top View (Floor Plan)
                </button>
                <button
                  onClick={() => setActiveViewTab('side')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeViewTab === 'side'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  Side Profile
                </button>
                <button
                  onClick={() => setActiveViewTab('3d')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeViewTab === '3d'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  3D Perspective
                </button>
              </div>
            </div>

            <div className="p-3 bg-[#0b0d12]">
              {/* Top View Canvas */}
              <div style={{ display: activeViewTab === 'top' ? 'block' : 'none' }}>
                <canvas
                  ref={cvTopRef}
                  width={860}
                  height={340}
                  className="w-full h-auto block rounded border border-[#181c28]"
                />
              </div>

              {/* Side View Canvas */}
              <div style={{ display: activeViewTab === 'side' ? 'block' : 'none' }}>
                <canvas
                  ref={cvSideRef}
                  width={860}
                  height={260}
                  className="w-full h-auto block rounded border border-[#181c28]"
                />
              </div>

              {/* 3D View Canvas */}
              <div style={{ display: activeViewTab === '3d' ? 'block' : 'none' }}>
                <canvas
                  ref={cv3dRef}
                  width={860}
                  height={300}
                  className="w-full h-auto block rounded border border-[#181c28]"
                />
              </div>
            </div>
          </div>

          {/* Camera Details Card */}
          <div className="bg-[#12151e] border border-[#252c3f] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#252c3f] px-3 bg-[#181c28]">
              <div className="flex items-center gap-2 py-2 text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                <div className="w-2 h-2 rounded-full bg-[#c084fc]" />
                Camera Details
              </div>
              <div className="flex flex-wrap">
                <button
                  onClick={() => setActiveDetTab('table')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'table'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  Summary Table
                </button>
                <button
                  onClick={() => setActiveDetTab('list')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'list'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  Full Details
                </button>
                <button
                  onClick={() => setActiveDetTab('reco')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'reco'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  Recommendations
                </button>
                <button
                  onClick={() => setActiveDetTab('legend')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'legend'
                      ? 'border-[#00e5ff] text-[#00e5ff]'
                      : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                  }`}
                >
                  Legend
                </button>
              </div>
            </div>

            <div className="p-3">
              {/* Summary Table */}
              {activeDetTab === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#252c3f] bg-[#1e2333]/50 text-[#00e5ff] text-[10px] uppercase">
                        <th className="p-2">#</th>
                        <th className="p-2">X Position</th>
                        <th className="p-2">Height</th>
                        <th className="p-2">Mount Type</th>
                        <th className="p-2">Facing</th>
                        <th className="p-2">Cover Start</th>
                        <th className="p-2">Cover End</th>
                        <th className="p-2">Span</th>
                        <th className="p-2">FOV-H</th>
                        <th className="p-2">Eff. Range</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#252c3f]/50">
                      {computedCameras.map((cam, idx) => {
                        const color = CAM_COLORS[idx % CAM_COLORS.length];
                        const span = (cam.coverEnd - cam.coverStart).toFixed(2);
                        return (
                          <tr key={cam.id} className="hover:bg-[#181c28]/40 transition-colors">
                            <td className="p-2 font-bold" style={{ color }}>
                              ▌{cam.id}
                            </td>
                            <td className="p-2 text-slate-300">{cam.x.toFixed(2)}m</td>
                            <td className="p-2 text-slate-300">{cam.z.toFixed(1)}m</td>
                            <td className="p-2 font-semibold" style={{ color: MOUNTS[cam.mountType]?.colorHint || '#fff' }}>
                              {cam.mountType.toUpperCase()}
                            </td>
                            <td className="p-2 text-slate-300">{cam.facing}</td>
                            <td className="p-2 text-slate-300">{cam.coverStart.toFixed(2)}m</td>
                            <td className="p-2 text-slate-300">{cam.coverEnd.toFixed(2)}m</td>
                            <td className="p-2 font-bold text-[#7fff6b]">{span}m</td>
                            <td className="p-2 text-slate-300">{cam.fovH.toFixed(0)}°</td>
                            <td className="p-2 text-slate-300">{cam.rangeUsed.toFixed(2)}m</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Full Details List */}
              {activeDetTab === 'list' && (
                <div className="space-y-2">
                  {computedCameras.map((cam, idx) => {
                    const color = CAM_COLORS[idx % CAM_COLORS.length];
                    const span = (cam.coverEnd - cam.coverStart).toFixed(2);
                    const minfo = MOUNTS[cam.mountType];
                    const halfH = (fovH / 2) * Math.PI / 180;
                    
                    let extraCalc = '';
                    switch (cam.mountType) {
                      case 'roof-nadir':
                        extraCalc = `Floor radius = ${mountHeight}m × tan(${(fovH / 2).toFixed(1)}°) = ${(mountHeight * Math.tan(halfH)).toFixed(2)}m`;
                        break;
                      case 'wall-h':
                        extraCalc = `Floor spread at ${cam.effectiveRange}m = ${cam.effectiveRange}m × tan(${(fovH / 2).toFixed(1)}°) × 2 = ${(cam.effectiveRange * Math.tan(halfH) * 2).toFixed(2)}m wide`;
                        break;
                      case 'roof-tilt':
                        extraCalc = `Tilt=${cam.tilt}°, Az=${cam.az}°. Ground intercept = ${mountHeight}m / tan(${cam.tilt}°) = ${(mountHeight / Math.tan(cam.tilt * Math.PI / 180)).toFixed(2)}m`;
                        break;
                      case 'pole360':
                        extraCalc = `360° coverage radius = ${cam.rangeUsed.toFixed(2)}m`;
                        break;
                      default:
                        extraCalc = `Effective range used = ${cam.rangeUsed.toFixed(2)}m`;
                    }

                    return (
                      <div key={cam.id} className="p-3 bg-[#181c28] border border-[#252c3f] rounded flex gap-3 items-start">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold text-[#0b0d12] shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {cam.id}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold mb-1" style={{ color }}>
                            Camera {cam.id} — {minfo?.label.replace('\n', ' ') || cam.mountType}
                          </div>
                          <div className="font-mono text-[10px] text-[#94a3b8] leading-relaxed space-y-0.5">
                            <div>
                              Position: x=<strong style={{ color }}>{cam.x.toFixed(2)}m</strong> ({(cam.x / bayLength * 100).toFixed(1)}% of bay) · y={cam.y.toFixed(2)}m · z={cam.z.toFixed(1)}m
                            </div>
                            <div>
                              Mount: <span style={{ color: minfo?.colorHint || '#fff' }}>{cam.mountType.toUpperCase()}</span> · Facing: {cam.facing}
                            </div>
                            <div>
                              Coverage: {cam.coverStart.toFixed(2)}m → {cam.coverEnd.toFixed(2)}m (span = <span className="text-[#7fff6b] font-bold">{span}m</span>)
                            </div>
                            <div className="text-cyan-400/90">{extraCalc}</div>
                            <div className="text-slate-400 italic">{cam.desc}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Recommendations */}
              {activeDetTab === 'reco' && (
                <div className="space-y-2 font-mono text-xs text-[#94a3b8]">
                  <div className="p-3 bg-[#181c28] border-l-2 border-[#00e5ff] rounded">
                    {metrics.blindPct === 0 ? (
                      <div><strong className="text-white">✓ Perfect Coverage:</strong> {metrics.total} cameras provide 100% coverage of the {bayLength}m × {bayWidth}m area.</div>
                    ) : (
                      <div><strong className="text-white">Coverage Gap {metrics.blindPct}%:</strong> {Math.ceil(metrics.blindPct / 10)} more camera(s) needed, or switch to wider FOV / longer range cameras.</div>
                    )}
                  </div>
                  <div className="p-3 bg-[#181c28] border-l-2 border-[#00e5ff] rounded">
                    <strong className="text-white">Mode: {mode.toUpperCase()}</strong> — Using { { detect: rD, observe: rO, recognize: rR, identify: rI }[mode] }m effective range. Switch to Detection for maximum distance; Identification for highest detail.
                  </div>
                  <div className="p-3 bg-[#181c28] border-l-2 border-[#00e5ff] rounded">
                    <strong className="text-white">Mount Diversity Tip:</strong> Combining mount types eliminates blind spots: use Wall-Horizontal for longitudinal reach, and Roof-Nadir / Tilted for width coverage.
                  </div>
                  <div className="p-3 bg-[#181c28] border-l-2 border-[#00e5ff] rounded">
                    <strong className="text-white">Cable & Infrastructure:</strong> Estimated ~{(bayLength * 1.5).toFixed(0)}m cabling. Minimum {metrics.total} PoE channels required on NVR/Switch.
                  </div>
                </div>
              )}

              {/* Legend */}
              {activeDetTab === 'legend' && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#94a3b8]">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-3 rounded bg-[#7fff6b]/30 border border-[#7fff6b]" />
                      Effective monitoring zone
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-3 rounded bg-[rgba(239,159,39,0.2)] border border-[rgba(239,159,39,0.4)]" />
                      Detection-only zone
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-3 rounded bg-[rgba(255,71,87,0.1)] border border-[#ff4757]" />
                      Blind spot
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#00e5ff]" />
                      Camera #N (left→right)
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#252c3f] text-[10px] text-[#64748b] leading-relaxed">
                    <strong className="text-white">Mount Geometry Formulas:</strong><br />
                    • wall-h → Cone: range × tan(½HFOV) = width spread at target distance<br />
                    • roof-nadir → Circle: h × tan(½HFOV) = floor radius<br />
                    • roof-tilt → Ellipse: near = h/tan(tilt+½VFOV), far = h/tan(tilt-½VFOV)<br />
                    • corner → Diagonal cone: range × tan(½FOV) at 45° azimuth<br />
                    • cross → Perpendicular cone: covers full bay width across aisle<br />
                    • pole360 → Circle: effectiveRange = omnidirectional radius
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

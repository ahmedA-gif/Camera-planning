'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Layers,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  ShieldCheck,
  AlertTriangle,
  Eye,
  Video,
  Move,
  Maximize2,
  Tv,
} from 'lucide-react';
import {
  clamp,
  type Vec3,
  type CameraSpec,
  type Obstacle3D,
  type TargetEvaluation,
  evaluateTargetPoint3D,
  computeSensorFov,
  AI_MODEL_FEASIBILITY_CRITERIA,
} from '@/lib/coverage-engine';

interface FrustumSpatialInspectorProps {
  initialFocalLength?: number;
  initialMountHeight?: number;
  initialTilt?: number;
  initialAzimuth?: number;
  resolutionName?: '2MP' | '4MP' | '5MP' | '8MP 4K' | '12MP';
  onSpecsChange?: (specs: { focalMm: number; mountHeight: number; tiltDeg: number; azimuthDeg: number }) => void;
}

export function FrustumSpatialInspector({
  initialFocalLength = 4.0,
  initialMountHeight = 4.5,
  initialTilt = 25,
  initialAzimuth = 45,
  resolutionName = '8MP 4K',
  onSpecsChange,
}: FrustumSpatialInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Optical & Physical Camera State
  const [focalLengthMm, setFocalLengthMm] = useState<number>(initialFocalLength);
  const [mountHeightM, setMountHeightM] = useState<number>(initialMountHeight);
  const [tiltDeg, setTiltDeg] = useState<number>(initialTilt);
  const [azimuthDeg, setAzimuthDeg] = useState<number>(initialAzimuth);
  const [targetType, setTargetType] = useState<'worker' | 'forklift' | 'intruder'>('worker');
  const [targetSpeed, setTargetSpeed] = useState<number>(1.4); // m/s
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [showPip, setShowPip] = useState<boolean>(true);

  // 3D Viewport Orbit State
  const [yaw, setYaw] = useState<number>(-38);
  const [pitch, setPitch] = useState<number>(24);
  const [zoom, setZoom] = useState<number>(1.1);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);

  // Animation timeline
  const animTimeRef = useRef<number>(0);

  // Physical Sensor Dimensions (1/1.8" Sensor for 4K / 8MP)
  const sensorSpec = useMemo(() => {
    if (resolutionName === '12MP') return { wMm: 7.6, hMm: 5.7, resW: 4000, resH: 3000 };
    if (resolutionName === '8MP 4K') return { wMm: 7.18, hMm: 4.04, resW: 3840, resH: 2160 };
    if (resolutionName === '5MP') return { wMm: 5.7, hMm: 4.28, resW: 2592, resH: 1944 };
    if (resolutionName === '4MP') return { wMm: 5.38, hMm: 3.02, resW: 2688, resH: 1520 };
    return { wMm: 5.14, hMm: 2.89, resW: 1920, resH: 1080 }; // 2MP
  }, [resolutionName]);

  const fov = useMemo(
    () => computeSensorFov(sensorSpec.wMm, sensorSpec.hMm, focalLengthMm),
    [sensorSpec, focalLengthMm]
  );

  // Camera Specification for Engine
  const cameraSpec: CameraSpec = useMemo(() => ({
    id: 'cam-inspector-01',
    position: { x: 3.5, y: 3.5, z: mountHeightM },
    azimuthDeg,
    tiltDeg,
    focalLengthMm,
    sensorWidthMm: sensorSpec.wMm,
    sensorHeightMm: sensorSpec.hMm,
    resolutionW: sensorSpec.resW,
    resolutionH: sensorSpec.resH,
    distortionK1: focalLengthMm <= 2.8 ? -0.18 : focalLengthMm <= 4.0 ? -0.09 : -0.03,
  }), [mountHeightM, azimuthDeg, tiltDeg, focalLengthMm, sensorSpec]);

  // Warehouse 3D Pallet Racks & Obstacle Shelves with cargo boxes
  const warehouseObstacles: Obstacle3D[] = useMemo(() => {
    const list: Obstacle3D[] = [];

    // Rack A: 3-tier heavy duty industrial pallet rack
    const rx = 10.0, ry = 8.5, rw = 3.6, rd = 1.2, rh = 4.2;

    // Outer bounding structure
    list.push({
      id: 'rack-a-main',
      name: 'Storage Rack A (Aisle 2)',
      min: { x: rx, y: ry, z: 0 },
      max: { x: rx + rw, y: ry + rd, z: rh },
      type: 'rack',
    });

    // Horizontal shelf beams at 1.4m and 2.8m (with physical gaps)
    list.push({
      id: 'rack-a-shelf-1',
      name: 'Rack A Tier-1 Beam',
      min: { x: rx, y: ry, z: 1.35 },
      max: { x: rx + rw, y: ry + rd, z: 1.55 },
      type: 'rack',
    });

    list.push({
      id: 'rack-a-shelf-2',
      name: 'Rack A Tier-2 Beam',
      min: { x: rx, y: ry, z: 2.75 },
      max: { x: rx + rw, y: ry + rd, z: 2.95 },
      type: 'rack',
    });

    // Pallet Cargo Boxes on shelves (different heights and positions)
    list.push({
      id: 'cargo-box-1',
      name: 'Heavy Pallet Box (Tier 1)',
      min: { x: rx + 0.3, y: ry + 0.1, z: 1.55 },
      max: { x: rx + 1.8, y: ry + 1.1, z: 2.65 },
      type: 'rack',
    });

    list.push({
      id: 'cargo-box-2',
      name: 'Industrial Carton Lot (Tier 2)',
      min: { x: rx + 1.9, y: ry + 0.15, z: 1.55 },
      max: { x: rx + 3.3, y: ry + 1.05, z: 2.55 },
      type: 'rack',
    });

    // Structural Concrete Column
    list.push({
      id: 'column-c1',
      name: 'Structural Column C1',
      min: { x: 15.5, y: 13.0, z: 0 },
      max: { x: 16.3, y: 13.8, z: 6.0 },
      type: 'column',
    });

    return list;
  }, []);

  // Visual Pallet Rack Wireframe Data for Rendering
  const rackVisualModel = useMemo(() => ({
    rx: 10.0,
    ry: 8.5,
    rw: 3.6,
    rd: 1.2,
    rh: 4.2,
    shelvesZ: [0.15, 1.4, 2.8],
    cargoBoxes: [
      { x: 10.3, y: 8.6, z: 1.45, w: 1.4, d: 1.0, h: 1.1, color: '#f97316', label: 'CARGO 01' },
      { x: 11.9, y: 8.65, z: 1.45, w: 1.4, d: 0.95, h: 0.95, color: '#a855f7', label: 'LOT 24' },
      { x: 10.4, y: 8.6, z: 0.18, w: 1.5, d: 1.0, h: 1.15, color: '#06b6d4', label: 'PALLET A' },
      { x: 12.0, y: 8.65, z: 0.18, w: 1.3, d: 0.95, h: 1.05, color: '#10b981', label: 'BOX B' },
    ],
  }), []);

  // Target Patrol Path Generator
  const getTargetPositionAtTime = useCallback((t: number) => {
    // Smooth looping path through warehouse aisle and behind Rack A
    const speedFactor = 0.25 * targetSpeed;
    const progress = (t * speedFactor) % (Math.PI * 2);

    const x = 11.8 + Math.cos(progress) * 3.8;
    const y = 9.8 + Math.sin(progress * 1.5) * 2.2;
    const z = targetType === 'forklift' ? 2.2 : 1.7;

    return { x, y, z };
  }, [targetSpeed, targetType]);

  // Current Target Evaluation
  const [currentEval, setCurrentEval] = useState<TargetEvaluation | null>(null);
  const [currentTargetPos, setCurrentTargetPos] = useState<Vec3>({ x: 11.8, y: 9.8, z: 1.7 });

  // Update specs callback
  const handleFocalChange = (v: number) => {
    setFocalLengthMm(v);
    onSpecsChange?.({ focalMm: v, mountHeight: mountHeightM, tiltDeg, azimuthDeg });
  };
  const handleHeightChange = (v: number) => {
    setMountHeightM(v);
    onSpecsChange?.({ focalMm: focalLengthMm, mountHeight: v, tiltDeg, azimuthDeg });
  };
  const handleTiltChange = (v: number) => {
    setTiltDeg(v);
    onSpecsChange?.({ focalMm: focalLengthMm, mountHeight: mountHeightM, tiltDeg: v, azimuthDeg });
  };

  // Main 3D Rendering Canvas Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;

    const render = () => {
      if (isPlaying) {
        animTimeRef.current += 0.016;
      }
      const t = animTimeRef.current;

      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deep Dark Tactical Background (matches prototype)
      ctx.fillStyle = '#050811';
      ctx.fillRect(0, 0, w, h);

      // 3D Perspective Projection Setup
      const lookAt: Vec3 = { x: 10.5, y: 8.5, z: 2.2 };
      const radYaw = (yaw * Math.PI) / 180;
      const radPitch = (pitch * Math.PI) / 180;

      // Orbit distance
      const orbitDist = 26 / zoom;
      const eyeX = lookAt.x + orbitDist * Math.cos(radPitch) * Math.sin(radYaw);
      const eyeY = lookAt.y - orbitDist * Math.cos(radPitch) * Math.cos(radYaw);
      const eyeZ = lookAt.z + orbitDist * Math.sin(radPitch);

      // Forward, Right, Up vectors for 3D camera
      const fwd = {
        x: lookAt.x - eyeX,
        y: lookAt.y - eyeY,
        z: lookAt.z - eyeZ,
      };
      const fwdLen = Math.hypot(fwd.x, fwd.y, fwd.z);
      const fn = { x: fwd.x / fwdLen, y: fwd.y / fwdLen, z: fwd.z / fwdLen };

      const right = {
        x: fn.y * 1 - 0,
        y: 0 - fn.x * 1,
        z: 0,
      };
      const rLen = Math.hypot(right.x, right.y) || 1;
      const rn = { x: right.x / rLen, y: right.y / rLen, z: 0 };

      const un = {
        x: rn.y * fn.z - rn.z * fn.y,
        y: rn.z * fn.x - rn.x * fn.z,
        z: rn.x * fn.y - rn.y * fn.x,
      };

      const focalDist = Math.min(w, h) * 0.95;

      const project = (px: number, py: number, pz: number) => {
        const dx = px - eyeX;
        const dy = py - eyeY;
        const dz = pz - eyeZ;

        const cz = dx * fn.x + dy * fn.y + dz * fn.z;
        if (cz <= 0.1) return { x: -9999, y: -9999, depth: cz, valid: false };

        const cx = dx * rn.x + dy * rn.y + dz * rn.z;
        const cy = dx * un.x + dy * un.y + dz * un.z;

        const screenX = w / 2 + (cx / cz) * focalDist;
        const screenY = h / 2 - (cy / cz) * focalDist;

        return { x: screenX, y: screenY, depth: cz, valid: true };
      };

      // 1. Draw Glowing Perspective Floor Grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.18)';

      const gridSize = 20;
      const step = 2.0;

      for (let gx = 0; gx <= gridSize; gx += step) {
        const p1 = project(gx, 0, 0);
        const p2 = project(gx, gridSize, 0);
        if (p1.valid && p2.valid) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      for (let gy = 0; gy <= gridSize; gy += step) {
        const p1 = project(0, gy, 0);
        const p2 = project(gridSize, gy, 0);
        if (p1.valid && p2.valid) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // Update Target Position & Evaluate Physics
      const tar = getTargetPositionAtTime(t);
      setCurrentTargetPos(tar);

      const evaluation = evaluateTargetPoint3D(
        cameraSpec,
        { x: tar.x, y: tar.y },
        warehouseObstacles,
        tar.z,
        targetType === 'forklift' ? 1.2 : 0.5
      );
      setCurrentEval(evaluation);

      // Camera Position in 3D
      const camP = cameraSpec.position;
      const camProj = project(camP.x, camP.y, camP.z);
      const poleBase = project(camP.x, camP.y, 0);

      // 2. Draw Camera Mount Pole & Housing
      if (poleBase.valid && camProj.valid) {
        ctx.beginPath();
        ctx.ellipse(poleBase.x, poleBase.y, 10, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
        ctx.fill();

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(poleBase.x, poleBase.y);
        ctx.lineTo(camProj.x, camProj.y);
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(camProj.x, camProj.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2;
        ctx.stroke();

        const azRad = (azimuthDeg * Math.PI) / 180;
        const tiltRad = (tiltDeg * Math.PI) / 180;
        const dirLen = 0.8;
        const lensP = project(
          camP.x + Math.sin(azRad) * Math.cos(tiltRad) * dirLen,
          camP.y + Math.cos(azRad) * Math.cos(tiltRad) * dirLen,
          camP.z - Math.sin(tiltRad) * dirLen
        );
        if (lensP.valid) {
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(camProj.x, camProj.y);
          ctx.lineTo(lensP.x, lensP.y);
          ctx.stroke();
        }
      }

      // 3. Draw 3D Volumetric Frustum Pyramid with Colored DORI Bands
      const azRad = (azimuthDeg * Math.PI) / 180;
      const tiltRad = (tiltDeg * Math.PI) / 180;
      const hfovRad = (fov.hfovDeg * Math.PI) / 180;
      const vfovRad = (fov.vfovDeg * Math.PI) / 180;

      const cf = {
        x: Math.sin(azRad) * Math.cos(tiltRad),
        y: Math.cos(azRad) * Math.cos(tiltRad),
        z: -Math.sin(tiltRad),
      };
      const cr = {
        x: Math.cos(azRad),
        y: -Math.sin(azRad),
        z: 0,
      };
      const cu = {
        x: -Math.sin(azRad) * Math.sin(tiltRad),
        y: -Math.cos(azRad) * Math.sin(tiltRad),
        z: -Math.cos(tiltRad),
      };

      const hpx = sensorSpec.resW;
      const maxDistDetect = Math.min(22, (hpx / (2 * 25 * Math.tan(hfovRad / 2))));
      const maxDistObserve = Math.min(16, (hpx / (2 * 62.5 * Math.tan(hfovRad / 2))));
      const maxDistRecognize = Math.min(11, (hpx / (2 * 125 * Math.tan(hfovRad / 2))));
      const maxDistIdentify = Math.min(6.5, (hpx / (2 * 250 * Math.tan(hfovRad / 2))));

      const frustumTiers = [
        { dist: maxDistIdentify, fill: 'rgba(0, 229, 255, 0.16)', stroke: 'rgba(0, 229, 255, 0.65)', label: 'IDENTIFY' },
        { dist: maxDistRecognize, fill: 'rgba(74, 222, 128, 0.12)', stroke: 'rgba(74, 222, 128, 0.55)', label: 'RECOGNIZE' },
        { dist: maxDistObserve, fill: 'rgba(250, 204, 21, 0.08)', stroke: 'rgba(250, 204, 21, 0.45)', label: 'OBSERVE' },
        { dist: maxDistDetect, fill: 'rgba(245, 158, 11, 0.06)', stroke: 'rgba(245, 158, 11, 0.35)', label: 'DETECT' },
      ];

      for (let i = frustumTiers.length - 1; i >= 0; i--) {
        const tier = frustumTiers[i];
        const d = tier.dist;
        const hw = d * Math.tan(hfovRad / 2);
        const vh = d * Math.tan(vfovRad / 2);

        const c1 = project(camP.x + cf.x * d - cr.x * hw - cu.x * vh, camP.y + cf.y * d - cr.y * hw - cu.y * vh, Math.max(0, camP.z + cf.z * d - cu.z * vh));
        const c2 = project(camP.x + cf.x * d + cr.x * hw - cu.x * vh, camP.y + cf.y * d + cr.y * hw - cu.y * vh, Math.max(0, camP.z + cf.z * d - cu.z * vh));
        const c3 = project(camP.x + cf.x * d + cr.x * hw + cu.x * vh, camP.y + cf.y * d + cr.y * hw + cu.y * vh, Math.max(0, camP.z + cf.z * d + cu.z * vh));
        const c4 = project(camP.x + cf.x * d - cr.x * hw + cu.x * vh, camP.y + cf.y * d - cr.y * hw + cu.y * vh, Math.max(0, camP.z + cf.z * d + cu.z * vh));

        if (c1.valid && c2.valid && c3.valid && c4.valid) {
          ctx.beginPath();
          ctx.moveTo(c1.x, c1.y);
          ctx.lineTo(c2.x, c2.y);
          ctx.lineTo(c3.x, c3.y);
          ctx.lineTo(c4.x, c4.y);
          ctx.closePath();
          ctx.fillStyle = tier.fill;
          ctx.fill();
          ctx.strokeStyle = tier.stroke;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          if (i === frustumTiers.length - 1 && camProj.valid) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
            [c1, c2, c3, c4].forEach(pt => {
              ctx.beginPath();
              ctx.moveTo(camProj.x, camProj.y);
              ctx.lineTo(pt.x, pt.y);
              ctx.stroke();
            });
            ctx.setLineDash([]);
          }
        }
      }

      // 4. Draw Warehouse Pallet Racks with Uprights, Shelves & Cargo Boxes
      const { rx, ry, rw, rd, rh, shelvesZ, cargoBoxes } = rackVisualModel;

      const uprights = [
        { x: rx, y: ry },
        { x: rx + rw, y: ry },
        { x: rx + rw, y: ry + rd },
        { x: rx, y: ry + rd },
      ];

      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 3;
      uprights.forEach(u => {
        const pBase = project(u.x, u.y, 0);
        const pTop = project(u.x, u.y, rh);
        if (pBase.valid && pTop.valid) {
          ctx.beginPath();
          ctx.moveTo(pBase.x, pBase.y);
          ctx.lineTo(pTop.x, pTop.y);
          ctx.stroke();
        }
      });

      shelvesZ.forEach(sz => {
        const s1 = project(rx, ry, sz);
        const s2 = project(rx + rw, ry, sz);
        const s3 = project(rx + rw, ry + rd, sz);
        const s4 = project(rx, ry + rd, sz);
        if (s1.valid && s2.valid && s3.valid && s4.valid) {
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });

      cargoBoxes.forEach(b => {
        const corners = [
          project(b.x, b.y, b.z),
          project(b.x + b.w, b.y, b.z),
          project(b.x + b.w, b.y + b.d, b.z),
          project(b.x, b.y + b.d, b.z),
          project(b.x, b.y, b.z + b.h),
          project(b.x + b.w, b.y, b.z + b.h),
          project(b.x + b.w, b.y + b.d, b.z + b.h),
          project(b.x, b.y + b.d, b.z + b.h),
        ];

        if (corners.every(c => c.valid)) {
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          ctx.lineTo(corners[1].x, corners[1].y);
          ctx.lineTo(corners[5].x, corners[5].y);
          ctx.lineTo(corners[4].x, corners[4].y);
          ctx.closePath();
          ctx.fillStyle = b.color;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(corners[4].x, corners[4].y);
          ctx.lineTo(corners[5].x, corners[5].y);
          ctx.lineTo(corners[6].x, corners[6].y);
          ctx.lineTo(corners[7].x, corners[7].y);
          ctx.closePath();
          ctx.globalAlpha = 0.95;
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }
      });

      // 5. Draw Patrolling Target (3D Human Worker with Hardhat & Hi-Vis Vest)
      const targetBase = project(tar.x, tar.y, 0);
      const targetTorso = project(tar.x, tar.y, 1.1);
      const targetHead = project(tar.x, tar.y, 1.65);

      if (targetBase.valid && targetHead.valid) {
        ctx.beginPath();
        ctx.ellipse(targetBase.x, targetBase.y, 12, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.fill();

        const ringPulse = (t * 0.8) % 1;
        ctx.beginPath();
        ctx.ellipse(targetBase.x, targetBase.y, 12 + ringPulse * 10, 6 + ringPulse * 5, 0, 0, Math.PI * 2);
        ctx.strokeStyle = evaluation.visibilityRatio > 0 ? 'rgba(0, 229, 255, 0.7)' : 'rgba(239, 68, 68, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (targetTorso.valid) {
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(targetBase.x, targetBase.y);
          ctx.lineTo(targetTorso.x, targetTorso.y);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(targetHead.x, targetHead.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 6. Draw 3 Multi-Height Laser Sightline Rays (Kay-Kajiya Ray-AABB Slab Math)
      if (camProj.valid && evaluation?.rayHits) {
        evaluation.rayHits.forEach(ray => {
          const samplePoint = project(tar.x, tar.y, ray.heightM);
          if (!samplePoint.valid) return;

          ctx.save();
          if (ray.blocked && ray.hitPoint) {
            const hitProj = project(ray.hitPoint.x, ray.hitPoint.y, ray.hitPoint.z);
            if (hitProj.valid) {
              ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
              ctx.lineWidth = 2;
              ctx.shadowColor = '#ef4444';
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.moveTo(camProj.x, camProj.y);
              ctx.lineTo(hitProj.x, hitProj.y);
              ctx.stroke();

              ctx.shadowBlur = 14;
              ctx.shadowColor = '#ef4444';
              ctx.fillStyle = '#ef4444';
              ctx.beginPath();
              ctx.arc(hitProj.x, hitProj.y, 4.5, 0, Math.PI * 2);
              ctx.fill();

              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(hitProj.x - 3, hitProj.y - 3);
              ctx.lineTo(hitProj.x + 3, hitProj.y + 3);
              ctx.moveTo(hitProj.x + 3, hitProj.y - 3);
              ctx.lineTo(hitProj.x - 3, hitProj.y + 3);
              ctx.stroke();
            }
          } else {
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.95)';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(camProj.x, camProj.y);
            ctx.lineTo(samplePoint.x, samplePoint.y);
            ctx.stroke();

            const phase = (t * 0.7 + (ray.heightM / 2)) % 1;
            const bx = camProj.x + (samplePoint.x - camProj.x) * phase;
            const by = camProj.y + (samplePoint.y - camProj.y) * phase;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(bx, by, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        });
      }

      ctx.restore();
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [
    yaw,
    pitch,
    zoom,
    isPlaying,
    targetSpeed,
    targetType,
    focalLengthMm,
    mountHeightM,
    tiltDeg,
    azimuthDeg,
    cameraSpec,
    warehouseObstacles,
    rackVisualModel,
    fov,
    sensorSpec,
    getTargetPositionAtTime,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => clamp(z * (e.deltaY > 0 ? 0.92 : 1.08), 0.4, 4.0));
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const evalData = currentEval || {
    inFrustum: true,
    visibilityRatio: 0.66,
    slantDistanceM: 11.7,
    groundDistanceM: 9.8,
    effectivePpm: 244,
    verticalDepressionDeg: 16.9,
    doriTier: 'RECOGNIZE' as const,
    personBBoxPx: { width: 122, height: 427 },
    aiFeasibility: { personTracking: true, ppeDetection: true, facialRecognition: false },
    rayHits: [],
  };

  const isOccluded = evalData.visibilityRatio < 1.0;
  const rayVisCount = evalData.rayHits
    ? `${evalData.rayHits.filter(r => !r.blocked).length}/${evalData.rayHits.length} Rays`
    : '2/3 Rays';

  return (
    <div
      ref={containerRef}
      className="w-full rounded-2xl border border-slate-800 bg-[#070b14] shadow-2xl overflow-hidden flex flex-col text-slate-100 font-sans"
    >
      {/* Header Block (matches user prototype screenshot) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0a0f1d] border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
            <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              CCTV Frustum & DORI Spatial Inspector
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Interactive 3D Warehouse Patrol & Optical Telemetry
          </p>
        </div>

        {/* Live Status Badges */}
        <div className="flex items-center gap-2.5">
          <span
            className={`px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase transition shadow-sm ${
              evalData.doriTier === 'IDENTIFY'
                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/60 shadow-cyan-900/50'
                : evalData.doriTier === 'RECOGNIZE'
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/60 shadow-emerald-900/50'
                : evalData.doriTier === 'OBSERVE'
                ? 'bg-amber-950/80 text-amber-300 border border-amber-500/60'
                : 'bg-rose-950/80 text-rose-300 border border-rose-500/60'
            }`}
          >
            {evalData.doriTier}
          </span>

          <span
            className={`px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase transition shadow-sm ${
              isOccluded
                ? 'bg-rose-950/90 text-rose-400 border border-rose-600/70 shadow-rose-950'
                : 'bg-emerald-950/90 text-emerald-400 border border-emerald-600/70 shadow-emerald-950'
            }`}
          >
            {isOccluded ? 'OCCLUDED' : 'CLEAR LOS'}
          </span>

          <button
            type="button"
            onClick={() => setShowPip(v => !v)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition flex items-center gap-1.5 ${
              showPip
                ? 'bg-sky-600 text-white border-sky-400 shadow-sm'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Toggle Picture-in-Picture Virtual CCTV View"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Virtual CCTV</span>
          </button>
        </div>
      </div>

      {/* Main 3D Viewport with Floating AI Telemetry HUD */}
      <div className="relative w-full h-[540px] bg-[#050811] overflow-hidden select-none">
        <canvas
          ref={canvasRef}
          className="block w-full h-full cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={e => {
            dragRef.current = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            const d = dragRef.current;
            if (!d) return;
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
            setYaw(d.yaw + (e.clientX - d.x) * 0.35);
            setPitch(clamp(d.pitch + (e.clientY - d.y) * 0.25, 5, 85));
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
        />

        {/* Floating AI TELEMETRY HUD (Matches exact prototype card from screenshot) */}
        <div className="absolute top-4 right-4 w-72 rounded-xl bg-[#090d19]/90 border border-slate-700/80 p-3.5 shadow-2xl backdrop-blur-md space-y-2.5">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
            <span className="text-[11px] font-mono font-bold tracking-wider text-cyan-400">
              AI TELEMETRY HUD
            </span>
            <span className="text-[10px] font-mono text-cyan-300 font-bold px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-800/80">
              {resolutionName}
            </span>
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Effective PPM:</span>
              <span className="font-bold text-white tracking-wide">{evalData.effectivePpm} px/m</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Slant Range:</span>
              <span className="font-bold text-white">{evalData.slantDistanceM} m</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Depression Angle:</span>
              <span className="font-bold text-white">{evalData.verticalDepressionDeg}°</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Est. Target Box:</span>
              <span className="font-bold text-white">
                {evalData.personBBoxPx.width}x{evalData.personBBoxPx.height} px
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Ray Visibility:</span>
              <span
                className={`font-bold ${
                  evalData.visibilityRatio === 1
                    ? 'text-emerald-400'
                    : evalData.visibilityRatio > 0
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {rayVisCount}
              </span>
            </div>
          </div>

          {/* AI Task Status Badges (Matches screenshot) */}
          <div className="pt-2 border-t border-slate-800 grid grid-cols-3 gap-1.5 text-center">
            <div>
              <div className="text-[9px] font-mono text-slate-500 mb-0.5">FACE ID</div>
              <span
                className={`block py-1 rounded text-[10px] font-mono font-bold ${
                  evalData.aiFeasibility.facialRecognition
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950/90 text-rose-400 border border-rose-800'
                }`}
              >
                {evalData.aiFeasibility.facialRecognition ? 'PASS' : 'FAIL'}
              </span>
            </div>

            <div>
              <div className="text-[9px] font-mono text-slate-500 mb-0.5">PPE SAFETY</div>
              <span
                className={`block py-1 rounded text-[10px] font-mono font-bold ${
                  evalData.aiFeasibility.ppeDetection
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950/90 text-rose-400 border border-rose-800'
                }`}
              >
                {evalData.aiFeasibility.ppeDetection ? 'PASS' : 'FAIL'}
              </span>
            </div>

            <div>
              <div className="text-[9px] font-mono text-slate-500 mb-0.5">BYTETRACK</div>
              <span
                className={`block py-1 rounded text-[10px] font-mono font-bold ${
                  evalData.aiFeasibility.personTracking
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : evalData.visibilityRatio > 0
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : 'bg-rose-950/90 text-rose-400 border border-rose-800'
                }`}
              >
                {evalData.aiFeasibility.personTracking
                  ? 'LOCKED'
                  : evalData.visibilityRatio > 0
                  ? 'DEGRADED'
                  : 'LOST'}
              </span>
            </div>
          </div>
        </div>

        {/* Floating Picture-in-Picture Virtual CCTV Monitor */}
        {showPip && (
          <div className="absolute bottom-10 left-4 w-60 rounded-xl bg-slate-950/90 border border-cyan-800/70 p-2.5 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between pb-1 mb-1.5 border-b border-slate-800 text-[10px] font-mono">
              <span className="text-cyan-400 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                CAM-01 LIVE RTSP
              </span>
              <span className="text-slate-400">{evalData.slantDistanceM}m</span>
            </div>

            {/* Synthetic Perspective Viewport of Target */}
            <div className="relative w-full h-28 bg-[#0a0f1d] rounded border border-slate-800 flex items-center justify-center overflow-hidden">
              <div className="absolute top-1 left-1.5 text-[8px] font-mono text-slate-500">
                REC [H.265+] {sensorSpec.resW}x{sensorSpec.resH}
              </div>

              {/* Bounding Box Overlay */}
              {evalData.inFrustum ? (
                <div
                  className={`relative flex flex-col items-center justify-center transition-all ${
                    evalData.visibilityRatio === 1
                      ? 'border-2 border-emerald-400'
                      : evalData.visibilityRatio > 0
                      ? 'border-2 border-amber-400 border-dashed'
                      : 'border-2 border-rose-500 border-dotted'
                  }`}
                  style={{
                    width: `${clamp(Math.round(evalData.personBBoxPx.width * 0.35), 28, 90)}px`,
                    height: `${clamp(Math.round(evalData.personBBoxPx.height * 0.35), 45, 95)}px`,
                  }}
                >
                  <span className="absolute -top-3.5 left-0 text-[8px] font-mono font-bold bg-slate-900 px-1 rounded text-cyan-300">
                    {targetType.toUpperCase()} {(evalData.visibilityRatio * 100).toFixed(0)}%
                  </span>
                  <div className="text-[9px] font-bold text-center">
                    {targetType === 'forklift' ? '🚜' : targetType === 'intruder' ? '⚠️' : '👷'}
                  </div>
                  <span className="absolute -bottom-3 text-[7px] font-mono text-slate-400">
                    {evalData.effectivePpm} px/m
                  </span>
                </div>
              ) : (
                <span className="text-[10px] font-mono text-slate-500">Target Outside FOV</span>
              )}
            </div>
          </div>
        )}

        {/* Viewport Orbit & Zoom Navigation Hint */}
        <div className="absolute bottom-2 right-4 text-[11px] font-mono text-slate-500">
          Drag to orbit scene | Scroll to zoom
        </div>
      </div>

      {/* Bottom Interactive Control Sliders (Matches exact prototype layout from screenshot) */}
      <div className="p-5 bg-[#0a0f1d] border-t border-slate-800 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Slider 1: Focal Length */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-medium">Focal Length</span>
              <span className="font-bold text-cyan-400">{focalLengthMm.toFixed(1)} mm</span>
            </div>
            <input
              type="range"
              min="2.8"
              max="12.0"
              step="0.1"
              value={focalLengthMm}
              onChange={e => handleFocalChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-500">
              <span>2.8mm (Wide {fov.hfovDeg}°)</span>
              <span>12.0mm (Tele)</span>
            </div>
          </div>

          {/* Slider 2: Mount Height */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-medium">Mount Height</span>
              <span className="font-bold text-cyan-400">{mountHeightM.toFixed(1)} m</span>
            </div>
            <input
              type="range"
              min="2.0"
              max="10.0"
              step="0.1"
              value={mountHeightM}
              onChange={e => handleHeightChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-500">
              <span>2.0m (Eye-level)</span>
              <span>10.0m (High-Bay)</span>
            </div>
          </div>

          {/* Slider 3: Down-Tilt Angle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-medium">Down-Tilt Angle</span>
              <span className="font-bold text-cyan-400">{tiltDeg}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="80"
              step="1"
              value={tiltDeg}
              onChange={e => handleTiltChange(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-500">
              <span>0° (Horizon)</span>
              <span>80° (Nadir Cutoff)</span>
            </div>
          </div>
        </div>

        {/* Secondary Navigation & Patrol Toolbar */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Patrol Target:</span>
            {(['worker', 'forklift', 'intruder'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTargetType(t)}
                className={`px-2.5 py-1 rounded-md transition ${
                  targetType === t
                    ? 'bg-sky-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {t === 'worker' ? '👷 Worker' : t === 'forklift' ? '🚜 Forklift' : '⚠️ Intruder'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPlaying(p => !p)}
              className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 border border-slate-700"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
              <span>{isPlaying ? 'Pause Patrol' : 'Play Patrol'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setYaw(-38);
                setPitch(24);
                setZoom(1.1);
              }}
              className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800"
              title="Reset 3D Viewport"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

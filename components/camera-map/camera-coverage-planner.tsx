'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { 
  Camera, 
  RotateCcw, 
  Download, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Layers, 
  Sparkles,
  ChevronDown,
  ChevronUp,
  Share2,
  Plus,
  Trash2,
  Sliders,
  ShieldCheck,
  Eye,
  Crosshair
} from 'lucide-react';
import type { Camera as ProjectCamera, DetVisionProject } from '@/lib/types';
import {
  computeCoverage,
  optimizeLayout,
  defaultLayout,
  defaultPose,
  MOUNT_INFO,
  type CameraPose,
  type MountType,
  type DoriMode,
  type LensSpec,
  type SiteSpec,
  type CoverageResult,
  DORI_PPM,
  LEVEL_NAMES,
  refocusLens,
} from '@/lib/coverage-engine';
import {
  TopView,
  SideView,
  PerspectiveView,
  camColor,
  CAM_COLORS
} from './coverage-views';

interface CameraCoveragePlannerProps {
  project?: DetVisionProject;
  onApplyToProject?: (cameras: ProjectCamera[]) => void;
  onClose?: () => void;
}

export function CameraCoveragePlanner({ project, onApplyToProject, onClose }: CameraCoveragePlannerProps) {
  // Global site specifications
  const [bayLength, setBayLength] = useState(90);
  const [bayWidth, setBayWidth] = useState(10);
  const [mountHeight, setMountHeight] = useState(4.0);
  const [targetHeight, setTargetHeight] = useState(1.5); // Target inspection plane (e.g. 1.5m for human/PPE)
  const [marginPct, setMarginPct] = useState(10); // Overlap margin
  const [mode, setMode] = useState<DoriMode>('recognize');
  const [cameraCount, setCameraCount] = useState(5);

  // Camera lens specifications
  const [lens, setLens] = useState<LensSpec>({
    focalMm: 2.8,
    hfovDeg: 106,
    vfovDeg: 56,
    ranges: {
      detect: 88,
      observe: 35.2,
      recognize: 17.6,
      identify: 8.8,
    },
  });

  // Site definition
  const site: SiteSpec = useMemo(() => ({
    length: bayLength,
    width: bayWidth,
    mountHeight,
    targetHeight,
    marginPct,
    obstacles: project?.structure
      ? project.structure
          .filter(s => s.type === 'obstacle' && s.points.length >= 2)
          .map((s, idx) => {
            const xs = s.points.map(p => p.x * bayLength);
            const ys = s.points.map(p => p.y * bayWidth);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            return {
              id: s.id || `obs-${idx}`,
              name: s.name || `Obstacle ${idx + 1}`,
              x: minX,
              y: minY,
              w: Math.max(0.5, maxX - minX),
              d: Math.max(0.5, maxY - minY),
              h: 3.5, // Standard industrial obstacle height
            };
          })
      : [],
  }), [bayLength, bayWidth, mountHeight, targetHeight, marginPct, project?.structure]);

  // Camera poses (initialized with mathematically sound defaults)
  const [poses, setPoses] = useState<CameraPose[]>(() => 
    defaultLayout(5, { length: 90, width: 10, mountHeight: 4.0, targetHeight: 1.5, marginPct: 10, obstacles: [] }, {
      focalMm: 2.8,
      hfovDeg: 106,
      vfovDeg: 56,
      ranges: { detect: 88, observe: 35.2, recognize: 17.6, identify: 8.8 },
    }, 'recognize')
  );

  // UI state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<'top' | 'side' | '3d'>('top');
  const [activeDetTab, setActiveDetTab] = useState<'table' | 'list' | 'reco' | 'legend'>('table');
  const [heatMode, setHeatMode] = useState<'dori' | 'overlap'>('dori');
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Compute coverage whenever parameters change (deterministic pure calculation)
  const result: CoverageResult = useMemo(() => {
    return computeCoverage(poses, lens, site, mode);
  }, [poses, lens, site, mode]);

  // Update camera count and re-distribute
  const handleCameraCountChange = (count: number) => {
    const c = Math.max(1, Math.min(100, count));
    setCameraCount(c);
    setPoses(defaultLayout(c, site, lens, mode));
    setSelectedId(null);
  };

  // Re-aim or update pose
  const handlePoseChange = (id: number, updates: Partial<CameraPose>) => {
    setPoses(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // Update mount type
  const handleMountChange = (id: number, mount: MountType) => {
    setPoses(prev => prev.map(p => {
      if (p.id !== id) return p;
      return defaultPose(mount, id, p.x, prev.length, site, lens, mode);
    }));
  };

  // Move camera position (drag from TopView)
  const handleMoveCamera = useCallback((id: number, x: number, y: number) => {
    setPoses(prev => prev.map(p => p.id === id ? { ...p, x, y } : p));
  }, []);

  // Run deterministic greedy set-cover optimizer (0 LLM tokens, optimal >= 95% coverage)
  const handleOptimize = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      const opt = optimizeLayout(lens, site, mode, { targetPct: 95, maxCameras: 60 });
      if (opt.poses.length > 0) {
        setPoses(opt.poses);
        setCameraCount(opt.poses.length);
        setSelectedId(null);
      }
      setIsOptimizing(false);
    }, 40);
  };

  // Refocus lens (adjust focal length & re-derive HFOV and DORI ranges)
  const handleFocalChange = (newFocal: number) => {
    const next = refocusLens(lens, newFocal);
    setLens(next);
  };

  // Sync to Konva project canvas
  const handleApplyToCanvas = () => {
    if (!onApplyToProject) return;
    const projectCameras: ProjectCamera[] = poses.map((p, idx) => {
      const normX = Math.max(0.02, Math.min(0.98, p.x / bayLength));
      const normY = Math.max(0.02, Math.min(0.98, p.y / bayWidth));
      const st = result.cameras[idx];

      return {
        id: crypto.randomUUID(),
        name: `CAM-${p.id} (${p.mount.toUpperCase()})`,
        x: normX,
        y: normY,
        orientation_degrees: (p.panDeg + 360) % 360,
        horizontal_fov_degrees: lens.hfovDeg,
        view_range: Math.min(0.9, Math.max(0.15, (st?.effectiveRange || 20) / bayLength)),
        resolution_width: Math.round(result.metrics.impliedHpx) || 1920,
        resolution_height: 1080,
        status: 'planned',
        target_area: `Position ${p.x.toFixed(1)}m, ${p.y.toFixed(1)}m`,
        assigned_use_case_ids: [],
        rationale: `Exact coverage: span ${st ? (st.coverEnd - st.coverStart).toFixed(1) : ''}m, near-blind ${st ? st.nearBlind.toFixed(1) : ''}m. ${MOUNT_INFO[p.mount].tip}`
      };
    });

    onApplyToProject(projectCameras);
  };

  // Export full technical engineering blueprint
  const handleExportReport = () => {
    const m = result.metrics;
    let r = `══════════════════════════════════════════════════════════════════════════════
  CAMERA COVERAGE PLANNER — DETERMINISTIC GEOMETRY REPORT v3.0
  Generated: ${new Date().toLocaleString()}
  Compliance: IEC EN 62676-4 Pixel Density Standards
══════════════════════════════════════════════════════════════════════════════

FACILITY & SITE PARAMETERS
  Bay Length:         ${bayLength} m
  Bay Width:          ${bayWidth} m
  Mounting Height:    ${mountHeight} m
  Target Plane:       ${targetHeight} m (PPE / Face Height)
  Boundary Margin:    ${marginPct}% derating
  Total Area:         ${m.totalArea} m² (Coverable: ${m.coverableArea.toFixed(1)} m²)

OPTICAL SPECIFICATIONS
  Lens:               ${lens.focalMm} mm (HFOV: ${lens.hfovDeg}°, VFOV: ${lens.vfovDeg}°)
  Effective Pixels:   ~${Math.round(m.impliedHpx)} px horizontal
  Active Mode:        ${mode.toUpperCase()} (Target: ${DORI_PPM[mode]} px/m)
  Published Ranges:   Detect: ${lens.ranges.detect}m | Observe: ${lens.ranges.observe}m
                      Recognize: ${lens.ranges.recognize}m | Identify: ${lens.ranges.identify}m

PERFORMANCE METRICS
  Total Cameras:      ${m.cameras}
  Area Coverage:      ${m.coveragePct.toFixed(1)}% (${m.coveredArea.toFixed(1)} m²)
  Blind Spot:         ${m.blindPct.toFixed(1)}%
  Redundant Overlap:  ${m.overlapPct.toFixed(1)}% (≥2 cameras)
  Length Coverage:    ${m.lengthCoveragePct.toFixed(1)}% (Largest unmonitored gap: ${m.largestGapM.toFixed(1)} m)
  Camera Efficiency:  ${m.efficiency.toFixed(1)}% per camera

DORI BREAKDOWN (% of facility meeting or exceeding level)
  [4] Identify   (≥250 px/m):  ${m.doriPct[4].toFixed(1)}%
  [3] Recognize  (≥125 px/m):  ${m.doriPct[3].toFixed(1)}%
  [2] Observe    (≥62.5 px/m): ${m.doriPct[2].toFixed(1)}%
  [1] Detect     (≥25 px/m):   ${m.doriPct[1].toFixed(1)}%

CAMERA INVENTORY & GEOMETRIC SCHEDULE
──────────────────────────────────────────────────────────────────────────────
`;

    poses.forEach((p, idx) => {
      const st = result.cameras[idx];
      r += `Camera ${p.id.toString().padEnd(3)} | Mount: ${p.mount.toUpperCase().padEnd(12)} | Pan: ${p.panDeg}° | Tilt: ${p.tiltDeg}°
  Coordinates:    x=${p.x.toFixed(2)}m, y=${p.y.toFixed(2)}m, z=${p.z.toFixed(2)}m
  Coverage Span:  ${st ? st.coverStart.toFixed(2) : '0'}m → ${st ? st.coverEnd.toFixed(2) : '0'}m (Span: ${st ? (st.coverEnd - st.coverStart).toFixed(2) : '0'}m)
  Blind Zone:     ${st && st.nearBlind > 0 ? `${st.nearBlind.toFixed(2)}m from base` : 'Zero dead-zone directly under mount'}
  Far Reach:      ${st ? st.farReach.toFixed(2) : '0'}m
  Covered Area:   ${st ? st.coveredArea.toFixed(1) : '0'} m² (${st ? st.uniqueArea.toFixed(1) : '0'} m² unique)
${'─'.repeat(78)}\n`;
    });

    const blob = new Blob([r], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Camera_Coverage_Blueprint_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedPose = poses.find(p => p.id === selectedId);
  const selectedStats = selectedId != null ? result.cameras.find(c => c.id === selectedId) : null;

  return (
    <div className="flex flex-col h-full bg-[#070a10] text-[#e2e8f0] font-sans overflow-hidden">
      {/* Top Mission Control Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 border-b border-[#1e293b] bg-[#0d1220]/90 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-500/20">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-tight text-white flex items-center gap-2">
              Coverage <span className="text-[#00e5ff]">Planner</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#00e5ff]/40 bg-[#00e5ff]/10 text-[#00e5ff] font-bold">
                ENGINE v3.0
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#ff6b35]/40 bg-[#ff6b35]/10 text-[#ff6b35] font-bold">
                IEC EN 62676-4
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#64748b]">
              Exact pinhole frustums · 3D obstacle occlusion · Pure deterministic mathematics
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOptimize}
            disabled={isOptimizing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold text-xs hover:opacity-90 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            title="Automatically solve the Art Gallery problem for >= 95% coverage with minimum cameras"
          >
            <Sparkles className="w-3.5 h-3.5 fill-current" />
            {isOptimizing ? 'Optimizing…' : '⚡ Auto-Solve (≥95%)'}
          </button>

          {onApplyToProject && (
            <button
              onClick={handleApplyToCanvas}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00e5ff] text-[#070a10] font-bold text-xs hover:bg-[#33ecff] transition-all shadow-lg shadow-cyan-500/20"
              title="Sync calculated camera positions and optical cones to the project interactive canvas"
            >
              <Share2 className="w-3.5 h-3.5" />
              Sync to Canvas
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-[#252c3f] bg-[#121826] text-xs font-semibold hover:border-[#00e5ff] text-slate-300 hover:text-white transition-colors"
            >
              Back to Map
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Controls & Right Visualizer */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 p-4 overflow-y-auto min-h-0">
        
        {/* Left Column: Interactive Parameters */}
        <div className="flex flex-col gap-3.5 overflow-y-auto pr-1">
          
          {/* Facility & Target Height */}
          <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b] text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#ff6b35]" />
                Facility & Target Geometry
              </div>
            </div>
            <div className="p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Bay Length (m)</label>
                  <input
                    type="number"
                    min="5"
                    max="500"
                    value={bayLength}
                    onChange={e => setBayLength(Math.max(5, parseFloat(e.target.value) || 90))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2.5 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Bay Width (m)</label>
                  <input
                    type="number"
                    min="2"
                    max="150"
                    value={bayWidth}
                    onChange={e => setBayWidth(Math.max(2, parseFloat(e.target.value) || 10))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2.5 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Mount H (m)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="30"
                    value={mountHeight}
                    onChange={e => setMountHeight(Math.max(1, parseFloat(e.target.value) || 4))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Target H (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={targetHeight}
                    onChange={e => setTargetHeight(Math.max(0, parseFloat(e.target.value) || 1.5))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    title="Inspection height (0m = floor ground, 1.5m = face/PPE inspection)"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Margin (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={marginPct}
                    onChange={e => setMarginPct(Math.max(0, Math.min(50, parseFloat(e.target.value) || 10)))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                    title="Derating margin for boundary overlap"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1e293b]/60">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Monitoring Mode</label>
                  <select
                    value={mode}
                    onChange={e => setMode(e.target.value as DoriMode)}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none font-bold"
                  >
                    <option value="detect">Detect (25 px/m)</option>
                    <option value="observe">Observe (62.5 px/m)</option>
                    <option value="recognize">Recognize (125 px/m)</option>
                    <option value="identify">Identify (250 px/m)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Camera Count</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={cameraCount}
                    onChange={e => handleCameraCountChange(parseInt(e.target.value) || 5)}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none font-bold"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Camera Specifications & Lens Physics */}
          <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b] text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#00e5ff]" />
                Lens Physics & DORI Standard
              </div>
              <span className="text-[10px] font-mono text-cyan-400">~{Math.round(result.metrics.impliedHpx)} px</span>
            </div>
            <div className="p-3 space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">Focal (mm)</label>
                  <input
                    type="number"
                    step="0.4"
                    min="1.8"
                    max="50"
                    value={lens.focalMm}
                    onChange={e => handleFocalChange(parseFloat(e.target.value) || 2.8)}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">H-FOV (°)</label>
                  <input
                    type="number"
                    value={lens.hfovDeg}
                    onChange={e => setLens(l => ({ ...l, hfovDeg: parseFloat(e.target.value) || 106 }))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[#64748b] mb-1">V-FOV (°)</label>
                  <input
                    type="number"
                    value={lens.vfovDeg}
                    onChange={e => setLens(l => ({ ...l, vfovDeg: parseFloat(e.target.value) || 56 }))}
                    className="w-full bg-[#121826] border border-[#252c3f] rounded px-2 py-1 text-xs font-mono text-white focus:border-[#00e5ff] outline-none"
                  />
                </div>
              </div>

              {/* Published Ranges Display */}
              <div className="grid grid-cols-4 gap-1.5 text-center pt-1 border-t border-[#1e293b]/60">
                <div className="bg-[#121826] p-1.5 rounded border border-[#1e293b]">
                  <div className="text-[8px] font-mono text-amber-400">DETECT</div>
                  <div className="text-xs font-mono font-bold text-white">{lens.ranges.detect}m</div>
                </div>
                <div className="bg-[#121826] p-1.5 rounded border border-[#1e293b]">
                  <div className="text-[8px] font-mono text-yellow-400">OBSERVE</div>
                  <div className="text-xs font-mono font-bold text-white">{lens.ranges.observe}m</div>
                </div>
                <div className="bg-[#121826] p-1.5 rounded border border-[#1e293b]">
                  <div className="text-[8px] font-mono text-emerald-400">RECOGNIZE</div>
                  <div className="text-xs font-mono font-bold text-white">{lens.ranges.recognize}m</div>
                </div>
                <div className="bg-[#121826] p-1.5 rounded border border-[#1e293b]">
                  <div className="text-[8px] font-mono text-cyan-400">IDENTIFY</div>
                  <div className="text-xs font-mono font-bold text-white">{lens.ranges.identify}m</div>
                </div>
              </div>
            </div>
          </div>

          {/* Per-Camera Mount Cards */}
          <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b] text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#7fff6b]" />
                Per-Camera Mount Schedule ({poses.length})
              </div>
              <button
                onClick={() => {
                  const nextId = poses.length + 1;
                  setPoses(prev => [...prev, defaultPose('wall-h', nextId, bayLength / 2, nextId, site, lens, mode)]);
                  setCameraCount(c => c + 1);
                }}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono"
              >
                <Plus className="w-3 h-3" /> Add Cam
              </button>
            </div>

            <div className="p-2.5 max-h-[380px] overflow-y-auto space-y-2">
              {poses.map((p, idx) => {
                const color = camColor(p.id);
                const info = MOUNT_INFO[p.mount];
                const isSelected = p.id === selectedId;
                const st = result.cameras[idx];

                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedId(isSelected ? null : p.id)}
                    className={`rounded-md border p-2.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-cyan-400 bg-cyan-950/20 shadow-md shadow-cyan-500/10'
                        : 'border-[#1e293b] bg-[#121826]/70 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] font-bold text-slate-950"
                          style={{ backgroundColor: color }}
                        >
                          {p.id}
                        </div>
                        <span className="text-xs font-bold" style={{ color }}>
                          Camera {p.id}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          x={p.x.toFixed(1)}m, y={p.y.toFixed(1)}m
                        </span>
                      </div>
                      <div className="text-[10px] font-mono font-bold text-cyan-400">
                        {info.short}
                      </div>
                    </div>

                    {/* Quick Metrics */}
                    <div className="text-[9px] font-mono text-slate-400 flex items-center justify-between">
                      <span>Span: {st ? (st.coverEnd - st.coverStart).toFixed(1) : '0'}m</span>
                      <span>Blind: {st ? st.nearBlind.toFixed(1) : '0'}m</span>
                      <span>Reach: {st ? st.farReach.toFixed(1) : '0'}m</span>
                    </div>

                    {/* Expanded Controls when Selected */}
                    {isSelected && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2" onClick={e => e.stopPropagation()}>
                        {/* Mount Type Selector */}
                        <div className="grid grid-cols-4 gap-1">
                          {(Object.keys(MOUNT_INFO) as MountType[]).map(mKey => (
                            <button
                              key={mKey}
                              type="button"
                              onClick={() => handleMountChange(p.id, mKey)}
                              className={`p-1 rounded text-[8px] font-bold border transition-all ${
                                p.mount === mKey
                                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                                  : 'border-[#1e293b] bg-[#0d1220] text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              {MOUNT_INFO[mKey].label.split(' ')[0]}
                            </button>
                          ))}
                        </div>

                        {/* Pan and Tilt Sliders */}
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-slate-400 w-12">Pan</span>
                            <input
                              type="range"
                              min="0"
                              max="359"
                              value={p.panDeg}
                              onChange={e => handlePoseChange(p.id, { panDeg: parseFloat(e.target.value) })}
                              className="flex-1 accent-cyan-400"
                            />
                            <span className="text-[10px] font-mono text-cyan-400 w-8 text-right">{p.panDeg}°</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-slate-400 w-12">Tilt</span>
                            <input
                              type="range"
                              min="-60"
                              max="90"
                              value={p.tiltDeg}
                              onChange={e => handlePoseChange(p.id, { tiltDeg: parseFloat(e.target.value) })}
                              className="flex-1 accent-cyan-400"
                            />
                            <span className="text-[10px] font-mono text-cyan-400 w-8 text-right">{p.tiltDeg}°</span>
                          </div>
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPoses(prev => prev.filter(c => c.id !== p.id));
                              setCameraCount(c => c - 1);
                              setSelectedId(null);
                            }}
                            className="text-[9px] text-rose-400 hover:text-rose-300 font-mono flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Remove Camera
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1 pb-4">
            <button
              onClick={() => {
                setPoses(defaultLayout(cameraCount, site, lens, mode));
                setSelectedId(null);
              }}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#121826] border border-[#1e293b] text-slate-300 hover:text-white hover:border-cyan-400 text-xs font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              ↺ Reset Layout
            </button>
            <button
              onClick={handleExportReport}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#121826] border border-[#1e293b] text-slate-300 hover:text-white hover:border-cyan-400 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              ↓ Full Blueprint
            </button>
          </div>
        </div>

        {/* Right Column: Visualization & Mathematical Metrics */}
        <div className="flex flex-col gap-3.5 overflow-y-auto">
          
          {/* Top KPI Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg p-3 shadow-lg">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Cameras</div>
              <div className="text-2xl font-mono font-extrabold text-[#00e5ff] leading-none">
                {result.metrics.cameras}
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">active mounts</div>
            </div>

            <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg p-3 shadow-lg">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Coverage</div>
              <div className="text-2xl font-mono font-extrabold text-[#7fff6b] leading-none">
                {result.metrics.coveragePct.toFixed(1)}%
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                {result.metrics.coveredArea.toFixed(0)} / {result.metrics.totalArea} m²
              </div>
            </div>

            <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg p-3 shadow-lg">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Blind Spot</div>
              <div className="text-2xl font-mono font-extrabold text-[#ff4757] leading-none">
                {result.metrics.blindPct.toFixed(1)}%
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                gap: {result.metrics.largestGapM.toFixed(1)}m max
              </div>
            </div>

            <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg p-3 shadow-lg">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#64748b] mb-1">Efficiency</div>
              <div className="text-2xl font-mono font-extrabold text-[#ffd60a] leading-none">
                {result.metrics.efficiency.toFixed(1)}%
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">coverage / camera</div>
            </div>
          </div>

          {/* Alert Status Banner */}
          {result.metrics.blindPct === 0 ? (
            <div className="bg-emerald-950/30 border-l-4 border-[#7fff6b] text-[#9ef090] p-3 rounded text-xs font-mono flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#7fff6b]" />
                <span>✓ Perfect — zero blind spots achieved across all {bayLength}m × {bayWidth}m at {mode.toUpperCase()} level.</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-400">100% SECURE</span>
            </div>
          ) : result.metrics.blindPct < 10 ? (
            <div className="bg-amber-950/30 border-l-4 border-[#ffd60a] text-[#ffe15a] p-3 rounded text-xs font-mono flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-[#ffd60a]" />
                <span>⚠ Only {result.metrics.blindPct.toFixed(1)}% blind spots remain. Adding 1 camera or widening HFOV fills the gap.</span>
              </div>
              <button onClick={handleOptimize} className="underline text-[10px] font-bold hover:text-white">Auto-Solve</button>
            </div>
          ) : (
            <div className="bg-rose-950/30 border-l-4 border-[#ff4757] text-[#ff7a85] p-3 rounded text-xs font-mono flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0 text-[#ff4757]" />
                <span>✗ {result.metrics.blindPct.toFixed(1)}% coverage gap. Adjust camera mount angles or click Auto-Solve.</span>
              </div>
              <button onClick={handleOptimize} className="underline text-[10px] font-bold hover:text-white">Auto-Solve (≥95%)</button>
            </div>
          )}

          {/* Main Visualizer: Top / Side / 3D Canvas Tabs */}
          <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1e293b] px-3 bg-[#121826]">
              <div className="flex items-center gap-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                <div className="w-2 h-2 rounded-full bg-[#ff6b35]" />
                Precision Multi-Angle Simulation
              </div>

              {/* View & Heatmap Controls */}
              <div className="flex items-center gap-3">
                {activeViewTab === 'top' && (
                  <div className="flex items-center bg-[#070a10] rounded p-0.5 border border-[#1e293b] text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setHeatMode('dori')}
                      className={`px-2 py-0.5 rounded ${heatMode === 'dori' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'}`}
                    >
                      DORI Resolution
                    </button>
                    <button
                      type="button"
                      onClick={() => setHeatMode('overlap')}
                      className={`px-2 py-0.5 rounded ${heatMode === 'overlap' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400'}`}
                    >
                      Redundancy
                    </button>
                  </div>
                )}

                <div className="flex border-l border-[#1e293b] pl-2">
                  <button
                    onClick={() => setActiveViewTab('top')}
                    className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                      activeViewTab === 'top'
                        ? 'border-[#00e5ff] text-[#00e5ff]'
                        : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Top View
                  </button>
                  <button
                    onClick={() => setActiveViewTab('side')}
                    className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                      activeViewTab === 'side'
                        ? 'border-[#00e5ff] text-[#00e5ff]'
                        : 'border-transparent text-[#64748b] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Side Elevation
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
            </div>

            {/* Canvas Panels */}
            <div className="p-3 bg-[#070a10]">
              {activeViewTab === 'top' && (
                <TopView
                  result={result}
                  poses={poses}
                  lens={lens}
                  site={site}
                  mode={mode}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onMove={handleMoveCamera}
                  heatMode={heatMode}
                />
              )}

              {activeViewTab === 'side' && (
                <SideView
                  result={result}
                  poses={poses}
                  lens={lens}
                  site={site}
                  mode={mode}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}

              {activeViewTab === '3d' && (
                <PerspectiveView
                  result={result}
                  poses={poses}
                  lens={lens}
                  site={site}
                  mode={mode}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  heatMode={heatMode}
                />
              )}
            </div>
          </div>

          {/* Details & Specifications Tabs */}
          <div className="bg-[#0d1220] border border-[#1e293b] rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between border-b border-[#1e293b] px-3 bg-[#121826]">
              <div className="flex items-center gap-2 py-2 text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                <div className="w-2 h-2 rounded-full bg-[#c084fc]" />
                Engineering Breakdown
              </div>
              <div className="flex">
                <button
                  onClick={() => setActiveDetTab('table')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'table' ? 'border-[#00e5ff] text-[#00e5ff]' : 'border-transparent text-[#64748b] hover:text-white'
                  }`}
                >
                  Summary Table
                </button>
                <button
                  onClick={() => setActiveDetTab('list')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'list' ? 'border-[#00e5ff] text-[#00e5ff]' : 'border-transparent text-[#64748b] hover:text-white'
                  }`}
                >
                  Full Details
                </button>
                <button
                  onClick={() => setActiveDetTab('reco')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'reco' ? 'border-[#00e5ff] text-[#00e5ff]' : 'border-transparent text-[#64748b] hover:text-white'
                  }`}
                >
                  Recommendations
                </button>
                <button
                  onClick={() => setActiveDetTab('legend')}
                  className={`px-3 py-2 text-xs font-bold transition-all border-b-2 ${
                    activeDetTab === 'legend' ? 'border-[#00e5ff] text-[#00e5ff]' : 'border-transparent text-[#64748b] hover:text-white'
                  }`}
                >
                  DORI Legend
                </button>
              </div>
            </div>

            <div className="p-3">
              {/* Summary Table */}
              {activeDetTab === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#1e293b] bg-[#121826] text-[#00e5ff] text-[10px] uppercase">
                        <th className="p-2">#</th>
                        <th className="p-2">Position (X, Y)</th>
                        <th className="p-2">Height</th>
                        <th className="p-2">Mount Type</th>
                        <th className="p-2">Pan / Tilt</th>
                        <th className="p-2">Coverage Span</th>
                        <th className="p-2">Near Blind</th>
                        <th className="p-2">Area</th>
                        <th className="p-2">Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e293b]/60">
                      {poses.map((p, idx) => {
                        const col = camColor(p.id);
                        const st = result.cameras[idx];
                        const span = st ? (st.coverEnd - st.coverStart).toFixed(1) : '0';
                        return (
                          <tr
                            key={p.id}
                            onClick={() => setSelectedId(p.id)}
                            className={`cursor-pointer transition-colors ${
                              selectedId === p.id ? 'bg-cyan-950/30' : 'hover:bg-[#121826]/60'
                            }`}
                          >
                            <td className="p-2 font-bold" style={{ color: col }}>
                              ▌{p.id}
                            </td>
                            <td className="p-2 text-slate-300">
                              {p.x.toFixed(1)}m, {p.y.toFixed(1)}m
                            </td>
                            <td className="p-2 text-slate-300">{p.z.toFixed(1)}m</td>
                            <td className="p-2 font-bold text-cyan-400">
                              {p.mount.toUpperCase()}
                            </td>
                            <td className="p-2 text-slate-300">
                              {p.panDeg}°, {p.tiltDeg}°
                            </td>
                            <td className="p-2 font-bold text-[#7fff6b]">{span}m</td>
                            <td className="p-2 text-slate-300">
                              {st && st.nearBlind > 0 ? `${st.nearBlind.toFixed(1)}m` : '0m'}
                            </td>
                            <td className="p-2 text-slate-300">
                              {st ? `${st.coveredArea.toFixed(0)} m²` : '0'}
                            </td>
                            <td className="p-2 text-cyan-300 font-bold">
                              {st ? `${Math.round(st.ppmAtAxis)} px/m` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Full Camera Details */}
              {activeDetTab === 'list' && (
                <div className="space-y-2">
                  {poses.map((p, idx) => {
                    const col = camColor(p.id);
                    const st = result.cameras[idx];
                    const info = MOUNT_INFO[p.mount];

                    return (
                      <div key={p.id} className="p-3 bg-[#121826] border border-[#1e293b] rounded flex gap-3 items-start">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold text-slate-950 shrink-0"
                          style={{ backgroundColor: col }}
                        >
                          {p.id}
                        </div>
                        <div className="min-w-0 flex-1 font-mono text-[11px] text-slate-300 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs" style={{ color: col }}>
                              Camera {p.id} — {info.label.replace('\n', ' ')}
                            </span>
                            <span className="text-cyan-400">Mount: {p.mount.toUpperCase()}</span>
                          </div>
                          <div>Position: x={p.x.toFixed(2)}m ({(p.x / bayLength * 100).toFixed(1)}% of length) · y={p.y.toFixed(2)}m · z={p.z.toFixed(2)}m</div>
                          <div>Angles: Pan={p.panDeg}° · Tilt={p.tiltDeg}° · HFOV={lens.hfovDeg}°</div>
                          <div>Effective Span: {st ? `${st.coverStart.toFixed(1)}m → ${st.coverEnd.toFixed(1)}m (Span: ${(st.coverEnd - st.coverStart).toFixed(1)}m)` : '0m'}</div>
                          <div>Under-camera blind cone: {st && st.nearBlind > 0 ? `${st.nearBlind.toFixed(2)}m radius` : 'None directly visible'}</div>
                          <div className="text-slate-400 text-[10px] italic">{info.tip}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Recommendations */}
              {activeDetTab === 'reco' && (
                <div className="space-y-2 font-mono text-xs text-slate-300">
                  <div className="p-3 bg-[#121826] border-l-2 border-[#00e5ff] rounded">
                    {result.metrics.blindPct === 0 ? (
                      <div><strong className="text-white">✓ Optimal Coverage Achieved:</strong> {result.metrics.cameras} cameras provide 100% complete coverage of the {bayLength}m × {bayWidth}m facility at {mode.toUpperCase()} level.</div>
                    ) : (
                      <div><strong className="text-white">Coverage Gap of {result.metrics.blindPct.toFixed(1)}%:</strong> Click &quot;⚡ Auto-Solve (≥95%)&quot; above to find the optimal camera count and mount configuration deterministically.</div>
                    )}
                  </div>
                  <div className="p-3 bg-[#121826] border-l-2 border-[#00e5ff] rounded">
                    <strong className="text-white">IEC EN 62676-4 Standard:</strong> Mode {mode.toUpperCase()} requires ≥ {DORI_PPM[mode]} pixels/metre at target inspection height {targetHeight}m.
                  </div>
                  <div className="p-3 bg-[#121826] border-l-2 border-[#00e5ff] rounded">
                    <strong className="text-white">Infrastructure & Cabling:</strong> Estimated ~{(bayLength * 1.4).toFixed(0)}m Cat6 PoE cabling. Dedicated {Math.ceil(result.metrics.cameras / 8) * 8}-port PoE switch recommended.
                  </div>
                </div>
              )}

              {/* Legend */}
              {activeDetTab === 'legend' && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-300">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-cyan-400" />
                      Identify (≥250 px/m)
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-emerald-400" />
                      Recognize (≥125 px/m)
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-yellow-400" />
                      Observe (≥62.5 px/m)
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-amber-400" />
                      Detect (≥25 px/m)
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[#1e293b] text-[10px] text-slate-400 leading-relaxed">
                    • Exact frustum mathematics calculates ray-plane intercepts for rectilinear lenses and equidistant fisheye lenses.<br />
                    • 3D obstacle occlusion computes ray-box slab intersections to eliminate false visibility behind racks or machinery.
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

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
  Crosshair,
  Building2,
  SlidersHorizontal,
  Info,
  Play,
  Pause,
  Box,
  Boxes,
  Activity,
  Warehouse,
  Factory,
  ShoppingCart,
  Server,
  HelpCircle
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
  type Obstacle,
  type ObstacleType,
  type FacilityPresetType,
  type AiVisionTask,
  generateProceduralObstacles,
  AI_VISION_TASKS,
  IEC_2025_LEVELS,
  DORI_PPM,
  LEVEL_NAMES,
  refocusLens,
} from '@/lib/coverage-engine';
import {
  TopView,
  SideView,
  PerspectiveView,
  camColor,
  CAM_COLORS,
  MOUNT_SYMBOLS
} from './coverage-views';
import { detectFacilityProfile, extractDesiredCameraCount } from '@/lib/rule-based-planner';

interface CameraCoveragePlannerProps {
  project?: DetVisionProject;
  onApplyToProject?: (cameras: ProjectCamera[]) => void;
  onClose?: () => void;
}

export function CameraCoveragePlanner({ project, onApplyToProject, onClose }: CameraCoveragePlannerProps) {
  // Infer initial configuration from user scenario / project brief dynamically
  const initialFacility = useMemo(() => {
    const text = project?.business_description || '';
    const prof = detectFacilityProfile(text);
    const count = project?.cameras?.length && project.cameras.length > 0
      ? project.cameras.length
      : extractDesiredCameraCount(text) || 12;

    // Detect target inspection mode based on scenario requirements / keywords
    const lower = text.toLowerCase();
    let initialMode: DoriMode = 'recognize';
    if (/facial|identity|plate|lpr|anpr|biometric/i.test(lower)) {
      initialMode = 'identify';
    } else if (/ppe|helmet|vest|personnel|badge|mask/i.test(lower)) {
      initialMode = 'recognize';
    } else if (/forklift|vehicle|traffic|crowd|motion/i.test(lower)) {
      initialMode = 'observe';
    } else if (/perimeter|boundary|fence/i.test(lower)) {
      initialMode = 'detect';
    }

    return {
      length: Math.max(10, Math.round(prof.length)),
      width: Math.max(5, Math.round(prof.width)),
      height: Math.max(3, Math.round(prof.height * 10) / 10),
      count: Math.max(1, count),
      mode: initialMode,
      facilityType: prof.facility_type,
    };
  }, [project?.business_description, project?.cameras?.length]);

  // Global site specifications
  const [bayLength, setBayLength] = useState(initialFacility.length);
  const [bayWidth, setBayWidth] = useState(initialFacility.width);
  const [mountHeight, setMountHeight] = useState(initialFacility.height);
  const [targetHeight, setTargetHeight] = useState(1.5); // Target inspection plane (e.g. 1.5m for human/PPE)
  const [marginPct, setMarginPct] = useState(10); // Overlap margin
  const [mode, setMode] = useState<DoriMode>(initialFacility.mode);
  const [cameraCount, setCameraCount] = useState(initialFacility.count);

  // Editable Obstacles state (procedural or from project)
  const [obstacles, setObstacles] = useState<Obstacle[]>(() => {
    if (project?.structure && project.structure.length > 0) {
      const fromProject = project.structure
        .filter(s => s.type === 'obstacle' && s.points.length >= 2)
        .map((s, idx) => {
          const xs = s.points.map(p => p.x * initialFacility.length);
          const ys = s.points.map(p => p.y * initialFacility.width);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return {
            id: s.id || `obs-${idx + 1}`,
            name: s.name || `Obstacle ${idx + 1}`,
            x: +minX.toFixed(2),
            y: +minY.toFixed(2),
            w: +Math.max(0.5, maxX - minX).toFixed(2),
            d: +Math.max(0.5, maxY - minY).toFixed(2),
            h: +Math.min(initialFacility.height, 3.5).toFixed(2),
            type: 'rack' as ObstacleType,
          };
        });
      if (fromProject.length > 0) return fromProject;
    }

    // Default procedural layout for facility archetype
    const facType = (initialFacility.facilityType as FacilityPresetType) || 'logistics_warehouse';
    return generateProceduralObstacles({
      type: ['logistics_warehouse', 'manufacturing_plant', 'retail_supermarket', 'data_center'].includes(facType)
        ? facType
        : 'logistics_warehouse',
      length: initialFacility.length,
      width: initialFacility.width,
      mountHeight: initialFacility.height,
    });
  });

  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [activeFacilityPreset, setActiveFacilityPreset] = useState<FacilityPresetType | 'custom'>(
    (['logistics_warehouse', 'manufacturing_plant', 'retail_supermarket', 'data_center'].includes(initialFacility.facilityType as any)
      ? (initialFacility.facilityType as FacilityPresetType)
      : 'logistics_warehouse')
  );

  // NVIDIA NIM Facility Synthesis state
  const [isSynthesizingFacility, setIsSynthesizingFacility] = useState(false);
  const [facilitySynthesisPrompt, setFacilitySynthesisPrompt] = useState('');
  const [facilitySynthesisStatus, setFacilitySynthesisStatus] = useState<string | null>(null);
  const [facilitySynthesisSummary, setFacilitySynthesisSummary] = useState<string | null>(null);
  const [newObsName, setNewObsName] = useState('Storage Racking Row');
  const [newObsType, setNewObsType] = useState<ObstacleType>('rack');
  const [newObsW, setNewObsW] = useState(12);
  const [newObsD, setNewObsD] = useState(2.2);
  const [newObsH, setNewObsH] = useState(3.8);
  const [isAddingObstacle, setIsAddingObstacle] = useState(false);

  // Animation controls
  const [isAnimated, setIsAnimated] = useState(true);
  const [animSpeed, setAnimSpeed] = useState<number>(1);

  // AI Task preset
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => {
    if (initialFacility.mode === 'recognize') return 'ppe_safety';
    if (initialFacility.mode === 'identify') return 'face_recognition';
    if (initialFacility.mode === 'observe') return 'forklift_agv';
    return 'perimeter_intrusion';
  });

  // Standard resolution mode: 'dori' | 'iec_2025'
  const [standardView, setStandardView] = useState<'dori' | 'iec_2025'>('dori');

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

  // Site definition with live dynamic obstacles
  const site: SiteSpec = useMemo(() => ({
    length: bayLength,
    width: bayWidth,
    mountHeight,
    targetHeight,
    marginPct,
    obstacles,
  }), [bayLength, bayWidth, mountHeight, targetHeight, marginPct, obstacles]);

  // Initialize camera poses: dynamically from project.cameras if present, else mathematically sound distribution
  const [poses, setPoses] = useState<CameraPose[]>(() => {
    if (project?.cameras && project.cameras.length > 0) {
      return project.cameras.map((c, i) => {
        const x = Math.max(0.5, Math.min(initialFacility.length - 0.5, c.x * initialFacility.length));
        const y = Math.max(0.5, Math.min(initialFacility.width - 0.5, c.y * initialFacility.width));
        const panDeg = Math.round(c.orientation_degrees || 0);
        const tiltDeg = Math.round(25);
        const mount: MountType = y < 1.0 ? 'cross' : (y > initialFacility.width - 1.0 ? 'cross' : 'roof-tilt');
        return {
          id: i + 1,
          mount,
          x: +x.toFixed(2),
          y: +y.toFixed(2),
          z: initialFacility.height,
          panDeg,
          tiltDeg,
        };
      });
    }
    const initialSite: SiteSpec = {
      length: initialFacility.length,
      width: initialFacility.width,
      mountHeight: initialFacility.height,
      targetHeight: 1.5,
      marginPct: 10,
      obstacles: [],
    };
    return defaultLayout(initialFacility.count, initialSite, {
      focalMm: 2.8,
      hfovDeg: 106,
      vfovDeg: 56,
      ranges: { detect: 88, observe: 35.2, recognize: 17.6, identify: 8.8 },
    }, initialFacility.mode);
  });

  // UI state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<'top' | 'side' | '3d'>('top');
  const [activeDetTab, setActiveDetTab] = useState<'table' | 'list' | 'obstacles' | 'reco' | 'legend'>('table');
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

  // AI Facility Structure Synthesizer powered by NVIDIA NIM
  const handleSynthesizeFacility = async (promptOverride?: string) => {
    setIsSynthesizingFacility(true);
    setFacilitySynthesisStatus('Querying NVIDIA NIM (meta/llama-3.2-90b-vision-instruct)...');
    try {
      const resp = await fetch('/api/camera/facility-structures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: project?.business_description || '',
          customPrompt: promptOverride || facilitySynthesisPrompt,
          facilityType: activeFacilityPreset,
          dimensions: { length: bayLength, width: bayWidth, height: mountHeight },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Facility synthesis failed');
      }
      const data = await resp.json();
      if (Array.isArray(data.obstacles) && data.obstacles.length > 0) {
        setObstacles(data.obstacles);
        setActiveFacilityPreset('custom');
        setSelectedObstacleId(null);
        setFacilitySynthesisSummary(data.architectural_summary || 'Generated realistic 3D facility structures with physical occlusion.');
        setFacilitySynthesisStatus(`✨ Synthesized ${data.obstacles.length} structures using ${data.model_used || 'NVIDIA NIM'}`);
      } else {
        throw new Error('No physical structures were returned');
      }
    } catch (e) {
      console.error(e);
      setFacilitySynthesisStatus(e instanceof Error ? `Error: ${e.message}` : 'Synthesis failed');
    } finally {
      setIsSynthesizingFacility(false);
    }
  };

  // Facility preset generator
  const handleApplyPreset = (preset: FacilityPresetType) => {
    setActiveFacilityPreset(preset);
    const newObs = generateProceduralObstacles({
      type: preset,
      length: bayLength,
      width: bayWidth,
      mountHeight,
    });
    setObstacles(newObs);
    setSelectedObstacleId(null);
  };

  // Add custom obstacle
  const handleAddObstacle = () => {
    const newId = `obs-${Date.now()}`;
    const cx = Math.max(0.5, Math.min(bayLength - newObsW - 0.5, (bayLength - newObsW) / 2));
    const cy = Math.max(0.5, Math.min(bayWidth - newObsD - 0.5, (bayWidth - newObsD) / 2));
    const obs: Obstacle = {
      id: newId,
      name: newObsName || `Structure ${obstacles.length + 1}`,
      type: newObsType,
      x: +cx.toFixed(2),
      y: +cy.toFixed(2),
      w: +newObsW.toFixed(2),
      d: +newObsD.toFixed(2),
      h: +newObsH.toFixed(2),
    };
    setObstacles(prev => [...prev, obs]);
    setSelectedObstacleId(newId);
    setActiveFacilityPreset('custom');
    setIsAddingObstacle(false);
  };

  // Delete obstacle
  const handleDeleteObstacle = (id: string) => {
    setObstacles(prev => prev.filter(o => o.id !== id));
    if (selectedObstacleId === id) setSelectedObstacleId(null);
    setActiveFacilityPreset('custom');
  };

  // Clear all obstacles
  const handleClearObstacles = () => {
    setObstacles([]);
    setSelectedObstacleId(null);
    setActiveFacilityPreset('custom');
  };

  // Select AI vision task preset
  const handleSelectAiTask = (task: AiVisionTask) => {
    setSelectedTaskId(task.id);
    setMode(task.doriEquivalent);
  };

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
  CAMERA COVERAGE PLANNER — ENGINEERING GEOMETRY REPORT v3.0
  Project:            ${project?.name || 'Computer Vision Facility Plan'}
  Industry/Type:      ${project?.industry || initialFacility.facilityType}
  Generated:          ${new Date().toLocaleString()}
  Compliance:         IEC EN 62676-4 Pixel Density Standards
══════════════════════════════════════════════════════════════════════════════

FACILITY & SITE PARAMETERS
  Facility Length:    ${bayLength} m
  Facility Width:     ${bayWidth} m
  Mounting Height:    ${mountHeight} m
  Target Plane:       ${targetHeight} m (PPE / Face Inspection Height)
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

    if (obstacles.length > 0) {
      r += `\nFACILITY PHYSICAL OBSTACLES & OCCLUSION SCHEDULE (${obstacles.length} items)
${'═'.repeat(78)}\n`;
      obstacles.forEach(o => {
        r += `[${(o.type || 'OBSTACLE').toUpperCase()}] ${o.name.padEnd(28)} | Dimensions: ${o.w.toFixed(1)}m × ${o.d.toFixed(1)}m × ${o.h.toFixed(1)}m (Area: ${(o.w * o.d).toFixed(1)} m²)
  Coordinates:    x=[${o.x.toFixed(2)}m … ${(o.x + o.w).toFixed(2)}m], y=[${o.y.toFixed(2)}m … ${(o.y + o.d).toFixed(2)}m], height=${o.h.toFixed(2)}m
  Occlusion:      3D Ray-Box Slab Intersect active · Shadows cast onto target plane ${targetHeight}m
${'─'.repeat(78)}\n`;
      });
    }

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
    <div className="flex flex-col h-full bg-slate-50/60 text-slate-900 font-sans overflow-hidden">
      {/* Top Header Control Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-6 py-3.5 border-b border-border bg-white shadow-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Coverage <span className="text-primary">Planner v3</span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-primary/20 bg-primary/10 text-primary">
                EN 62676-4 Standard
              </span>
              {project?.business_description && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-slate-200 bg-slate-100 text-slate-600 hidden sm:inline-block">
                  Scenario-Linked
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span>{initialFacility.facilityType.toUpperCase()} facility</span>
              <span>•</span>
              <span>{bayLength}m × {bayWidth}m</span>
              <span>•</span>
              <span>Exact ray frustums & 3D obstacle occlusion</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleOptimize}
            disabled={isOptimizing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-xs disabled:opacity-50"
            title="Automatically solve the Art Gallery problem for >= 95% coverage with minimum cameras"
          >
            <Sparkles className="w-3.5 h-3.5 fill-current" />
            {isOptimizing ? 'Optimizing…' : 'Auto-Solve (≥95%)'}
          </button>

          {onApplyToProject && (
            <button
              onClick={handleApplyToCanvas}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition-colors shadow-xs"
              title="Sync calculated camera positions and optical cones to the project interactive canvas"
            >
              <Share2 className="w-3.5 h-3.5" />
              Sync to Canvas
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-border bg-white text-xs font-semibold hover:bg-muted text-slate-700 transition-colors"
            >
              Back to Map
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Controls & Right Visualizer */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 p-5 overflow-y-auto min-h-0">
        
        {/* Left Column: Interactive Parameters */}
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          
          {/* Facility & Target Height */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/50 text-xs font-semibold text-slate-700">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Facility & Target Geometry
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">{bayLength * bayWidth} m²</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Facility Length (m)</label>
                  <input
                    type="number"
                    min="5"
                    max="500"
                    value={bayLength}
                    onChange={e => setBayLength(Math.max(5, parseFloat(e.target.value) || 90))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-3 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Facility Width (m)</label>
                  <input
                    type="number"
                    min="2"
                    max="150"
                    value={bayWidth}
                    onChange={e => setBayWidth(Math.max(2, parseFloat(e.target.value) || 10))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-3 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Mount H (m)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="30"
                    value={mountHeight}
                    onChange={e => setMountHeight(Math.max(1, parseFloat(e.target.value) || 4))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Target H (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={targetHeight}
                    onChange={e => setTargetHeight(Math.max(0, parseFloat(e.target.value) || 1.5))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                    title="Target inspection plane height (1.5m for human face/PPE inspection)"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Margin (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={marginPct}
                    onChange={e => setMarginPct(Math.max(0, Math.min(50, parseFloat(e.target.value) || 10)))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                    title="Derating margin for boundary overlap"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Target Mode</label>
                  <select
                    value={mode}
                    onChange={e => setMode(e.target.value as DoriMode)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  >
                    <option value="detect">Detect (25 px/m)</option>
                    <option value="observe">Observe (62.5 px/m)</option>
                    <option value="recognize">Recognize (125 px/m)</option>
                    <option value="identify">Identify (250 px/m)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Camera Count</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={cameraCount}
                    onChange={e => handleCameraCountChange(parseInt(e.target.value) || 5)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* AI Vision Tasks & DORI Resolution Standard */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/50 text-xs font-semibold text-slate-700">
              <div className="flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-primary" />
                AI Task & DORI Standards
              </div>
              <div className="flex bg-slate-200/60 rounded p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setStandardView('dori')}
                  className={`px-2 py-0.5 rounded transition-colors ${standardView === 'dori' ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-600'}`}
                >
                  Classic DORI
                </button>
                <button
                  type="button"
                  onClick={() => setStandardView('iec_2025')}
                  className={`px-2 py-0.5 rounded transition-colors ${standardView === 'iec_2025' ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-600'}`}
                >
                  IEC 2025 (7-Level)
                </button>
              </div>
            </div>
            
            <div className="p-4 space-y-3">
              <div className="text-[11px] font-medium text-slate-600">
                AI Neural Network Tasks (Click to auto-apply PPM criteria):
              </div>
              
              {/* AI Task Presets Grid */}
              <div className="grid grid-cols-2 gap-2">
                {AI_VISION_TASKS.map(task => {
                  const isActive = selectedTaskId === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => handleSelectAiTask(task)}
                      className={`text-left p-2.5 rounded-lg border transition-all ${
                        isActive
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs'
                          : 'border-border bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-slate-900 truncate">
                          {task.name}
                        </span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-100 text-primary">
                          {task.minPpm} px/m
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {task.iecLevel} · {task.doriEquivalent.toUpperCase()}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Standard Explanation */}
              {standardView === 'iec_2025' ? (
                <div className="p-2.5 bg-slate-50 rounded-lg border border-border text-[11px] space-y-1 text-slate-600 font-mono">
                  <div className="font-bold text-slate-900 text-xs">IEC 62676-4:2025 OODPCVS Matrix:</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                    <div>O1 Overview: 20 px/m</div>
                    <div>O2 Outline: 40 px/m</div>
                    <div>D3 Discern: 80 px/m</div>
                    <div className="text-emerald-700 font-bold">P4 Perceive: 125 px/m</div>
                    <div className="text-cyan-700 font-bold">C5 Characterize: 250 px/m</div>
                    <div className="text-indigo-700 font-bold">V6 Validate: 500 px/m</div>
                    <div className="text-purple-700 font-bold col-span-2">S7 Scrutinize: 1500 px/m (Forensic)</div>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 bg-slate-50 rounded-lg border border-border text-[11px] text-slate-600 leading-snug">
                  Target density <strong className="text-slate-900">{DORI_PPM[mode]} px/m</strong> ({mode.toUpperCase()}) guarantees deep learning models (YOLOv8, RT-DETR) receive &ge;32&times;32px bounding crops for target objects at {targetHeight}m height plane.
                </div>
              )}
            </div>
          </div>

          {/* Virtual Facility Blueprint & Obstacles Studio */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/50 text-xs font-semibold text-slate-700">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-primary" />
                Facility Blueprint & Obstacles
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">
                {obstacles.length} {obstacles.length === 1 ? 'structure' : 'structures'}
              </span>
            </div>

            <div className="p-4 space-y-3">
              {/* NVIDIA NIM Facility Synthesizer */}
              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-700">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>AI Facility Synthesizer (NVIDIA NIM)</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-600 text-white font-semibold">
                    LLaMA-3.2-90B
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Synthesize complex 3D industrial equipment, robotic cells, conveyors, AGV tracks, and loading docks with true line-of-sight ray occlusion.
                </p>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="e.g. Battery assembly plant with 6 robotic welding cells & conveyor..."
                    value={facilitySynthesisPrompt}
                    onChange={e => setFacilitySynthesisPrompt(e.target.value)}
                    className="w-full bg-white border border-emerald-200 rounded px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-sans"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isSynthesizingFacility}
                      onClick={() => handleSynthesizeFacility()}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isSynthesizingFacility ? 'Synthesizing 3D Facilities...' : 'Synthesize 3D Structures'}</span>
                    </button>
                    {project?.business_description && (
                      <button
                        type="button"
                        disabled={isSynthesizingFacility}
                        onClick={() => handleSynthesizeFacility(project.business_description)}
                        title="Synthesize structures directly from the current project business scenario"
                        className="px-2.5 py-1.5 rounded-md border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        From Brief
                      </button>
                    )}
                  </div>
                </div>
                {facilitySynthesisStatus && (
                  <div className="text-[10px] font-mono text-emerald-700 bg-white/80 p-1.5 rounded border border-emerald-200/60 flex items-center gap-1">
                    <Activity className="w-3 h-3 shrink-0 animate-pulse text-emerald-600" />
                    <span className="truncate">{facilitySynthesisStatus}</span>
                  </div>
                )}
                {facilitySynthesisSummary && (
                  <div className="text-[10px] text-slate-600 bg-white/60 p-2 rounded border border-emerald-100 italic">
                    &ldquo;{facilitySynthesisSummary}&rdquo;
                  </div>
                )}
              </div>

              {/* Fast Procedural Archetype Selector */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1.5">
                  Procedural Blueprint Archetypes:
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('logistics_warehouse')}
                    className={`flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                      activeFacilityPreset === 'logistics_warehouse'
                        ? 'border-primary bg-primary text-primary-foreground font-bold'
                        : 'border-border bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Warehouse className="w-3.5 h-3.5 shrink-0" />
                    <span>Warehouse Racks</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('manufacturing_plant')}
                    className={`flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                      activeFacilityPreset === 'manufacturing_plant'
                        ? 'border-primary bg-primary text-primary-foreground font-bold'
                        : 'border-border bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Factory className="w-3.5 h-3.5 shrink-0" />
                    <span>Factory Lines</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('retail_supermarket')}
                    className={`flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                      activeFacilityPreset === 'retail_supermarket'
                        ? 'border-primary bg-primary text-primary-foreground font-bold'
                        : 'border-border bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
                    <span>Retail Gondolas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('data_center')}
                    className={`flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                      activeFacilityPreset === 'data_center'
                        ? 'border-primary bg-primary text-primary-foreground font-bold'
                        : 'border-border bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Server className="w-3.5 h-3.5 shrink-0" />
                    <span>Data Center</span>
                  </button>
                </div>
              </div>

              {/* Add Obstacle Expander Button */}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsAddingObstacle(!isAddingObstacle)}
                  className="text-xs text-primary font-semibold flex items-center gap-1.5 hover:text-primary/80"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAddingObstacle ? 'Cancel New Structure' : '+ Add Custom Structure / Rack'}</span>
                </button>
                {obstacles.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearObstacles}
                    className="text-[11px] text-muted-foreground hover:text-rose-600 transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Add Obstacle Form */}
              {isAddingObstacle && (
                <div className="p-3 bg-slate-50 rounded-lg border border-border space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Name</label>
                      <input
                        type="text"
                        value={newObsName}
                        onChange={e => setNewObsName(e.target.value)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Type</label>
                      <select
                        value={newObsType}
                        onChange={e => setNewObsType(e.target.value as ObstacleType)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs text-slate-900 outline-none"
                      >
                        <option value="rack">Storage Rack (📦)</option>
                        <option value="machine">Machinery / Robot (🤖)</option>
                        <option value="conveyor">Conveyor Line (🔄)</option>
                        <option value="agv_lane">AGV Transit Lane (🚜)</option>
                        <option value="mezzanine">Mezzanine Platform (🏢)</option>
                        <option value="hazard">Hazard Zone (⚠️)</option>
                        <option value="dock">Loading Dock (🚛)</option>
                        <option value="column">Structural Column (🏛️)</option>
                        <option value="wall">Perimeter Wall (🧱)</option>
                        <option value="partition">Partition Screen (🛡️)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Width (m)</label>
                      <input
                        type="number"
                        min="0.5"
                        max="200"
                        step="0.5"
                        value={newObsW}
                        onChange={e => setNewObsW(parseFloat(e.target.value) || 5)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Depth (m)</label>
                      <input
                        type="number"
                        min="0.5"
                        max="100"
                        step="0.5"
                        value={newObsD}
                        onChange={e => setNewObsD(parseFloat(e.target.value) || 2)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Height (m)</label>
                      <input
                        type="number"
                        min="0.5"
                        max="30"
                        step="0.5"
                        value={newObsH}
                        onChange={e => setNewObsH(parseFloat(e.target.value) || 3.5)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddObstacle}
                    className="w-full py-1.5 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs"
                  >
                    Place Structure on Blueprint
                  </button>
                </div>
              )}

              {/* Obstacles List */}
              <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-0.5">
                {obstacles.map(o => {
                  const isSelected = o.id === selectedObstacleId;
                  return (
                    <div
                      key={o.id}
                      onClick={() => setSelectedObstacleId(isSelected ? null : o.id)}
                      className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/50 shadow-xs'
                          : 'border-border bg-white hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            o.type === 'rack' ? 'bg-amber-500' :
                            o.type === 'machine' ? 'bg-sky-500' :
                            o.type === 'column' ? 'bg-purple-500' :
                            o.type === 'wall' ? 'bg-rose-500' : 'bg-emerald-500'
                          }`} />
                          <span className="font-semibold text-slate-900 truncate">{o.name}</span>
                          <span className="text-[10px] uppercase font-mono text-muted-foreground px-1 py-0.2 rounded bg-slate-100">
                            {o.type || 'obs'}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                          pos ({o.x.toFixed(1)}m, {o.y.toFixed(1)}m) · size {o.w.toFixed(1)}m &times; {o.d.toFixed(1)}m · h={o.h.toFixed(1)}m
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteObstacle(o.id);
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                        title="Remove structure"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Camera Specifications & Lens Physics */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/50 text-xs font-semibold text-slate-700">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                Lens Physics & DORI
              </div>
              <span className="text-[11px] font-mono text-primary font-medium">~{Math.round(result.metrics.impliedHpx)} px</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Focal (mm)</label>
                  <input
                    type="number"
                    step="0.4"
                    min="1.8"
                    max="50"
                    value={lens.focalMm}
                    onChange={e => handleFocalChange(parseFloat(e.target.value) || 2.8)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">H-FOV (°)</label>
                  <input
                    type="number"
                    value={lens.hfovDeg}
                    onChange={e => setLens(l => ({ ...l, hfovDeg: parseFloat(e.target.value) || 106 }))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">V-FOV (°)</label>
                  <input
                    type="number"
                    value={lens.vfovDeg}
                    onChange={e => setLens(l => ({ ...l, vfovDeg: parseFloat(e.target.value) || 56 }))}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Published Ranges Display */}
              <div className="grid grid-cols-4 gap-2 text-center pt-2 border-t border-border">
                <div className="bg-slate-50 p-2 rounded-lg border border-border">
                  <div className="text-[10px] font-bold text-amber-600">DETECT</div>
                  <div className="text-xs font-mono font-bold text-slate-900">{lens.ranges.detect}m</div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-border">
                  <div className="text-[10px] font-bold text-yellow-600">OBSERVE</div>
                  <div className="text-xs font-mono font-bold text-slate-900">{lens.ranges.observe}m</div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-border">
                  <div className="text-[10px] font-bold text-emerald-600">RECOGNIZE</div>
                  <div className="text-xs font-mono font-bold text-slate-900">{lens.ranges.recognize}m</div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-border">
                  <div className="text-[10px] font-bold text-cyan-600">IDENTIFY</div>
                  <div className="text-xs font-mono font-bold text-slate-900">{lens.ranges.identify}m</div>
                </div>
              </div>
            </div>
          </div>

          {/* Per-Camera Mount Cards */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/50 text-xs font-semibold text-slate-700">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-primary" />
                Mount Schedule ({poses.length} Cameras)
              </div>
              <button
                onClick={() => {
                  const nextId = poses.length + 1;
                  setPoses(prev => [...prev, defaultPose('wall-h', nextId, bayLength / 2, nextId, site, lens, mode)]);
                  setCameraCount(c => c + 1);
                }}
                className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 font-semibold"
              >
                <Plus className="w-3.5 h-3.5" /> Add Cam
              </button>
            </div>

            <div className="p-3 max-h-[380px] overflow-y-auto space-y-2.5">
              {poses.map((p, idx) => {
                const color = camColor(p.id);
                const info = MOUNT_INFO[p.mount];
                const isSelected = p.id === selectedId;
                const st = result.cameras[idx];

                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedId(isSelected ? null : p.id)}
                    className={`rounded-lg border p-3 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs'
                        : 'border-border bg-white hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] font-bold text-white shadow-xs"
                          style={{ backgroundColor: color }}
                        >
                          {p.id}
                        </div>
                        <span className="text-xs font-bold text-slate-900">
                          Camera {p.id}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          x={p.x.toFixed(1)}m, y={p.y.toFixed(1)}m
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-primary font-mono">
                        {info.short}
                      </div>
                    </div>

                    {/* Quick Metrics */}
                    <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between">
                      <span>Span: {st ? (st.coverEnd - st.coverStart).toFixed(1) : '0'}m</span>
                      <span>Blind: {st ? st.nearBlind.toFixed(1) : '0'}m</span>
                      <span>Reach: {st ? st.farReach.toFixed(1) : '0'}m</span>
                    </div>

                    {/* Expanded Controls when Selected */}
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-border space-y-2.5" onClick={e => e.stopPropagation()}>
                        {/* Mount Type Selector */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {(Object.keys(MOUNT_INFO) as MountType[]).map(mKey => (
                            <button
                              key={mKey}
                              type="button"
                              onClick={() => handleMountChange(p.id, mKey)}
                              title={MOUNT_INFO[mKey].tip}
                              className={`p-1.5 rounded-md text-[10px] font-semibold border transition-all flex flex-col items-center justify-center gap-0.5 ${
                                p.mount === mKey
                                  ? 'border-primary bg-primary text-primary-foreground font-bold shadow-xs'
                                  : 'border-border bg-white text-slate-700 hover:bg-muted'
                              }`}
                            >
                              <span className="font-mono text-xs leading-none">{MOUNT_SYMBOLS[mKey] || '●'}</span>
                              <span className="truncate w-full text-center text-[9px]">{MOUNT_INFO[mKey].label.split('\n')[0]}</span>
                            </button>
                          ))}
                        </div>

                        {/* Pan and Tilt Sliders */}
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-slate-600 w-12">Pan</span>
                            <input
                              type="range"
                              min="0"
                              max="359"
                              value={p.panDeg}
                              onChange={e => handlePoseChange(p.id, { panDeg: parseFloat(e.target.value) })}
                              className="flex-1 accent-primary"
                            />
                            <span className="text-[11px] font-mono text-slate-900 w-9 text-right font-bold">{p.panDeg}°</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-slate-600 w-12">Tilt</span>
                            <input
                              type="range"
                              min="-60"
                              max="90"
                              value={p.tiltDeg}
                              onChange={e => handlePoseChange(p.id, { tiltDeg: parseFloat(e.target.value) })}
                              className="flex-1 accent-primary"
                            />
                            <span className="text-[11px] font-mono text-slate-900 w-9 text-right font-bold">{p.tiltDeg}°</span>
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
                            className="text-xs text-rose-600 hover:text-rose-700 font-medium flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove Camera
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
          <div className="grid grid-cols-2 gap-3 pt-1 pb-4">
            <button
              onClick={() => {
                setPoses(defaultLayout(cameraCount, site, lens, mode));
                setSelectedId(null);
              }}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-white border border-border text-slate-700 hover:bg-muted text-xs font-semibold shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Layout
            </button>
            <button
              onClick={handleExportReport}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-white border border-border text-slate-700 hover:bg-muted text-xs font-semibold shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Export Blueprint
            </button>
          </div>
        </div>

        {/* Right Column: Visualization & Mathematical Metrics */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          
          {/* Top KPI Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Cameras</div>
              <div className="text-2xl font-mono font-bold text-primary leading-none">
                {result.metrics.cameras}
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">active mount positions</div>
            </div>

            <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Coverage</div>
              <div className="text-2xl font-mono font-bold text-emerald-600 leading-none">
                {result.metrics.coveragePct.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">
                {result.metrics.coveredArea.toFixed(0)} / {result.metrics.totalArea} m²
              </div>
            </div>

            <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Blind Spot</div>
              <div className="text-2xl font-mono font-bold text-rose-600 leading-none">
                {result.metrics.blindPct.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">
                largest gap: {result.metrics.largestGapM.toFixed(1)}m
              </div>
            </div>

            <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Efficiency</div>
              <div className="text-2xl font-mono font-bold text-amber-600 leading-none">
                {result.metrics.efficiency.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">coverage / camera</div>
            </div>
          </div>

          {/* Alert Status Banner */}
          {result.metrics.blindPct === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3.5 rounded-xl text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span className="font-medium">100% Complete Coverage — zero blind spots detected across all {bayLength}m × {bayWidth}m at {mode.toUpperCase()} level.</span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">COMPLIANT</span>
            </div>
          ) : result.metrics.blindPct < 10 ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-xl text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span className="font-medium">Only {result.metrics.blindPct.toFixed(1)}% blind spots remain. Adding 1 camera or widening HFOV fills the gap.</span>
              </div>
              <button onClick={handleOptimize} className="underline font-bold text-amber-900 hover:text-black">Auto-Solve</button>
            </div>
          ) : (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span className="font-medium">{result.metrics.blindPct.toFixed(1)}% coverage gap. Adjust camera mount angles or click Auto-Solve.</span>
              </div>
              <button onClick={handleOptimize} className="underline font-bold text-rose-900 hover:text-black">Auto-Solve (≥95%)</button>
            </div>
          )}

          {/* Main Visualizer: Top / Side / 3D Canvas Tabs */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-slate-50/50">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Layers className="w-4 h-4 text-primary" />
                Multi-Angle Simulation
              </div>

              {/* View & Heatmap Controls */}
              <div className="flex items-center gap-3">
                {activeViewTab === 'top' && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-200/60 rounded-lg p-0.5 border border-border text-[11px]">
                      <button
                        type="button"
                        onClick={() => setHeatMode('dori')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${heatMode === 'dori' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        DORI Resolution
                      </button>
                      <button
                        type="button"
                        onClick={() => setHeatMode('overlap')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${heatMode === 'overlap' ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        Redundancy
                      </button>
                    </div>

                    {/* Animated Optical Wave Scan Controls */}
                    <div className="flex items-center gap-1 bg-slate-200/60 rounded-lg p-0.5 border border-border text-[11px]">
                      <button
                        type="button"
                        onClick={() => setIsAnimated(!isAnimated)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                          isAnimated
                            ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                            : 'bg-white text-slate-700 hover:text-slate-900'
                        }`}
                        title="Toggle animated propagating optical wave scan"
                      >
                        {isAnimated ? <Activity className="w-3 h-3 animate-pulse" /> : <Play className="w-3 h-3" />}
                        <span>{isAnimated ? 'Live Waves' : 'Paused'}</span>
                      </button>
                      {isAnimated && (
                        <button
                          type="button"
                          onClick={() => setAnimSpeed(s => (s === 1 ? 2 : 1))}
                          className="px-1.5 py-1 rounded-md text-[10px] font-mono font-bold text-slate-700 hover:text-slate-900 transition-colors"
                          title="Optical wave pulse speed"
                        >
                          {animSpeed}x
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex border-l border-border pl-3 gap-1">
                  <button
                    onClick={() => setActiveViewTab('top')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      activeViewTab === 'top'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    Top View
                  </button>
                  <button
                    onClick={() => setActiveViewTab('side')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      activeViewTab === 'side'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    Side Elevation
                  </button>
                  <button
                    onClick={() => setActiveViewTab('3d')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      activeViewTab === '3d'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    3D Perspective
                  </button>
                </div>
              </div>
            </div>

            {/* Canvas Panels */}
            <div className="p-4 bg-slate-100/50">
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
                  selectedObstacleId={selectedObstacleId}
                  onSelectObstacle={setSelectedObstacleId}
                  isAnimated={isAnimated}
                  animSpeed={animSpeed}
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
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-slate-50/50">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Info className="w-4 h-4 text-primary" />
                Technical Schedule
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveDetTab('table')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'table' ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Summary Table
                </button>
                <button
                  onClick={() => setActiveDetTab('list')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'list' ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Full Details
                </button>
                <button
                  onClick={() => setActiveDetTab('obstacles')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'obstacles' ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Obstacles ({obstacles.length})
                </button>
                <button
                  onClick={() => setActiveDetTab('reco')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'reco' ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Recommendations
                </button>
                <button
                  onClick={() => setActiveDetTab('legend')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'legend' ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  DORI Legend
                </button>
              </div>
            </div>

            <div className="p-4">
              {/* Summary Table */}
              {activeDetTab === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase">
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Position (X, Y)</th>
                        <th className="p-2.5">Height</th>
                        <th className="p-2.5">Mount Type</th>
                        <th className="p-2.5">Pan / Tilt</th>
                        <th className="p-2.5">Coverage Span</th>
                        <th className="p-2.5">Near Blind</th>
                        <th className="p-2.5">Area</th>
                        <th className="p-2.5">Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {poses.map((p, idx) => {
                        const col = camColor(p.id);
                        const st = result.cameras[idx];
                        const span = st ? (st.coverEnd - st.coverStart).toFixed(1) : '0';
                        return (
                          <tr
                            key={p.id}
                            onClick={() => setSelectedId(p.id)}
                            className={`cursor-pointer transition-colors ${
                              selectedId === p.id ? 'bg-primary/5 font-semibold' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="p-2.5 font-bold" style={{ color: col }}>
                              ▌{p.id}
                            </td>
                            <td className="p-2.5 text-slate-700">
                              {p.x.toFixed(1)}m, {p.y.toFixed(1)}m
                            </td>
                            <td className="p-2.5 text-slate-700">{p.z.toFixed(1)}m</td>
                            <td className="p-2.5 font-bold text-primary">
                              {p.mount.toUpperCase()}
                            </td>
                            <td className="p-2.5 text-slate-700">
                              {p.panDeg}°, {p.tiltDeg}°
                            </td>
                            <td className="p-2.5 font-bold text-emerald-600">{span}m</td>
                            <td className="p-2.5 text-slate-700">
                              {st && st.nearBlind > 0 ? `${st.nearBlind.toFixed(1)}m` : '0m'}
                            </td>
                            <td className="p-2.5 text-slate-700">
                              {st ? `${st.coveredArea.toFixed(0)} m²` : '0'}
                            </td>
                            <td className="p-2.5 text-primary font-bold">
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
                <div className="space-y-2.5">
                  {poses.map((p, idx) => {
                    const col = camColor(p.id);
                    const st = result.cameras[idx];
                    const info = MOUNT_INFO[p.mount];

                    return (
                      <div key={p.id} className="p-3.5 bg-slate-50/50 border border-border rounded-lg flex gap-3.5 items-start">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold text-white shrink-0 shadow-xs"
                          style={{ backgroundColor: col }}
                        >
                          {p.id}
                        </div>
                        <div className="min-w-0 flex-1 font-mono text-xs text-slate-700 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs" style={{ color: col }}>
                              Camera {p.id} — {info.label.replace('\n', ' ')}
                            </span>
                            <span className="text-primary font-semibold">Mount: {p.mount.toUpperCase()}</span>
                          </div>
                          <div>Position: x={p.x.toFixed(2)}m ({(p.x / bayLength * 100).toFixed(1)}% of length) · y={p.y.toFixed(2)}m · z={p.z.toFixed(2)}m</div>
                          <div>Angles: Pan={p.panDeg}° · Tilt={p.tiltDeg}° · HFOV={lens.hfovDeg}°</div>
                          <div>Effective Span: {st ? `${st.coverStart.toFixed(1)}m → ${st.coverEnd.toFixed(1)}m (Span: ${(st.coverEnd - st.coverStart).toFixed(1)}m)` : '0m'}</div>
                          <div>Under-camera dead-zone: {st && st.nearBlind > 0 ? `${st.nearBlind.toFixed(2)}m radius` : 'Zero dead-zone directly under mount'}</div>
                          <div className="text-muted-foreground text-[11px] italic">{info.tip}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Obstacles & Physical Shadow Table */}
              {activeDetTab === 'obstacles' && (
                <div className="space-y-3 font-sans text-xs">
                  {obstacles.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg bg-slate-50/50">
                      No physical obstacles placed. Use the &quot;Facility Blueprint &amp; Obstacles&quot; panel on the left to generate procedural racks or place custom structures.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-mono text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-border bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase">
                            <th className="p-2.5">Structure</th>
                            <th className="p-2.5">Type</th>
                            <th className="p-2.5">Origin (X, Y)</th>
                            <th className="p-2.5">Footprint (W &times; D)</th>
                            <th className="p-2.5">Height</th>
                            <th className="p-2.5">Footprint Area</th>
                            <th className="p-2.5">3D Ray Occlusion</th>
                            <th className="p-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {obstacles.map(o => {
                            const isSel = o.id === selectedObstacleId;
                            return (
                              <tr
                                key={o.id}
                                onClick={() => setSelectedObstacleId(o.id)}
                                className={`cursor-pointer transition-colors ${
                                  isSel ? 'bg-primary/5 font-semibold' : 'hover:bg-slate-50'
                                }`}
                              >
                                <td className="p-2.5 font-bold text-slate-900">
                                  {o.name}
                                </td>
                                <td className="p-2.5">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    o.type === 'rack' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                                    o.type === 'machine' ? 'bg-sky-100 text-sky-800 border border-sky-300' :
                                    o.type === 'conveyor' ? 'bg-cyan-100 text-cyan-800 border border-cyan-300' :
                                    o.type === 'agv_lane' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                                    o.type === 'mezzanine' ? 'bg-purple-100 text-purple-800 border border-purple-300' :
                                    o.type === 'hazard' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
                                    o.type === 'dock' ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' :
                                    o.type === 'column' ? 'bg-slate-100 text-slate-800 border border-slate-300' :
                                    o.type === 'wall' ? 'bg-zinc-200 text-zinc-900 border border-zinc-400' : 'bg-teal-100 text-teal-800 border border-teal-300'
                                  }`}>
                                    {o.type || 'obstacle'}
                                  </span>
                                </td>
                                <td className="p-2.5 text-slate-700">
                                  {o.x.toFixed(1)}m, {o.y.toFixed(1)}m
                                </td>
                                <td className="p-2.5 text-slate-700">
                                  {o.w.toFixed(1)}m &times; {o.d.toFixed(1)}m
                                </td>
                                <td className="p-2.5 font-bold text-slate-900">
                                  {o.h.toFixed(1)}m
                                </td>
                                <td className="p-2.5 text-slate-700">
                                  {(o.w * o.d).toFixed(1)} m²
                                </td>
                                <td className="p-2.5 text-emerald-600 font-semibold">
                                  Casts 3D shadow (target h={targetHeight}m)
                                </td>
                                <td className="p-2.5 text-right">
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleDeleteObstacle(o.id);
                                    }}
                                    className="text-xs text-rose-600 hover:text-rose-800 font-medium"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Recommendations */}
              {activeDetTab === 'reco' && (
                <div className="space-y-3 font-sans text-xs text-slate-700">
                  <div className="p-3.5 bg-slate-50 border-l-4 border-primary rounded-lg">
                    {result.metrics.blindPct === 0 ? (
                      <div><strong className="text-slate-900">Optimal Coverage Achieved:</strong> {result.metrics.cameras} cameras provide 100% complete coverage of the {bayLength}m × {bayWidth}m facility at {mode.toUpperCase()} level.</div>
                    ) : (
                      <div><strong className="text-slate-900">Coverage Gap of {result.metrics.blindPct.toFixed(1)}%:</strong> Click &quot;Auto-Solve (≥95%)&quot; above to find the optimal camera count and mount configuration deterministically.</div>
                    )}
                  </div>
                  <div className="p-3.5 bg-slate-50 border-l-4 border-primary rounded-lg">
                    <strong className="text-slate-900">IEC EN 62676-4 Standard:</strong> Mode {mode.toUpperCase()} requires ≥ {DORI_PPM[mode]} pixels/metre at target inspection height {targetHeight}m.
                  </div>
                  <div className="p-3.5 bg-slate-50 border-l-4 border-primary rounded-lg">
                    <strong className="text-slate-900">Infrastructure & Cabling:</strong> Estimated ~{(bayLength * 1.4).toFixed(0)}m Cat6 PoE cabling. Dedicated {Math.ceil(result.metrics.cameras / 8) * 8}-port PoE switch recommended.
                  </div>
                </div>
              )}

              {/* Legend */}
              {activeDetTab === 'legend' && (
                <div className="space-y-3 font-sans text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-700">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-cyan-400" />
                      <span className="font-medium">Identify (≥250 px/m)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-emerald-400" />
                      <span className="font-medium">Recognize (≥125 px/m)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-yellow-400" />
                      <span className="font-medium">Observe (≥62.5 px/m)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-amber-400" />
                      <span className="font-medium">Detect (≥25 px/m)</span>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
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

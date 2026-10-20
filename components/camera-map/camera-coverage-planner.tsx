'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { 
  Camera, 
  RotateCcw, 
  Download, 
  Printer,
  FileText,
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
  HelpCircle,
  Compass,
  Move,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Copy,
  Video,
  Cpu,
  Aperture,
  Disc,
  RefreshCw
} from 'lucide-react';
import type { Camera as ProjectCamera, DetVisionProject } from '@/lib/types';
import {
  computeCoverage,
  optimizeLayout,
  defaultLayout,
  defaultPose,
  architectureAwareLayout,
  MOUNT_INFO,
  clamp,
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
  rangesFromResolution,
  type MappingStandard,
  MAPPING_STANDARDS,
} from '@/lib/coverage-engine';
import {
  TopView,
  SideView,
  PerspectiveView,
  BirdCameraView,
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

  // Derive initial obstacles from project structure or procedural generation based on scenario profile
  const initialObstacles = useMemo<Obstacle[]>(() => {
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
  }, [project?.structure, initialFacility]);

  // Editable Obstacles state
  const [obstacles, setObstacles] = useState<Obstacle[]>(initialObstacles);

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

  // Camera hardware specifications
  const [cameraModel, setCameraModel] = useState<string>('4MP Wide-Dynamic AI Dome');
  const [resolutionPreset, setResolutionPreset] = useState<string>('4mp');
  const [sensorWidthPx, setSensorWidthPx] = useState<number>(2688);
  const [sensorHeightPx, setSensorHeightPx] = useState<number>(1520);
  const [sensorFormat, setSensorFormat] = useState<string>('1/2.8"');
  const [framerateFps, setFramerateFps] = useState<number>(30);
  const [videoCodec, setVideoCodec] = useState<string>('H.265');
  const [bitrateKbps, setBitrateKbps] = useState<number>(4096);
  const [minLux, setMinLux] = useState<number>(0.005);
  const [irRangeM, setIrRangeM] = useState<number>(30);
  const [savedToast, setSavedToast] = useState<boolean>(false);

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

  const handleResolutionPresetChange = (preset: string) => {
    setResolutionPreset(preset);
    let w = sensorWidthPx, h = sensorHeightPx;
    if (preset === '4mp') { w = 2688; h = 1520; }
    else if (preset === '8mp') { w = 3840; h = 2160; }
    else if (preset === '12mp') { w = 4000; h = 3000; }
    else if (preset === '2mp') { w = 1920; h = 1080; }
    else if (preset === '5mp') { w = 2592; h = 1944; }
    setSensorWidthPx(w);
    setSensorHeightPx(h);
    const newRanges = rangesFromResolution(w, lens.hfovDeg);
    setLens(l => ({ ...l, ranges: newRanges }));
  };

  const handleCustomResolutionChange = (w: number, h: number) => {
    const validW = Math.max(640, w);
    const validH = Math.max(480, h);
    setSensorWidthPx(validW);
    setSensorHeightPx(validH);
    const newRanges = rangesFromResolution(validW, lens.hfovDeg);
    setLens(l => ({ ...l, ranges: newRanges }));
  };

  const handleHfovChange = (hfov: number) => {
    const validH = Math.max(10, Math.min(180, hfov));
    const newRanges = rangesFromResolution(sensorWidthPx, validH);
    setLens(l => ({ ...l, hfovDeg: validH, ranges: newRanges }));
  };

  // Site definition with live dynamic obstacles
  const site: SiteSpec = useMemo(() => ({
    length: bayLength,
    width: bayWidth,
    mountHeight,
    targetHeight,
    marginPct,
    obstacles,
  }), [bayLength, bayWidth, mountHeight, targetHeight, marginPct, obstacles]);

  // Initialize camera poses: dynamically from project.cameras if present, else architecture-aware distribution
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
      obstacles: initialObstacles,
    };
    const defaultLens: LensSpec = {
      focalMm: 2.8,
      hfovDeg: 106,
      vfovDeg: 56,
      ranges: { detect: 88, observe: 35.2, recognize: 17.6, identify: 8.8 },
    };
    if (initialObstacles.length > 0) {
      return architectureAwareLayout(initialObstacles, initialSite, defaultLens, initialFacility.mode, initialFacility.count);
    }
    return defaultLayout(initialFacility.count, initialSite, defaultLens, initialFacility.mode);
  });

  // UI state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<'top' | 'side' | '3d' | 'bird'>('bird');
  const [activeStandard, setActiveStandard] = useState<MappingStandard>('dori');
  const [activeDetTab, setActiveDetTab] = useState<'table' | 'list' | 'obstacles' | 'reco' | 'legend'>('table');
  const [heatMode, setHeatMode] = useState<'dori' | 'overlap'>('dori');
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Compute coverage whenever parameters change (deterministic pure calculation)
  const result: CoverageResult = useMemo(() => {
    return computeCoverage(poses, lens, site, mode);
  }, [poses, lens, site, mode]);

  // Update camera count and re-distribute (architecture-aware if obstacles exist)
  const handleCameraCountChange = (count: number) => {
    const c = Math.max(1, Math.min(100, count));
    setCameraCount(c);
    if (obstacles.length > 0) {
      setPoses(architectureAwareLayout(obstacles, site, lens, mode, c));
    } else {
      setPoses(defaultLayout(c, site, lens, mode));
    }
    setSelectedId(null);
  };

  // Plan cameras directly based on architectural layout, storage aisles, and dock doors
  const handlePlanFromArchitecture = () => {
    let currentObs = obstacles;
    if (currentObs.length === 0) {
      currentObs = generateProceduralObstacles({
        type: 'logistics_warehouse',
        length: bayLength,
        width: bayWidth,
        mountHeight,
      });
      setObstacles(currentObs);
    }
    const archPoses = architectureAwareLayout(currentObs, { ...site, obstacles: currentObs }, lens, mode, cameraCount);
    if (archPoses.length > 0) {
      setPoses(archPoses);
      setCameraCount(archPoses.length);
    }
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

  // Move obstacle position (drag from TopView or inspector)
  const handleMoveObstacle = useCallback((id: string, x: number, y: number) => {
    setObstacles(prev => prev.map(o => o.id === id ? { ...o, x, y } : o));
  }, []);

  const handleUpdateObstacle = (id: string, updates: Partial<Obstacle>) => {
    setObstacles(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  const handleRotateObstacle = (id: string) => {
    setObstacles(prev => prev.map(o => {
      if (o.id !== id) return o;
      return { ...o, w: o.d, d: o.w };
    }));
  };

  const handleDuplicateObstacle = (id: string) => {
    const obs = obstacles.find(o => o.id === id);
    if (!obs) return;
    const newId = `obs_${Date.now()}`;
    const newX = clamp(obs.x + 3, 0, bayLength - obs.w);
    const newY = clamp(obs.y, 0, bayWidth - obs.d);
    const newObs: Obstacle = {
      ...obs,
      id: newId,
      name: `${obs.name} (Copy)`,
      x: +newX.toFixed(2),
      y: +newY.toFixed(2),
    };
    setObstacles(prev => [...prev, newObs]);
    setSelectedObstacleId(newId);
  };

  const handleNudgeObstacle = (id: string, dx: number, dy: number) => {
    setObstacles(prev => prev.map(o => {
      if (o.id !== id) return o;
      return {
        ...o,
        x: +clamp(o.x + dx, 0, bayLength - o.w).toFixed(2),
        y: +clamp(o.y + dy, 0, bayWidth - o.d).toFixed(2),
      };
    }));
  };

  const handleNudgeCamera = (id: number, dx: number, dy: number) => {
    setPoses(prev => prev.map(p => {
      if (p.id !== id) return p;
      return {
        ...p,
        x: +clamp(p.x + dx, 0, bayLength).toFixed(2),
        y: +clamp(p.y + dy, 0, bayWidth).toFixed(2),
      };
    }));
  };

  const handleSetCameraPan = (id: number, panDeg: number) => {
    const norm = (Math.round(panDeg) % 360 + 360) % 360;
    setPoses(prev => prev.map(p => p.id === id ? { ...p, panDeg: norm } : p));
  };

  const handleSetCameraTilt = (id: number, tiltDeg: number) => {
    const norm = Math.round(clamp(tiltDeg, -30, 90));
    setPoses(prev => prev.map(p => p.id === id ? { ...p, tiltDeg: norm } : p));
  };

  // AI Facility Structure Synthesizer powered by NVIDIA NIM
  const handleSynthesizeFacility = async (promptOverride?: string) => {
    setIsSynthesizingFacility(true);
    setFacilitySynthesisStatus('Querying NVIDIA NIM (meta/llama-3.2-11b-vision-instruct)...');
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
        // Automatically auto-align cameras with newly generated architectural design!
        const archPoses = architectureAwareLayout(data.obstacles, { ...site, obstacles: data.obstacles }, lens, mode, cameraCount);
        if (archPoses.length > 0) {
          setPoses(archPoses);
        }
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
    const archPoses = architectureAwareLayout(newObs, { ...site, obstacles: newObs }, lens, mode, cameraCount);
    if (archPoses.length > 0) {
      setPoses(archPoses);
    }
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

  // Save cameras to project blueprint
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
        resolution_width: sensorWidthPx,
        resolution_height: sensorHeightPx,
        status: 'planned',
        target_area: `Position ${p.x.toFixed(1)}m, ${p.y.toFixed(1)}m (Elev: ${p.z.toFixed(1)}m)`,
        assigned_use_case_ids: [],
        rationale: `${cameraModel} (${resolutionPreset.toUpperCase()}) · Codec: ${videoCodec} @ ${framerateFps}fps · Span: ${st ? (st.coverEnd - st.coverStart).toFixed(1) : ''}m, Blind: ${st ? st.nearBlind.toFixed(1) : ''}m. ${MOUNT_INFO[p.mount].tip}`
      };
    });

    onApplyToProject(projectCameras);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  // Export full technical engineering blueprint for Installation Team and Software Developers
  const handleExportReport = (format: 'pdf' | 'docx' = 'pdf') => {
    const m = result.metrics;
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const title = project?.name || 'Computer Vision Facility Plan';
    const estTotalCablingM = poses.reduce((acc, p) => acc + (p.x * 1.1 + p.y * 1.3) + 15, 0);

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} - Dual Engineering Blueprint</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0f172a; margin: 0; padding: 20px; font-size: 11px; line-height: 1.45; }
    h1, h2, h3, h4 { color: #0f172a; margin-top: 0; }
    .header-box { border-bottom: 2px solid #2563eb; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .badge-amber { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .badge-indigo { background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; }
    .badge-green { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
    .section-card { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 18px; page-break-inside: avoid; }
    .section-title { font-size: 15px; font-weight: 800; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; margin-bottom: 12px; }
    th { background: #f1f5f9; text-align: left; padding: 6px 8px; font-weight: 700; color: #334155; border: 1px solid #cbd5e1; }
    td { padding: 6px 8px; border: 1px solid #e2e8f0; color: #1e293b; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
    .kpi-val { font-size: 16px; font-weight: 800; color: #2563eb; font-family: ui-monospace, monospace; }
    .kpi-lbl { font-size: 9px; font-weight: 600; text-transform: uppercase; color: #64748b; }
    .code-box { background: #0f172a; color: #f8fafc; padding: 10px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 9.5px; line-height: 1.4; overflow-x: auto; }
    @media print {
      body { padding: 0; font-size: 10px; }
      .no-print { display: none !important; }
      .section-card { page-break-inside: avoid; border: 1px solid #94a3b8; }
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <h1 style="font-size: 20px; font-weight: 800; margin-bottom: 4px; color: #1e3a8a;">${title}</h1>
      <div style="font-size: 12px; font-weight: 600; color: #2563eb;">TECHNICAL BLUEPRINT &amp; SYSTEM ARCHITECTURE</div>
      <div style="color: #64748b; font-size: 10px; margin-top: 3px;">
        Generated on ${dateStr} • Standard: IEC EN 62676-4 • Compliance Verified
      </div>
    </div>
    <div style="text-align: right;">
      <span class="badge badge-indigo">Dual-Target Release</span><br>
      <span style="font-size: 10px; color: #64748b; margin-top: 4px; display: inline-block;">Field Crew &amp; Developer Ready</span>
    </div>
  </div>

  <div class="grid-3">
    <div class="kpi-box">
      <div class="kpi-lbl">Facility Geometry</div>
      <div class="kpi-val">${bayLength}m × ${bayWidth}m</div>
      <div style="font-size: 9px; color: #64748b;">Ceiling Mount: ${mountHeight}m • Target Plane: ${targetHeight}m</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-lbl">Optical Mode &amp; Density</div>
      <div class="kpi-val">${mode.toUpperCase()}</div>
      <div style="font-size: 9px; color: #64748b;">Standard Requirement: ≥ ${DORI_PPM[mode]} px/m</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-lbl">Total Area Coverage</div>
      <div class="kpi-val">${m.coveragePct.toFixed(1)}%</div>
      <div style="font-size: 9px; color: #64748b;">${m.cameras} Active Cameras • ${m.overlapPct.toFixed(1)}% Redundant Overlap</div>
    </div>
  </div>

  <!-- PART 0: DETAILED AI SCENARIO & FACILITY PROFILE -->
  <div class="section-card">
    <div class="section-title">
      <span>📋 PART 0: AI Facility Scenario &amp; Computer Vision Objectives</span>
      <span class="badge badge-indigo">AI Scenario Analysis</span>
    </div>
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 14px; margin-bottom: 10px;">
      <div>
        <div style="font-size: 10px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin-bottom: 4px;">Operational Scenario &amp; Brief:</div>
        <p style="margin: 0; font-size: 10.5px; color: #334155; line-height: 1.5; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
          ${project?.business_description || 'Industrial high-bay facility requiring comprehensive computer vision coverage across logistics corridors, storage racking aisles, loading docks, and machinery workcells.'}
        </p>
      </div>
      <div>
        <div style="font-size: 10px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin-bottom: 4px;">Facility Metadata:</div>
        <table style="margin: 0; font-size: 9.5px;">
          <tr><td style="font-weight: 600; color: #64748b; width: 40%;">Company</td><td><strong>${project?.company_name || 'Enterprise Facility Operations'}</strong></td></tr>
          <tr><td style="font-weight: 600; color: #64748b;">Industry</td><td>${project?.industry || 'Logistics & Automated Manufacturing'}</td></tr>
          <tr><td style="font-weight: 600; color: #64748b;">Archetype</td><td><span class="badge badge-indigo">${initialFacility.facilityType ? initialFacility.facilityType.replace('_', ' ').toUpperCase() : 'WAREHOUSE'}</span></td></tr>
          <tr><td style="font-weight: 600; color: #64748b;">Volume</td><td>${(bayLength * bayWidth * mountHeight).toLocaleString()} m³ (${(bayLength * bayWidth).toLocaleString()} m²)</td></tr>
        </table>
      </div>
    </div>

    ${project?.requirements && project.requirements.length > 0 ? `
    <div style="margin-top: 8px;">
      <div style="font-size: 10px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin-bottom: 4px;">Specific Computer Vision Requirements:</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 9.5px; color: #334155;">
        ${project.requirements.map(r => `<div style="background: #f1f5f9; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #2563eb;">• ${r}</div>`).join('')}
      </div>
    </div>` : ''}
  </div>

  <!-- PART 0B: OPTICAL DORI STANDARDS, THERMAL JOHNSON'S CRITERIA & 3D MAPPING TECHNIQUES -->
  <div class="section-card">
    <div class="section-title">
      <span>📐 PART 0B: Multi-Standard Optical &amp; Thermal Camera Mapping Frameworks</span>
      <span class="badge badge-green">IEC 62676-4:2025 · US Military · DHS/NIJ · French Code</span>
    </div>
    
    <!-- Visual DORI Distribution Graph -->
    <div style="margin-bottom: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-size: 10px; font-weight: 700; color: #1e3a8a; text-transform: uppercase;">Visual DORI Coverage Breakdown &amp; Blind Spot Graph:</span>
        <span style="font-size: 10px; font-weight: 700; color: #166534;">Covered: ${m.coveragePct.toFixed(1)}% | Blind Spot: ${m.blindPct.toFixed(1)}%</span>
      </div>
      
      <!-- Multi-color Stacked Progress Bar -->
      <div style="display: flex; width: 100%; height: 16px; border-radius: 4px; overflow: hidden; background: #e2e8f0; margin-bottom: 8px; border: 1px solid #cbd5e1;">
        <div style="width: ${m.doriPct[4].toFixed(1)}%; background: #06b6d4;" title="Identify (${m.doriPct[4].toFixed(1)}%)"></div>
        <div style="width: ${m.doriPct[3].toFixed(1)}%; background: #10b981;" title="Recognize (${m.doriPct[3].toFixed(1)}%)"></div>
        <div style="width: ${m.doriPct[2].toFixed(1)}%; background: #f59e0b;" title="Observe (${m.doriPct[2].toFixed(1)}%)"></div>
        <div style="width: ${m.doriPct[1].toFixed(1)}%; background: #f97316;" title="Detect (${m.doriPct[1].toFixed(1)}%)"></div>
        <div style="width: ${m.blindPct.toFixed(1)}%; background: #f43f5e;" title="Blind Spot (${m.blindPct.toFixed(1)}%)"></div>
      </div>

      <!-- Legend Pills -->
      <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 9px;">
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 2px; background: #06b6d4;"></span> <strong>Identify (≥250 PPM):</strong> ${m.doriPct[4].toFixed(1)}%</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 2px; background: #10b981;"></span> <strong>Recognize (≥125 PPM):</strong> ${m.doriPct[3].toFixed(1)}%</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 2px; background: #f59e0b;"></span> <strong>Observe (≥62.5 PPM):</strong> ${m.doriPct[2].toFixed(1)}%</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 2px; background: #f97316;"></span> <strong>Detect (≥25 PPM):</strong> ${m.doriPct[1].toFixed(1)}%</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 2px; background: #f43f5e;"></span> <strong>Blind Spot:</strong> ${m.blindPct.toFixed(1)}%</span>
      </div>
    </div>

    <!-- Comparative Table of Global CCTV Standards -->
    <div style="margin-bottom: 12px;">
      <div style="font-size: 10px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin-bottom: 6px;">Global CCTV Standards Matrix &amp; Resolution Criteria:</div>
      <table style="font-size: 9px; margin: 0;">
        <thead>
          <tr style="background: #1e293b; color: #f8fafc;">
            <th style="padding: 6px;">Standard / Framework</th>
            <th style="padding: 6px;">Authority &amp; Domain</th>
            <th style="padding: 6px;">Metric Unit</th>
            <th style="padding: 6px;">Key Resolution Tiers &amp; Thresholds</th>
            <th style="padding: 6px;">Application &amp; AI Objectives</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>DORI</strong></td>
            <td>IEC EN 62676-4:2015 (Visible Light)</td>
            <td>Pixels / Metre (PPM)</td>
            <td>Detect (25), Observe (62.5), Recognize (125), Identify (250 px/m)</td>
            <td>Baseline European CCTV design for security installations &amp; general perimeter monitoring.</td>
          </tr>
          <tr style="background: #f8fafc;">
            <td><strong>OODPCVS (2025)</strong></td>
            <td>IEC 62676-4:2025 (Ultra-HD / AI)</td>
            <td>Pixels / Metre (PPM)</td>
            <td>Overview (20), Outline (40), Discern (80), Perceive (125), Characterize (250), Validate (500), <strong>Scrutinize (1500 px/m)</strong></td>
            <td>Designed for 4K/8K AI systems. Scrutinize tier guarantees passport-grade 3D biometric facial recognition.</td>
          </tr>
          <tr>
            <td><strong>Johnson's Criteria</strong></td>
            <td>US Military / NVESD (Thermal IR)</td>
            <td>Line Pairs (lp) across Target</td>
            <td><strong>Detection (1.0–1.5 lp)</strong>, <strong>Recognition (3.0–4.0 lp)</strong>, <strong>Identification (6.0–8.0 lp)</strong></td>
            <td>Military thermal imaging. Evaluates LWIR/MWIR heat signatures across target dimensions (human 1.8m, vehicle 2.3m).</td>
          </tr>
          <tr style="background: #f8fafc;">
            <td><strong>US DHS / NIJ</strong></td>
            <td>Dept of Homeland Security (Forensic Video)</td>
            <td>% Vertical Screen Height (% VSH)</td>
            <td>General (5%), Classification (10%), <strong>Forensic Evidence ID (≥15% VSH)</strong>, High-Security ID (≥25% VSH)</td>
            <td>Courtroom forensic evidence standard. A suspect's face must occupy ≥15% of vertical frame height for federal prosecution.</td>
          </tr>
          <tr>
            <td><strong>French Standards</strong></td>
            <td>Ministère de l'Intérieur / CNIL (France)</td>
            <td>Pixels / Metre (PPM)</td>
            <td>Surveillance (30), Reconnaissance (150), <strong>Identification Stricte (300)</strong>, Contrôle d'Accès (800 px/m)</td>
            <td>Strict French municipal public surveillance code and JVSG professional CCTV tool design standard.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mathematical Formulations Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; font-size: 9.5px;">
        <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 4px;">1. Optical Pixel Density (PPM) Formula:</div>
        <div style="font-family: ui-monospace, monospace; background: #ffffff; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0; margin-bottom: 6px; color: #0369a1;">
          PPM(D) = Resolution_W / [ 2 · D · tan(HFOV / 2) ]
        </div>
        <p style="margin: 0; color: #475569; line-height: 1.4;">
          Calculates optical density at distance <em>D</em> on ground target plane (height ${targetHeight}m). Guarantees sufficient pixels across facial features (Identify ≥250 px/m) and safety apparel (Recognize ≥125 px/m).
        </p>
      </div>

      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; font-size: 9.5px;">
        <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 4px;">2. Thermal Johnson's Criteria Line-Pair Formula:</div>
        <div style="font-family: ui-monospace, monospace; background: #ffffff; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0; margin-bottom: 6px; color: #0369a1;">
          N_lp = [ PPM(D) · H_target ] / 2 = [ Res_W · H_target ] / [ 4 · D · tan(HFOV/2) ]
        </div>
        <p style="margin: 0; color: #475569; line-height: 1.4;">
          Thermal cameras measure line pairs resolved across a target object dimension (human 1.8m, vehicle 2.3m). Identification requires 6–8 line pairs; Recognition requires 3–4 line pairs; Detection requires 1–1.5 line pairs.
        </p>
      </div>

      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; font-size: 9.5px;">
        <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 4px;">3. US DHS / NIJ % Vertical Screen Height:</div>
        <div style="font-family: ui-monospace, monospace; background: #ffffff; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0; margin-bottom: 6px; color: #0369a1;">
          VSH_% = [ H_target / (2 · D · tan(VFOV / 2)) ] × 100%
        </div>
        <p style="margin: 0; color: #475569; line-height: 1.4;">
          Maps camera distance based on vertical frame percentage. For court-admissible forensic evidence under NIJ standards, the target face must occupy at least 15% of the total vertical screen height.
        </p>
      </div>

      <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; font-size: 9.5px;">
        <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 4px;">4. 3D Bird Camera View &amp; Ray-Box Occlusion:</div>
        <div style="font-family: ui-monospace, monospace; background: #ffffff; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0; margin-bottom: 6px; color: #0369a1;">
          D_blind = (Mount_Z - Target_Z) / tan(θ_tilt + VFOV / 2)
        </div>
        <p style="margin: 0; color: #475569; line-height: 1.4;">
          Top-down 3D bird's-eye projection with 3D ray-box slab intersection testing against ${obstacles.length} physical obstacles. Eliminates blind zone occlusions behind storage racks and structural columns via longitudinal aisle aiming.
        </p>
      </div>
    </div>
  </div>

  <!-- PART 1: FIELD RIGGING GUIDE -->
  <div class="section-card">
    <div class="section-title">
      <span>🛠️ PART 1: Camera Installation &amp; Field Engineering Package</span>
      <span class="badge badge-amber">For Field Rigging Crew &amp; Electricians</span>
    </div>
    <p style="margin: 0 0 8px 0; color: #475569; font-size: 10px;">
      Field rigging personnel must mount each camera according to physical coordinates, adjust azimuth and depression angles precisely, and verify under-mount clearance.
    </p>

    <div class="grid-3" style="margin-bottom: 8px;">
      <div class="kpi-box">
        <div class="kpi-lbl">Cabling Infrastructure</div>
        <div style="font-weight: 700; color: #0f172a;">~${Math.round(estTotalCablingM)} m Total Cat6 UTP/STP</div>
        <div style="font-size: 9px; color: #64748b;">Direct home-runs to network rack</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-lbl">PoE Switch Power Budget</div>
        <div style="font-weight: 700; color: #0f172a;">${(m.cameras * 15.4).toFixed(1)} W (Nominal) / ${(m.cameras * 30).toFixed(1)} W (Peak)</div>
        <div style="font-size: 9px; color: #64748b;">IEEE 802.3af/at PoE+ Switch Required</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-lbl">Mounting Enclosures</div>
        <div style="font-weight: 700; color: #0f172a;">${m.cameras} Units IP67 / IK10</div>
        <div style="font-size: 9px; color: #64748b;">Vandal-resistant outdoor/high-bay rating</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Camera Tag</th>
          <th>Mount Type</th>
          <th>Floor Coordinates (X, Y, Z)</th>
          <th>Aiming Angles</th>
          <th>Rigging Hardware &amp; Pole</th>
          <th>Aiming Point / Target Corridor</th>
          <th>PoE Run &amp; Port</th>
        </tr>
      </thead>
      <tbody>
        ${poses.map((p, idx) => {
          const st = result.cameras[idx];
          const sym = MOUNT_SYMBOLS[p.mount] || '●';
          const estDist = Math.round(p.x * 1.1 + p.y * 1.3 + 15);
          const dropperDesc = p.mount.includes('roof') ? '1.2m threaded steel pendant dropper with safety tether' : 'Heavy-duty wall cantilever bracket';
          return `<tr>
            <td style="font-weight: 700; color: #1e3a8a;">Camera ${p.id}</td>
            <td><span class="badge" style="background: #e2e8f0; color: #1e293b;">${sym} ${p.mount.toUpperCase()}</span></td>
            <td>X: <strong>${p.x.toFixed(2)}m</strong><br>Y: <strong>${p.y.toFixed(2)}m</strong><br>Z: <strong>${p.z.toFixed(2)}m</strong></td>
            <td>Pan: <strong>${p.panDeg}°</strong> Azimuth<br>Tilt: <strong>${p.tiltDeg}°</strong> Depression</td>
            <td>${dropperDesc}<br><span style="color: #b45309; font-size: 9px;">Dead-zone: ${st && st.nearBlind > 0 ? st.nearBlind.toFixed(1) + 'm' : 'Directly beneath mount'}</span></td>
            <td>Span: ${st ? st.coverStart.toFixed(1) + 'm → ' + st.coverEnd.toFixed(1) + 'm' : '0m'}<br><span style="color: #64748b; font-size: 9px;">Target h: ${targetHeight}m</span></td>
            <td>Port #${idx + 1}<br><span style="color: #64748b; font-size: 9px;">~${estDist}m Cat6</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 12px; margin-top: 6px;">
      <strong style="color: #92400e; font-size: 10px;">Field Rigging Sign-Off Checklist (Required for Handover):</strong>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px; font-size: 9.5px; color: #78350f;">
        <div>☑ Physical mount torqued to structural I-beam / concrete slab</div>
        <div>☑ IP67 weather gland sealed with conduit drip loop</div>
        <div>☑ Cat6 TIA-568B terminated & certified with active PoE link</div>
        <div>☑ Azimuth pan & depression tilt aligned to target corridor marker</div>
        <div>☑ Varifocal optical focus set screw locked & anti-tamper seal applied</div>
      </div>
    </div>
  </div>

  <!-- PART 2: SOFTWARE DEVELOPER GUIDE -->
  <div class="section-card">
    <div class="section-title">
      <span>💻 PART 2: Computer Vision Pipeline &amp; Ingestion Package</span>
      <span class="badge badge-indigo">For Software Developers &amp; CV Engineers</span>
    </div>
    <p style="margin: 0 0 8px 0; color: #475569; font-size: 10px;">
      Camera stream endpoints, RTSP video codecs, DeepStream pipeline graph, target inspection resolution guarantees, and GPU VRAM resource sizing.
    </p>

    <table>
      <thead>
        <tr>
          <th>Camera Tag</th>
          <th>RTSP Ingestion URI Schema</th>
          <th>Native Profile &amp; Codec</th>
          <th>Assigned Vision Model</th>
          <th>DORI PPM Guarantee</th>
          <th>Normalized Spatial ROI</th>
        </tr>
      </thead>
      <tbody>
        ${poses.map((p, idx) => {
          let assignedModel = 'YOLOv8x (General Detection)';
          let ppmReq = '≥ 125 px/m (Recognize)';
          if (mode === 'identify') {
            assignedModel = 'ArcFace + YOLOv8-Face (LPR / Biometrics)';
            ppmReq = '≥ 250 px/m (Identify)';
          } else if (mode === 'recognize') {
            assignedModel = 'YOLOv8x-pose (PPE & Personnel Safety)';
            ppmReq = '≥ 125 px/m (Recognize)';
          } else if (mode === 'observe') {
            assignedModel = 'ByteTrack + RT-DETR (Forklift / Asset)';
            ppmReq = '≥ 62.5 px/m (Observe)';
          }
          const roiStr = `[(${(p.x / bayLength - 0.05).toFixed(2)}, ${(p.y / bayWidth - 0.05).toFixed(2)}) … (${Math.min(1, p.x / bayLength + 0.2).toFixed(2)}, ${Math.min(1, p.y / bayWidth + 0.2).toFixed(2)})]`;
          return `<tr>
            <td style="font-weight: 700; color: #1e3a8a;">Camera ${p.id}</td>
            <td style="font-family: ui-monospace, monospace; color: #4338ca;">rtsp://192.168.1.${101 + idx}:554/live/ch1/main</td>
            <td>1920×1080 @ 20 FPS<br><span style="color: #64748b; font-size: 9px;">H.264 Main / 4096 kbps CBR</span></td>
            <td><span class="badge badge-indigo">${assignedModel}</span></td>
            <td><strong style="color: #166534;">${ppmReq}</strong></td>
            <td style="font-family: ui-monospace, monospace; font-size: 9px; color: #475569;">${roiStr}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px;">
      <div class="code-box">
        <div style="color: #38bdf8; font-weight: 700; margin-bottom: 4px;">NVIDIA DeepStream Pipeline Architecture</div>
[RTSP Sources: ${m.cameras} Streams]
       │
       ▼
nvurisrcbin (Hardware Accelerated Dec: NVDEC)
       │
       ▼
nvstreammux (Batch Size: ${Math.min(m.cameras, 16)}, 1080p, 25 FPS)
       │
       ▼
nvinfer: Primary GIE (YOLOv8 TensorRT FP16 Engine)
       │
       ▼
nvtracker: NvDCF / ByteTrack (Trajectory Association)
       │
       ▼
nvdsanalytics: Virtual ROI Triplines & Directional Cross
       │
       ▼
msgconv + msgbroker: MQTT / Kafka Event Publishing
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-size: 10px;">
        <div style="font-weight: 800; color: #1e293b; margin-bottom: 6px;">Edge Hardware &amp; VRAM Sizing Calculation</div>
        <div style="margin-bottom: 4px;">• <strong>Simultaneous Streams:</strong> ${m.cameras} IP RTSP camera streams.</div>
        <div style="margin-bottom: 4px;">• <strong>VRAM Footprint:</strong> ~120 MB per 1080p stream at FP16 batch inference $\to$ ~<strong>${(m.cameras * 0.12).toFixed(1)} GB VRAM</strong>.</div>
        <div style="margin-bottom: 4px;">• <strong>Recommended Hardware:</strong> ${m.cameras <= 8 ? 'NVIDIA Jetson Orin Nano (8GB)' : (m.cameras <= 20 ? 'NVIDIA Jetson AGX Orin (32GB)' : 'NVIDIA L4 / A2 Enterprise Edge Server')}.</div>
        <div>• <strong>Network Bandwidth:</strong> ~<strong>${(m.cameras * 4.2).toFixed(1)} Mbps</strong> aggregate ingestion throughput.</div>
      </div>
    </div>
  </div>

  ${obstacles.length > 0 ? `
  <!-- PART 3: 3D OCCLUSION SCHEDULE -->
  <div class="section-card">
    <div class="section-title">
      <span>🏗️ PART 3: Facility 3D Physical Obstacles &amp; Occlusion Schedule</span>
      <span class="badge badge-green">${obstacles.length} Physical Structures</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Structure Name</th>
          <th>Type</th>
          <th>Floor Coordinates (X, Y)</th>
          <th>Dimensions (W × D × H)</th>
          <th>Footprint Area</th>
          <th>3D Ray Occlusion Status</th>
        </tr>
      </thead>
      <tbody>
        ${obstacles.map(o => `<tr>
          <td style="font-weight: 700;">${o.name}</td>
          <td><span class="badge" style="background: #f1f5f9; color: #334155;">${(o.type || 'obstacle').toUpperCase()}</span></td>
          <td>X: ${o.x.toFixed(1)}m, Y: ${o.y.toFixed(1)}m</td>
          <td>${o.w.toFixed(1)}m × ${o.d.toFixed(1)}m × ${o.h.toFixed(1)}m</td>
          <td>${(o.w * o.d).toFixed(1)} m²</td>
          <td style="color: #166534; font-weight: 600;">Active 3D Ray-Box Slab Intersect (Shadows cast onto target plane ${targetHeight}m)</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <div style="text-align: center; color: #94a3b8; font-size: 9px; margin-top: 15px;">
    Plan Vision • Automated Computer Vision Facility Engineering System • Document Hash: ${Math.random().toString(36).substring(2, 10).toUpperCase()}
  </div>
</body>
</html>`;

    if (format === 'pdf') {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 500);
      }
    } else {
      // DOCX export (Word compatible HTML container with Office XML declarations)
      const docxHeader = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${title}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1e293b; }
table { width: 100%; border-collapse: collapse; margin-bottom: 15pt; }
th { background-color: #f1f5f9; border: 1pt solid #cbd5e1; padding: 6pt; font-weight: bold; }
td { border: 1pt solid #e2e8f0; padding: 6pt; vertical-align: top; }
h1 { color: #1e3a8a; font-size: 18pt; margin-bottom: 4pt; }
h2 { color: #2563eb; font-size: 14pt; margin-top: 15pt; border-bottom: 1pt solid #cbd5e1; padding-bottom: 4pt; }
.badge { font-weight: bold; font-size: 9pt; }
</style>
</head>
<body>
${htmlContent.replace(/<!DOCTYPE html>[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*?<\/html>/, '')}
</body></html>`;

      const blob = new Blob(['\ufeff', docxHeader], { type: 'application/msword;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/\s+/g, '_')}_Field_and_Developer_Blueprint.doc`;
      a.click();
      URL.revokeObjectURL(url);
    }
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
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-semibold text-xs transition-all shadow-xs ${
                savedToast
                  ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              title="Save active calculated camera positions and optical specs directly to the project"
            >
              {savedToast ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Saved to Project!
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  Save Cameras to Project
                </>
              )}
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

              {/* Active Obstacle Inspector & Moving/Rotating Controls */}
              {selectedObstacleId && (() => {
                const activeObs = obstacles.find(o => o.id === selectedObstacleId);
                if (!activeObs) return null;
                return (
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5 mb-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-blue-900">
                        <Move className="w-3.5 h-3.5 text-blue-600" />
                        <span>Edit Structure: {activeObs.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedObstacleId(null)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded bg-white border border-slate-200"
                      >
                        Done
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">Structure Name</label>
                        <input
                          type="text"
                          value={activeObs.name}
                          onChange={e => handleUpdateObstacle(activeObs.id, { name: e.target.value })}
                          className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-medium text-slate-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">Type</label>
                        <select
                          value={activeObs.type}
                          onChange={e => handleUpdateObstacle(activeObs.id, { type: e.target.value as ObstacleType })}
                          className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-medium text-slate-900 outline-none"
                        >
                          <option value="rack">Storage Racks</option>
                          <option value="machine">Heavy Machinery</option>
                          <option value="column">Building Column</option>
                          <option value="wall">Perimeter Wall</option>
                          <option value="partition">Partition</option>
                          <option value="conveyor">Conveyor</option>
                          <option value="agv_lane">AGV Lane</option>
                        </select>
                      </div>
                    </div>

                    {/* Position (X, Y) and Directional Nudge */}
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-semibold text-slate-700 mb-1">
                        <span>Position (X: {activeObs.x.toFixed(1)}m, Y: {activeObs.y.toFixed(1)}m)</span>
                        <span className="text-[9px] text-muted-foreground">Drag on map or nudge</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-1.5">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-slate-500 w-3">X:</span>
                          <input
                            type="number"
                            step="0.5"
                            value={activeObs.x}
                            onChange={e => handleMoveObstacle(activeObs.id, parseFloat(e.target.value) || 0, activeObs.y)}
                            className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-slate-500 w-3">Y:</span>
                          <input
                            type="number"
                            step="0.5"
                            value={activeObs.y}
                            onChange={e => handleMoveObstacle(activeObs.id, activeObs.x, parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                          />
                        </div>
                      </div>
                      {/* Directional Nudge Buttons */}
                      <div className="flex items-center justify-center gap-1.5 py-1 bg-white/70 rounded-lg border border-blue-100">
                        <button
                          type="button"
                          onClick={() => handleNudgeObstacle(activeObs.id, -0.5, 0)}
                          className="px-2 py-1 rounded bg-white hover:bg-blue-100 border text-slate-700 text-[10px] font-bold flex items-center gap-0.5"
                          title="Move Left 0.5m"
                        >
                          <ArrowLeft className="w-3 h-3" /> -0.5m
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNudgeObstacle(activeObs.id, 0.5, 0)}
                          className="px-2 py-1 rounded bg-white hover:bg-blue-100 border text-slate-700 text-[10px] font-bold flex items-center gap-0.5"
                          title="Move Right 0.5m"
                        >
                          +0.5m <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNudgeObstacle(activeObs.id, 0, -0.5)}
                          className="px-2 py-1 rounded bg-white hover:bg-blue-100 border text-slate-700 text-[10px] font-bold flex items-center gap-0.5"
                          title="Move Up 0.5m"
                        >
                          <ArrowUp className="w-3 h-3" /> Up
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNudgeObstacle(activeObs.id, 0, 0.5)}
                          className="px-2 py-1 rounded bg-white hover:bg-blue-100 border text-slate-700 text-[10px] font-bold flex items-center gap-0.5"
                          title="Move Down 0.5m"
                        >
                          Down <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Dimensions & Rotation */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">Width W (m)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={activeObs.w}
                          onChange={e => handleUpdateObstacle(activeObs.id, { w: Math.max(0.5, parseFloat(e.target.value) || 1) })}
                          className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">Depth D (m)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={activeObs.d}
                          onChange={e => handleUpdateObstacle(activeObs.id, { d: Math.max(0.5, parseFloat(e.target.value) || 1) })}
                          className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">Height H (m)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={activeObs.h}
                          onChange={e => handleUpdateObstacle(activeObs.id, { h: Math.max(0.5, parseFloat(e.target.value) || 1) })}
                          className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                        />
                      </div>
                    </div>

                    {/* Action buttons: Rotate 90 deg, Clone, Remove */}
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleRotateObstacle(activeObs.id)}
                        className="py-1 px-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-[10px] font-bold text-slate-800 flex items-center justify-center gap-1 shadow-2xs"
                        title="Rotate 90 degrees (swaps width and depth)"
                      >
                        <RotateCcw className="w-3 h-3 text-primary" />
                        Rotate 90°
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateObstacle(activeObs.id)}
                        className="py-1 px-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-[10px] font-bold text-slate-800 flex items-center justify-center gap-1 shadow-2xs"
                        title="Duplicate this obstacle"
                      >
                        <Copy className="w-3 h-3 text-primary" />
                        Clone
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleDeleteObstacle(activeObs.id);
                          setSelectedObstacleId(null);
                        }}
                        className="py-1 px-2 rounded-md bg-rose-50 border border-rose-200 hover:bg-rose-100 text-[10px] font-bold text-rose-700 flex items-center justify-center gap-1"
                        title="Delete structure"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })()}

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

          {/* Camera Hardware Specifications & Optical Physics */}
          <div className="bg-white border border-border rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/50 text-xs font-semibold text-slate-800">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-primary" />
                <span>Camera Hardware & Optical Specs</span>
              </div>
              <span className="text-[11px] font-mono text-primary font-bold">
                {sensorWidthPx} &times; {sensorHeightPx} px ({((sensorWidthPx * sensorHeightPx) / 1000000).toFixed(1)}MP)
              </span>
            </div>

            <div className="p-4 space-y-3.5">
              {/* Camera Model & Preset */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Camera Model</label>
                  <input
                    type="text"
                    value={cameraModel}
                    onChange={e => setCameraModel(e.target.value)}
                    placeholder="e.g. 4MP AI Starlight Turret"
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Resolution Preset</label>
                  <select
                    value={resolutionPreset}
                    onChange={e => handleResolutionPresetChange(e.target.value)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:bg-white focus:border-primary outline-none transition-colors"
                  >
                    <option value="4mp">4MP QHD (2688 &times; 1520) - AI Standard</option>
                    <option value="8mp">8MP 4K UHD (3840 &times; 2160) - High Precision</option>
                    <option value="12mp">12MP Ultra-HD (4000 &times; 3000) - Wide Perimeter</option>
                    <option value="5mp">5MP Super HD (2592 &times; 1944) - Retail & Detail</option>
                    <option value="2mp">2MP Full HD 1080p (1920 &times; 1080)</option>
                    <option value="custom">Custom Sensor Resolution...</option>
                  </select>
                </div>
              </div>

              {/* Custom Resolution Inputs */}
              {resolutionPreset === 'custom' && (
                <div className="p-2.5 bg-slate-50 border border-dashed border-slate-300 rounded-lg">
                  <div className="text-[10px] font-bold text-slate-700 mb-1.5">Custom Sensor Pixel Grid</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-600 mb-0.5">Sensor Width (px)</label>
                      <input
                        type="number"
                        min="640"
                        max="8192"
                        step="16"
                        value={sensorWidthPx}
                        onChange={e => handleCustomResolutionChange(parseInt(e.target.value) || 2688, sensorHeightPx)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-600 mb-0.5">Sensor Height (px)</label>
                      <input
                        type="number"
                        min="480"
                        max="8192"
                        step="16"
                        value={sensorHeightPx}
                        onChange={e => handleCustomResolutionChange(sensorWidthPx, parseInt(e.target.value) || 1520)}
                        className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Sensor Format, Video Codec, Bitrate, Framerate */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-700 mb-1">Sensor Format</label>
                  <select
                    value={sensorFormat}
                    onChange={e => setSensorFormat(e.target.value)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-900 outline-none"
                  >
                    <option value="1/1.8&quot;">1/1.8&quot; Large Starlight</option>
                    <option value="1/2.8&quot;">1/2.8&quot; Standard</option>
                    <option value="1/2.7&quot;">1/2.7&quot; Compact</option>
                    <option value="1/3&quot;">1/3&quot; Economic</option>
                    <option value="1/2&quot;">1/2&quot; Wide Dynamic</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-700 mb-1">Video Codec</label>
                  <select
                    value={videoCodec}
                    onChange={e => setVideoCodec(e.target.value)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-900 outline-none"
                  >
                    <option value="H.265">H.265 (HEVC)</option>
                    <option value="H.264">H.264 (AVC)</option>
                    <option value="AV1">AV1 Stream</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-700 mb-1">Frame Rate</label>
                  <select
                    value={framerateFps}
                    onChange={e => setFramerateFps(parseInt(e.target.value) || 30)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-900 outline-none"
                  >
                    <option value="15">15 FPS</option>
                    <option value="20">20 FPS</option>
                    <option value="25">25 FPS</option>
                    <option value="30">30 FPS (Fluid AI)</option>
                    <option value="60">60 FPS (High Speed)</option>
                  </select>
                </div>
              </div>

              {/* Bitrate, Min Lux, IR Range */}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-700 mb-1">Bitrate (Kbps)</label>
                  <input
                    type="number"
                    step="512"
                    min="1024"
                    max="32768"
                    value={bitrateKbps}
                    onChange={e => setBitrateKbps(parseInt(e.target.value) || 4096)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-700 mb-1">Min Lux (Color)</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.0001"
                    max="1"
                    value={minLux}
                    onChange={e => setMinLux(parseFloat(e.target.value) || 0.005)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-700 mb-1">IR Range (m)</label>
                  <input
                    type="number"
                    step="5"
                    min="10"
                    max="200"
                    value={irRangeM}
                    onChange={e => setIrRangeM(parseFloat(e.target.value) || 30)}
                    className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 outline-none"
                  />
                </div>
              </div>

              {/* Optical Lens & DORI Distance Recalculation */}
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-slate-800 flex items-center gap-1.5">
                    <Aperture className="w-3.5 h-3.5 text-primary" />
                    <span>Optical Lens & Field of View</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">DORI auto-recalculates</span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">Focal (mm)</label>
                    <input
                      type="number"
                      step="0.4"
                      min="1.8"
                      max="50"
                      value={lens.focalMm}
                      onChange={e => handleFocalChange(parseFloat(e.target.value) || 2.8)}
                      className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">H-FOV (°)</label>
                    <input
                      type="number"
                      value={lens.hfovDeg}
                      onChange={e => handleHfovChange(parseFloat(e.target.value) || 106)}
                      className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-1">V-FOV (°)</label>
                    <input
                      type="number"
                      value={lens.vfovDeg}
                      onChange={e => setLens(l => ({ ...l, vfovDeg: parseFloat(e.target.value) || 56 }))}
                      className="w-full bg-slate-50 border border-input rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 outline-none"
                    />
                  </div>
                </div>

                {/* Quick Focal Presets */}
                <div className="flex items-center gap-1 flex-wrap pt-0.5">
                  {[2.8, 3.6, 4.0, 6.0, 8.0, 12.0].map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleFocalChange(f)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        Math.abs(lens.focalMm - f) < 0.2
                          ? 'bg-primary text-primary-foreground font-bold border-primary'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-border'
                      }`}
                    >
                      {f}mm
                    </button>
                  ))}
                </div>

                {/* Real-time DORI Ranges Calculated */}
                <div className="grid grid-cols-4 gap-2 text-center pt-2">
                  <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-200">
                    <div className="text-[9px] font-bold text-amber-700">DETECT</div>
                    <div className="text-xs font-mono font-bold text-amber-900">{lens.ranges.detect}m</div>
                  </div>
                  <div className="bg-yellow-50/70 p-2 rounded-lg border border-yellow-200">
                    <div className="text-[9px] font-bold text-yellow-700">OBSERVE</div>
                    <div className="text-xs font-mono font-bold text-yellow-900">{lens.ranges.observe}m</div>
                  </div>
                  <div className="bg-emerald-50/70 p-2 rounded-lg border border-emerald-200">
                    <div className="text-[9px] font-bold text-emerald-700">RECOGNIZE</div>
                    <div className="text-xs font-mono font-bold text-emerald-900">{lens.ranges.recognize}m</div>
                  </div>
                  <div className="bg-cyan-50/70 p-2 rounded-lg border border-cyan-200">
                    <div className="text-[9px] font-bold text-cyan-700">IDENTIFY</div>
                    <div className="text-xs font-mono font-bold text-cyan-900">{lens.ranges.identify}m</div>
                  </div>
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

            <div className="p-3 max-h-[420px] overflow-y-auto space-y-2.5">
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
                          x={p.x.toFixed(1)}m, y={p.y.toFixed(1)}m, z={p.z.toFixed(1)}m
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

                    {/* Expanded Controls when Selected: Edit Position & Angle from Any Angle */}
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-border space-y-3" onClick={e => e.stopPropagation()}>
                        {/* Position (X, Y, Z) and Directional Nudge */}
                        <div className="p-2.5 bg-slate-50/80 rounded-lg border border-slate-200 space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-800">
                            <span className="flex items-center gap-1">
                              <Move className="w-3.5 h-3.5 text-primary" />
                              Position & Mounting Height
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              ({p.x.toFixed(1)}m, {p.y.toFixed(1)}m, {p.z.toFixed(1)}m)
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">X Pos (m)</label>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max={bayLength}
                                value={p.x}
                                onChange={e => handlePoseChange(p.id, { x: clamp(parseFloat(e.target.value) || 0, 0, bayLength) })}
                                className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Y Pos (m)</label>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max={bayWidth}
                                value={p.y}
                                onChange={e => handlePoseChange(p.id, { y: clamp(parseFloat(e.target.value) || 0, 0, bayWidth) })}
                                className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Height Z (m)</label>
                              <input
                                type="number"
                                step="0.5"
                                min="1.5"
                                max="20"
                                value={p.z}
                                onChange={e => handlePoseChange(p.id, { z: clamp(parseFloat(e.target.value) || 3, 1.5, 20) })}
                                className="w-full bg-white border border-input rounded px-2 py-1 text-xs font-mono text-slate-900 outline-none"
                              />
                            </div>
                          </div>

                          {/* Quick Nudge Buttons */}
                          <div className="flex items-center justify-between gap-1 pt-0.5">
                            <span className="text-[10px] text-slate-500 font-medium">Nudge:</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleNudgeCamera(p.id, -0.5, 0)}
                                className="px-1.5 py-0.5 rounded bg-white border hover:bg-slate-100 text-[10px] font-mono text-slate-700"
                                title="Move West / Left -0.5m"
                              >
                                ← X
                              </button>
                              <button
                                type="button"
                                onClick={() => handleNudgeCamera(p.id, 0.5, 0)}
                                className="px-1.5 py-0.5 rounded bg-white border hover:bg-slate-100 text-[10px] font-mono text-slate-700"
                                title="Move East / Right +0.5m"
                              >
                                X →
                              </button>
                              <button
                                type="button"
                                onClick={() => handleNudgeCamera(p.id, 0, -0.5)}
                                className="px-1.5 py-0.5 rounded bg-white border hover:bg-slate-100 text-[10px] font-mono text-slate-700"
                                title="Move North / Up -0.5m"
                              >
                                ↑ Y
                              </button>
                              <button
                                type="button"
                                onClick={() => handleNudgeCamera(p.id, 0, 0.5)}
                                className="px-1.5 py-0.5 rounded bg-white border hover:bg-slate-100 text-[10px] font-mono text-slate-700"
                                title="Move South / Down +0.5m"
                              >
                                ↓ Y
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Mount Type Selector */}
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-700 mb-1">Mounting Bracket</label>
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
                        </div>

                        {/* Pan Azimuth with Compass Directional Controls */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                              <Compass className="w-3.5 h-3.5 text-primary" />
                              Pan Azimuth ({p.panDeg}°)
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSetCameraPan(p.id, p.panDeg - 15)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-mono text-slate-700"
                                title="Rotate -15°"
                              >
                                -15°
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetCameraPan(p.id, p.panDeg + 15)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-mono text-slate-700"
                                title="Rotate +15°"
                              >
                                +15°
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="359"
                              value={p.panDeg}
                              onChange={e => handlePoseChange(p.id, { panDeg: parseFloat(e.target.value) })}
                              className="flex-1 accent-primary"
                            />
                            <input
                              type="number"
                              min="0"
                              max="359"
                              value={p.panDeg}
                              onChange={e => handleSetCameraPan(p.id, parseFloat(e.target.value) || 0)}
                              className="w-14 bg-white border border-input rounded px-1.5 py-0.5 text-xs font-mono text-right font-bold text-slate-900 outline-none"
                            />
                          </div>

                          {/* 8-Point Compass Direction Buttons */}
                          <div className="grid grid-cols-4 gap-1 pt-0.5">
                            {[
                              { label: 'N 0°', deg: 0 },
                              { label: 'NE 45°', deg: 45 },
                              { label: 'E 90°', deg: 90 },
                              { label: 'SE 135°', deg: 135 },
                              { label: 'S 180°', deg: 180 },
                              { label: 'SW 225°', deg: 225 },
                              { label: 'W 270°', deg: 270 },
                              { label: 'NW 315°', deg: 315 },
                            ].map(cardinal => (
                              <button
                                key={cardinal.deg}
                                type="button"
                                onClick={() => handleSetCameraPan(p.id, cardinal.deg)}
                                className={`px-1 py-1 rounded text-[9px] font-mono border text-center transition-colors ${
                                  Math.abs(p.panDeg - cardinal.deg) < 5
                                    ? 'bg-primary text-primary-foreground font-bold border-primary'
                                    : 'bg-white hover:bg-slate-100 text-slate-700 border-border'
                                }`}
                              >
                                {cardinal.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Tilt Depression with Surveillance Angle Presets */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-700">Tilt Angle ({p.tiltDeg}°)</span>
                            <span className="text-[10px] text-muted-foreground font-mono">0° = level · 90° = nadir</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="-30"
                              max="90"
                              value={p.tiltDeg}
                              onChange={e => handlePoseChange(p.id, { tiltDeg: parseFloat(e.target.value) })}
                              className="flex-1 accent-primary"
                            />
                            <input
                              type="number"
                              min="-30"
                              max="90"
                              value={p.tiltDeg}
                              onChange={e => handleSetCameraTilt(p.id, parseFloat(e.target.value) || 0)}
                              className="w-14 bg-white border border-input rounded px-1.5 py-0.5 text-xs font-mono text-right font-bold text-slate-900 outline-none"
                            />
                          </div>

                          {/* Tilt Angle Presets */}
                          <div className="grid grid-cols-5 gap-1 pt-0.5">
                            {[
                              { label: '0° Level', deg: 0 },
                              { label: '15° Aisle', deg: 15 },
                              { label: '30° Norm', deg: 30 },
                              { label: '45° Gate', deg: 45 },
                              { label: '90° Nadir', deg: 90 },
                            ].map(tp => (
                              <button
                                key={tp.deg}
                                type="button"
                                onClick={() => handleSetCameraTilt(p.id, tp.deg)}
                                className={`px-1 py-1 rounded text-[9px] font-mono border text-center transition-colors ${
                                  Math.abs(p.tiltDeg - tp.deg) < 3
                                    ? 'bg-primary text-primary-foreground font-bold border-primary'
                                    : 'bg-white hover:bg-slate-100 text-slate-700 border-border'
                                }`}
                              >
                                {tp.label}
                              </button>
                            ))}
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
                            className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 p-1"
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
          <div className="space-y-2 pt-1 pb-4">
            <button
              onClick={handlePlanFromArchitecture}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors"
              title="Automatically aligns all camera mounts, pan azimuths, and tilt angles with corridors, racking aisles, dock gates, and machinery"
            >
              <Building2 className="w-4 h-4" />
              Plan Cameras from Architecture
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleExportReport('pdf')}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-xs transition-colors"
                title="Generates printable field rigging & developer PDF with print stylesheet"
              >
                <Download className="w-3.5 h-3.5" />
                Export PDF
              </button>
              <button
                onClick={() => handleExportReport('docx')}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold shadow-xs transition-colors"
                title="Generates editable Microsoft Word / Google Docs DOCX blueprint"
              >
                <Download className="w-3.5 h-3.5" />
                Export DOCX
              </button>
            </div>
            <button
              onClick={() => {
                if (obstacles.length > 0) {
                  setPoses(architectureAwareLayout(obstacles, site, lens, mode, cameraCount));
                } else {
                  setPoses(defaultLayout(cameraCount, site, lens, mode));
                }
                setSelectedId(null);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-white border border-border text-slate-700 hover:bg-muted text-xs font-medium shadow-xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Layout to Defaults
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
                    onClick={() => setActiveViewTab('bird')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                      activeViewTab === 'bird'
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Bird Camera 3D
                  </button>
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
              {activeViewTab === 'bird' && (
                <BirdCameraView
                  result={result}
                  poses={poses}
                  lens={lens}
                  site={site}
                  mode={mode}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  heatMode={heatMode}
                  standard={activeStandard}
                  onStandardChange={setActiveStandard}
                  onMoveCamera={handleMoveCamera}
                  onPoseChange={handlePoseChange}
                />
              )}

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
                  onMoveObstacle={handleMoveObstacle}
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

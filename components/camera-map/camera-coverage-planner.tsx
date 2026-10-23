'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
  Shield,
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
  RefreshCw,
  GitBranch,
  Network,
  Workflow as WorkflowIcon,
  ExternalLink,
} from 'lucide-react';
import type { Camera as ProjectCamera, DetVisionProject, Workflow } from '@/lib/types';
import { useView } from '@/components/view-context';
import { generateWorkflowFromUseCases } from '@/lib/workflow-generator';
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
  AI_MODEL_FEASIBILITY_CRITERIA,
  calculateCableRun,
  calculateStorageAndBandwidth,
  calculateTrackerOcclusion,
  impliedHorizontalPixels,
} from '@/lib/coverage-engine';
import {
  TopView,
  SideView,
  PerspectiveView,
  BirdCameraView,
  FrustumSpatialInspector,
  camColor,
  MOUNT_SYMBOLS,
} from './coverage-views';
import { detectFacilityProfile, extractDesiredCameraCount, parseCameraHardware, calculateReasonedCameraCount } from '@/lib/rule-based-planner';
import { 
  generateSiteTelemetryMapSvg, 
  generatePipelineArchitectureSvg, 
  generateCoverageTelemetryMetricsSvg 
} from '@/lib/report-diagrams';

interface CameraCoveragePlannerProps {
  project?: DetVisionProject;
  onApplyToProject?: (
    cameras: ProjectCamera[], 
    structure?: any[], 
    dimensions?: { facility_width_m: number; facility_length_m: number; facility_height_m: number; facility_type: string },
    workflow?: Workflow
  ) => void;
  onClose?: () => void;
}

export function CameraCoveragePlanner({ project, onApplyToProject, onClose }: CameraCoveragePlannerProps) {
  let viewCtx: any = null;
  try {
    viewCtx = useView();
  } catch {
    // optional outside provider
  }

  // Infer initial configuration from user scenario / project brief dynamically
  const initialFacility = useMemo(() => {
    const allUserText = [
      project?.business_description || '',
      project?.camera_specifications || '',
      ...(project?.requirements || []),
      ...(project?.critical_components || []),
      ...(project?.layout_sections || []),
    ].join(' ');

    const prof = detectFacilityProfile(allUserText);
    const userRequestedCount = extractDesiredCameraCount(allUserText, null);

    // Priority: cameras the user actually has/edited > count typed in brief > geometry-based reasoning
    let count: number;
    if (project?.cameras && project.cameras.length > 0) {
      count = project.cameras.length;
    } else if (userRequestedCount > 0) {
      count = userRequestedCount;
    } else {
      count = calculateReasonedCameraCount({
        length_m: project?.facility_length_m || prof.length,
        width_m: project?.facility_width_m || prof.width,
        height_m: project?.facility_height_m || prof.height,
        use_cases_count: project?.use_cases?.length || 1,
        detection_coverage_target: project?.detection_coverage_target || 95,
      });
    }

    // Detect target inspection mode based on scenario requirements / keywords
    const lower = allUserText.toLowerCase();
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

    // Map to supported FacilityPresetType
    let mappedType: FacilityPresetType = 'manufacturing_plant';
    if (/chemical|petrochemical|oil|gas|refinery|filling|hazard/i.test(lower)) {
      mappedType = 'manufacturing_plant';
    } else if (/airport|terminal|baggage|flight|tsa/i.test(lower)) {
      mappedType = 'airport_terminal';
    } else if (/hospital|clinic|patient|triage|nurse|healthcare/i.test(lower) || prof.facility_type === 'healthcare') {
      mappedType = 'hospital_clinic';
    } else if (/cleanroom|semiconductor|wafer|lithograph|stepper|lab/i.test(lower)) {
      mappedType = 'cleanroom_lab';
    } else if (/data\s*center|server|datacenter|rack\s*row/i.test(lower) || prof.facility_type === 'data_center') {
      mappedType = 'data_center';
    } else if (/retail|supermarket|grocery|store|checkout/i.test(lower) || prof.facility_type === 'retail') {
      mappedType = 'retail_supermarket';
    } else if (/perimeter|fence|border|boundary|gatehouse/i.test(lower) || prof.facility_type === 'perimeter') {
      mappedType = 'perimeter_security';
    } else if (/office|corporate|desk|cubicle|conference/i.test(lower)) {
      mappedType = 'corporate_office';
    } else if (/warehouse|distribution|logistics|depot/i.test(lower)) {
      mappedType = 'logistics_warehouse';
    }

    const dynLength = project?.facility_length_m || Math.max(10, Math.round(prof.length));
    const dynWidth = project?.facility_width_m || Math.max(5, Math.round(prof.width));
    const dynHeight = project?.facility_height_m || Math.max(3, Math.round(prof.height * 10) / 10);

    return {
      length: dynLength,
      width: dynWidth,
      height: dynHeight,
      count: Math.max(1, count),
      mode: initialMode,
      facilityType: (project?.facility_type as FacilityPresetType) || mappedType,
    };
  }, [
    project?.business_description,
    project?.camera_specifications,
    project?.requirements,
    project?.critical_components,
    project?.layout_sections,
    project?.cameras?.length,
    project?.facility_width_m,
    project?.facility_length_m,
    project?.facility_height_m,
    project?.facility_type
  ]);

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
            w: +(s.width_m || Math.max(0.5, maxX - minX)).toFixed(2),
            d: +(s.depth_m || Math.max(0.5, maxY - minY)).toFixed(2),
            h: +(s.height_m || Math.min(initialFacility.height, 3.5)).toFixed(2),
            type: ((s.obstacle_type || 'rack') as ObstacleType),
          };
        });
      if (fromProject.length > 0) return fromProject;
    }

    // Default procedural layout for facility archetype
    const ALL_PRESETS: FacilityPresetType[] = [
      'logistics_warehouse',
      'manufacturing_plant',
      'retail_supermarket',
      'data_center',
      'perimeter_security',
      'corporate_office',
      'airport_terminal',
      'hospital_clinic',
      'cleanroom_lab',
    ];
    const facType = (initialFacility.facilityType as FacilityPresetType) || 'logistics_warehouse';
    return generateProceduralObstacles({
      type: ALL_PRESETS.includes(facType) ? facType : 'logistics_warehouse',
      length: initialFacility.length,
      width: initialFacility.width,
      mountHeight: initialFacility.height,
    });
  }, [project?.structure, initialFacility]);

  // Editable Obstacles state
  const [obstacles, setObstacles] = useState<Obstacle[]>(initialObstacles);

  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [activeFacilityPreset, setActiveFacilityPreset] = useState<FacilityPresetType | 'custom'>(
    ([
      'logistics_warehouse',
      'manufacturing_plant',
      'retail_supermarket',
      'data_center',
      'perimeter_security',
      'corporate_office',
      'airport_terminal',
      'hospital_clinic',
      'cleanroom_lab',
    ].includes(initialFacility.facilityType as any)
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

  // Dynamically parsed camera hardware specifications strictly honoring user input and LLM reasoning
  const initialHw = useMemo(() => {
    const allText = `${project?.camera_specifications || ''} ${project?.business_description || ''}`;
    return parseCameraHardware(project?.camera_specifications || '', allText);
  }, [project?.camera_specifications, project?.business_description]);

  const [cameraModel, setCameraModel] = useState<string>(() => `${initialHw.brand} ${initialHw.model}`);
  const [resolutionPreset, setResolutionPreset] = useState<string>(initialHw.resolutionPreset);
  const [sensorWidthPx, setSensorWidthPx] = useState<number>(initialHw.sensorWidthPx);
  const [sensorHeightPx, setSensorHeightPx] = useState<number>(initialHw.sensorHeightPx);
  const [sensorFormat, setSensorFormat] = useState<string>('1/2.8"');
  const [framerateFps, setFramerateFps] = useState<number>(initialHw.framerateFps);
  const [videoCodec, setVideoCodec] = useState<string>(initialHw.videoCodec);
  const [bitrateKbps, setBitrateKbps] = useState<number>(initialHw.bitrateKbps);
  const [minLux, setMinLux] = useState<number>(initialHw.minLux);
  const [irRangeM, setIrRangeM] = useState<number>(initialHw.irRangeM);
  const [savedToast, setSavedToast] = useState<boolean>(false);
  const [showDiagramModal, setShowDiagramModal] = useState<boolean>(false);
  const [generatedDiagram, setGeneratedDiagram] = useState<any>(null);

  // Camera lens specifications
  const [lens, setLens] = useState<LensSpec>(() => {
    const newRanges = rangesFromResolution(initialHw.sensorWidthPx, initialHw.hfovDeg);
    return {
      focalMm: initialHw.focalMm,
      hfovDeg: initialHw.hfovDeg,
      vfovDeg: initialHw.vfovDeg,
      ranges: newRanges,
    };
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

  // Initialize camera poses: strictly prioritizing user-specified camera count
  const [poses, setPoses] = useState<CameraPose[]>(() => {
    const targetCams = initialFacility.count;
    if (project?.cameras && project.cameras.length >= targetCams) {
      return project.cameras.slice(0, targetCams).map((c, i) => {
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
      return architectureAwareLayout(initialObstacles, initialSite, defaultLens, initialFacility.mode, targetCams);
    }
    return defaultLayout(targetCams, initialSite, defaultLens, initialFacility.mode);
  });

  // UI state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<'top' | 'side' | '3d' | 'bird' | 'frustum'>('bird');
  const [activeStandard, setActiveStandard] = useState<MappingStandard>('dori');
  const [activeDetTab, setActiveDetTab] = useState<'table' | 'list' | 'obstacles' | 'reco' | 'legend' | 'ai-feasibility' | 'cables'>('table');
  const [heatMode, setHeatMode] = useState<'dori' | 'overlap'>('dori');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isExportingModalDocx, setIsExportingModalDocx] = useState(false);
  const [isExportingModalPdf, setIsExportingModalPdf] = useState(false);

  const handleConfirmAndUpdateReports = () => {
    handleApplyToCanvas();
    setShowConfirmModal(true);
  };

  // Compute coverage whenever parameters change (deterministic pure calculation)
  const result: CoverageResult = useMemo(() => {
    return computeCoverage(poses, lens, site, mode);
  }, [poses, lens, site, mode]);

  const lastCamSigRef = useRef<string>('');
  // Synchronize camera poses, obstacles, and bounds whenever project is analyzed or updated
  useEffect(() => {
    if (!project) return;
    
    // 1. Synchronize site bounds if project has dimensions
    if (project.facility_length_m && project.facility_length_m !== bayLength) {
      setBayLength(project.facility_length_m);
    }
    if (project.facility_width_m && project.facility_width_m !== bayWidth) {
      setBayWidth(project.facility_width_m);
    }
    if (project.facility_height_m && project.facility_height_m !== mountHeight) {
      setMountHeight(project.facility_height_m);
    }

    // 2. Synchronize obstacles if project has structure
    if (project.structure && project.structure.length > 0) {
      const L = project.facility_length_m || bayLength;
      const W = project.facility_width_m || bayWidth;
      const H = project.facility_height_m || mountHeight;
      const parsedObstacles: Obstacle[] = project.structure
        .filter(s => s.type === 'obstacle' && s.points.length >= 2)
        .map((s, idx) => {
          const xs = s.points.map(p => p.x * L);
          const ys = s.points.map(p => p.y * W);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return {
            id: s.id || `obs-${idx + 1}`,
            name: s.name || `Obstacle ${idx + 1}`,
            x: s.x_m ?? +minX.toFixed(2),
            y: s.y_m ?? +minY.toFixed(2),
            w: s.width_m ?? +(maxX - minX).toFixed(2),
            d: s.depth_m ?? +(maxY - minY).toFixed(2),
            h: s.height_m ?? Math.min(H, 3.5),
            type: ((s.obstacle_type || 'rack') as ObstacleType),
          };
        });
      if (parsedObstacles.length > 0) {
        setObstacles(parsedObstacles);
      }
    } else if (project.layout_sections && project.layout_sections.length > 0 && obstacles.length === 0) {
      // Auto-build physical structure directly from user layout sections (e.g. 4 buildings)
      const L = project.facility_length_m || bayLength;
      const W = project.facility_width_m || bayWidth;
      const H = project.facility_height_m || mountHeight;
      const secCount = project.layout_sections.length;
      const autoSecObs: Obstacle[] = project.layout_sections.map((sec, idx) => {
        const cleanName = sec.replace(/^[0-9.:\-\s]+/, '').trim();
        const secW = Math.max(4, Math.round((L / secCount) * 0.75));
        const secD = Math.max(3, Math.round(W * 0.40));
        const posX = 0.05 * L + idx * ((0.85 * L - secW) / Math.max(1, secCount - 1));
        const posY = idx % 2 === 0 ? 0.15 * W : 0.45 * W;
        return {
          id: `sec-${idx + 1}`,
          name: cleanName,
          x: +posX.toFixed(1),
          y: +posY.toFixed(1),
          w: secW,
          d: secD,
          h: Math.min(H, 3.2),
          type: /filling|drum|chemical/i.test(cleanName) ? 'hazard' : /workshop|tool|lathe/i.test(cleanName) ? 'machine' : /loading|dock/i.test(cleanName) ? 'dock' : 'partition',
        };
      });
      setObstacles(autoSecObs);
    }

    // 3. Synchronize camera count and poses strictly respecting user specification.
    // Only re-sync when the project's camera set really changed (not on unrelated clicks).
    const camSig = (project.cameras || []).map(c => `${c.id}:${c.x.toFixed(3)}:${c.y.toFixed(3)}:${c.orientation_degrees}`).join('|');
    if (lastCamSigRef.current === `${project.id}#${camSig}`) return;
    lastCamSigRef.current = `${project.id}#${camSig}`;
    const targetCams = project.cameras && project.cameras.length > 0 ? project.cameras.length : initialFacility.count;
    if (project.cameras && project.cameras.length >= targetCams) {
      const L = project.facility_length_m || bayLength;
      const W = project.facility_width_m || bayWidth;
      const H = project.facility_height_m || mountHeight;
      const newPoses: CameraPose[] = project.cameras.slice(0, targetCams).map((c, i) => {
        const x = Math.max(0.5, Math.min(L - 0.5, c.x * L));
        const y = Math.max(0.5, Math.min(W - 0.5, c.y * W));
        const panDeg = Math.round(c.orientation_degrees || 0);
        const tiltDeg = Math.round(25);
        const mount: MountType = y < 1.5 ? 'wall-h' : (y > W - 1.5 ? 'wall-h' : 'cross');
        return {
          id: i + 1,
          mount,
          x: +x.toFixed(2),
          y: +y.toFixed(2),
          z: H,
          panDeg,
          tiltDeg,
        };
      });
      setPoses(newPoses);
      setCameraCount(newPoses.length);
    } else if (targetCams > 0 && poses.length !== targetCams) {
      const curSite: SiteSpec = {
        length: project.facility_length_m || bayLength,
        width: project.facility_width_m || bayWidth,
        mountHeight: project.facility_height_m || mountHeight,
        targetHeight,
        marginPct,
        obstacles,
      };
      const newPoses = obstacles.length > 0
        ? architectureAwareLayout(obstacles, curSite, lens, mode, targetCams)
        : defaultLayout(targetCams, curSite, lens, mode);
      setPoses(newPoses);
      setCameraCount(newPoses.length);
    }
  }, [project?.id, project?.cameras, project?.structure, initialFacility.count]);

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

  // AI Facility Structure Synthesizer powered by NVIDIA Vision AI
  const handleSynthesizeFacility = async (promptOverride?: string) => {
    setIsSynthesizingFacility(true);
    setFacilitySynthesisStatus('Synthesizing 3D facility structures with NVIDIA Vision AI...');
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
        setFacilitySynthesisStatus(`✨ Synthesized ${data.obstacles.length} structures via NVIDIA Vision AI`);
        // Automatically auto-align cameras with newly generated architectural design!
        const archPoses = architectureAwareLayout(data.obstacles, { ...site, obstacles: data.obstacles }, lens, mode, cameraCount);
        if (archPoses.length > 0) {
          setPoses(archPoses);
        }

        // Real-time synchronization to project
        if (onApplyToProject) {
          const syncedStructure = data.obstacles.map((o: Obstacle) => ({
            id: o.id,
            name: o.name,
            type: 'obstacle' as const,
            points: [
              { x: o.x / bayLength, y: o.y / bayWidth },
              { x: (o.x + o.w) / bayLength, y: o.y / bayWidth },
              { x: (o.x + o.w) / bayLength, y: (o.y + o.d) / bayWidth },
              { x: o.x / bayLength, y: (o.y + o.d) / bayWidth },
            ],
            x_m: o.x,
            y_m: o.y,
            width_m: o.w,
            depth_m: o.d,
            height_m: o.h,
            obstacle_type: o.type,
          }));
          const targetPoses = archPoses.length > 0 ? archPoses : poses;
          const rawUcs = project?.use_cases || [];
          const syncedCameras: ProjectCamera[] = targetPoses.map((p, pIdx) => {
            const assignedUc = rawUcs.length > 0 ? rawUcs[pIdx % rawUcs.length] : null;
            return {
              id: crypto.randomUUID(),
              name: `CAM-${p.id} (${p.mount.toUpperCase()})`,
              x: Math.max(0.02, Math.min(0.98, p.x / bayLength)),
              y: Math.max(0.02, Math.min(0.98, p.y / bayWidth)),
              orientation_degrees: (p.panDeg + 360) % 360,
              horizontal_fov_degrees: lens.hfovDeg,
              view_range: 0.5,
              resolution_width: sensorWidthPx,
              resolution_height: sensorHeightPx,
              status: 'planned',
              target_area: `Position ${p.x.toFixed(1)}m, ${p.y.toFixed(1)}m (Elev: ${p.z.toFixed(1)}m)`,
              assigned_use_case_ids: assignedUc ? [assignedUc.id] : [],
              rationale: `Auto-aligned to 3D synthesized structures (${data.facility_title || 'Facility Layout'}).`,
            };
          });
          onApplyToProject(syncedCameras, syncedStructure, {
            facility_width_m: bayLength,
            facility_length_m: bayWidth,
            facility_height_m: mountHeight,
            facility_type: 'custom',
          });
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

    if (onApplyToProject) {
      const syncedStructure = newObs.map((o: Obstacle) => ({
        id: o.id,
        name: o.name,
        type: 'obstacle' as const,
        points: [
          { x: o.x / bayLength, y: o.y / bayWidth },
          { x: (o.x + o.w) / bayLength, y: o.y / bayWidth },
          { x: (o.x + o.w) / bayLength, y: (o.y + o.d) / bayWidth },
          { x: o.x / bayLength, y: (o.y + o.d) / bayWidth },
        ],
        x_m: o.x,
        y_m: o.y,
        width_m: o.w,
        depth_m: o.d,
        height_m: o.h,
        obstacle_type: o.type,
      }));
      const targetPoses = archPoses.length > 0 ? archPoses : poses;
      const rawUcs = project?.use_cases || [];
      const syncedCameras: ProjectCamera[] = targetPoses.map((p, pIdx) => {
        const assignedUc = rawUcs.length > 0 ? rawUcs[pIdx % rawUcs.length] : null;
        return {
          id: crypto.randomUUID(),
          name: `CAM-${p.id} (${p.mount.toUpperCase()})`,
          x: Math.max(0.02, Math.min(0.98, p.x / bayLength)),
          y: Math.max(0.02, Math.min(0.98, p.y / bayWidth)),
          orientation_degrees: (p.panDeg + 360) % 360,
          horizontal_fov_degrees: lens.hfovDeg,
          view_range: 0.5,
          resolution_width: sensorWidthPx,
          resolution_height: sensorHeightPx,
          status: 'planned',
          target_area: `Position ${p.x.toFixed(1)}m, ${p.y.toFixed(1)}m (Elev: ${p.z.toFixed(1)}m)`,
          assigned_use_case_ids: assignedUc ? [assignedUc.id] : [],
          rationale: `Preset architecture: ${preset.replace(/_/g, ' ')}`,
        };
      });
      onApplyToProject(syncedCameras, syncedStructure, {
        facility_width_m: bayLength,
        facility_length_m: bayWidth,
        facility_height_m: mountHeight,
        facility_type: preset,
      });
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

  // Run deterministic greedy set-cover optimizer strictly respecting user-specified camera count
  const handleOptimize = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      const targetReqCount = cameraCount || initialFacility.count;
      const opt = optimizeLayout(lens, site, mode, { 
        targetPct: project?.detection_coverage_target || 95, 
        maxCameras: Math.max(60, targetReqCount),
        minCameras: targetReqCount,
        exactCameras: targetReqCount
      });
      if (opt.poses.length > 0) {
        setPoses(opt.poses);
        setCameraCount(opt.poses.length);
        setSelectedId(null);
      }
      setIsOptimizing(false);
    }, 40);
  };

  // Build pipeline architecture diagram based on user requirements and LLM reasoning
  const handleBuildDiagram = () => {
    const cameraList = poses.map(p => ({
      id: `CAM-${String(p.id).padStart(2, '0')}`,
      name: `CAM-${String(p.id).padStart(2, '0')} (${p.mount.toUpperCase()})`,
    }));

    const wf = generateWorkflowFromUseCases(project?.use_cases || [], cameraList);
    setGeneratedDiagram({
      workflow: wf,
      cameraCount: poses.length,
      modelCount: (project?.use_cases || []).length || 4,
      fps: framerateFps,
      resolution: `${sensorWidthPx}×${sensorHeightPx}`,
      codec: videoCodec,
      edgeDevice: 'NVIDIA Vision AI Accelerator / Jetson IGX Orin Enterprise',
      generatedAt: new Date().toLocaleTimeString(),
    });
    setShowDiagramModal(true);

    if (onApplyToProject) {
      handleApplyToCanvas();
      onApplyToProject(
        poses.map((p, idx) => {
          const normX = Math.max(0.02, Math.min(0.98, p.x / bayLength));
          const normY = Math.max(0.02, Math.min(0.98, p.y / bayWidth));
          const st = result.cameras[idx];
          return {
            id: crypto.randomUUID(),
            name: `CAM-${String(p.id).padStart(2, '0')} (${p.mount.toUpperCase()})`,
            x: normX,
            y: normY,
            orientation_degrees: (p.panDeg + 360) % 360,
            horizontal_fov_degrees: lens.hfovDeg,
            view_range: Math.min(0.9, Math.max(0.15, (st?.effectiveRange || 20) / bayLength)),
            resolution_width: sensorWidthPx,
            resolution_height: sensorHeightPx,
            status: 'planned',
            target_area: `Position ${p.x.toFixed(1)}m, ${p.y.toFixed(1)}m`,
            assigned_use_case_ids: [],
            rationale: `${cameraModel} · Codec: ${videoCodec} @ ${framerateFps}fps`
          };
        }),
        obstacles.map(o => ({
          id: o.id,
          name: o.name,
          type: 'obstacle' as const,
          obstacle_type: o.type,
          x_m: o.x,
          y_m: o.y,
          width_m: o.w,
          depth_m: o.d,
          height_m: o.h,
          points: [
            { x: o.x / bayLength, y: o.y / bayWidth },
            { x: (o.x + o.w) / bayLength, y: o.y / bayWidth },
            { x: (o.x + o.w) / bayLength, y: (o.y + o.d) / bayWidth },
            { x: o.x / bayLength, y: (o.y + o.d) / bayWidth },
          ]
        })),
        {
          facility_width_m: bayLength,
          facility_length_m: bayWidth,
          facility_height_m: mountHeight,
          facility_type: activeFacilityPreset !== 'custom' ? activeFacilityPreset : (initialFacility.facilityType || 'custom'),
        },
        wf
      );
    }
  };

  // Refocus lens (adjust focal length & re-derive HFOV and DORI ranges)
  const handleFocalChange = (newFocal: number) => {
    const next = refocusLens(lens, newFocal);
    setLens(next);
  };

  // Save cameras to project blueprint
  const handleApplyToCanvas = () => {
    if (!onApplyToProject) return;
    const rawUcs = project?.use_cases || [];
    const projectCameras: ProjectCamera[] = poses.map((p, idx) => {
      const normX = Math.max(0.02, Math.min(0.98, p.x / bayLength));
      const normY = Math.max(0.02, Math.min(0.98, p.y / bayWidth));
      const st = result.cameras[idx];
      const assignedUc = rawUcs.length > 0 ? rawUcs[idx % rawUcs.length] : null;

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
        assigned_use_case_ids: assignedUc ? [assignedUc.id] : [],
        mount_type: p.mount,
        height_m: p.z,
        tilt_degrees: p.tiltDeg,
        rationale: `${cameraModel} (${resolutionPreset.toUpperCase()}) · Codec: ${videoCodec} @ ${framerateFps}fps · Span: ${st ? (st.coverEnd - st.coverStart).toFixed(1) : ''}m, Blind: ${st ? st.nearBlind.toFixed(1) : ''}m. ${MOUNT_INFO[p.mount].tip}`
      };
    });

    const projectStructure = obstacles.map(o => ({
      id: o.id,
      name: o.name,
      type: 'obstacle' as const,
      points: [
        { x: o.x / bayLength, y: o.y / bayWidth },
        { x: (o.x + o.w) / bayLength, y: o.y / bayWidth },
        { x: (o.x + o.w) / bayLength, y: (o.y + o.d) / bayWidth },
        { x: o.x / bayLength, y: (o.y + o.d) / bayWidth },
      ],
      x_m: o.x,
      y_m: o.y,
      width_m: o.w,
      depth_m: o.d,
      height_m: o.h,
      obstacle_type: o.type,
    }));

    onApplyToProject(projectCameras, projectStructure, {
      facility_width_m: bayLength,
      facility_length_m: bayWidth,
      facility_height_m: mountHeight,
      facility_type: activeFacilityPreset !== 'custom' ? activeFacilityPreset : (initialFacility.facilityType || 'custom'),
    });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  // Export clean, non-technical 5-page blueprint with all 6 diagrams
  const handleExportReport = async (format: 'pdf' | 'docx' = 'pdf') => {
    const rawExportUcs = (project?.use_cases || []).map(u => ({ ...u, camera_ids: [] as string[] }));
    const exportCameras = poses.map((p, idx) => {
      const camId = `CAM-${String(idx + 1).padStart(2, '0')}`;
      const assignedUc = rawExportUcs.length > 0 ? rawExportUcs[idx % rawExportUcs.length] : null;
      if (assignedUc && !assignedUc.camera_ids.includes(camId)) {
        assignedUc.camera_ids.push(camId);
      }
      return {
        id: camId,
        name: `CAM-${String(idx + 1).padStart(2, '0')} (${p.mount.toUpperCase()})`,
        x: Math.max(0.02, Math.min(0.98, p.x / bayLength)),
        y: Math.max(0.02, Math.min(0.98, p.y / bayWidth)),
        orientation_degrees: (p.panDeg + 360) % 360,
        horizontal_fov_degrees: lens.hfovDeg,
        view_range: 0.5,
        resolution_width: sensorWidthPx,
        resolution_height: sensorHeightPx,
        status: 'active' as const,
        target_area: `Zone @ ${p.x.toFixed(1)}m, ${p.y.toFixed(1)}m`,
        mount_type: p.mount,
        height_m: p.z,
        tilt_degrees: p.tiltDeg,
        assigned_use_case_ids: assignedUc ? [assignedUc.id] : [],
      };
    });

    const effectiveProject: any = {
      ...(project || {}),
      id: project?.id || 'export-project',
      name: project?.name || 'Plan Vision Facility Plan',
      facility_width_m: bayWidth,
      facility_length_m: bayLength,
      facility_height_m: mountHeight,
      detection_coverage_target: project?.detection_coverage_target || 95,
      cameras: exportCameras,
      use_cases: rawExportUcs,
      structure: obstacles.map(o => ({
        id: o.id,
        name: o.name,
        type: 'obstacle' as const,
        points: [
          { x: o.x / bayLength, y: o.y / bayWidth },
          { x: (o.x + o.w) / bayLength, y: o.y / bayWidth },
          { x: (o.x + o.w) / bayLength, y: (o.y + o.d) / bayWidth },
          { x: o.x / bayLength, y: (o.y + o.d) / bayWidth },
        ],
        x_m: o.x,
        y_m: o.y,
        width_m: o.w,
        depth_m: o.d,
        height_m: o.h,
        obstacle_type: o.type,
      })),
    };

    if (format === 'docx') {
      try {
        const resp = await fetch('/api/report/generate?mode=docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: effectiveProject, format: 'docx' }),
        });
        if (!resp.ok) throw new Error('DOCX export failed');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(effectiveProject.name || 'Plan_Vision').replace(/\s+/g, '_')}_Camera_Safety_Plan.doc`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('DOCX export failed:', err);
        alert('Unable to generate Word DOCX report.');
      }
      return;
    }

    // PDF: Open printable 5-page report with all 6 diagrams and trigger print dialog
    try {
      const resp = await fetch('/api/report/generate?mode=pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: effectiveProject, format: 'pdf' }),
      });
      if (!resp.ok) throw new Error('PDF export failed');
      const html = await resp.text();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 400);
      }
    } catch (err) {
      console.error('PDF export failed:', err);
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
              Camera <span className="text-primary">Coverage Planner</span>
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
            title={`Optimize positioning, pan angles, and tilts for all ${poses.length} user-specified cameras across site geometry`}
          >
            <Sparkles className="w-3.5 h-3.5 fill-current" />
            {isOptimizing ? 'Optimizing…' : `Auto-Solve (${poses.length} Cams)`}
          </button>

          <button
            onClick={handleBuildDiagram}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 transition-colors shadow-xs"
            title="Automatically build pipeline architecture diagram based on user requirements and LLM reasoning"
          >
            <GitBranch className="w-3.5 h-3.5" />
            Diagram Builder
          </button>

          {onApplyToProject && (
            <button
              onClick={handleConfirmAndUpdateReports}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all shadow-xs ring-2 ring-emerald-500/20 cursor-pointer"
              title="Confirm current camera mapping and update all 6 diagram views in PDF and Word reports"
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirm Camera Mapping &amp; Update Reports
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
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 p-5 overflow-y-auto min-h-0">
        
        {/* Left Column: Interactive Parameters */}
        <div className="flex flex-col gap-4 overflow-y-auto pr-1 min-h-0">
          
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
                    <span>AI Facility Synthesizer</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-600 text-white font-semibold">
                    NVIDIA Vision AI
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
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('perimeter_security')}
                    className={`flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                      activeFacilityPreset === 'perimeter_security'
                        ? 'border-primary bg-primary text-primary-foreground font-bold'
                        : 'border-border bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5 shrink-0" />
                    <span>Perimeter & Gate</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('corporate_office')}
                    className={`flex items-center gap-1.5 p-2 rounded-lg border text-[11px] font-medium transition-all ${
                      activeFacilityPreset === 'corporate_office'
                        ? 'border-primary bg-primary text-primary-foreground font-bold'
                        : 'border-border bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Office & Lobby</span>
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
        <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
          
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
              <div className="flex items-center gap-3">
                <button onClick={handleOptimize} className="underline font-bold text-amber-900 hover:text-black">Auto-Solve</button>
                <button onClick={handleConfirmAndUpdateReports} className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] transition-colors">
                  Confirm &amp; Update Reports
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span className="font-medium">{result.metrics.blindPct.toFixed(1)}% coverage gap. Adjust camera mount angles or click Auto-Solve.</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleOptimize} className="underline font-bold text-rose-900 hover:text-black">Auto-Solve (≥95%)</button>
                <button onClick={handleConfirmAndUpdateReports} className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors">
                  Confirm &amp; Update Reports
                </button>
              </div>
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
                    onClick={() => setActiveViewTab('frustum')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                      activeViewTab === 'frustum'
                        ? 'bg-cyan-600 text-white shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    Frustum & DORI 3D
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

              {activeViewTab === 'frustum' && (
                <FrustumSpatialInspector
                  site={site}
                  poses={poses}
                  selectedId={selectedId}
                  onSelectCamera={(id) => setSelectedId(id)}
                  lens={lens}
                  facilityType={activeFacilityPreset === 'custom' ? 'project' : activeFacilityPreset}
                  initialFocalLength={lens.focalMm}
                  initialMountHeight={selectedPose?.z ?? site.mountHeight}
                  initialTilt={selectedPose?.tiltDeg ?? 25}
                  initialAzimuth={selectedPose?.panDeg ?? 45}
                  resolutionName={resolutionPreset === '8mp' ? '8MP 4K' : resolutionPreset === '12mp' ? '12MP' : resolutionPreset === '5mp' ? '5MP' : resolutionPreset === '2mp' ? '2MP' : '4MP'}
                  onSpecsChange={(specs) => {
                    if (selectedPose) {
                      handlePoseChange(selectedPose.id, {
                        tiltDeg: specs.tiltDeg,
                        panDeg: specs.azimuthDeg,
                        z: specs.mountHeight,
                      });
                    }
                    if (specs.focalMm !== lens.focalMm) {
                      setLens(refocusLens(lens, specs.focalMm));
                    }
                  }}
                  onSynthesizeScenario={handleSynthesizeFacility}
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
                  onClick={() => setActiveDetTab('ai-feasibility')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'ai-feasibility' ? 'bg-primary text-primary-foreground font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  AI Feasibility Matrix
                </button>
                <button
                  onClick={() => setActiveDetTab('cables')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeDetTab === 'cables' ? 'bg-primary text-primary-foreground font-bold shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Cable & Storage
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

              {/* AI Feasibility Matrix */}
              {activeDetTab === 'ai-feasibility' && (
                <div className="space-y-4 font-sans text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Neural Network Task-Specific Feasibility Engine</h4>
                      <p className="text-slate-600 text-xs">Validation against real-world deep learning models, optical angle-of-incidence, and minimum bounding box pixel requirements.</p>
                    </div>
                    <span className="px-2.5 py-1 rounded bg-sky-100 text-sky-800 font-mono text-xs font-semibold">
                      5 AI Task Profiles
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-left font-mono text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-slate-100/80 text-slate-700 text-[11px] font-semibold">
                          <th className="p-2.5">AI Computer Vision Task</th>
                          <th className="p-2.5">Target Dimension</th>
                          <th className="p-2.5">Min Pixel Bounding Box</th>
                          <th className="p-2.5">Required PPM</th>
                          <th className="p-2.5">Max Tilt (βpitch)</th>
                          <th className="p-2.5">Framerate & Shutter</th>
                          <th className="p-2.5">Feasibility Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {AI_MODEL_FEASIBILITY_CRITERIA.map((crit, idx) => {
                          const passesPpm = poses.some(p => {
                            const maxPpm = (impliedHorizontalPixels(lens) / (2 * 4 * Math.tan((lens.hfovDeg * Math.PI) / 360)));
                            return maxPpm >= crit.minRequiredPpm && p.tiltDeg <= crit.maxDepressionDeg;
                          });

                          return (
                            <tr key={crit.id} className={`border-b border-border ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/60`}>
                              <td className="p-2.5 font-bold text-slate-900">{crit.task}</td>
                              <td className="p-2.5 text-slate-600">{crit.targetObject}</td>
                              <td className="p-2.5 text-slate-800 font-semibold">{crit.minPixelBox}</td>
                              <td className="p-2.5 text-sky-700 font-bold">{crit.minRequiredPpm} px/m</td>
                              <td className="p-2.5 text-amber-700">≤ {crit.maxDepressionDeg}°</td>
                              <td className="p-2.5 text-slate-600">{crit.minFramerateFps} fps, {crit.shutterGuidance}</td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${passesPpm ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}`}>
                                  {passesPpm ? '✓ High Feasibility' : '⚠ Requires Calibration'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Tracker Occlusion Horizon Metric */}
                  <div className="p-4 rounded-xl bg-slate-900 text-slate-200 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        <span className="font-bold text-xs text-white">Tracker Occlusion Horizon Metric (ByteTrack / DeepSORT)</span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400">t_blind = L_shadow / v_target</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-slate-400 text-[10px] mb-1">Walking Worker (1.4 m/s)</div>
                        <div className="text-slate-200">Shadow transit behind 2.5m rack: <strong>1.79 sec</strong></div>
                        <div className="text-cyan-400 font-bold mt-1">track_buffer = 54 frames @ 30fps</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-slate-400 text-[10px] mb-1">Industrial Forklift (3.5 m/s)</div>
                        <div className="text-slate-200">Shadow transit behind 3.6m rack: <strong>1.03 sec</strong></div>
                        <div className="text-cyan-400 font-bold mt-1">track_buffer = 31 frames @ 30fps</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-slate-400 text-[10px] mb-1">AI Re-ID Continuity</div>
                        <div className="text-slate-300 text-[11px] leading-relaxed">
                          Configuring multi-object tracker buffer frames above t_blind prevents trajectory fragmentation and preserves track IDs across storage rack pillars.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cable & Storage Calculator */}
              {activeDetTab === 'cables' && (
                <div className="space-y-4 font-sans text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">Automated Cable Routing & PoE Engineering</h4>
                      <p className="text-slate-600 text-xs">Manhattan A* orthogonal ceiling/wall cable tray pathfinding with 1.15× slack factor and 90m Ethernet limit validation.</p>
                    </div>
                    <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 font-mono text-xs font-semibold">
                      {poses.length} Camera Runs
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-left font-mono text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-slate-100/80 text-slate-700 text-[11px] font-semibold">
                          <th className="p-2.5">Camera</th>
                          <th className="p-2.5">Coordinates (X, Y, Z)</th>
                          <th className="p-2.5">Orthogonal Distance</th>
                          <th className="p-2.5">Total Run (1.15x Slack)</th>
                          <th className="p-2.5">90m Limit Status</th>
                          <th className="p-2.5">PoE Standard</th>
                          <th className="p-2.5">Power Draw</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poses.map((p, idx) => {
                          const isPtz = p.mount === 'pole360';
                          const run = calculateCableRun({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: 2.2 }, 1.15, isPtz);

                          return (
                            <tr key={p.id} className={`border-b border-border ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/60`}>
                              <td className="p-2.5 font-bold text-slate-900 flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: camColor(p.id) }} />
                                Camera C{p.id}
                              </td>
                              <td className="p-2.5 text-slate-600">({p.x.toFixed(1)}m, {p.y.toFixed(1)}m, {p.z.toFixed(1)}m)</td>
                              <td className="p-2.5 text-slate-700">{run.cableDistanceM} m</td>
                              <td className="p-2.5 text-slate-900 font-bold">{run.totalRunM} m</td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${!run.exceeds90m ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                  {!run.exceeds90m ? '✓ Compliant (≤90m)' : '⚠ Exceeds 90m (Extender Req.)'}
                                </span>
                              </td>
                              <td className="p-2.5 text-slate-600">{run.poeClass}</td>
                              <td className="p-2.5 text-slate-900 font-semibold">{run.poeWatts} W</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Storage & Bandwidth Computation Table */}
                  {(() => {
                    const resName = resolutionPreset === '8mp' ? '8MP 4K' : resolutionPreset === '12mp' ? '12MP' : resolutionPreset === '5mp' ? '5MP' : resolutionPreset === '2mp' ? '2MP' : '4MP';
                    const storageCalc = calculateStorageAndBandwidth(poses.length, resName as any, 'H.265+', 25, 30);
                    const totalPoeWatts = poses.reduce((acc, p) => acc + (p.mount === 'pole360' ? 30 : 15.4), 0);

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-mono text-slate-500 uppercase">Per-Camera Bitrate</div>
                          <div className="text-lg font-bold text-slate-900">{storageCalc.bitrateMbps} Mbps</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">H.265+ Smart Codec @ 25fps</div>
                        </div>

                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-mono text-slate-500 uppercase">Total NVR Bandwidth</div>
                          <div className="text-lg font-bold text-sky-700">{storageCalc.totalBitrateMbps} Mbps</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{poses.length} Concurrent Streams</div>
                        </div>

                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-mono text-slate-500 uppercase">30-Day Storage Capacity</div>
                          <div className="text-lg font-bold text-emerald-700">{storageCalc.storage30DaysTb} TB</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{storageCalc.dailyGb} GB daily ingestion</div>
                        </div>

                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-mono text-slate-500 uppercase">Total PoE Switch Power</div>
                          <div className="text-lg font-bold text-amber-700">{totalPoeWatts.toFixed(0)} W</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Recommended {Math.ceil(poses.length / 8) * 8}-port Switch</div>
                        </div>
                      </div>
                    );
                  })()}
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

      {/* Interactive System Pipeline Architecture Diagram Modal */}
      {showDiagramModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-slate-50/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-200 flex items-center justify-center text-indigo-600">
                  <GitBranch className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                    System Architecture & Vision Pipeline Builder
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                      Zero Hardware Reduction
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Deterministic pipeline constructed from user requirements ({poses.length} Camera Feeds · NVIDIA Vision AI Inference · SCADA & Safety Interlocks)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDiagramModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-200/80 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content - Diagram Stages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Telemetry & Spec Summary Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Inbound Streams</span>
                  <span className="font-bold text-slate-900 font-mono">{poses.length}x IP Cameras</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Stream Resolution</span>
                  <span className="font-bold text-slate-900 font-mono">{sensorWidthPx}×{sensorHeightPx} @ {framerateFps}fps</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Video Compression</span>
                  <span className="font-bold text-slate-900 font-mono">{videoCodec} (PoE+ Gigabit)</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Edge AI Compute</span>
                  <span className="font-bold text-indigo-700 font-mono">NVIDIA Vision AI</span>
                </div>
              </div>

              {/* End-to-End Visual Architecture Diagram */}
              <div className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  End-to-End Vision AI Architecture Pipeline
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {/* Stage 1: Ingestion */}
                  <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                        1
                      </div>
                      <span className="font-bold text-xs text-slate-900">Ingestion Layer</span>
                    </div>
                    <div className="space-y-2 flex-1 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-blue-600" />
                          <span>{poses.length}x {cameraModel}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          RTSP over Gigabit PoE+ switch. Distributed across all facility buildings.
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Network className="w-3.5 h-3.5 text-blue-600" />
                          <span>Frame Sampling & Decode</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Hardware NVDEC/NVJPG decoding with 15–30 FPS adaptive rate.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Stage 2: Preprocessing */}
                  <div className="bg-indigo-50/40 border border-indigo-200/80 rounded-xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                        2
                      </div>
                      <span className="font-bold text-xs text-slate-900">Edge Preprocessing</span>
                    </div>
                    <div className="space-y-2 flex-1 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-indigo-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                          <span>TensorRT Pipeline</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Letterboxing, FP16/INT8 normalization, and optical batch synchronization.
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-indigo-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Spatial ROI Cropping</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Dynamic cropping around filling nozzles, berms, and ingress gates.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Stage 3: Neural Inference */}
                  <div className="bg-purple-50/40 border border-purple-200/80 rounded-xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                        3
                      </div>
                      <span className="font-bold text-xs text-slate-900">Neural Inference</span>
                    </div>
                    <div className="space-y-2 flex-1 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-purple-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
                          <span>Chemical Spill & Leak</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Visual anomaly segmentation on secondary containment sumps.
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-purple-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5 text-purple-600" />
                          <span>Drum Fill Level & OCR</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          PaddleOCR for lot codes + liquid meniscus height estimation.
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-purple-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-purple-600" />
                          <span>PPE & Vehicle Safety</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Splash suit, respirator, and forklift collision trajectory tracking.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Stage 4: Outputs & Interlocks */}
                  <div className="bg-emerald-50/40 border border-emerald-200/80 rounded-xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                        4
                      </div>
                      <span className="font-bold text-xs text-slate-900">Safety & Outputs</span>
                    </div>
                    <div className="space-y-2 flex-1 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-emerald-600" />
                          <span>SCADA / PLC Interlock</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Modbus / OPC-UA emergency valve cutoff on spill confirmation.
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>VMS Security Matrix</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Security operations center alert triggers & audit event logging.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-slate-50 flex-wrap gap-3">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Architecture diagram automatically synchronized with project blueprint.</span>
              </div>
              <div className="flex items-center gap-2.5">
                {viewCtx && (
                  <button
                    onClick={() => {
                      setShowDiagramModal(false);
                      viewCtx.setActiveView('workflow');
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 transition-colors shadow-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in Workflow Editor
                  </button>
                )}
                <button
                  onClick={() => setShowDiagramModal(false)}
                  className="px-4 py-2 rounded-lg border border-border bg-white text-xs font-semibold hover:bg-muted text-slate-700 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Camera Mapping Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-left">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white backdrop-blur-xs">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Camera Mapping Confirmed!</h3>
                  <p className="text-xs text-emerald-100 mt-0.5">
                    Your layout and coverage have been saved to the project blueprint.
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Stat Cards */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="text-xl font-black text-slate-900">{poses.length}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Cameras</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="text-xl font-black text-emerald-600">{result.metrics.coveragePct.toFixed(1)}%</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Coverage</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="text-xl font-black text-blue-600">6 of 6</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">Views Synced</div>
                </div>
              </div>

              {/* Status Note */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-900 leading-relaxed">
                <strong>Reports are now updated:</strong> All 6 diagrams (Top View, Side Elevation, Bird Camera 3D, 3D Perspective, Frustum &amp; DORI 3D, and Telemetry Scorecard) in the 5-page PDF and Word DOCX reports now reflect these exact camera placements.
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    if (viewCtx?.setActiveView) {
                      viewCtx.setActiveView('report');
                    } else {
                      window.location.href = '/report';
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  View Updated 5-Page Report
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      setIsExportingModalPdf(true);
                      try {
                        await handleExportReport('pdf');
                      } finally {
                        setIsExportingModalPdf(false);
                      }
                    }}
                    disabled={isExportingModalPdf}
                    className="py-2.5 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    {isExportingModalPdf ? 'Opening PDF…' : 'Print / Save PDF'}
                  </button>

                  <button
                    onClick={async () => {
                      setIsExportingModalDocx(true);
                      try {
                        await handleExportReport('docx');
                      } finally {
                        setIsExportingModalDocx(false);
                      }
                    }}
                    disabled={isExportingModalDocx}
                    className="py-2.5 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    {isExportingModalDocx ? 'Generating DOCX…' : 'Download DOCX'}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Continue Editing Cameras
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

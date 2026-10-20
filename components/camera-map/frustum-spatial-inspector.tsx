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
  Building,
  Factory,
  ShoppingBag,
  Server,
  Shield,
  Briefcase,
  Plane,
  HeartPulse,
  Sparkles,
  ChevronDown,
  RefreshCw,
  Box,
  Compass,
} from 'lucide-react';
import {
  clamp,
  type Vec3,
  type CameraSpec,
  type CameraPose,
  type Obstacle,
  type Obstacle3D,
  type TargetEvaluation,
  type SiteSpec,
  type LensSpec,
  type FacilityPresetType,
  evaluateTargetPoint3D,
  computeSensorFov,
  obstaclesTo3D,
  generateProceduralObstacles,
  AI_MODEL_FEASIBILITY_CRITERIA,
} from '@/lib/coverage-engine';

export type ScenarioArchetype =
  | 'project'              // Active project floorplan
  | 'logistics_warehouse'  // High-bay pallet racks & forklift aisle
  | 'manufacturing_plant'  // Assembly conveyors, robotic workcells, CNC machines
  | 'retail_supermarket'   // Gondola shelving runs & POS registers
  | 'data_center'          // Server rack rows with LED arrays & CRAC units
  | 'perimeter_security'   // Fence line, automated gate & vehicle access
  | 'corporate_office'     // Reception lobby, glass partitions & turnstiles
  | 'airport_terminal'     // Baggage carousel, security portals & passenger queues
  | 'hospital_clinic'      // Nurse station, triage bays & diagnostic cart
  | 'cleanroom_lab'        // Cleanroom fab, airlocks, wafer tools & laminar hoods
  | 'custom_ai';           // AI-synthesized custom 3D facility

export interface FrustumSpatialInspectorProps {
  site?: SiteSpec;
  poses?: CameraPose[];
  selectedId?: number | null;
  onSelectCamera?: (id: number) => void;
  lens?: LensSpec;
  facilityType?: string;
  initialFocalLength?: number;
  initialMountHeight?: number;
  initialTilt?: number;
  initialAzimuth?: number;
  resolutionName?: '2MP' | '4MP' | '5MP' | '8MP 4K' | '12MP';
  onSpecsChange?: (specs: { focalMm: number; mountHeight: number; tiltDeg: number; azimuthDeg: number }) => void;
  onSynthesizeScenario?: (prompt: string) => Promise<void>;
}

export function FrustumSpatialInspector({
  site,
  poses,
  selectedId,
  onSelectCamera,
  lens,
  facilityType = 'logistics_warehouse',
  initialFocalLength = 4.0,
  initialMountHeight = 4.5,
  initialTilt = 25,
  initialAzimuth = 45,
  resolutionName = '8MP 4K',
  onSpecsChange,
  onSynthesizeScenario,
}: FrustumSpatialInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Determine initial scenario: if project has custom obstacles, default to 'project'
  const hasProjectObstacles = Boolean(site?.obstacles && site.obstacles.length > 0);
  const [activeScenario, setActiveScenario] = useState<ScenarioArchetype>(
    hasProjectObstacles ? 'project' : (facilityType as ScenarioArchetype) || 'logistics_warehouse'
  );

  // Custom AI Scenario Synthesis state
  const [aiPromptInput, setAiPromptInput] = useState('');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [customAiObstacles, setCustomAiObstacles] = useState<Obstacle[] | null>(null);

  // Room Dimensions (Adapts directly to user's site)
  const roomLength = Math.max(12, site?.length ?? 40);
  const roomWidth = Math.max(8, site?.width ?? 20);
  const roomCeiling = Math.max(3.2, site?.mountHeight ?? 4.5);

  // Sync selected camera from props
  const activeCamera = useMemo(() => {
    if (poses && poses.length > 0) {
      return (selectedId != null ? poses.find(p => p.id === selectedId) : null) || poses[0];
    }
    return null;
  }, [poses, selectedId]);

  // Optical & Physical Camera State
  const [focalLengthMm, setFocalLengthMm] = useState<number>(lens?.focalMm ?? initialFocalLength);
  const [mountHeightM, setMountHeightM] = useState<number>(activeCamera?.z ?? initialMountHeight);
  const [tiltDeg, setTiltDeg] = useState<number>(activeCamera?.tiltDeg ?? initialTilt);
  const [azimuthDeg, setAzimuthDeg] = useState<number>(activeCamera?.panDeg ?? initialAzimuth);

  // Sync with active camera prop changes
  useEffect(() => {
    if (activeCamera) {
      if (activeCamera.z != null) setMountHeightM(activeCamera.z);
      if (activeCamera.tiltDeg != null) setTiltDeg(activeCamera.tiltDeg);
      if (activeCamera.panDeg != null) setAzimuthDeg(activeCamera.panDeg);
    }
  }, [activeCamera]);

  useEffect(() => {
    if (lens?.focalMm) {
      setFocalLengthMm(lens.focalMm);
    }
  }, [lens?.focalMm]);

  // 3D Orbit Camera Controls
  const [yaw, setYaw] = useState<number>(42);
  const [pitch, setPitch] = useState<number>(26);
  const [zoom, setZoom] = useState<number>(1.0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Animation & Dynamic Actor state
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [targetSpeed, setTargetSpeed] = useState<number>(0.65);
  const animTimeRef = useRef<number>(0);
  const [targetRole, setTargetRole] = useState<'primary' | 'vehicle' | 'intruder'>('primary');

  // UI Panels state
  const [showHUD, setShowHUD] = useState<boolean>(true);
  const [showPiP, setShowPiP] = useState<boolean>(true);
  const [showFeasibilityMatrix, setShowFeasibilityMatrix] = useState<boolean>(true);
  const [showAllCamerasIn3D, setShowAllCamerasIn3D] = useState<boolean>(true);

  // Resolution to Sensor Specs Mapping
  const sensorSpec = useMemo(() => {
    switch (resolutionName) {
      case '2MP':
        return { resW: 1920, resH: 1080, wMm: 5.37, hMm: 3.02 };
      case '5MP':
        return { resW: 2592, resH: 1944, wMm: 5.76, hMm: 4.32 };
      case '12MP':
        return { resW: 4000, resH: 3000, wMm: 7.4, hMm: 5.55 };
      case '8MP 4K':
      default:
        return { resW: 3840, resH: 2160, wMm: 6.4, hMm: 3.6 };
    }
  }, [resolutionName]);

  // Compute Sensor FOV
  const fov = useMemo(() => {
    return computeSensorFov(sensorSpec.wMm, sensorSpec.hMm, focalLengthMm);
  }, [sensorSpec, focalLengthMm]);

  // Full Camera Specification Object
  const cameraSpec = useMemo<CameraSpec>(() => {
    const pos: Vec3 = activeCamera
      ? { x: activeCamera.x, y: activeCamera.y, z: mountHeightM }
      : { x: 3.5, y: 3.5, z: mountHeightM };

    return {
      id: activeCamera ? `cam-${activeCamera.id}` : 'cam-inspector-01',
      position: pos,
      azimuthDeg,
      tiltDeg,
      focalLengthMm,
      sensorWidthMm: sensorSpec.wMm,
      sensorHeightMm: sensorSpec.hMm,
      resolutionW: sensorSpec.resW,
      resolutionH: sensorSpec.resH,
      distortionK1: focalLengthMm <= 2.8 ? -0.18 : focalLengthMm <= 4.0 ? -0.09 : -0.03,
    };
  }, [activeCamera, mountHeightM, azimuthDeg, tiltDeg, focalLengthMm, sensorSpec]);

  // Scenario Definitions with Rich Contextual Targets
  const scenarioOptions = useMemo(() => [
    {
      id: 'project' as const,
      name: site?.obstacles && site.obstacles.length > 0 ? `Active Project Blueprint (${site.obstacles.length} Obstacles)` : 'Active Project Blueprint',
      icon: '📐',
      description: 'Direct 3D visualization of your uploaded floor plan, custom obstacles, and exact camera mounts.',
      targets: [
        { id: 'primary', label: '👷 Site Worker', icon: '👷', height: 1.7, speed: 1.4 },
        { id: 'vehicle', label: '🚜 Site Equipment', icon: '🚜', height: 2.2, speed: 3.2 },
        { id: 'intruder', label: '⚠️ Unauthorized Person', icon: '⚠️', height: 1.75, speed: 1.8 },
      ],
    },
    {
      id: 'logistics_warehouse' as const,
      name: 'Logistics Warehouse & Distribution',
      icon: '📦',
      description: 'High-bay pallet racks, forklift lanes, loading dock doors, and column grids.',
      targets: [
        { id: 'primary', label: '👷 Warehouse Worker', icon: '👷', height: 1.7, speed: 1.4 },
        { id: 'vehicle', label: '🚜 High-Reach Forklift', icon: '🚜', height: 2.3, speed: 3.5 },
        { id: 'intruder', label: '⚠️ Perimeter Intruder', icon: '⚠️', height: 1.75, speed: 1.8 },
      ],
    },
    {
      id: 'manufacturing_plant' as const,
      name: 'Manufacturing & Robotic Assembly',
      icon: '🏭',
      description: 'Assembly conveyor lines, enclosed robotic workcells, CNC machines, and safety fences.',
      targets: [
        { id: 'primary', label: '👷 Assembly Operator', icon: '👷', height: 1.7, speed: 1.2 },
        { id: 'vehicle', label: '🤖 Autonomous Mobile Robot', icon: '🤖', height: 1.4, speed: 2.0 },
        { id: 'intruder', label: '⚠️ Zone Trespasser', icon: '⚠️', height: 1.75, speed: 1.6 },
      ],
    },
    {
      id: 'retail_supermarket' as const,
      name: 'Retail Supermarket & Store',
      icon: '🛒',
      description: 'Multi-tier retail gondolas, checkout POS counters, and customer queue aisles.',
      targets: [
        { id: 'primary', label: '🛒 Store Shopper', icon: '🛒', height: 1.65, speed: 1.1 },
        { id: 'vehicle', label: '👤 Cashier / Staff', icon: '👤', height: 1.6, speed: 0.8 },
        { id: 'intruder', label: '⚠️ Shoplifter / Suspect', icon: '⚠️', height: 1.75, speed: 2.2 },
      ],
    },
    {
      id: 'data_center' as const,
      name: 'Data Center Server Hall',
      icon: '🖥️',
      description: 'High-density 42U server cabinets with status LEDs, cold-aisle containment, and CRAC units.',
      targets: [
        { id: 'primary', label: '🧑‍💻 Systems Engineer', icon: '🧑‍💻', height: 1.72, speed: 1.2 },
        { id: 'vehicle', label: '🤖 Server Cart / Lift', icon: '🤖', height: 1.5, speed: 1.5 },
        { id: 'intruder', label: '⚠️ Unescorted Person', icon: '⚠️', height: 1.75, speed: 1.7 },
      ],
    },
    {
      id: 'perimeter_security' as const,
      name: 'Perimeter Defense & Access Control',
      icon: '🛡️',
      description: 'Chain-link fence lines, automated sliding vehicle gate, guardhouse, and vehicle barrier.',
      targets: [
        { id: 'primary', label: '🚶 Security Officer', icon: '🚶', height: 1.75, speed: 1.5 },
        { id: 'vehicle', label: '🚗 Delivery Vehicle', icon: '🚗', height: 1.9, speed: 4.0 },
        { id: 'intruder', label: '⚠️ Fence Breacher', icon: '⚠️', height: 1.7, speed: 2.5 },
      ],
    },
    {
      id: 'corporate_office' as const,
      name: 'Corporate Office & Lobby',
      icon: '🏢',
      description: 'Executive reception desk, optical speed turnstiles, glass meeting room, and desk pods.',
      targets: [
        { id: 'primary', label: '💼 Corporate Employee', icon: '💼', height: 1.7, speed: 1.3 },
        { id: 'vehicle', label: '👔 Guest / Visitor', icon: '👔', height: 1.68, speed: 1.0 },
        { id: 'intruder', label: '⚠️ Tailgater / Intruder', icon: '⚠️', height: 1.75, speed: 1.8 },
      ],
    },
    {
      id: 'airport_terminal' as const,
      name: 'Airport Concourse & Baggage Claim',
      icon: '✈️',
      description: 'Dual carousel baggage claim conveyor loops, TSA security portal, and check-in counters.',
      targets: [
        { id: 'primary', label: '🧳 Passenger with Luggage', icon: '🧳', height: 1.72, speed: 1.3 },
        { id: 'vehicle', label: '👮 TSA Security Officer', icon: '👮', height: 1.78, speed: 1.2 },
        { id: 'intruder', label: '⚠️ Unattended Baggage / Person', icon: '⚠️', height: 1.7, speed: 1.9 },
      ],
    },
    {
      id: 'hospital_clinic' as const,
      name: 'Hospital Emergency Department',
      icon: '🏥',
      description: 'Central nurse command station, triage bays with privacy curtains, and diagnostic equipment.',
      targets: [
        { id: 'primary', label: '👨‍⚕️ Nurse / Caregiver', icon: '👨‍⚕️', height: 1.7, speed: 1.4 },
        { id: 'vehicle', label: '🦽 Wheelchair Patient', icon: '🦽', height: 1.35, speed: 0.9 },
        { id: 'intruder', label: '⚠️ Restricted Ward Trespasser', icon: '⚠️', height: 1.75, speed: 2.1 },
      ],
    },
    {
      id: 'cleanroom_lab' as const,
      name: 'Semiconductor / Pharma Cleanroom',
      icon: '🧪',
      description: 'Wafer photolithography steppers, air shower vestibule, laminar flow clean benches, and exhaust hoods.',
      targets: [
        { id: 'primary', label: '🥼 Cleanroom Operator (Tyvek)', icon: '🥼', height: 1.72, speed: 1.0 },
        { id: 'vehicle', label: '🤖 FOUP Wafer Transport Robot', icon: '🤖', height: 1.3, speed: 1.6 },
        { id: 'intruder', label: '⚠️ Contamination Zone Violation', icon: '⚠️', height: 1.75, speed: 1.5 },
      ],
    },
  ], [site]);

  const currentScenarioDef = useMemo(
    () => scenarioOptions.find(s => s.id === activeScenario) || scenarioOptions[0],
    [scenarioOptions, activeScenario]
  );

  const activeTargetOption = useMemo(
    () => currentScenarioDef.targets.find(t => t.id === targetRole) || currentScenarioDef.targets[0],
    [currentScenarioDef, targetRole]
  );

  // Procedural 3D Environment Synthesis (Zero Hardcoded Layouts)
  const { obstacleEntities, visualDetails } = useMemo(() => {
    let baseObstacles: Obstacle[] = [];

    // 1. If user synthesized a custom AI scenario
    if (activeScenario === 'custom_ai' && customAiObstacles && customAiObstacles.length > 0) {
      baseObstacles = customAiObstacles;
    }
    // 2. If user is in 'project' mode with active floor plan obstacles
    else if (activeScenario === 'project' && site?.obstacles && site.obstacles.length > 0) {
      baseObstacles = site.obstacles;
    }
    // 3. Procedural synthesis across room dimensions
    else {
      const presetType = activeScenario === 'project' || activeScenario === 'custom_ai'
        ? 'logistics_warehouse'
        : (activeScenario as FacilityPresetType);

      baseObstacles = generateProceduralObstacles({
        type: presetType,
        length: roomLength,
        width: roomWidth,
        mountHeight: roomCeiling,
      });
    }

    const list: Obstacle3D[] = [];
    const details: Array<{
      id: string;
      type: string;
      x: number;
      y: number;
      z: number;
      w: number;
      d: number;
      h: number;
      color: string;
      accentColor: string;
      label: string;
      shelves?: number[];
      boxes?: Array<{ x: number; y: number; z: number; w: number; d: number; h: number; color: string; label: string }>;
      rollers?: boolean;
      statusLed?: string;
      isColumn?: boolean;
      isGate?: boolean;
    }> = [];

    baseObstacles.forEach((o, idx) => {
      const zb = o.zBase ?? 0;
      list.push({
        id: o.id,
        name: o.name,
        type: o.type,
        min: { x: o.x, y: o.y, z: zb },
        max: { x: o.x + o.w, y: o.y + o.d, z: zb + o.h },
      });

      // Procedural 3D Geometric Detailing based on structural type
      const isRack = o.type === 'rack';
      const isConveyor = o.type === 'conveyor';
      const isMachine = o.type === 'machine';
      const isColumn = o.type === 'column';
      const isPartition = o.type === 'partition';
      const isWall = o.type === 'wall';
      const isDock = o.type === 'dock';
      const isHazard = o.type === 'hazard';

      const color = isRack ? '#0284c7'
        : isConveyor ? '#0891b2'
        : isMachine ? '#1e3a8a'
        : isColumn ? '#475569'
        : isPartition ? '#059669'
        : isWall ? '#334155'
        : isDock ? '#d97706'
        : isHazard ? '#dc2626'
        : '#0f172a';

      const accentColor = isRack ? '#38bdf8'
        : isConveyor ? '#67e8f9'
        : isMachine ? '#60a5fa'
        : isColumn ? '#eab308'
        : isPartition ? '#34d399'
        : isWall ? '#94a3b8'
        : isDock ? '#f59e0b'
        : isHazard ? '#f87171'
        : '#38bdf8';

      // Shelves for racks
      const shelves = isRack ? [
        zb + 0.15,
        zb + o.h * 0.45,
        zb + o.h * 0.8,
      ] : undefined;

      // Realistic Cargo Packages on shelves or conveyors
      let boxes: Array<{ x: number; y: number; z: number; w: number; d: number; h: number; color: string; label: string }> | undefined;

      if (isRack) {
        boxes = [
          {
            x: o.x + 0.3,
            y: o.y + 0.15,
            z: zb + 0.18,
            w: Math.max(0.8, o.w * 0.4),
            d: Math.max(0.6, o.d * 0.75),
            h: Math.min(1.1, o.h * 0.35),
            color: '#f97316',
            label: `PALLET ${idx + 1}A`,
          },
          {
            x: o.x + o.w * 0.52,
            y: o.y + 0.15,
            z: zb + 0.18,
            w: Math.max(0.8, o.w * 0.4),
            d: Math.max(0.6, o.d * 0.75),
            h: Math.min(1.1, o.h * 0.35),
            color: '#a855f7',
            label: `CARGO ${idx + 1}B`,
          },
          {
            x: o.x + 0.4,
            y: o.y + 0.15,
            z: zb + o.h * 0.48,
            w: Math.max(0.7, o.w * 0.35),
            d: Math.max(0.5, o.d * 0.7),
            h: Math.min(0.9, o.h * 0.28),
            color: '#10b981',
            label: `LOT #${200 + idx}`,
          },
        ];
      } else if (isConveyor) {
        boxes = [
          {
            x: o.x + o.w * 0.2,
            y: o.y + 0.2,
            z: zb + o.h,
            w: Math.min(1.2, o.w * 0.25),
            d: Math.min(o.d * 0.7, 1.2),
            h: 0.65,
            color: '#f59e0b',
            label: 'PARCEL 1',
          },
          {
            x: o.x + o.w * 0.65,
            y: o.y + 0.2,
            z: zb + o.h,
            w: Math.min(1.1, o.w * 0.22),
            d: Math.min(o.d * 0.7, 1.2),
            h: 0.75,
            color: '#38bdf8',
            label: 'PARCEL 2',
          },
        ];
      }

      details.push({
        id: o.id,
        type: o.type || 'structure',
        x: o.x,
        y: o.y,
        z: zb,
        w: o.w,
        d: o.d,
        h: o.h,
        color,
        accentColor,
        label: o.name.toUpperCase(),
        shelves,
        boxes,
        rollers: isConveyor,
        statusLed: isMachine ? '#ef4444' : isRack && activeScenario === 'data_center' ? '#06b6d4' : undefined,
        isColumn,
        isGate: isDock,
      });
    });

    return { obstacleEntities: list, visualDetails: details };
  }, [activeScenario, customAiObstacles, site, roomLength, roomWidth, roomCeiling]);

  // Handle in-inspector AI Scenario Synthesis
  const handleRunAiSynthesis = async () => {
    if (!aiPromptInput.trim()) return;
    setIsSynthesizing(true);
    try {
      if (onSynthesizeScenario) {
        await onSynthesizeScenario(aiPromptInput);
        setActiveScenario('project');
      } else {
        const resp = await fetch('/api/camera/facility-structures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPrompt: aiPromptInput,
            facilityType: activeScenario,
            dimensions: { length: roomLength, width: roomWidth, height: roomCeiling },
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.obstacles) && data.obstacles.length > 0) {
            setCustomAiObstacles(data.obstacles);
            setActiveScenario('custom_ai');
          }
        }
      }
    } catch (err) {
      console.error('Failed to synthesize 3D environment:', err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Dynamic Contextual Patrol Spline (Scaled to Room Bounds)
  const getTargetPositionAtTime = useCallback((t: number) => {
    const speedFactor = 0.22 * targetSpeed;
    const progress = (t * speedFactor) % (Math.PI * 2);

    const cx = roomLength * 0.48;
    const cy = roomWidth * 0.48;
    const targetH = activeTargetOption.height;

    let x = cx + Math.cos(progress) * (roomLength * 0.28);
    let y = cy + Math.sin(progress * 1.5) * (roomWidth * 0.25);

    // Keep target inside room boundaries
    x = clamp(x, 1.5, roomLength - 1.5);
    y = clamp(y, 1.5, roomWidth - 1.5);

    return { x, y, z: targetH };
  }, [roomLength, roomWidth, targetSpeed, activeTargetOption]);

  // Current Target Evaluation & Physics Telemetry
  const [currentEval, setCurrentEval] = useState<TargetEvaluation | null>(null);
  const [currentTargetPos, setCurrentTargetPos] = useState<Vec3>({ x: 12, y: 10, z: 1.7 });

  const telemetry = useMemo(() => {
    if (!currentEval) return null;
    const headHit = currentEval.rayHits?.find(r => r.anchor === 'head');
    const torsoHit = currentEval.rayHits?.find(r => r.anchor === 'torso');
    const ankleHit = currentEval.rayHits?.find(r => r.anchor === 'ankle');

    const headOccluded = Boolean(headHit?.blocked);
    const torsoOccluded = Boolean(torsoHit?.blocked);
    const ankleOccluded = Boolean(ankleHit?.blocked);
    const isOccluded = currentEval.visibilityRatio < 1.0;
    const fullyOccluded = currentEval.visibilityRatio === 0;
    const distanceM = currentEval.slantDistanceM;
    const ppm = currentEval.effectivePpm;
    const doriCategory = currentEval.doriTier;
    const verticalAngleDeg = currentEval.verticalDepressionDeg;
    const faceOccluded = headOccluded || verticalAngleDeg > 45;
    const facialPixels = Math.round(0.065 * ppm);
    const impactPoint = currentEval.rayHits?.find(r => r.hitPoint)?.hitPoint;

    return {
      headOccluded,
      torsoOccluded,
      ankleOccluded,
      isOccluded,
      fullyOccluded,
      distanceM,
      ppm,
      doriCategory,
      verticalAngleDeg,
      faceOccluded,
      facialPixels,
      impactPoint,
      aiFeasibility: currentEval.aiFeasibility,
    };
  }, [currentEval]);

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
  const handleAzimuthChange = (v: number) => {
    setAzimuthDeg(v);
    onSpecsChange?.({ focalMm: focalLengthMm, mountHeight: mountHeightM, tiltDeg, azimuthDeg: v });
  };

  // Main 3D Canvas Render Loop
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
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deep Dark Aerospace Virtual Environment Background
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, w, h);

      // 3D Perspective Projection Setup
      const sceneCenter = {
        x: roomLength * 0.45,
        y: roomWidth * 0.45,
        z: roomCeiling * 0.4,
      };

      const radYaw = (yaw * Math.PI) / 180;
      const radPitch = (pitch * Math.PI) / 180;

      const orbitDist = (Math.max(roomLength, roomWidth) * 0.85) / zoom;
      const eyeX = sceneCenter.x + orbitDist * Math.cos(radPitch) * Math.sin(radYaw);
      const eyeY = sceneCenter.y - orbitDist * Math.cos(radPitch) * Math.cos(radYaw);
      const eyeZ = sceneCenter.z + orbitDist * Math.sin(radPitch);

      const fwd = {
        x: sceneCenter.x - eyeX,
        y: sceneCenter.y - eyeY,
        z: sceneCenter.z - eyeZ,
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

      const focalDist = Math.min(w, h) * 1.05;

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

      // -------------------------------------------------------------
      // 1. FULL 3D FLOOR SLAB WITH SCENARIO-SPECIFIC MATERIALS
      // -------------------------------------------------------------
      const floorCorners = [
        project(0, 0, 0),
        project(roomLength, 0, 0),
        project(roomLength, roomWidth, 0),
        project(0, roomWidth, 0),
      ];

      if (floorCorners.every(c => c.valid)) {
        // Floor Base Fill
        ctx.beginPath();
        ctx.moveTo(floorCorners[0].x, floorCorners[0].y);
        ctx.lineTo(floorCorners[1].x, floorCorners[1].y);
        ctx.lineTo(floorCorners[2].x, floorCorners[2].y);
        ctx.lineTo(floorCorners[3].x, floorCorners[3].y);
        ctx.closePath();

        // Scenario Themed Flooring Materials
        const floorGrad = ctx.createLinearGradient(floorCorners[0].x, floorCorners[0].y, floorCorners[2].x, floorCorners[2].y);
        if (activeScenario === 'manufacturing_plant') {
          floorGrad.addColorStop(0, '#062820'); // Industrial Epoxy Teal
          floorGrad.addColorStop(1, '#021813');
        } else if (activeScenario === 'data_center') {
          floorGrad.addColorStop(0, '#060f1e'); // Raised Floor Blue
          floorGrad.addColorStop(1, '#020610');
        } else if (activeScenario === 'perimeter_security') {
          floorGrad.addColorStop(0, '#1c1917'); // Asphalt Roadway
          floorGrad.addColorStop(1, '#0c0a09');
        } else if (activeScenario === 'retail_supermarket') {
          floorGrad.addColorStop(0, '#131b2e'); // Commercial Tile
          floorGrad.addColorStop(1, '#090d18');
        } else {
          floorGrad.addColorStop(0, '#0f172a'); // Industrial Slab Concrete
          floorGrad.addColorStop(1, '#090e17');
        }
        ctx.fillStyle = floorGrad;
        ctx.fill();

        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Floor Perspective Grid Lines & Distance Markings
      ctx.lineWidth = 1;
      ctx.strokeStyle = activeScenario === 'data_center'
        ? 'rgba(6, 182, 212, 0.22)'
        : activeScenario === 'manufacturing_plant'
        ? 'rgba(16, 185, 129, 0.18)'
        : 'rgba(56, 189, 248, 0.16)';

      const step = 4.0;
      for (let gx = 0; gx <= roomLength; gx += step) {
        const p1 = project(gx, 0, 0);
        const p2 = project(gx, roomWidth, 0);
        if (p1.valid && p2.valid) {
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          // Distance meter badge
          if (gx % 8 === 0 && p1.valid) {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
            ctx.font = '600 8px ui-monospace, monospace';
            ctx.fillText(`${gx}m`, p1.x - 6, p1.y + 12);
          }
        }
      }

      for (let gy = 0; gy <= roomWidth; gy += step) {
        const p1 = project(0, gy, 0);
        const p2 = project(roomLength, gy, 0);
        if (p1.valid && p2.valid) {
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
      }

      // Warehouse Forklift Safety Lines (Yellow Aisles)
      if (activeScenario === 'logistics_warehouse') {
        const aisleY1 = project(2, roomWidth * 0.45, 0);
        const aisleY2 = project(roomLength - 2, roomWidth * 0.45, 0);
        const aisleY3 = project(2, roomWidth * 0.55, 0);
        const aisleY4 = project(roomLength - 2, roomWidth * 0.55, 0);
        if (aisleY1.valid && aisleY2.valid && aisleY3.valid && aisleY4.valid) {
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.moveTo(aisleY1.x, aisleY1.y); ctx.lineTo(aisleY2.x, aisleY2.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(aisleY3.x, aisleY3.y); ctx.lineTo(aisleY4.x, aisleY4.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // -------------------------------------------------------------
      // 2. 3D ARCHITECTURAL BOUNDARY WALLS & ENCLOSURE
      // -------------------------------------------------------------
      // Back Wall (Y = roomWidth)
      const bw1 = project(0, roomWidth, 0);
      const bw2 = project(roomLength, roomWidth, 0);
      const bw3 = project(roomLength, roomWidth, roomCeiling);
      const bw4 = project(0, roomWidth, roomCeiling);

      if (bw1.valid && bw2.valid && bw3.valid && bw4.valid) {
        ctx.beginPath();
        ctx.moveTo(bw1.x, bw1.y);
        ctx.lineTo(bw2.x, bw2.y);
        ctx.lineTo(bw3.x, bw3.y);
        ctx.lineTo(bw4.x, bw4.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // High-Bay Clerestory Windows on Back Wall
        for (let wx = 6; wx < roomLength - 6; wx += 12) {
          const w1 = project(wx, roomWidth, roomCeiling - 1.2);
          const w2 = project(wx + 5, roomWidth, roomCeiling - 1.2);
          const w3 = project(wx + 5, roomWidth, roomCeiling - 0.4);
          const w4 = project(wx, roomWidth, roomCeiling - 0.4);
          if (w1.valid && w2.valid && w3.valid && w4.valid) {
            ctx.beginPath();
            ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.lineTo(w3.x, w3.y); ctx.lineTo(w4.x, w4.y);
            ctx.closePath();
            ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.stroke();
          }
        }
      }

      // Left Side Wall (X = 0) with Elevation Height Markers
      const lw1 = project(0, 0, 0);
      const lw2 = project(0, roomWidth, 0);
      const lw3 = project(0, roomWidth, roomCeiling);
      const lw4 = project(0, 0, roomCeiling);

      if (lw1.valid && lw2.valid && lw3.valid && lw4.valid) {
        ctx.beginPath();
        ctx.moveTo(lw1.x, lw1.y);
        ctx.lineTo(lw2.x, lw2.y);
        ctx.lineTo(lw3.x, lw3.y);
        ctx.lineTo(lw4.x, lw4.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
        ctx.stroke();

        // Elevation meter marks on left wall
        for (let hz = 1; hz < roomCeiling; hz += 1) {
          const m1 = project(0, 0.5, hz);
          const m2 = project(0, 2.5, hz);
          if (m1.valid && m2.valid) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
            ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
            ctx.font = '600 8px ui-monospace, monospace';
            ctx.fillText(`${hz}m`, m2.x + 3, m2.y + 3);
          }
        }

        // Emergency Exit Glow Sign
        const exitP = project(0, roomWidth * 0.2, 2.4);
        if (exitP.valid) {
          ctx.fillStyle = '#10b981';
          ctx.fillRect(exitP.x - 14, exitP.y - 7, 28, 14);
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 8px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('EXIT 🟢', exitP.x, exitP.y + 3);
        }
      }

      // -------------------------------------------------------------
      // 3. MULTI-CAMERA 3D NETWORK VISUALIZATION
      // -------------------------------------------------------------
      if (showAllCamerasIn3D && poses && poses.length > 0) {
        poses.forEach(p => {
          const isSelected = p.id === activeCamera?.id;
          const cp = project(p.x, p.y, p.z);
          const bp = project(p.x, p.y, 0);

          if (cp.valid && bp.valid) {
            // Mounting Pole
            ctx.strokeStyle = isSelected ? '#00e5ff' : '#475569';
            ctx.lineWidth = isSelected ? 2.5 : 1.2;
            ctx.beginPath(); ctx.moveTo(bp.x, bp.y); ctx.lineTo(cp.x, cp.y); ctx.stroke();

            // Pole Base Footing
            ctx.fillStyle = isSelected ? 'rgba(0, 229, 255, 0.4)' : 'rgba(15, 23, 42, 0.6)';
            ctx.beginPath(); ctx.ellipse(bp.x, bp.y, 6, 3, 0, 0, Math.PI * 2); ctx.fill();

            // Camera Housing
            ctx.fillStyle = isSelected ? '#00e5ff' : '#f8fafc';
            ctx.beginPath(); ctx.arc(cp.x, cp.y, isSelected ? 6.5 : 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Floating Camera Badge
            ctx.fillStyle = isSelected ? '#00e5ff' : '#94a3b8';
            ctx.font = isSelected ? '700 10px ui-monospace, monospace' : '600 8.5px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`C${p.id}`, cp.x, cp.y - (isSelected ? 10 : 8));
          }
        });
      }

      // -------------------------------------------------------------
      // 4. SELECTED CAMERA DORI VOLUMETRIC FRUSTUM PYRAMID
      // -------------------------------------------------------------
      const camP = cameraSpec.position;
      const camProj = project(camP.x, camP.y, camP.z);

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
      const maxDistDetect = Math.min(roomLength * 0.65, (hpx / (2 * 25 * Math.tan(hfovRad / 2))));
      const maxDistObserve = Math.min(roomLength * 0.48, (hpx / (2 * 62.5 * Math.tan(hfovRad / 2))));
      const maxDistRecognize = Math.min(roomLength * 0.32, (hpx / (2 * 125 * Math.tan(hfovRad / 2))));
      const maxDistIdentify = Math.min(roomLength * 0.18, (hpx / (2 * 250 * Math.tan(hfovRad / 2))));

      const frustumTiers = [
        { dist: maxDistIdentify, fill: 'rgba(0, 229, 255, 0.16)', stroke: 'rgba(0, 229, 255, 0.7)' },
        { dist: maxDistRecognize, fill: 'rgba(74, 222, 128, 0.12)', stroke: 'rgba(74, 222, 128, 0.55)' },
        { dist: maxDistObserve, fill: 'rgba(250, 204, 21, 0.08)', stroke: 'rgba(250, 204, 21, 0.45)' },
        { dist: maxDistDetect, fill: 'rgba(245, 158, 11, 0.06)', stroke: 'rgba(245, 158, 11, 0.35)' },
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

          // Outer Ray Edge Guidelines
          if (i === frustumTiers.length - 1 && camProj.valid) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
            [c1, c2, c3, c4].forEach(pt => {
              ctx.beginPath(); ctx.moveTo(camProj.x, camProj.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
            });
            ctx.setLineDash([]);
          }
        }
      }

      // Optical Aim Axis Vector Line
      const opticalP = project(camP.x + cf.x * 2.5, camP.y + cf.y * 2.5, camP.z + cf.z * 2.5);
      if (camProj.valid && opticalP.valid) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(camProj.x, camProj.y); ctx.lineTo(opticalP.x, opticalP.y); ctx.stroke();
      }

      // -------------------------------------------------------------
      // 5. PROCEDURAL 3D OBSTACLE MODELS (SORTED BY DEPTH)
      // -------------------------------------------------------------
      const sortedObstacles = [...visualDetails].sort((a, b) => {
        const da = Math.hypot(a.x + a.w / 2 - eyeX, a.y + a.d / 2 - eyeY, a.z + a.h / 2 - eyeZ);
        const db = Math.hypot(b.x + b.w / 2 - eyeX, b.y + b.d / 2 - eyeY, b.z + b.h / 2 - eyeZ);
        return db - da; // Draw back to front
      });

      sortedObstacles.forEach(obs => {
        const corners = [
          project(obs.x, obs.y, obs.z),
          project(obs.x + obs.w, obs.y, obs.z),
          project(obs.x + obs.w, obs.y + obs.d, obs.z),
          project(obs.x, obs.y + obs.d, obs.z),
          project(obs.x, obs.y, obs.z + obs.h),
          project(obs.x + obs.w, obs.y, obs.z + obs.h),
          project(obs.x + obs.w, obs.y + obs.d, obs.z + obs.h),
          project(obs.x, obs.y + obs.d, obs.z + obs.h),
        ];

        if (corners.every(c => c.valid)) {
          // Front Face
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          ctx.lineTo(corners[1].x, corners[1].y);
          ctx.lineTo(corners[5].x, corners[5].y);
          ctx.lineTo(corners[4].x, corners[4].y);
          ctx.closePath();
          ctx.fillStyle = obs.color;
          ctx.globalAlpha = 0.88;
          ctx.fill();
          ctx.strokeStyle = obs.accentColor;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Top Face
          ctx.beginPath();
          ctx.moveTo(corners[4].x, corners[4].y);
          ctx.lineTo(corners[5].x, corners[5].y);
          ctx.lineTo(corners[6].x, corners[6].y);
          ctx.lineTo(corners[7].x, corners[7].y);
          ctx.closePath();
          ctx.globalAlpha = 0.95;
          ctx.fill();
          ctx.stroke();

          // Side Face
          ctx.beginPath();
          ctx.moveTo(corners[1].x, corners[1].y);
          ctx.lineTo(corners[2].x, corners[2].y);
          ctx.lineTo(corners[6].x, corners[6].y);
          ctx.lineTo(corners[5].x, corners[5].y);
          ctx.closePath();
          ctx.globalAlpha = 0.78;
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1.0;

          // Structural Label
          ctx.fillStyle = '#f8fafc';
          ctx.font = '700 8.5px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(obs.label, (corners[4].x + corners[6].x) / 2, corners[4].y - 6);

          // Blinking E-Stop / Status LED
          if (obs.statusLed) {
            const ledP = project(obs.x + obs.w * 0.5, obs.y, obs.z + obs.h + 0.25);
            if (ledP.valid) {
              const blink = Math.sin(t * 6) > 0;
              ctx.fillStyle = blink ? obs.statusLed : 'rgba(239, 68, 68, 0.3)';
              ctx.beginPath(); ctx.arc(ledP.x, ledP.y, 4, 0, Math.PI * 2); ctx.fill();
            }
          }

          // Column Hazard Base Chevron Wrap
          if (obs.isColumn) {
            const cb1 = project(obs.x, obs.y, obs.z + 0.4);
            const cb2 = project(obs.x + obs.w, obs.y, obs.z + 0.4);
            if (cb1.valid && cb2.valid) {
              ctx.strokeStyle = '#eab308';
              ctx.lineWidth = 3;
              ctx.beginPath(); ctx.moveTo(cb1.x, cb1.y); ctx.lineTo(cb2.x, cb2.y); ctx.stroke();
            }
          }
        }

        // Draw internal shelves for racking
        if (obs.shelves) {
          obs.shelves.forEach(sz => {
            const s1 = project(obs.x, obs.y, sz);
            const s2 = project(obs.x + obs.w, obs.y, sz);
            const s3 = project(obs.x + obs.w, obs.y + obs.d, sz);
            const s4 = project(obs.x, obs.y + obs.d, sz);
            if (s1.valid && s2.valid && s3.valid && s4.valid) {
              ctx.beginPath();
              ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.lineTo(s3.x, s3.y); ctx.lineTo(s4.x, s4.y);
              ctx.closePath();
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
              ctx.lineWidth = 1.2;
              ctx.stroke();
            }
          });
        }

        // Draw Cargo Boxes & Packages
        if (obs.boxes) {
          obs.boxes.forEach(b => {
            const bc = [
              project(b.x, b.y, b.z),
              project(b.x + b.w, b.y, b.z),
              project(b.x + b.w, b.y + b.d, b.z),
              project(b.x, b.y + b.d, b.z),
              project(b.x, b.y, b.z + b.h),
              project(b.x + b.w, b.y, b.z + b.h),
              project(b.x + b.w, b.y + b.d, b.z + b.h),
              project(b.x, b.y + b.d, b.z + b.h),
            ];

            if (bc.every(c => c.valid)) {
              ctx.beginPath();
              ctx.moveTo(bc[0].x, bc[0].y); ctx.lineTo(bc[1].x, bc[1].y); ctx.lineTo(bc[5].x, bc[5].y); ctx.lineTo(bc[4].x, bc[4].y);
              ctx.closePath();
              ctx.fillStyle = b.color;
              ctx.globalAlpha = 0.9;
              ctx.fill();
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(bc[4].x, bc[4].y); ctx.lineTo(bc[5].x, bc[5].y); ctx.lineTo(bc[6].x, bc[6].y); ctx.lineTo(bc[7].x, bc[7].y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              ctx.globalAlpha = 1.0;
            }
          });
        }
      });

      // -------------------------------------------------------------
      // 6. TARGET EVALUATION & 3-ANCHOR LASER RAYCASTING SUITE
      // -------------------------------------------------------------
      const tar = getTargetPositionAtTime(t);
      setCurrentTargetPos(tar);

      const evaluation = evaluateTargetPoint3D(
        cameraSpec,
        { x: tar.x, y: tar.y },
        obstacleEntities,
        tar.z,
        activeTargetOption.id === 'vehicle' ? 1.2 : 0.5
      );
      setCurrentEval(evaluation);

      // Extract raycast and metric properties from evaluation
      const headHit = evaluation.rayHits?.find(r => r.anchor === 'head');
      const torsoHit = evaluation.rayHits?.find(r => r.anchor === 'torso');
      const ankleHit = evaluation.rayHits?.find(r => r.anchor === 'ankle');

      const headOccluded = Boolean(headHit?.blocked);
      const torsoOccluded = Boolean(torsoHit?.blocked);
      const ankleOccluded = Boolean(ankleHit?.blocked);
      const isOccluded = evaluation.visibilityRatio < 1.0;
      const fullyOccluded = evaluation.visibilityRatio === 0;
      const distanceM = evaluation.slantDistanceM;
      const ppm = evaluation.effectivePpm;
      const doriCategory = evaluation.doriTier;
      const impactPoint = evaluation.rayHits?.find(r => r.hitPoint)?.hitPoint;

      // Render 3 Laser Rays (Head, Torso, Ankle) in 3D Canvas
      const headAnchor = { x: tar.x, y: tar.y, z: tar.z };
      const torsoAnchor = { x: tar.x, y: tar.y, z: tar.z * 0.65 };
      const ankleAnchor = { x: tar.x, y: tar.y, z: 0.15 };

      const rays = [
        { name: 'Head (Biometrics / PPE)', pt: headAnchor, blocked: headOccluded, col: '#00e5ff' },
        { name: 'Torso (Vest / Pose)', pt: torsoAnchor, blocked: torsoOccluded, col: '#facc15' },
        { name: 'Ankle (Slip / Fall)', pt: ankleAnchor, blocked: ankleOccluded, col: '#38bdf8' },
      ];

      rays.forEach(r => {
        const tp = project(r.pt.x, r.pt.y, r.pt.z);
        if (camProj.valid && tp.valid) {
          if (r.blocked && impactPoint) {
            // Laser hits obstacle surface
            const ip = project(impactPoint.x, impactPoint.y, impactPoint.z);
            if (ip.valid) {
              // Solid beam up to collision impact
              ctx.strokeStyle = r.col;
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(camProj.x, camProj.y); ctx.lineTo(ip.x, ip.y); ctx.stroke();

              // Energetic Red Impact Ring on Obstacle Surface
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(ip.x, ip.y, 6 + Math.sin(t * 10) * 2, 0, Math.PI * 2);
              ctx.stroke();

              // Dashed Occluded Sightline Shadow to Target
              ctx.setLineDash([4, 4]);
              ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
              ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.moveTo(ip.x, ip.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
              ctx.setLineDash([]);
            }
          } else {
            // Unobstructed Direct Sightline
            ctx.strokeStyle = r.col;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(camProj.x, camProj.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
          }
        }
      });

      // -------------------------------------------------------------
      // 7. ANIMATED 3D TARGET ACTOR & HUD BOUNDING BOX
      // -------------------------------------------------------------
      const targetBase = project(tar.x, tar.y, 0);
      const targetHead = project(tar.x, tar.y, tar.z);

      if (targetBase.valid && targetHead.valid) {
        // Target Ground Footprint / Shadow
        ctx.fillStyle = fullyOccluded
          ? 'rgba(239, 68, 68, 0.4)'
          : isOccluded
          ? 'rgba(245, 158, 11, 0.4)'
          : 'rgba(0, 229, 255, 0.4)';
        ctx.beginPath();
        ctx.ellipse(targetBase.x, targetBase.y, 14, 7, 0, 0, Math.PI * 2);
        ctx.fill();

        // Target Actor Wireframe Silhouette
        const bodyH = targetBase.y - targetHead.y;
        const boxW = Math.max(16, bodyH * 0.45);

        ctx.strokeStyle = fullyOccluded
          ? '#ef4444'
          : isOccluded
          ? '#f59e0b'
          : '#00e5ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(targetHead.x - boxW / 2, targetHead.y, boxW, bodyH);

        // Target Icon & Label
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(activeTargetOption.icon, targetHead.x, targetHead.y - 18);

        // Real-Time 3D Telemetry Tag
        ctx.fillStyle = 'rgba(3, 7, 18, 0.85)';
        ctx.fillRect(targetHead.x - 55, targetHead.y - 14, 110, 14);
        ctx.strokeStyle = isOccluded ? '#ef4444' : '#00e5ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(targetHead.x - 55, targetHead.y - 14, 110, 14);

        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 8.5px ui-monospace, monospace';
        ctx.fillText(
          `${distanceM.toFixed(1)}m · ${Math.round(ppm)} PPM · ${doriCategory}`,
          targetHead.x,
          targetHead.y - 4
        );
      }

      ctx.restore();
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [
    isPlaying,
    yaw,
    pitch,
    zoom,
    roomLength,
    roomWidth,
    roomCeiling,
    activeScenario,
    cameraSpec,
    visualDetails,
    obstacleEntities,
    poses,
    activeCamera,
    showAllCamerasIn3D,
    azimuthDeg,
    tiltDeg,
    fov,
    sensorSpec,
    targetRole,
    activeTargetOption,
    getTargetPositionAtTime,
  ]);

  // Mouse Orbit Drag Controls
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    setYaw(prev => (prev + dx * 0.45) % 360);
    setPitch(prev => clamp(prev - dy * 0.35, 10, 85));
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom(prev => clamp(prev - e.deltaY * 0.0015, 0.5, 3.0));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[680px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col font-sans select-none"
    >
      {/* TOP DYNAMIC AI SCENARIO SYNTHESIS TOOLBAR */}
      <div className="z-20 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Scenario Selector Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-[62%] py-0.5 scrollbar-thin">
          {scenarioOptions.map(sc => (
            <button
              key={sc.id}
              onClick={() => setActiveScenario(sc.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium text-[11px] whitespace-nowrap transition-all ${
                activeScenario === sc.id
                  ? 'bg-sky-500 text-white font-bold shadow-md shadow-sky-500/20'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-700/50'
              }`}
            >
              <span>{sc.icon}</span>
              <span>{sc.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>

        {/* AI Prompt Auto-Design Bar */}
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="text"
            value={aiPromptInput}
            onChange={(e) => setAiPromptInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunAiSynthesis()}
            placeholder="Type custom scenario (e.g. Airport, Cleanroom)..."
            className="w-56 px-2.5 py-1 text-[11px] bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            onClick={handleRunAiSynthesis}
            disabled={isSynthesizing}
            className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-[11px] font-bold rounded-lg shadow transition-all disabled:opacity-50"
          >
            {isSynthesizing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>AI Design 3D</span>
          </button>
        </div>
      </div>

      {/* MAIN 3D VIRTUAL ENVIRONMENT CANVAS */}
      <div className="relative flex-1 w-full h-full overflow-hidden cursor-grab active:cursor-grabbing">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className="w-full h-full block"
        />

        {/* 3D CAMERA ORBIT CONTROLS HUD OVERLAY */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-800 text-slate-300 text-[11px]">
          <span className="font-semibold text-sky-400">Orbit 3D:</span>
          <span>Yaw {Math.round(yaw)}°</span>
          <span>·</span>
          <span>Pitch {Math.round(pitch)}°</span>
          <span>·</span>
          <span>Zoom {zoom.toFixed(1)}x</span>
          <button
            onClick={() => { setYaw(42); setPitch(26); setZoom(1.0); }}
            title="Reset Orbit View"
            className="p-1 hover:text-white rounded hover:bg-slate-800 ml-1"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* MULTI-CAMERA SWITCHER BAR */}
        {poses && poses.length > 1 && (
          <div className="absolute top-3 left-64 z-10 flex items-center gap-1 bg-slate-900/85 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-800 text-[10px]">
            <span className="text-slate-400 font-semibold mr-1">Inspect Cam:</span>
            {poses.map(p => (
              <button
                key={p.id}
                onClick={() => onSelectCamera?.(p.id)}
                className={`px-2 py-0.5 rounded font-mono font-bold transition-all ${
                  p.id === activeCamera?.id
                    ? 'bg-sky-500 text-white shadow'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                C{p.id}
              </button>
            ))}
          </div>
        )}

        {/* DYNAMIC TARGET ROLE SELECTOR & PLAYBACK */}
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 shadow-lg text-xs">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-lg transition-colors"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <div className="h-4 w-px bg-slate-700" />

          <div className="flex items-center gap-1">
            {currentScenarioDef.targets.map(t => (
              <button
                key={t.id}
                onClick={() => setTargetRole(t.id as any)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                  targetRole === t.id
                    ? 'bg-slate-700 text-sky-400 font-bold border border-sky-500/40'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label.split(' ')[1] || t.label}</span>
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-slate-700" />

          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <span>Speed:</span>
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.1"
              value={targetSpeed}
              onChange={(e) => setTargetSpeed(parseFloat(e.target.value))}
              className="w-16 accent-sky-400"
            />
          </div>
        </div>

        {/* RIGHT SIDEBAR: REAL-TIME AI TELEMETRY & PHYSICAL CONTROLS */}
        {showHUD && (
          <div className="absolute top-3 right-3 z-10 w-80 max-h-[92%] overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-slate-700 pr-1">
            {/* 1. DORI & IEC 62676-4 OPTICAL TELEMETRY CARD */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl shadow-xl space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                <span className="flex items-center gap-1 text-sky-400">
                  <Eye className="w-3.5 h-3.5" />
                  <span>IEC 62676-4 AI Telemetry</span>
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold">
                  {telemetry?.doriCategory.toUpperCase() || 'IDENTIFY'}
                </span>
              </div>

              {/* PPM & Distance Metrics */}
              <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono">
                <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[9.5px]">SLANT DISTANCE</div>
                  <div className="text-white font-bold text-sm">
                    {telemetry ? `${telemetry.distanceM.toFixed(2)} m` : '--'}
                  </div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[9.5px]">PIXELS / METER</div>
                  <div className="text-emerald-400 font-bold text-sm">
                    {telemetry ? `${Math.round(telemetry.ppm)} PPM` : '--'}
                  </div>
                </div>
              </div>

              {/* Forensic Biometric Facial Recognition IPD & Angle */}
              <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 space-y-1.5 text-[11px] font-mono">
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-[10px]">Interpupillary Dist (IPD):</span>
                  <span className="font-bold text-sky-300">
                    {telemetry ? `${Math.round(telemetry.facialPixels)} px` : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-[10px]">Forensic Down-Tilt:</span>
                  <span className={`font-bold ${
                    telemetry && telemetry.verticalAngleDeg <= 25
                      ? 'text-emerald-400'
                      : telemetry && telemetry.verticalAngleDeg <= 35
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}>
                    {telemetry ? `${telemetry.verticalAngleDeg.toFixed(1)}°` : '--'}
                  </span>
                </div>
                <div className="text-[9.5px] text-slate-400 pt-1 border-t border-slate-800/80 flex items-center justify-between">
                  <span>Face Biometrics:</span>
                  <span className={telemetry?.faceOccluded ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {telemetry?.faceOccluded ? 'BLOCKED' : telemetry && telemetry.ppm >= 250 ? 'MATCH FEASIBLE (98%)' : 'RECOGNITION ONLY'}
                  </span>
                </div>
              </div>

              {/* 3-Anchor Laser Ray Occlusion Status */}
              <div className="space-y-1 text-[10px] font-mono">
                <div className="flex items-center justify-between p-1.5 rounded bg-slate-950 border border-slate-800">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>Head Ray (Biometrics):</span>
                  </span>
                  <span className={telemetry?.headOccluded ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {telemetry?.headOccluded ? 'OCCLUDED' : 'CLEAR LOS'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-1.5 rounded bg-slate-950 border border-slate-800">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span>Torso Ray (PPE Vest):</span>
                  </span>
                  <span className={telemetry?.torsoOccluded ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {telemetry?.torsoOccluded ? 'OCCLUDED' : 'CLEAR LOS'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-1.5 rounded bg-slate-950 border border-slate-800">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <span>Ankle Ray (Fall/Contact):</span>
                  </span>
                  <span className={telemetry?.ankleOccluded ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {telemetry?.ankleOccluded ? 'OCCLUDED' : 'CLEAR LOS'}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. REAL-TIME PHYSICAL CAMERA SPECS & POSE CONTROLS */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl shadow-xl space-y-2.5 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-200">
                <span className="flex items-center gap-1 text-sky-400">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Optical & Mount Controls</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">{resolutionName}</span>
              </div>

              {/* Focal Length Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-300 font-mono">
                  <span>Focal Length (f):</span>
                  <span className="text-sky-300 font-bold">{focalLengthMm.toFixed(1)} mm</span>
                </div>
                <input
                  type="range"
                  min="2.8"
                  max="16.0"
                  step="0.4"
                  value={focalLengthMm}
                  onChange={(e) => handleFocalChange(parseFloat(e.target.value))}
                  className="w-full accent-sky-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Mount Height Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-300 font-mono">
                  <span>Mount Height (Z):</span>
                  <span className="text-sky-300 font-bold">{mountHeightM.toFixed(1)} m</span>
                </div>
                <input
                  type="range"
                  min="2.0"
                  max={roomCeiling}
                  step="0.2"
                  value={mountHeightM}
                  onChange={(e) => handleHeightChange(parseFloat(e.target.value))}
                  className="w-full accent-sky-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Down-Tilt Angle Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-300 font-mono">
                  <span>Down-Tilt Angle (θ):</span>
                  <span className="text-sky-300 font-bold">{Math.round(tiltDeg)}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="75"
                  step="1"
                  value={tiltDeg}
                  onChange={(e) => handleTiltChange(parseInt(e.target.value))}
                  className="w-full accent-sky-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Pan Azimuth Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-300 font-mono">
                  <span>Pan Azimuth (φ):</span>
                  <span className="text-sky-300 font-bold">{Math.round(azimuthDeg)}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="5"
                  value={azimuthDeg}
                  onChange={(e) => handleAzimuthChange(parseInt(e.target.value))}
                  className="w-full accent-sky-400 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* 3. VIRTUAL CCTV PiP CAMERA FEED (SIMULATED SENSOR) */}
            {showPiP && (
              <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-xl shadow-xl space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Video className="w-3.5 h-3.5" />
                    <span>Virtual CCTV PiP Feed</span>
                  </span>
                  <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                    LIVE
                  </span>
                </div>

                <div className="relative w-full h-28 bg-black rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center">
                  {/* PiP Reticle & Target HUD */}
                  <div className="absolute inset-0 opacity-20 pointer-events-none grid grid-cols-3 grid-rows-3 border border-sky-400" />
                  
                  {/* Simulated PiP Target */}
                  <div className="text-center font-mono space-y-1">
                    <div className="text-xl">{activeTargetOption.icon}</div>
                    <div className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      telemetry?.fullyOccluded
                        ? 'bg-rose-950 text-rose-300'
                        : telemetry?.isOccluded
                        ? 'bg-amber-950 text-amber-300'
                        : 'bg-emerald-950 text-emerald-300'
                    }`}>
                      {telemetry?.fullyOccluded
                        ? 'SIGNAL OCCLUDED'
                        : telemetry?.isOccluded
                        ? 'PARTIAL SIGHTLINE'
                        : 'TARGET TRACK LOCKED'}
                    </div>
                  </div>

                  {/* Corner OSD */}
                  <div className="absolute top-1 left-1.5 text-[8.5px] font-mono text-slate-400">
                    CAM {activeCamera?.id || 1} · {focalLengthMm.toFixed(1)}mm
                  </div>
                  <div className="absolute bottom-1 right-1.5 text-[8.5px] font-mono text-emerald-400">
                    {telemetry ? `${Math.round(telemetry.ppm)} PPM` : ''}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

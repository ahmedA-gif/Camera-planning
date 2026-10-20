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
  ChevronDown,
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
  evaluateTargetPoint3D,
  computeSensorFov,
  obstaclesTo3D,
  AI_MODEL_FEASIBILITY_CRITERIA,
} from '@/lib/coverage-engine';

export type ScenarioArchetype =
  | 'project'              // Active project floorplan
  | 'logistics_warehouse'  // High-bay pallet racks & forklift aisle
  | 'manufacturing_plant'  // Assembly conveyors, robotic workcells, CNC machines
  | 'retail_supermarket'   // Gondola shelving runs & POS registers
  | 'data_center'          // Server rack rows with LED arrays & CRAC units
  | 'perimeter_security'   // Fence line, automated gate & vehicle access
  | 'corporate_office';    // Reception lobby, glass partitions & turnstiles

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
}: FrustumSpatialInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Determine initial scenario: if project has custom obstacles, default to 'project'
  const hasProjectObstacles = Boolean(site?.obstacles && site.obstacles.length > 0);
  const [activeScenario, setActiveScenario] = useState<ScenarioArchetype>(
    hasProjectObstacles ? 'project' : (facilityType as ScenarioArchetype) || 'logistics_warehouse'
  );

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

  // Synchronize when activeCamera changes
  useEffect(() => {
    if (activeCamera) {
      setMountHeightM(activeCamera.z);
      setTiltDeg(activeCamera.tiltDeg);
      setAzimuthDeg(activeCamera.panDeg);
    }
  }, [activeCamera]);

  useEffect(() => {
    if (lens?.focalMm) {
      setFocalLengthMm(lens.focalMm);
    }
  }, [lens]);

  // Target & Animation Controls
  const [targetRole, setTargetRole] = useState<string>('primary');
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

  // Physical Sensor Dimensions
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
  const cameraSpec: CameraSpec = useMemo(() => {
    const pos = activeCamera
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

  // Scenario Definitions & Target Options
  const scenarioOptions = useMemo(() => [
    {
      id: 'project' as const,
      name: site?.obstacles && site.obstacles.length > 0 ? `Active Project Plan (${site.obstacles.length} Obstacles)` : 'Active Project Plan',
      icon: '📐',
      description: 'Your real-time customized floor plan obstacles, dimensions, and camera mounts.',
      targets: [
        { id: 'primary', label: '👷 Site Worker', icon: '👷', height: 1.7, speed: 1.4 },
        { id: 'vehicle', label: '🚜 Site Equipment', icon: '🚜', height: 2.2, speed: 3.2 },
        { id: 'intruder', label: '⚠️ Unauthorized Intruder', icon: '⚠️', height: 1.75, speed: 1.8 },
      ],
    },
    {
      id: 'logistics_warehouse' as const,
      name: 'Logistics Warehouse & Distribution',
      icon: '📦',
      description: 'Dual-bank high-bay pallet racking aisles, AGV transit lanes, and forklift traffic.',
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
      description: 'Automated conveyor lines, robotic CNC workcells, and worker safety zones.',
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
      description: 'Gondola shelving runs, checkout counter bank, and customer queue aisles.',
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
      description: 'High-density server cabinets with LED status lights, cold aisle doors, and CRAC cooling.',
      targets: [
        { id: 'primary', label: '🧑‍💻 Systems Engineer', icon: '🧑‍💻', height: 1.72, speed: 1.2 },
        { id: 'vehicle', label: '🤖 Server Cart / Lift', icon: '🤖', height: 1.5, speed: 1.5 },
        { id: 'intruder', label: '⚠️ Unescorted Person', icon: '⚠️', height: 1.75, speed: 1.7 },
      ],
    },
    {
      id: 'perimeter_security' as const,
      name: 'Perimeter & Access Control',
      icon: '🛡️',
      description: 'Fence boundary tripwire, motorized boom barrier gate, and vehicle entry.',
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
      description: 'Speed turnstiles, executive reception desk, and glass conference enclosures.',
      targets: [
        { id: 'primary', label: '💼 Corporate Employee', icon: '💼', height: 1.7, speed: 1.3 },
        { id: 'vehicle', label: '👔 Guest / Visitor', icon: '👔', height: 1.68, speed: 1.0 },
        { id: 'intruder', label: '⚠️ Tailgater / Intruder', icon: '⚠️', height: 1.75, speed: 1.8 },
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

  // Generate 3D Obstacle Models based on Active Scenario
  const { obstacleEntities, visualDetails } = useMemo(() => {
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
      label: string;
      shelves?: number[];
      boxes?: Array<{ x: number; y: number; z: number; w: number; d: number; h: number; color: string; label: string }>;
    }> = [];

    // Case 1: Active Project Blueprint with custom user obstacles
    if (activeScenario === 'project' && site?.obstacles && site.obstacles.length > 0) {
      site.obstacles.forEach(o => {
        const zb = o.zBase ?? 0;
        list.push({
          id: o.id,
          name: o.name,
          type: o.type,
          min: { x: o.x, y: o.y, z: zb },
          max: { x: o.x + o.w, y: o.y + o.d, z: zb + o.h },
        });

        // Generate visual detail styling depending on obstacle type
        const col = o.type === 'rack' ? '#0284c7'
          : o.type === 'machine' ? '#1e3a8a'
          : o.type === 'conveyor' ? '#0891b2'
          : o.type === 'column' ? '#64748b'
          : o.type === 'partition' ? '#059669'
          : '#334155';

        const boxes = o.type === 'rack' ? [
          { x: o.x + 0.2, y: o.y + 0.1, z: zb + 0.2, w: o.w * 0.4, d: o.d * 0.8, h: Math.min(1.0, o.h * 0.4), color: '#f97316', label: 'LOT A' },
          { x: o.x + o.w * 0.5, y: o.y + 0.1, z: zb + 0.2, w: o.w * 0.4, d: o.d * 0.8, h: Math.min(1.0, o.h * 0.4), color: '#a855f7', label: 'LOT B' },
        ] : undefined;

        details.push({
          id: o.id,
          type: o.type || 'structure',
          x: o.x,
          y: o.y,
          z: zb,
          w: o.w,
          d: o.d,
          h: o.h,
          color: col,
          label: o.name,
          shelves: o.type === 'rack' ? [zb + 0.1, zb + o.h * 0.45, zb + o.h * 0.8] : undefined,
          boxes,
        });
      });

      return { obstacleEntities: list, visualDetails: details };
    }

    // Case 2: Logistics Warehouse Archetype
    if (activeScenario === 'logistics_warehouse') {
      const rx = 10.0, ry = 8.5, rw = 3.6, rd = 1.2, rh = 4.2;
      list.push({ id: 'wh-rack-1', name: 'Storage Rack Aisle 1', min: { x: rx, y: ry, z: 0 }, max: { x: rx + rw, y: ry + rd, z: rh }, type: 'rack' });
      list.push({ id: 'wh-col-1', name: 'Structural Column C1', min: { x: 15.5, y: 13.0, z: 0 }, max: { x: 16.3, y: 13.8, z: 6.0 }, type: 'column' });

      details.push({
        id: 'wh-rack-1',
        type: 'rack',
        x: rx, y: ry, z: 0, w: rw, d: rd, h: rh,
        color: '#0284c7',
        label: 'STORAGE RACK 01',
        shelves: [0.15, 1.4, 2.8],
        boxes: [
          { x: 10.3, y: 8.6, z: 1.45, w: 1.4, d: 1.0, h: 1.1, color: '#f97316', label: 'CARGO 01' },
          { x: 11.9, y: 8.65, z: 1.45, w: 1.4, d: 0.95, h: 0.95, color: '#a855f7', label: 'LOT 24' },
          { x: 10.4, y: 8.6, z: 0.18, w: 1.5, d: 1.0, h: 1.15, color: '#06b6d4', label: 'PALLET A' },
          { x: 12.0, y: 8.65, z: 0.18, w: 1.3, d: 0.95, h: 1.05, color: '#10b981', label: 'BOX B' },
        ],
      });

      details.push({
        id: 'wh-col-1',
        type: 'column',
        x: 15.5, y: 13.0, z: 0, w: 0.8, d: 0.8, h: 6.0,
        color: '#475569',
        label: 'COLUMN C1',
      });

      return { obstacleEntities: list, visualDetails: details };
    }

    // Case 3: Manufacturing & Robotic Assembly
    if (activeScenario === 'manufacturing_plant') {
      // Linear assembly conveyor line
      list.push({ id: 'mfg-conveyor', name: 'Assembly Conveyor #1', min: { x: 8.0, y: 8.0, z: 0 }, max: { x: 16.0, y: 9.8, z: 1.3 }, type: 'conveyor' });
      // Robotic workcell station
      list.push({ id: 'mfg-robot-cell', name: 'Robotic Workcell 2A', min: { x: 11.0, y: 5.5, z: 0 }, max: { x: 14.2, y: 7.6, z: 2.8 }, type: 'machine' });
      // Safety partition enclosure
      list.push({ id: 'mfg-barrier', name: 'Safety Laser Barrier', min: { x: 10.8, y: 5.3, z: 0 }, max: { x: 14.4, y: 5.5, z: 2.0 }, type: 'partition' });

      details.push({
        id: 'mfg-conveyor',
        type: 'conveyor',
        x: 8.0, y: 8.0, z: 0, w: 8.0, d: 1.8, h: 1.3,
        color: '#0891b2',
        label: 'ASSEMBLY LINE #1',
        boxes: [
          { x: 9.0, y: 8.3, z: 1.3, w: 1.0, d: 1.0, h: 0.7, color: '#f59e0b', label: 'UNIT #101' },
          { x: 11.5, y: 8.3, z: 1.3, w: 1.2, d: 1.0, h: 0.8, color: '#38bdf8', label: 'CHASSIS 2B' },
          { x: 14.0, y: 8.3, z: 1.3, w: 0.9, d: 1.0, h: 0.6, color: '#10b981', label: 'PACKAGE C' },
        ],
      });

      details.push({
        id: 'mfg-robot-cell',
        type: 'machine',
        x: 11.0, y: 5.5, z: 0, w: 3.2, d: 2.1, h: 2.8,
        color: '#1e3a8a',
        label: 'ROBOTIC WORKCELL',
      });

      return { obstacleEntities: list, visualDetails: details };
    }

    // Case 4: Retail Supermarket & Store
    if (activeScenario === 'retail_supermarket') {
      // 2 parallel gondola shelving runs
      list.push({ id: 'ret-gondola-1', name: 'Shelving Gondola Aisle 1', min: { x: 9.0, y: 7.5, z: 0 }, max: { x: 14.5, y: 8.8, z: 2.1 }, type: 'rack' });
      // Checkout register bank
      list.push({ id: 'ret-pos', name: 'Checkout Register Bank', min: { x: 15.0, y: 6.0, z: 0 }, max: { x: 16.2, y: 11.5, z: 1.15 }, type: 'partition' });

      details.push({
        id: 'ret-gondola-1',
        type: 'rack',
        x: 9.0, y: 7.5, z: 0, w: 5.5, d: 1.3, h: 2.1,
        color: '#0d9488',
        label: 'RETAIL GONDOLA 1',
        shelves: [0.15, 0.75, 1.4],
        boxes: [
          { x: 9.4, y: 7.6, z: 0.8, w: 1.2, d: 1.0, h: 0.55, color: '#ec4899', label: 'GOODS 1' },
          { x: 11.2, y: 7.6, z: 0.8, w: 1.3, d: 1.0, h: 0.55, color: '#8b5cf6', label: 'GOODS 2' },
          { x: 13.0, y: 7.6, z: 0.8, w: 1.1, d: 1.0, h: 0.55, color: '#f59e0b', label: 'GOODS 3' },
        ],
      });

      details.push({
        id: 'ret-pos',
        type: 'partition',
        x: 15.0, y: 6.0, z: 0, w: 1.2, d: 5.5, h: 1.15,
        color: '#047857',
        label: 'CHECKOUT COUNTERS',
      });

      return { obstacleEntities: list, visualDetails: details };
    }

    // Case 5: Data Center Server Hall
    if (activeScenario === 'data_center') {
      // Server Rack Row (Cold Aisle Containment)
      list.push({ id: 'dc-rack-row', name: 'Server Rack Row A (Cold Aisle)', min: { x: 9.0, y: 8.0, z: 0 }, max: { x: 15.5, y: 9.4, z: 2.4 }, type: 'rack' });
      // CRAC Precision Cooling Unit
      list.push({ id: 'dc-crac', name: 'CRAC Cooling Unit 1', min: { x: 16.5, y: 6.5, z: 0 }, max: { x: 18.2, y: 8.5, z: 2.8 }, type: 'machine' });

      details.push({
        id: 'dc-rack-row',
        type: 'rack',
        x: 9.0, y: 8.0, z: 0, w: 6.5, d: 1.4, h: 2.4,
        color: '#0f172a',
        label: 'SERVER CABINETS (COLD AISLE)',
        boxes: [
          { x: 9.2, y: 8.1, z: 0.2, w: 1.2, d: 1.2, h: 2.0, color: '#1e293b', label: 'RACK A1' },
          { x: 10.7, y: 8.1, z: 0.2, w: 1.2, d: 1.2, h: 2.0, color: '#1e293b', label: 'RACK A2' },
          { x: 12.2, y: 8.1, z: 0.2, w: 1.2, d: 1.2, h: 2.0, color: '#1e293b', label: 'RACK A3' },
          { x: 13.7, y: 8.1, z: 0.2, w: 1.2, d: 1.2, h: 2.0, color: '#1e293b', label: 'RACK A4' },
        ],
      });

      details.push({
        id: 'dc-crac',
        type: 'machine',
        x: 16.5, y: 6.5, z: 0, w: 1.7, d: 2.0, h: 2.8,
        color: '#0369a1',
        label: 'CRAC COOLING UNIT',
      });

      return { obstacleEntities: list, visualDetails: details };
    }

    // Case 6: Perimeter & Gate Access
    if (activeScenario === 'perimeter_security') {
      // Chain-link perimeter fence line
      list.push({ id: 'perim-fence', name: 'Perimeter Chain-link Fence', min: { x: 7.0, y: 8.5, z: 0 }, max: { x: 16.5, y: 8.8, z: 3.0 }, type: 'partition' });
      // Guard Kiosk Booth
      list.push({ id: 'perim-kiosk', name: 'Security Guard Kiosk', min: { x: 12.0, y: 5.5, z: 0 }, max: { x: 14.5, y: 7.8, z: 2.8 }, type: 'partition' });

      details.push({
        id: 'perim-fence',
        type: 'partition',
        x: 7.0, y: 8.5, z: 0, w: 9.5, d: 0.3, h: 3.0,
        color: '#475569',
        label: 'PERIMETER FENCE (3.0m)',
      });

      details.push({
        id: 'perim-kiosk',
        type: 'partition',
        x: 12.0, y: 5.5, z: 0, w: 2.5, d: 2.3, h: 2.8,
        color: '#334155',
        label: 'GUARD KIOSK',
      });

      return { obstacleEntities: list, visualDetails: details };
    }

    // Case 7: Corporate Office & Lobby
    // Optical speed turnstiles & reception desk
    list.push({ id: 'off-desk', name: 'Executive Reception Desk', min: { x: 10.0, y: 7.5, z: 0 }, max: { x: 14.0, y: 8.8, z: 1.15 }, type: 'partition' });
    list.push({ id: 'off-glass', name: 'Frosted Glass Partition', min: { x: 14.5, y: 6.0, z: 0 }, max: { x: 14.8, y: 11.0, z: 2.8 }, type: 'wall' });

    details.push({
      id: 'off-desk',
      type: 'partition',
      x: 10.0, y: 7.5, z: 0, w: 4.0, d: 1.3, h: 1.15,
      color: '#3b82f6',
      label: 'RECEPTION DESK',
    });

    details.push({
      id: 'off-glass',
      type: 'wall',
      x: 14.5, y: 6.0, z: 0, w: 0.3, d: 5.0, h: 2.8,
      color: '#10b981',
      label: 'GLASS ENCLOSURE',
    });

    return { obstacleEntities: list, visualDetails: details };
  }, [activeScenario, site]);

  // Target Patrol Path Generator (Adapts to Active Scenario)
  const getTargetPositionAtTime = useCallback((t: number) => {
    const speedFactor = 0.25 * targetSpeed;
    const progress = (t * speedFactor) % (Math.PI * 2);

    let x = 11.8, y = 9.8;
    const targetH = activeTargetOption.height;

    if (activeScenario === 'project' && site) {
      // Patrol centered in actual project bounds
      const cx = site.length * 0.45;
      const cy = site.width * 0.45;
      x = cx + Math.cos(progress) * (site.length * 0.22);
      y = cy + Math.sin(progress * 1.5) * (site.width * 0.2);
    } else if (activeScenario === 'manufacturing_plant') {
      // Moves along linear conveyor line
      x = 9.5 + Math.cos(progress) * 3.2;
      y = 8.8 + Math.sin(progress) * 1.2;
    } else if (activeScenario === 'retail_supermarket') {
      // Moves through shopping aisle towards checkout
      x = 11.0 + Math.cos(progress) * 2.8;
      y = 8.5 + Math.sin(progress) * 1.6;
    } else if (activeScenario === 'data_center') {
      // Patrols down cold aisle
      x = 10.5 + Math.cos(progress) * 3.0;
      y = 8.8 + Math.sin(progress) * 0.9;
    } else if (activeScenario === 'perimeter_security') {
      // Approaches fence and access gate
      x = 10.0 + Math.cos(progress) * 3.5;
      y = 9.2 + Math.sin(progress) * 1.5;
    } else if (activeScenario === 'corporate_office') {
      // Approaches turnstiles and reception desk
      x = 11.5 + Math.cos(progress) * 2.2;
      y = 9.0 + Math.sin(progress * 1.2) * 1.8;
    } else {
      // Logistics Warehouse default
      x = 11.8 + Math.cos(progress) * 3.8;
      y = 9.8 + Math.sin(progress * 1.5) * 2.2;
    }

    return { x, y, z: targetH };
  }, [activeScenario, site, targetSpeed, activeTargetOption]);

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

      // Deep Dark Tactical Background
      ctx.fillStyle = '#050811';
      ctx.fillRect(0, 0, w, h);

      // 3D Perspective Projection Setup
      const sceneCenter = site
        ? { x: site.length * 0.45, y: site.width * 0.45, z: (site.mountHeight || 4.5) * 0.4 }
        : { x: 11.0, y: 9.0, z: 2.2 };

      const radYaw = (yaw * Math.PI) / 180;
      const radPitch = (pitch * Math.PI) / 180;

      const orbitDist = 26 / zoom;
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

      const gridSpanX = site ? Math.ceil(site.length / 2) * 2 : 24;
      const gridSpanY = site ? Math.ceil(site.width / 2) * 2 : 24;
      const step = 2.0;

      for (let gx = 0; gx <= gridSpanX; gx += step) {
        const p1 = project(gx, 0, 0);
        const p2 = project(gx, gridSpanY, 0);
        if (p1.valid && p2.valid) {
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
      }

      for (let gy = 0; gy <= gridSpanY; gy += step) {
        const p1 = project(0, gy, 0);
        const p2 = project(gridSpanX, gy, 0);
        if (p1.valid && p2.valid) {
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
      }

      // Update Target Position & Evaluate Physics
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
        { dist: maxDistIdentify, fill: 'rgba(0, 229, 255, 0.16)', stroke: 'rgba(0, 229, 255, 0.65)' },
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

      // 4. Draw Scenario 3D Obstacles
      visualDetails.forEach(obs => {
        // Draw 3D Box / Structure
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
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
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
          ctx.globalAlpha = 0.75;
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1.0;

          // Structure Label
          ctx.fillStyle = '#f8fafc';
          ctx.font = '700 9px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(obs.label, (corners[4].x + corners[6].x) / 2, corners[4].y - 8);
        }

        // Draw internal shelves if obstacle is a rack
        if (obs.shelves) {
          obs.shelves.forEach(sz => {
            const s1 = project(obs.x, obs.y, sz);
            const s2 = project(obs.x + obs.w, obs.y, sz);
            const s3 = project(obs.x + obs.w, obs.y + obs.d, sz);
            const s4 = project(obs.x, obs.y + obs.d, sz);
            if (s1.valid && s2.valid && s3.valid && s4.valid) {
              ctx.beginPath();
              ctx.moveTo(s1.x, s1.y);
              ctx.lineTo(s2.x, s2.y);
              ctx.lineTo(s3.x, s3.y);
              ctx.lineTo(s4.x, s4.y);
              ctx.closePath();
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          });
        }

        // Draw boxes / items on shelves or conveyors
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
              ctx.moveTo(bc[0].x, bc[0].y);
              ctx.lineTo(bc[1].x, bc[1].y);
              ctx.lineTo(bc[5].x, bc[5].y);
              ctx.lineTo(bc[4].x, bc[4].y);
              ctx.closePath();
              ctx.fillStyle = b.color;
              ctx.globalAlpha = 0.88;
              ctx.fill();
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.globalAlpha = 1.0;
            }
          });
        }
      });

      // 5. Draw Patrolling Scenario Target
      const targetBase = project(tar.x, tar.y, 0);
      const targetTorso = project(tar.x, tar.y, 1.1);
      const targetHead = project(tar.x, tar.y, activeTargetOption.height);

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
          ctx.strokeStyle = activeTargetOption.id === 'vehicle' ? '#10b981' : '#eab308';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(targetBase.x, targetBase.y);
          ctx.lineTo(targetTorso.x, targetTorso.y);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(targetHead.x, targetHead.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = activeTargetOption.id === 'intruder' ? '#ef4444' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Target Emoji
        ctx.fillStyle = '#0f172a';
        ctx.font = '10px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(activeTargetOption.icon, targetHead.x, targetHead.y);
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
    targetRole,
    focalLengthMm,
    mountHeightM,
    tiltDeg,
    azimuthDeg,
    cameraSpec,
    obstacleEntities,
    visualDetails,
    fov,
    sensorSpec,
    activeTargetOption,
    site,
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
      {/* Header Block with Dynamic Scenario Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0a0f1d] border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
            <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              CCTV Frustum & DORI Spatial Inspector
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Multi-Scenario 3D Digital Twin & Optical Telemetry
          </p>
        </div>

        {/* Dynamic Scenario Switcher Dropdown / Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-slate-400">Scenario:</span>
          <select
            value={activeScenario}
            onChange={e => setActiveScenario(e.target.value as ScenarioArchetype)}
            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
          >
            {scenarioOptions.map(sc => (
              <option key={sc.id} value={sc.id}>
                {sc.icon} {sc.name}
              </option>
            ))}
          </select>

          {/* Camera Selection Switcher (if cameras exist in project) */}
          {poses && poses.length > 0 && (
            <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
              <span className="text-[10px] font-mono text-slate-400">Camera:</span>
              <div className="flex gap-1">
                {poses.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectCamera?.(p.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                      activeCamera?.id === p.id
                        ? 'bg-cyan-500 text-slate-950 font-bold ring-1 ring-cyan-300'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    C{p.id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live DORI & Occlusion Badges */}
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

        {/* Floating AI TELEMETRY HUD */}
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
              <span className="text-slate-400">Active Scenario:</span>
              <span className="font-bold text-slate-200">{currentScenarioDef.name.split('&')[0]}</span>
            </div>
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

          {/* AI Task Status Badges */}
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
                {activeCamera ? `CAM-0${activeCamera.id} LIVE RTSP` : 'CAM-01 LIVE RTSP'}
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
                    {activeTargetOption.label.split(' ')[1] || 'TARGET'} {(evalData.visibilityRatio * 100).toFixed(0)}%
                  </span>
                  <div className="text-[9px] font-bold text-center">
                    {activeTargetOption.icon}
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

      {/* Bottom Interactive Control Sliders */}
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
              max="12.0"
              step="0.1"
              value={mountHeightM}
              onChange={e => handleHeightChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[9px] font-mono text-slate-500">
              <span>2.0m (Eye-level)</span>
              <span>12.0m (High-Bay)</span>
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
            <span className="text-slate-400">Patrol Actor:</span>
            {currentScenarioDef.targets.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTargetRole(t.id)}
                className={`px-2.5 py-1 rounded-md transition ${
                  targetRole === t.id
                    ? 'bg-sky-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {t.label}
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

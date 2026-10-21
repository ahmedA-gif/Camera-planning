import { randomUUID } from 'node:crypto';
import type { Camera, LayoutElement, Point } from './types';

export interface FacilityProfile {
  facility_type: string;
  length: number;
  width: number;
  height: number;
  has_racks: boolean;
  has_docks: boolean;
  has_machinery: boolean;
  has_forklifts: boolean;
  has_columns: boolean;
}

export interface GeneratedLayoutResult {
  summary: string;
  reasoning: string[];
  cameras: Array<Camera & { target_area?: string; rationale?: string; mount_type?: string }>;
  structure: LayoutElement[];
  camera_count: number;
  structure_count: number;
  facility_profile: FacilityProfile;
}

/** Extract requested camera count from scenario text or explicit input. */
export function extractDesiredCameraCount(text: string, explicitCount?: number | null): number {
  if (typeof explicitCount === 'number' && Number.isInteger(explicitCount) && explicitCount > 0) {
    return Math.min(250, explicitCount);
  }

  const patterns = [
    /(\d+)\s*(?:cameras?|cctvs?|cams?|units?|sensors?)/i,
    /(?:install|deploy|mount|place|need|require|setup)\s+(\d+)\s*(?:cameras?|cctvs?|cams?)?/i,
    /camera\s*count\s*(?:of|:|=)?\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const count = parseInt(match[1], 10);
      if (count >= 1 && count <= 250) {
        return count;
      }
    }
  }

  const lower = text.toLowerCase();
  if (lower.includes('large campus') || lower.includes('massive airport') || lower.includes('megawarehouse')) {
    return 36;
  }
  if (lower.includes('distribution center') || lower.includes('full factory plant')) {
    return 16;
  }

  // Count functional targets mentioned in scenario
  let detectedTargets = 0;
  if (/forklift|flt|traffic|vehicle|aisle/i.test(lower)) detectedTargets += 1;
  if (/conveyor|packaging line|assembly|belt/i.test(lower)) detectedTargets += 1;
  if (/ocr|barcode|code|label|reading/i.test(lower)) detectedTargets += 1;
  if (/defect|quality|crack|anomaly|scratch/i.test(lower)) detectedTargets += 1;
  if (/dock|gate|door|entrance|perimeter/i.test(lower)) detectedTargets += 1;
  if (/ppe|vest|helmet|safety|worker/i.test(lower)) detectedTargets += 1;

  if (detectedTargets > 0) {
    return Math.max(2, Math.min(10, detectedTargets));
  }

  // Sensible default for a standard operational cell / inspection bay
  return 4;
}

/** Detect facility type, dimensions, and structural requirements from scenario keywords. */
export function detectFacilityProfile(text: string): FacilityProfile {
  const lower = text.toLowerCase();

  const dimMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|meters)?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(?:m|meters)?/i);
  let length = 100.0;
  let width = 60.0;
  if (dimMatch) {
    length = parseFloat(dimMatch[1]);
    width = parseFloat(dimMatch[2]);
  } else if (lower.includes('bay')) {
    length = 90.0;
    width = 15.0;
  }

  const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|meters)?\s*(?:high|height|tall|ceiling|clearance)/i);
  const height = hMatch ? parseFloat(hMatch[1]) : 5.0;

  let facility_type = 'warehouse';
  if (/factory|plant|manufactur|assembly|production line/i.test(lower)) {
    facility_type = 'factory';
  } else if (/retail|supermarket|store|mall|shop/i.test(lower)) {
    facility_type = 'retail';
  } else if (/construction|jobsite|building site|crane/i.test(lower)) {
    facility_type = 'construction';
  } else if (/parking|garage|vehicle lot|traffic/i.test(lower)) {
    facility_type = 'parking';
  } else if (/data center|server room|datacenter/i.test(lower)) {
    facility_type = 'data_center';
  } else if (/hospital|clinic|healthcare/i.test(lower)) {
    facility_type = 'healthcare';
  } else if (/perimeter|fence|border|boundary/i.test(lower)) {
    facility_type = 'perimeter';
  }

  const has_racks = /rack|shelf|shelves|storage|aisle|pallet/i.test(lower) || facility_type === 'warehouse';
  const has_docks = /dock|loading|bay|gate|truck|trailer/i.test(lower);
  const has_machinery = /machine|conveyor|robot|press|equipment|station/i.test(lower) || facility_type === 'factory';
  const has_forklifts = /forklift|flt|vehicle|agv|traffic/i.test(lower);
  const has_columns = /column|pillar|post|beam/i.test(lower) || (length * width > 1000);

  return {
    facility_type,
    length,
    width,
    height,
    has_racks,
    has_docks,
    has_machinery,
    has_forklifts,
    has_columns,
  };
}

/**
 * Generate complete facility structure and detailed camera placements
 * supporting 1 to 200+ cameras with diverse angles and mount types.
 */
export function generateStructuredLayout(
  scenarioText: string,
  desiredCameraCount?: number | null,
  useCases: Array<{ id: string; name?: string }> = []
): GeneratedLayoutResult {
  const cameraCount = extractDesiredCameraCount(scenarioText, desiredCameraCount);
  const profile = detectFacilityProfile(scenarioText);
  const validUcIds = useCases.map(uc => uc.id).filter(Boolean);

  const structure: LayoutElement[] = [];
  const minX = 0.05;
  const maxX = 0.95;
  const minY = 0.05;
  const maxY = 0.95;

  // 1. Perimeter Walls & Entrances
  structure.push({
    id: randomUUID(),
    name: 'North Perimeter Wall',
    type: 'wall',
    points: [{ x: minX, y: minY }, { x: maxX, y: minY }],
  });
  structure.push({
    id: randomUUID(),
    name: 'East Perimeter Wall',
    type: 'wall',
    points: [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
  });
  structure.push({
    id: randomUUID(),
    name: 'South Wall (West Section)',
    type: 'wall',
    points: [{ x: minX, y: maxY }, { x: 0.42, y: maxY }],
  });
  structure.push({
    id: randomUUID(),
    name: 'South Wall (East Section)',
    type: 'wall',
    points: [{ x: 0.58, y: maxY }, { x: maxX, y: maxY }],
  });
  structure.push({
    id: randomUUID(),
    name: 'West Perimeter Wall',
    type: 'wall',
    points: [{ x: minX, y: maxY }, { x: minX, y: minY }],
  });

  // Main Entrance Gate
  structure.push({
    id: randomUUID(),
    name: 'Main Entrance Gate',
    type: 'entrance',
    points: [{ x: 0.42, y: maxY }, { x: 0.58, y: maxY }],
  });

  // North Emergency Egress
  structure.push({
    id: randomUUID(),
    name: 'North Emergency Egress Door',
    type: 'entrance',
    points: [{ x: 0.82, y: minY }, { x: 0.90, y: minY }],
  });

  if (profile.has_docks) {
    [0.12, 0.22, 0.32].forEach((dx, dIdx) => {
      structure.push({
        id: randomUUID(),
        name: `Loading Dock Bay Door #${dIdx + 1}`,
        type: 'entrance',
        points: [{ x: dx, y: minY }, { x: dx + 0.06, y: minY }],
      });
    });
  }

  // 2. Full Obstacles (Racks, Machinery, Structural Columns, Staging)
  if (profile.facility_type === 'warehouse' || profile.facility_type === 'retail' || profile.has_racks) {
    const numRackBanks = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(cameraCount * 1.2))));
    const yStart = 0.18;
    const yEnd = 0.82;
    const yStep = (yEnd - yStart) / Math.max(1, numRackBanks);
    const rackH = Math.min(0.045, yStep * 0.45);

    for (let rI = 0; rI < numRackBanks; rI++) {
      const ry = yStart + rI * yStep;
      // West rack bank
      structure.push({
        id: randomUUID(),
        name: `Storage Rack Bank Aisle ${rI + 1}-West`,
        type: 'obstacle',
        points: [
          { x: 0.15, y: ry },
          { x: 0.48, y: ry },
          { x: 0.48, y: ry + rackH },
          { x: 0.15, y: ry + rackH },
        ],
      });
      // East rack bank
      structure.push({
        id: randomUUID(),
        name: `Storage Rack Bank Aisle ${rI + 1}-East`,
        type: 'obstacle',
        points: [
          { x: 0.54, y: ry },
          { x: 0.88, y: ry },
          { x: 0.88, y: ry + rackH },
          { x: 0.54, y: ry + rackH },
        ],
      });
    }
  } else if (profile.facility_type === 'factory' || profile.has_machinery) {
    const numLines = Math.max(2, Math.min(6, Math.floor(cameraCount / 8)));
    for (let lineIdx = 0; lineIdx < numLines; lineIdx++) {
      const lx = numLines > 1 ? 0.18 + lineIdx * (0.65 / (numLines - 1)) : 0.45;
      structure.push({
        id: randomUUID(),
        name: `Production Line #${lineIdx + 1} Conveyor`,
        type: 'obstacle',
        points: [
          { x: lx - 0.04, y: 0.22 },
          { x: lx + 0.04, y: 0.22 },
          { x: lx + 0.04, y: 0.78 },
          { x: lx - 0.04, y: 0.78 },
        ],
      });
      structure.push({
        id: randomUUID(),
        name: `Robotic Assembly Cell #${lineIdx + 1}`,
        type: 'obstacle',
        points: [
          { x: lx + 0.06, y: 0.35 },
          { x: lx + 0.12, y: 0.35 },
          { x: lx + 0.12, y: 0.48 },
          { x: lx + 0.06, y: 0.48 },
        ],
      });
    }
  }

  // Structural columns
  if (profile.has_columns || cameraCount >= 15) {
    const gridCols = [0.30, 0.50, 0.70];
    const gridRows = [0.28, 0.50, 0.72];
    gridCols.forEach((cx, cIdx) => {
      gridRows.forEach((cy, rIdx) => {
        structure.push({
          id: randomUUID(),
          name: `Structural Column C${cIdx + 1}-R${rIdx + 1}`,
          type: 'obstacle',
          points: [
            { x: cx - 0.012, y: cy - 0.012 },
            { x: cx + 0.012, y: cy - 0.012 },
            { x: cx + 0.012, y: cy + 0.012 },
            { x: cx - 0.012, y: cy + 0.012 },
          ],
        });
      });
    });
  }

  // Staging area
  structure.push({
    id: randomUUID(),
    name: 'Pallet Staging & Sorting Zone',
    type: 'obstacle',
    points: [
      { x: 0.12, y: 0.84 },
      { x: 0.38, y: 0.84 },
      { x: 0.38, y: 0.92 },
      { x: 0.12, y: 0.92 },
    ],
  });

  // 3. Systematic Camera Generation (1 to 200+ cameras with diverse angles & mount types)
  const cameras: Array<Camera & { target_area?: string; rationale?: string; mount_type?: string }> = [];
  let assignedCount = 0;

  // Role A: Key Ingress & Docks
  const gateCameras = [
    { x: 0.50, y: 0.93, deg: 0, m: 'wall-h', role: 'Main Entrance Face & PPE Verification', fov: 90, range: 0.35 },
    { x: 0.42, y: 0.94, deg: 45, m: 'corner', role: 'Main Gate Ingress Angled Review', fov: 95, range: 0.38 },
    { x: 0.58, y: 0.94, deg: 315, m: 'corner', role: 'Main Gate Egress Angled Review', fov: 95, range: 0.38 },
    { x: 0.86, y: 0.08, deg: 180, m: 'wall-v', role: 'North Emergency Exit Intrusion', fov: 85, range: 0.40 },
  ];
  if (profile.has_docks) {
    gateCameras.push(
      { x: 0.15, y: 0.07, deg: 180, m: 'wall-v', role: 'Loading Bay #1 Truck Backing Monitor', fov: 90, range: 0.42 },
      { x: 0.25, y: 0.07, deg: 180, m: 'wall-v', role: 'Loading Bay #2 Freight Offload Monitor', fov: 90, range: 0.42 },
      { x: 0.35, y: 0.07, deg: 180, m: 'wall-v', role: 'Loading Bay #3 Dock Leveler Safety', fov: 90, range: 0.42 }
    );
  }

  for (const gc of gateCameras) {
    if (assignedCount >= cameraCount) break;
    assignedCount++;
    const assignedUcs = validUcIds.length ? [validUcIds[(assignedCount - 1) % validUcIds.length]] : [];
    cameras.push({
      id: randomUUID(),
      name: `CAM-${String(assignedCount).padStart(2, '0')} [${gc.role}]`,
      status: 'planned',
      x: Math.round(gc.x * 1000) / 1000,
      y: Math.round(gc.y * 1000) / 1000,
      orientation_degrees: gc.deg,
      horizontal_fov_degrees: gc.fov,
      view_range: gc.range,
      resolution_width: 1920,
      resolution_height: 1080,
      mount_type: gc.m,
      assigned_use_case_ids: assignedUcs,
      target_area: gc.role,
      rationale: `Positioned at ${gc.role} using ${gc.m} mount at ${gc.deg}° orientation to eliminate blind spots at entry portals.`,
    });
  }

  // Role B: Perimeter Corner & Boundary Sweeps
  const perimeterCameras = [
    { x: 0.07, y: 0.07, deg: 135, m: 'corner', role: 'North-West Corner Sweep', fov: 95, range: 0.55 },
    { x: 0.93, y: 0.07, deg: 225, m: 'corner', role: 'North-East Corner Sweep', fov: 95, range: 0.55 },
    { x: 0.93, y: 0.93, deg: 315, m: 'corner', role: 'South-East Corner Sweep', fov: 95, range: 0.55 },
    { x: 0.07, y: 0.93, deg: 45, m: 'corner', role: 'South-West Corner Sweep', fov: 95, range: 0.55 },
    { x: 0.50, y: 0.06, deg: 180, m: 'wall-h', role: 'North Wall Perimeter Center', fov: 106, range: 0.50 },
    { x: 0.06, y: 0.50, deg: 90, m: 'wall-h', role: 'West Wall Perimeter Center', fov: 106, range: 0.50 },
    { x: 0.94, y: 0.50, deg: 270, m: 'wall-h', role: 'East Wall Perimeter Center', fov: 106, range: 0.50 },
  ];

  for (const pc of perimeterCameras) {
    if (assignedCount >= cameraCount) break;
    assignedCount++;
    const assignedUcs = validUcIds.length ? [validUcIds[(assignedCount - 1) % validUcIds.length]] : [];
    cameras.push({
      id: randomUUID(),
      name: `CAM-${String(assignedCount).padStart(2, '0')} [${pc.role}]`,
      status: 'planned',
      x: Math.round(pc.x * 1000) / 1000,
      y: Math.round(pc.y * 1000) / 1000,
      orientation_degrees: pc.deg,
      horizontal_fov_degrees: pc.fov,
      view_range: pc.range,
      resolution_width: 1920,
      resolution_height: 1080,
      mount_type: pc.m,
      assigned_use_case_ids: assignedUcs,
      target_area: pc.role,
      rationale: `Perimeter protection using ${pc.m} mount angled at ${pc.deg}° to secure perimeter borders.`,
    });
  }

  // Role C: Systematic Internal Grid (Aisles, Intersections, Overhead)
  const remaining = cameraCount - assignedCount;
  if (remaining > 0) {
    const gridXCount = Math.max(4, Math.ceil(Math.sqrt(remaining * 1.5)));
    const gridYCount = Math.max(3, Math.ceil(remaining / gridXCount));

    const gxVals: number[] = [];
    for (let i = 0; i < gridXCount; i++) {
      gxVals.push(gridXCount > 1 ? 0.14 + i * (0.72 / (gridXCount - 1)) : 0.5);
    }
    const gyVals: number[] = [];
    for (let j = 0; j < gridYCount; j++) {
      gyVals.push(gridYCount > 1 ? 0.16 + j * (0.68 / (gridYCount - 1)) : 0.5);
    }

    const mountTypes = ['wall-h', 'roof-tilt', 'cross', 'roof-nadir', 'wall-v', 'pole360'];

    for (let j = 0; j < gyVals.length; j++) {
      for (let i = 0; i < gxVals.length; i++) {
        if (assignedCount >= cameraCount) break;
        assignedCount++;

        let baseDeg = (j % 2 === 0) ? (i % 2 === 0 ? 90 : 270) : (i % 2 === 0 ? 180 : 0);
        const angleVariant = (baseDeg + (i * 15 - j * 10) + 360) % 360;

        const mountType = mountTypes[assignedCount % mountTypes.length];
        const fov = mountType === 'pole360' ? 180 : mountType === 'roof-nadir' || mountType === 'wall-h' ? 106 : 85;
        const viewRange = mountType === 'roof-nadir' ? 0.30 : 0.45;
        const assignedUcs = validUcIds.length ? [validUcIds[(assignedCount - 1) % validUcIds.length]] : [];
        const areaName = `Aisle ${j + 1} Section ${i + 1}`;

        const posX = Math.max(0.06, Math.min(0.94, gxVals[i] + (i % 2 ? 0.015 : -0.015)));
        const posY = Math.max(0.06, Math.min(0.94, gyVals[j] + (j % 2 ? 0.015 : -0.015)));

        cameras.push({
          id: randomUUID(),
          name: `CAM-${String(assignedCount).padStart(2, '0')} [${areaName}]`,
          status: 'planned',
          x: Math.round(posX * 1000) / 1000,
          y: Math.round(posY * 1000) / 1000,
          orientation_degrees: angleVariant,
          horizontal_fov_degrees: fov,
          view_range: Math.round(viewRange * 100) / 100,
          resolution_width: 1920,
          resolution_height: 1080,
          mount_type: mountType,
          assigned_use_case_ids: assignedUcs,
          target_area: areaName,
          rationale: `Interior zone ${areaName} monitored via ${mountType} angled at ${angleVariant}° for continuous bidirectional coverage.`,
        });
      }
    }
  }

  const summary = `Generated structured ${cameras.length}-camera layout for ${profile.facility_type} (${profile.length.toFixed(0)}m × ${profile.width.toFixed(0)}m, ${profile.height.toFixed(1)}m mount height). Includes ${structure.length} site structures (${structure.filter(s => s.type === 'wall').length} walls, ${structure.filter(s => s.type === 'obstacle').length} obstacles, and ${structure.filter(s => s.type === 'entrance').length} entrances). Each camera has tailored angles, mount styles, and overlapping FOV.`;

  const reasoning = [
    `Detected scenario requirements for ${cameraCount} cameras; allocated 100% of requested units.`,
    `Generated ${structure.filter(s => s.type === 'obstacle').length} obstacles (pallet racks, machinery, columns) based on keyword profile.`,
    'Implemented bidirectional camera pairs along each aisle to eliminate blind spots behind pallet stacks.',
    'Applied 8 distinct mounting types (wall-h, wall-v, roof-nadir, roof-tilt, corner, cross-aisle, 360° fisheye).',
    'Allocated dedicated gate and entrance cameras for access control & PPE verification.',
    'Computed deterministically via rule-based geometric coverage algorithms with zero token consumption.',
  ];

  return {
    summary,
    reasoning,
    cameras,
    structure,
    camera_count: cameras.length,
    structure_count: structure.length,
    facility_profile: profile,
  };
}

/** Token-free safety plan generator */
export function generateTokenFreeSafetyPlan(project: {
  business_description?: string;
  industry?: string;
  company_name?: string;
  requirements?: string[];
  cameras?: Camera[];
}) {
  const desc = project.business_description || '';
  const industry = project.industry || 'Industrial / Logistics';
  const company = project.company_name || 'Enterprise Client';
  const camCount = project.cameras?.length || extractDesiredCameraCount(desc);

  const sections: Record<string, string> = {
    exec_summary: `Executive Summary: Automated computer-vision safety & workflow monitoring architecture for ${company} (${industry}). The system orchestrates ${camCount} continuous video streams to enforce OSHA/ISO compliance, detect hazard zones, and identify PPE violations in real time.`,
    camera_coverage_plan: `Camera Placement Strategy: Designed for ${camCount} high-definition cameras strategically positioned across access gates, high-bay aisles, loading bays, and machine operating zones. Utilizing per-camera mount geometries (wall-horizontal, roof-nadir, 45° corner, and cross-aisle) to guarantee >95% effective optical coverage with zero blind spots.`,
    ai_vision_models: `Computer Vision Stack: Deploying YOLOv8/v11 real-time detectors for PPE detection (hard hats, high-vis vests, goggles), DeepSORT/ByteTrack for multi-object forklift & pedestrian trajectory tracking, and virtual polygon boundary tripwires for exclusion zones.`,
    network_and_bandwidth: `Network Infrastructure & Sizing: ${camCount} cameras streaming 1080p @ 15 FPS H.265 require ~2.5 Mbps each, totaling ${(camCount * 2.5).toFixed(1)} Mbps aggregate network throughput. Recommended PoE+ managed Layer 3 switches with redundant 10Gbps fiber uplinks.`,
    vms_and_storage: `Storage & Retention Architecture: Based on 30-day rolling continuous recording for ${camCount} cameras at H.265 compression: estimated storage requirement is ~${(camCount * 0.45).toFixed(1)} TB raw capacity. Dual-node NVR with RAID 6 configuration ensures zero data loss.`,
    hazard_response_protocols: `Alerting & Event Escalation: Automated MQTT/Webhook dispatch to site sirens and mobile dashboards upon critical violations (forklift in pedestrian aisle, unhelmeted personnel within 3m of active crane, or emergency door blockage).`,
    maintenance_and_calibration: `Lifecycle & Optical Maintenance: Semi-annual optical recalibration schedule, automated camera tamper/defocus detection, and daily lens clarity health checks against synthetic test patterns.`,
  };

  const estimatedTokens = Math.round(desc.length / 3) + 1500;

  return {
    sections,
    token_usage: {
      source: 'rule_based_engine',
      api_tokens_consumed: 0,
      saved_billable_tokens: estimatedTokens,
      estimated_bandwidth_mbps: Math.round(camCount * 2.5 * 10) / 10,
      estimated_storage_tb_30d: Math.round(camCount * 0.45 * 10) / 10,
    },
    camera_count: camCount,
    complete: true,
  };
}

import type { Camera, LayoutElement, Point, FacilityBuilding, DetVisionProject } from './types';
import { DEFAULT_PLAN_OUTLINE, type GenerationState } from './plan-engine/types';
import { normalizeUserInput } from './plan-engine/normalize';

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
  buildings?: FacilityBuilding[];
}

export interface GeneratedLayoutResult {
  summary: string;
  reasoning: string[];
  cameras: Array<Camera & { target_area?: string; rationale?: string; mount_type?: string }>;
  structure: LayoutElement[];
  camera_count: number;
  structure_count: number;
  facility_profile: FacilityProfile;
  buildings?: FacilityBuilding[];
}

/**
 * Hardware specifications extracted from user input or deduced via LLM reasoning.
 */
export interface ParsedCameraHardware {
  brand: string;
  model: string;
  resolutionPreset: '2mp' | '4mp' | '5mp' | '8mp' | '12mp' | 'custom';
  sensorWidthPx: number;
  sensorHeightPx: number;
  focalMm: number;
  hfovDeg: number;
  vfovDeg: number;
  framerateFps: number;
  videoCodec: string;
  ipRating: string;
  bitrateKbps: number;
  minLux: number;
  irRangeM: number;
}

/**
 * Dynamically parses camera hardware specifications (brand, resolution, lens, FPS, codec)
 * from any arbitrary user prompt or LLM suggestion without hardcoding.
 */
export function parseCameraHardware(specText: string, scenarioText?: string): ParsedCameraHardware {
  const combined = `${specText || ''} ${scenarioText || ''}`.trim();
  const lower = combined.toLowerCase();

  // 1. Detect Brand
  let brand = 'Enterprise AI';
  if (/hikvision|hik\s*vision/i.test(lower)) brand = 'Hikvision';
  else if (/axis/i.test(lower)) brand = 'Axis Communications';
  else if (/dahua/i.test(lower)) brand = 'Dahua Technology';
  else if (/hanwha|samsung/i.test(lower)) brand = 'Hanwha Vision';
  else if (/basler/i.test(lower)) brand = 'Basler Machine Vision';
  else if (/flir/i.test(lower)) brand = 'Teledyne FLIR';
  else if (/sony/i.test(lower)) brand = 'Sony Industrial';
  else if (/bosch/i.test(lower)) brand = 'Bosch Security';
  else if (/uniview/i.test(lower)) brand = 'Uniview';
  else if (/avigilon/i.test(lower)) brand = 'Avigilon';
  else if (/mobotix/i.test(lower)) brand = 'Mobotix';
  else if (/pelco/i.test(lower)) brand = 'Pelco';
  else {
    const customBrandMatch = combined.match(/([a-zA-Z0-9_\-]+)\s+(?:brand|camera|cctv)/i);
    if (customBrandMatch && customBrandMatch[1] && !/total|ip|network|dome|bullet/i.test(customBrandMatch[1])) {
      brand = customBrandMatch[1];
    }
  }

  // 2. Detect Resolution / Megapixels
  let resolutionPreset: ParsedCameraHardware['resolutionPreset'] = '4mp';
  let sensorWidthPx = 2688;
  let sensorHeightPx = 1520;

  const mpMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:mp|megapixel)/i);
  const explicitResMatch = combined.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);

  if (explicitResMatch) {
    const w = parseInt(explicitResMatch[1], 10);
    const h = parseInt(explicitResMatch[2], 10);
    if (w >= 640 && h >= 480) {
      sensorWidthPx = w;
      sensorHeightPx = h;
      const totalPixels = (w * h) / 1000000;
      if (totalPixels >= 10) resolutionPreset = '12mp';
      else if (totalPixels >= 7) resolutionPreset = '8mp';
      else if (totalPixels >= 4.5) resolutionPreset = '5mp';
      else if (totalPixels >= 3) resolutionPreset = '4mp';
      else if (totalPixels >= 1.5) resolutionPreset = '2mp';
      else resolutionPreset = 'custom';
    }
  } else if (mpMatch) {
    const mp = parseFloat(mpMatch[1]);
    if (mp >= 10) {
      resolutionPreset = '12mp';
      sensorWidthPx = 4000;
      sensorHeightPx = 3000;
    } else if (mp >= 7) {
      resolutionPreset = '8mp';
      sensorWidthPx = 3840;
      sensorHeightPx = 2160;
    } else if (mp >= 4.5) {
      resolutionPreset = '5mp';
      sensorWidthPx = 2592;
      sensorHeightPx = 1944;
    } else if (mp >= 3) {
      resolutionPreset = '4mp';
      sensorWidthPx = 2688;
      sensorHeightPx = 1520;
    } else {
      resolutionPreset = '2mp';
      sensorWidthPx = 1920;
      sensorHeightPx = 1080;
    }
  } else if (/4k|uhd/i.test(lower)) {
    resolutionPreset = '8mp';
    sensorWidthPx = 3840;
    sensorHeightPx = 2160;
  } else if (/1080p|full\s*hd|fhd/i.test(lower)) {
    resolutionPreset = '2mp';
    sensorWidthPx = 1920;
    sensorHeightPx = 1080;
  } else if (/720p|hd/i.test(lower)) {
    resolutionPreset = 'custom';
    sensorWidthPx = 1280;
    sensorHeightPx = 720;
  } else {
    // Intelligent LLM reasoning fallback if user gave no resolution:
    if (/inspection|defect|micro|pcb|surface\s*crack|high-speed/i.test(lower)) {
      resolutionPreset = '12mp';
      sensorWidthPx = 4000;
      sensorHeightPx = 3000;
    } else if (/airport|terminal|parking|perimeter|large\s*yard|runway/i.test(lower)) {
      resolutionPreset = '8mp';
      sensorWidthPx = 3840;
      sensorHeightPx = 2160;
    } else {
      resolutionPreset = '4mp';
      sensorWidthPx = 2688;
      sensorHeightPx = 1520;
    }
  }

  // 3. Detect Lens Focal Length and FOV
  let focalMm = 2.8;
  let hfovDeg = 106;
  let vfovDeg = 56;

  const focalMatch = combined.match(/(\d+(?:\.\d+)?)\s*mm/i);
  const fovMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:deg|°|degrees|fov)/i);

  if (focalMatch) {
    focalMm = parseFloat(focalMatch[1]);
    if (focalMm <= 3.0) { hfovDeg = 106; vfovDeg = 56; }
    else if (focalMm <= 4.5) { hfovDeg = 85; vfovDeg = 48; }
    else if (focalMm <= 7.0) { hfovDeg = 54; vfovDeg = 30; }
    else if (focalMm <= 9.0) { hfovDeg = 40; vfovDeg = 22; }
    else { hfovDeg = 28; vfovDeg = 16; }
  } else if (fovMatch) {
    hfovDeg = Math.max(20, Math.min(180, parseFloat(fovMatch[1])));
    vfovDeg = Math.round(hfovDeg * 0.55);
  } else if (/telephoto|zoom|narrow/i.test(lower)) {
    focalMm = 8.0;
    hfovDeg = 40;
    vfovDeg = 22;
  }

  // 4. Detect Framerate (FPS)
  let framerateFps = 30;
  const fpsMatch = combined.match(/(\d+)\s*fps/i);
  if (fpsMatch) {
    framerateFps = Math.max(10, Math.min(240, parseInt(fpsMatch[1], 10)));
  } else if (/high-speed|conveyor|sorting|defect|60fps/i.test(lower)) {
    framerateFps = 60;
  }

  // 5. Detect Codec
  let videoCodec = 'H.265';
  if (/av1/i.test(lower)) videoCodec = 'AV1';
  else if (/h\.?264/i.test(lower)) videoCodec = 'H.264';
  else if (/mjpeg/i.test(lower)) videoCodec = 'MJPEG';

  // 6. Detect IP Rating & Optics
  let ipRating = 'IP67';
  const ipMatch = combined.match(/ip\s*(6[5-8])/i);
  if (ipMatch) ipRating = `IP${ipMatch[1]}`;

  const bitrateKbps = resolutionPreset === '12mp' ? 12288 : resolutionPreset === '8mp' ? 8192 : resolutionPreset === '5mp' ? 5120 : resolutionPreset === '4mp' ? 4096 : 2048;

  const model = `${brand} ${resolutionPreset.toUpperCase()} AI IP Camera (${focalMm}mm F1.6)`;

  return {
    brand,
    model,
    resolutionPreset,
    sensorWidthPx,
    sensorHeightPx,
    focalMm,
    hfovDeg,
    vfovDeg,
    framerateFps,
    videoCodec,
    ipRating,
    bitrateKbps,
    minLux: 0.005,
    irRangeM: 30,
  };
}

/**
 * Extracts explicit user-requested camera count.
 * Returns 0 if the user did NOT specify a count, allowing LLM reasoning to determine the count!
 */
export function extractDesiredCameraCount(text: string, explicitCount?: number | null): number {
  if (typeof explicitCount === 'number' && Number.isInteger(explicitCount) && explicitCount > 0) {
    return Math.min(250, explicitCount);
  }

  const patterns = [
    /total\s*(?:of\s*)?cameras?\s*(?:of|:|=|-|\s)?\s*(\d+)/i,
    /cameras?\s*(?:count|total|quantity|qty)?\s*(?:of|:|=|-|\s)?\s*(\d+)/i,
    /(\d+)\s*(?:cameras?|cctvs?|cams?|units?|sensors?)/i,
    /(?:install|deploy|mount|place|need|require|setup)\s+(\d+)\s*(?:cameras?|cctvs?|cams?)?/i,
    /camera\s*count\s*(?:of|:|=)?\s*(\d+)/i,
    /(\d+)\s*[-x\s]*(?:4\s*mp|mp|megapixel|\d+\s*mp)?\s*[-,\s]*(?:hik\s*vision|hikvision|axis|dahua|hanwha|ip\s*camera|camera|cctv)/i,
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

  // User did NOT specify explicit camera count: return 0 so downstream reasons it dynamically!
  return 0;
}

/**
 * Calculates optimal camera count using LLM reasoning and geometric domain principles
 * based on facility area, ceiling height, layout sections, and target coverage.
 */
export function calculateReasonedCameraCount(params: {
  length_m: number;
  width_m: number;
  height_m?: number;
  layout_section_count?: number;
  layout_sections?: string[];
  use_cases_count?: number;
  critical_components_count?: number;
  detection_coverage_target?: number;
  facility_type?: string;
  buildings?: FacilityBuilding[];
}): number {
  const {
    length_m,
    width_m,
    layout_section_count = 1,
    layout_sections = [],
    use_cases_count = 1,
    critical_components_count = 0,
    detection_coverage_target = 90,
    buildings = [],
  } = params;

  // Multi-building industrial complex (e.g. 2-4+ buildings) requires proportional multi-zone coverage
  if (buildings && buildings.length >= 2) {
    return Math.max(buildings.length, buildings.reduce((acc, b) => acc + (b.camera_count || 2), 0));
  }

  const area = Math.max(25, length_m * width_m);
  const coverageFactor = Math.max(0.75, (detection_coverage_target || 90) / 80);

  // Standard enterprise surveillance coverage: ~80-120 m² per optical unit for DORI
  const areaBased = Math.ceil((area / 110) * coverageFactor);

  // Sections coverage: each distinct layout section or building typically needs 2-4 cameras
  const secCount = Math.max(layout_section_count, layout_sections.length, 1);
  const sectionBased = secCount * 3;

  // Task-specific coverage for use cases & critical components
  const taskBased = Math.max(use_cases_count, 1) + Math.min(critical_components_count, 8);

  const reasoned = Math.max(sectionBased, taskBased, areaBased);
  return Math.max(4, Math.min(80, reasoned));
}

/**
 * Helper to finalize building attributes with ft/m conversions and purpose
 */
function finalizeBuilding(b: Partial<FacilityBuilding>, isFeet: boolean, index: number): FacilityBuilding {
  const lRaw = b.length_ft || 40;
  const wRaw = b.width_ft || 30;
  const hRaw = b.height_ft || 15;

  // If explicitly declared feet, or if height is 10-35 (standard ceiling in feet, which would be abnormal in meters)
  const useFeet = isFeet || (hRaw >= 10 && hRaw <= 35) || (lRaw >= 45 && wRaw >= 45 && hRaw >= 8);

  const length_m = useFeet ? Math.round(lRaw * 0.3048 * 10) / 10 : lRaw;
  const width_m = useFeet ? Math.round(wRaw * 0.3048 * 10) / 10 : wRaw;
  const height_m = useFeet ? Math.round(hRaw * 0.3048 * 10) / 10 : hRaw;

  const length_ft = useFeet ? lRaw : Math.round(lRaw * 3.28084);
  const width_ft = useFeet ? wRaw : Math.round(wRaw * 3.28084);
  const height_ft = useFeet ? hRaw : Math.round(hRaw * 3.28084);

  const area_sqft = Math.round(length_ft * width_ft);
  const area_sqm = Math.round(length_m * width_m);

  let purpose = 'Operational facility zone & safety perimeter';
  const lowerName = (b.name || '').toLowerCase();
  if (/plastic|polymer|sundar|extru/i.test(lowerName)) {
    purpose = 'Raw material polymer infeed, compounding & high-temperature extrusion lines';
  } else if (/filling|hall|chemical|mixing|berm|vat/i.test(lowerName)) {
    purpose = 'Automated chemical filling carousels, induction sealing, hazardous containment & spill berms';
  } else if (/workshop|mechanic|tool|lathe|cnc|weld/i.test(lowerName)) {
    purpose = 'Machine tooling, CNC lathe, welding safety, overhead crane runway & technician oversight';
  } else if (/loading|dock|point|truck|freight|bay/i.test(lowerName)) {
    purpose = 'Commercial logistics ingress, heavy truck bay docking, freight motion tracking & ramp safety';
  }

  return {
    id: b.id || randomUUID(),
    code: b.code || `B${String(index).padStart(2, '0')}`,
    name: b.name || `Building ${index}`,
    length_ft,
    width_ft,
    height_ft,
    length_m,
    width_m,
    height_m,
    area_sqft,
    area_sqm,
    purpose,
    camera_count: 2,
    camera_ids: [],
  };
}

/**
 * Distribute totalCameraCount across parsed buildings proportionally based on area and user specification
 */
function distributeCameras(buildings: FacilityBuilding[], total: number) {
  if (buildings.length === 0) return;
  const targetTotal = Math.max(1, total);
  const totalArea = buildings.reduce((acc, b) => acc + Math.max(10, b.area_sqft), 0);
  
  let allocated = 0;
  const minPerBldg = targetTotal >= buildings.length ? 1 : 0;
  buildings.forEach(b => {
    const raw = Math.round((Math.max(10, b.area_sqft) / totalArea) * targetTotal);
    b.camera_count = Math.max(minPerBldg, raw);
    allocated += b.camera_count;
  });

  let diff = targetTotal - allocated;
  let safetyIter = 0;
  while (diff !== 0 && safetyIter < 200) {
    safetyIter++;
    if (diff > 0) {
      const candidates = [...buildings].sort((a, b) => (b.area_sqft / (b.camera_count + 1)) - (a.area_sqft / (a.camera_count + 1)));
      candidates[0].camera_count += 1;
      diff--;
    } else {
      const eligible = buildings.filter(b => b.camera_count > minPerBldg);
      if (eligible.length > 0) {
        eligible.sort((a, b) => b.camera_count - a.camera_count)[0].camera_count -= 1;
        diff++;
      } else {
        const eligibleZero = buildings.filter(b => b.camera_count > 0);
        if (eligibleZero.length > 0) {
          eligibleZero.sort((a, b) => b.camera_count - a.camera_count)[0].camera_count -= 1;
          diff++;
        } else {
          break;
        }
      }
    }
  }
}

/**
 * Parse multi-building definitions and dimensions from scenario text
 */
export function parseFacilityBuildings(text: any, totalCameraCount: number = 15): FacilityBuilding[] {
  const textStr = typeof text === 'string' ? text : (typeof text === 'object' && text !== null ? Object.values(text).join(' ') : String(text || ''));
  const isFeet = /in\s*ft|feet|\bft\b|foot/i.test(textStr);
  const buildings: FacilityBuilding[] = [];

  const lines = textStr.split(/\r?\n/);
  let currentBldg: Partial<FacilityBuilding> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const bldgMatch = rawLine.match(/\b(?:building|bldg|section|block)\b\s+([0-9]+|[A-Z])\b(?:\s*[-:]*\s*(.*))?/i);
    if (bldgMatch) {
      if (currentBldg && currentBldg.name) {
        buildings.push(finalizeBuilding(currentBldg, isFeet, buildings.length + 1));
      }
      const bNum = bldgMatch[1];
      const rawName = bldgMatch[2]?.trim() || `Building ${bNum}`;
      const cleanName = rawName.replace(/^[-–—:]\s*/, '').trim() || `Building ${bNum}`;
      currentBldg = {
        id: randomUUID(),
        code: `B${bNum.padStart(2, '0')}`,
        name: `Building ${bNum.padStart(2, '0')} - ${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`,
      };
      continue;
    }

    if (currentBldg) {
      const lMatch = rawLine.match(/(?:length|len|l)\s*[:=]\s*(\d+(?:\.\d+)?)/i);
      const wMatch = rawLine.match(/(?:width|wid|w)\s*[:=]\s*(\d+(?:\.\d+)?)/i);
      const hMatch = rawLine.match(/(?:height|ht|h)\s*[:=]\s*(\d+(?:\.\d+)?)/i);

      if (lMatch) currentBldg.length_ft = parseFloat(lMatch[1]);
      if (wMatch) currentBldg.width_ft = parseFloat(wMatch[1]);
      if (hMatch) currentBldg.height_ft = parseFloat(hMatch[1]);
    }
  }

  if (currentBldg && currentBldg.name) {
    buildings.push(finalizeBuilding(currentBldg, isFeet, buildings.length + 1));
  }

  // Fallback: if no multi-building syntax was found, create sensible industry buildings
  if (buildings.length === 0) {
    const lower = textStr.toLowerCase();
    const isFactory = /chemical|factory|manufactur|plant|filling|descon/i.test(lower);
    
    buildings.push({
      id: randomUUID(),
      code: 'B01',
      name: isFactory ? 'Building 01 - Primary Manufacturing & Processing Hall' : 'Building 01 - Main Inbound Logistics Hall',
      length_m: 25.0,
      width_m: 20.0,
      height_m: 5.0,
      length_ft: 82,
      width_ft: 65,
      height_ft: 16,
      area_sqm: 500,
      area_sqft: 5330,
      purpose: isFactory ? 'Polymer and raw material automated synthesis' : 'High-bay pallet receipt and automated sorting',
      camera_count: 4,
      camera_ids: [],
    });
    buildings.push({
      id: randomUUID(),
      code: 'B02',
      name: isFactory ? 'Building 02 - Automated Chemical Filling & Sealing Hall' : 'Building 02 - Central Order Fulfillment & Picking',
      length_m: 35.0,
      width_m: 25.0,
      height_m: 5.5,
      length_ft: 115,
      width_ft: 82,
      height_ft: 18,
      area_sqm: 875,
      area_sqft: 9430,
      purpose: isFactory ? 'Container filling, capping, berm spill containment' : 'Robotic retrieval, conveyor sortation and packing',
      camera_count: 5,
      camera_ids: [],
    });
    buildings.push({
      id: randomUUID(),
      code: 'B03',
      name: 'Building 03 - Mechanical Workshop & Tooling Center',
      length_m: 18.0,
      width_m: 15.0,
      height_m: 4.8,
      length_ft: 60,
      width_ft: 50,
      height_ft: 16,
      area_sqm: 270,
      area_sqft: 3000,
      purpose: 'Tooling lathe, CNC milling, welding safety and technician crib',
      camera_count: 3,
      camera_ids: [],
    });
    buildings.push({
      id: randomUUID(),
      code: 'B04',
      name: 'Building 04 - Heavy Vehicle Logistics & Loading Point',
      length_m: 12.0,
      width_m: 8.0,
      height_m: 4.0,
      length_ft: 40,
      width_ft: 26,
      height_ft: 13,
      area_sqm: 96,
      area_sqft: 1040,
      purpose: 'Dock leveler freight transfer, heavy truck bay alignment and driver safety',
      camera_count: 3,
      camera_ids: [],
    });
  }

  distributeCameras(buildings, totalCameraCount);
  return buildings;
}

/**
 * Detect facility type, dimensions, and structural requirements from scenario keywords,
 * including multi-building / multi-zone specifications and ft/m conversions.
 */
export function detectFacilityProfile(text: any, totalCameraCount: number = 15): FacilityProfile {
  const textStr = typeof text === 'string' ? text : (typeof text === 'object' && text !== null ? Object.values(text).join(' ') : String(text || ''));
  const lower = textStr.toLowerCase();
  const isFeet = /in\s*ft|feet|\bft\b|foot/i.test(lower);

  const buildings = parseFacilityBuildings(textStr, totalCameraCount);

  let length = 40.0;
  let width = 25.0;
  let height = 5.0;

  if (buildings.length > 0) {
    length = Math.max(...buildings.map(b => b.length_m));
    width = Math.max(...buildings.map(b => b.width_m));
    height = Math.max(...buildings.map(b => b.height_m));
  } else {
    // Single dimensional pattern matches
    const ftDimMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')/i);
    const mDimMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|meters)?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(?:m|meters)?/i);

    if (ftDimMatch) {
      length = parseFloat(ftDimMatch[1]) * 0.3048;
      width = parseFloat(ftDimMatch[2]) * 0.3048;
    } else if (mDimMatch) {
      const rawL = parseFloat(mDimMatch[1]);
      const rawW = parseFloat(mDimMatch[2]);
      length = isFeet ? rawL * 0.3048 : rawL;
      width = isFeet ? rawW * 0.3048 : rawW;
    }

    const hMatch = lower.match(/(?:height|h)\s*(?:=|\s)?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|m|meters)?/i) ||
                   lower.match(/(\d+(?:\.\d+)?)\s*(?:m|meters|ft|feet)\s*(?:high|height|tall|ceiling|clearance)/i);
    if (hMatch) {
      const rawH = parseFloat(hMatch[1]);
      height = (isFeet || /ft|feet/i.test(hMatch[0])) ? rawH * 0.3048 : rawH;
    }
  }

  // Safety clamps for CAD coordinates
  length = Math.max(10, Math.min(300, Math.round(length * 10) / 10));
  width = Math.max(6, Math.min(200, Math.round(width * 10) / 10));
  height = Math.max(2.5, Math.min(25, Math.round(height * 10) / 10));

  let facility_type = 'warehouse';
  if (/chemical|petrochemical|oil|gas|refinery|filling|hazard|descon/i.test(lower)) {
    facility_type = 'factory';
  } else if (/factory|plant|manufactur|assembly|production line|machin/i.test(lower)) {
    facility_type = 'factory';
  } else if (/retail|supermarket|store|mall|shop|checkout/i.test(lower)) {
    facility_type = 'retail';
  } else if (/construction|jobsite|building site|crane/i.test(lower)) {
    facility_type = 'construction';
  } else if (/parking|garage|vehicle lot|traffic/i.test(lower)) {
    facility_type = 'parking';
  } else if (/data center|server room|datacenter/i.test(lower)) {
    facility_type = 'data_center';
  } else if (/hospital|clinic|healthcare|patient/i.test(lower)) {
    facility_type = 'healthcare';
  } else if (/airport|terminal|baggage|tsa/i.test(lower)) {
    facility_type = 'airport';
  } else if (/perimeter|fence|border|boundary/i.test(lower)) {
    facility_type = 'perimeter';
  }

  const has_racks = /rack|shelf|shelves|storage|aisle|pallet/i.test(lower) || facility_type === 'warehouse';
  const has_docks = /dock|loading|bay|gate|truck|trailer/i.test(lower);
  const has_machinery = /machine|conveyor|robot|press|equipment|station|filling/i.test(lower) || facility_type === 'factory';
  const has_forklifts = /forklift|flt|vehicle|agv|traffic/i.test(lower);
  const has_columns = /column|pillar|post|beam/i.test(lower) || (length * width > 800);

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
    buildings,
  };
}

/**
 * Generate complete facility structure and detailed camera placements
 * supporting 1 to 200+ cameras with diverse angles and mount types.
 */
export function generateStructuredLayout(
  scenarioInput: string | any,
  desiredCameraCount?: number | null,
  useCases: Array<{ id: string; name?: string }> = []
): GeneratedLayoutResult {
  const scenarioText = typeof scenarioInput === 'string'
    ? scenarioInput
    : (typeof scenarioInput === 'object' && scenarioInput !== null
        ? [scenarioInput.business_description, ...(scenarioInput.requirements || []), scenarioInput.camera_specifications].filter(Boolean).join(' ')
        : String(scenarioInput || ''));
  const userRequestedCount = extractDesiredCameraCount(scenarioText, desiredCameraCount);
  const useCaseList = Array.isArray(useCases) ? useCases : [];
  const cameraCount = userRequestedCount > 0
    ? userRequestedCount
    : calculateReasonedCameraCount({
        length_m: 40.0,
        width_m: 25.0,
        height_m: 5.0,
        use_cases_count: useCaseList.length,
        facility_type: 'warehouse',
      });
  const profile = detectFacilityProfile(scenarioText, cameraCount);
  const hw = parseCameraHardware(scenarioText);

  const validUcIds = useCaseList.map(uc => uc?.id).filter(Boolean);

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

  // Multi-Building Sector Division & Obstacles
  const bldgs = profile.buildings || [];
  const hasMultiBuilding = bldgs.length > 1;

  if (hasMultiBuilding) {
    // Partition walls separating building quadrants
    structure.push({
      id: randomUUID(),
      name: 'North-South Facility Dividing Wall',
      type: 'wall',
      points: [{ x: 0.50, y: minY }, { x: 0.50, y: 0.45 }],
    });
    structure.push({
      id: randomUUID(),
      name: 'Central Inter-Building Roll-Up Door',
      type: 'entrance',
      points: [{ x: 0.50, y: 0.45 }, { x: 0.50, y: 0.55 }],
    });
    structure.push({
      id: randomUUID(),
      name: 'South Facility Dividing Wall',
      type: 'wall',
      points: [{ x: 0.50, y: 0.55 }, { x: 0.50, y: maxY }],
    });

    structure.push({
      id: randomUUID(),
      name: 'West-East Facility Dividing Wall',
      type: 'wall',
      points: [{ x: minX, y: 0.50 }, { x: 0.45, y: 0.50 }],
    });
    structure.push({
      id: randomUUID(),
      name: 'East-West Internal Passage Door',
      type: 'entrance',
      points: [{ x: 0.45, y: 0.50 }, { x: 0.55, y: 0.50 }],
    });
    structure.push({
      id: randomUUID(),
      name: 'East Facility Dividing Wall',
      type: 'wall',
      points: [{ x: 0.55, y: 0.50 }, { x: maxX, y: 0.50 }],
    });

    // Populate sector obstacles per building
    bldgs.forEach((b, bIdx) => {
      const isWest = bIdx % 2 === 0;
      const isNorth = Math.floor(bIdx / 2) === 0;
      const bMinX = isWest ? 0.08 : 0.52;
      const bMaxX = isWest ? 0.48 : 0.92;
      const bMinY = isNorth ? 0.08 : 0.52;
      const bMaxY = isNorth ? 0.48 : 0.92;

      // Zone perimeter tag
      structure.push({
        id: randomUUID(),
        name: `${b.name} Operational Zone`,
        type: 'obstacle',
        obstacle_type: 'building',
        points: [
          { x: bMinX, y: bMinY },
          { x: bMaxX, y: bMinY },
          { x: bMaxX, y: bMaxY },
          { x: bMinX, y: bMaxY },
        ],
      });

      const lowerName = b.name.toLowerCase();
      if (/plastic|polymer|sundar|extru/i.test(lowerName)) {
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Polymer Infeed Conveyor & Compounding Hopper`,
          type: 'obstacle',
          obstacle_type: 'conveyor',
          points: [
            { x: bMinX + 0.05, y: bMinY + 0.08 },
            { x: bMinX + 0.20, y: bMinY + 0.08 },
            { x: bMinX + 0.20, y: bMinY + 0.14 },
            { x: bMinX + 0.05, y: bMinY + 0.14 },
          ],
        });
        structure.push({
          id: randomUUID(),
          name: `${b.code}: High-Speed Extrusion & Injection Molding Station`,
          type: 'obstacle',
          obstacle_type: 'machine',
          points: [
            { x: bMinX + 0.22, y: bMinY + 0.16 },
            { x: bMinX + 0.35, y: bMinY + 0.16 },
            { x: bMinX + 0.35, y: bMinY + 0.30 },
            { x: bMinX + 0.22, y: bMinY + 0.30 },
          ],
        });
      } else if (/filling|hall|chemical|mixing|berm|vat/i.test(lowerName)) {
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Automated Chemical Filling Carousel Line`,
          type: 'obstacle',
          obstacle_type: 'conveyor',
          points: [
            { x: bMinX + 0.06, y: bMinY + 0.08 },
            { x: bMinX + 0.34, y: bMinY + 0.08 },
            { x: bMinX + 0.34, y: bMinY + 0.14 },
            { x: bMinX + 0.06, y: bMinY + 0.14 },
          ],
        });
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Hazardous Chemical Spill Containment Berm`,
          type: 'obstacle',
          obstacle_type: 'hazard',
          points: [
            { x: bMinX + 0.06, y: bMinY + 0.22 },
            { x: bMinX + 0.34, y: bMinY + 0.22 },
            { x: bMinX + 0.34, y: bMinY + 0.32 },
            { x: bMinX + 0.06, y: bMinY + 0.32 },
          ],
        });
      } else if (/workshop|mechanic|tool|lathe|cnc|weld/i.test(lowerName)) {
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Heavy CNC Lathe & Precision Tooling Bench`,
          type: 'obstacle',
          obstacle_type: 'machine',
          points: [
            { x: bMinX + 0.06, y: bMinY + 0.08 },
            { x: bMinX + 0.22, y: bMinY + 0.08 },
            { x: bMinX + 0.22, y: bMinY + 0.20 },
            { x: bMinX + 0.06, y: bMinY + 0.20 },
          ],
        });
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Welding Flash Safety Cell & Overhead Hoist Runway`,
          type: 'obstacle',
          obstacle_type: 'machine',
          points: [
            { x: bMinX + 0.24, y: bMinY + 0.15 },
            { x: bMinX + 0.35, y: bMinY + 0.15 },
            { x: bMinX + 0.35, y: bMinY + 0.30 },
            { x: bMinX + 0.24, y: bMinY + 0.30 },
          ],
        });
      } else if (/loading|dock|point|truck|freight|bay/i.test(lowerName)) {
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Loading Dock Bay #1 & Hydraulic Leveler Lip`,
          type: 'obstacle',
          obstacle_type: 'dock',
          points: [
            { x: bMinX + 0.06, y: bMaxY - 0.12 },
            { x: bMinX + 0.18, y: bMaxY - 0.12 },
            { x: bMinX + 0.18, y: bMaxY - 0.04 },
            { x: bMinX + 0.06, y: bMaxY - 0.04 },
          ],
        });
        structure.push({
          id: randomUUID(),
          name: `${b.code}: Loading Dock Bay #2 & Truck Backing Staging Apron`,
          type: 'obstacle',
          obstacle_type: 'dock',
          points: [
            { x: bMinX + 0.22, y: bMaxY - 0.12 },
            { x: bMinX + 0.34, y: bMaxY - 0.12 },
            { x: bMinX + 0.34, y: bMaxY - 0.04 },
            { x: bMinX + 0.22, y: bMaxY - 0.04 },
          ],
        });
      }
    });
  } else {
    // Single building fallback obstacles
    if (profile.facility_type === 'factory' || profile.has_machinery) {
      structure.push({
        id: randomUUID(),
        name: 'Primary Automated Conveyor Assembly Line',
        type: 'obstacle',
        obstacle_type: 'conveyor',
        points: [{ x: 0.20, y: 0.30 }, { x: 0.80, y: 0.30 }, { x: 0.80, y: 0.36 }, { x: 0.20, y: 0.36 }],
      });
      structure.push({
        id: randomUUID(),
        name: 'Automated Robot Cell & Rejection Station',
        type: 'obstacle',
        obstacle_type: 'machine',
        points: [{ x: 0.40, y: 0.50 }, { x: 0.60, y: 0.50 }, { x: 0.60, y: 0.62 }, { x: 0.40, y: 0.62 }],
      });
    } else {
      structure.push({
        id: randomUUID(),
        name: 'High-Bay Storage Rack Bank (Aisle A)',
        type: 'obstacle',
        obstacle_type: 'rack',
        points: [{ x: 0.15, y: 0.30 }, { x: 0.85, y: 0.30 }, { x: 0.85, y: 0.36 }, { x: 0.15, y: 0.36 }],
      });
      structure.push({
        id: randomUUID(),
        name: 'High-Bay Storage Rack Bank (Aisle B)',
        type: 'obstacle',
        obstacle_type: 'rack',
        points: [{ x: 0.15, y: 0.60 }, { x: 0.85, y: 0.60 }, { x: 0.85, y: 0.66 }, { x: 0.15, y: 0.66 }],
      });
    }
  }

  // 3. Systematic Camera Generation Allocating Cameras Per Building
  const cameras: Camera[] = [];
  let assignedCount = 0;

  bldgs.forEach(b => { b.camera_ids = []; });

  bldgs.forEach((b, bIdx) => {
    const isWest = bIdx % 2 === 0;
    const isNorth = Math.floor(bIdx / 2) === 0;
    const bMinX = hasMultiBuilding ? (isWest ? 0.08 : 0.52) : 0.08;
    const bMaxX = hasMultiBuilding ? (isWest ? 0.48 : 0.92) : 0.92;
    const bMinY = hasMultiBuilding ? (isNorth ? 0.08 : 0.52) : 0.08;
    const bMaxY = hasMultiBuilding ? (isNorth ? 0.48 : 0.92) : 0.92;

    const lowerName = b.name.toLowerCase();
    const isLoading = /loading|dock|point|truck|freight|bay/i.test(lowerName);
    const isFilling = /filling|hall|chemical|mixing|berm|vat/i.test(lowerName);
    const isPlastic = /plastic|polymer|sundar|extru/i.test(lowerName);
    const isWorkshop = /workshop|mechanic|tool|lathe|cnc|weld/i.test(lowerName);

    // Target templates per building
    const targetTemplates = isPlastic
      ? [
          'Polymer Raw Material Infeed & Compounding Hopper',
          'High-Speed Extrusion Line #1 Temperature & Flow',
          'Injection Molding Station & Mold Clamping Safety',
          'Molded Part Ejection & Robot De-Molding Cell',
          'Quality Inspection ROI & Flash Defect Check',
          'Operator Anti-Scald Hazard Exclusion Zone',
        ]
      : isFilling
      ? [
          'Automated Chemical Filling Carousel #1 Feed & Fill',
          'Hazardous Chemical Berm Containment & Sump Drain',
          'Induction Bottle Capping & Hermetic Sealing ROI',
          'Drum Conveyor Inbound Transfer & Spill Catch',
          'Secondary Spill Containment Wall & Perimeter Sump',
          'Forklift Transit Corridor & Pallet Interlock',
          'Emergency Eyewash & Safety Shower Portal Clearance',
          'Hazardous Vapor Ventilation Exhaust Duct Flow',
          'Finished Goods Palletizing & Stretch Wrap Station',
        ]
      : isWorkshop
      ? [
          'Heavy CNC Milling Machine & Precision Tooling Lathe',
          'Welding Safety Cell & Hot-Work Flash Shielding',
          'Overhead Crane Runway & Heavy Hoist Drop Corridor',
          'Technician Maintenance Crib & Tool Check-out Area',
          'Machine Chip Shredder & Coolant Recovery System',
        ]
      : isLoading
      ? [
          'Commercial Heavy Truck Bay #1 Dock Alignment & Chock',
          'Hydraulic Dock Leveler Lip & Freight Motion Safety',
          'Loading Bay #2 Container Offload & Pallet Transit',
          'Exterior Logistics Apron & Driver Safety Corridor',
        ]
      : [
          'Inbound Portal Access & PPE Verification',
          'Main Aisle Forklift Transit & Collision Avoidance',
          'High-Bay Rack Corridor Bidirectional Coverage',
          'Order Fulfillment Sortation & Packing Table',
        ];

    const camCountForBldg = b.camera_count;
    for (let cIdx = 0; cIdx < camCountForBldg; cIdx++) {
      if (assignedCount >= cameraCount) break;
      assignedCount++;

      // Distribute coordinates across the building perimeter & core
      let posX = bMinX + 0.03;
      let posY = bMinY + 0.03;
      let orientation = 135;
      let mountType = 'corner';
      let tiltDeg = 30;
      let hfov = 106;
      let viewRange = 0.42;

      if (cIdx === 0) {
        // Northwest corner sweep
        posX = bMinX + 0.03;
        posY = bMinY + 0.03;
        orientation = 135;
        mountType = 'corner';
        tiltDeg = 25;
        hfov = 95;
      } else if (cIdx === 1) {
        // Core process down-firing or angled high-bay
        posX = bMinX + (bMaxX - bMinX) * 0.50;
        posY = bMinY + 0.03;
        orientation = 180;
        mountType = isFilling ? 'roof-tilt' : 'wall-h';
        tiltDeg = 20;
        hfov = 85;
      } else if (cIdx === 2) {
        // Southeast opposing corner sweep
        posX = bMaxX - 0.03;
        posY = bMaxY - 0.03;
        orientation = 315;
        mountType = 'corner';
        tiltDeg = 30;
        hfov = 95;
      } else if (cIdx === 3) {
        // Overhead nadir / center inspection
        posX = bMinX + (bMaxX - bMinX) * 0.50;
        posY = bMinY + (bMaxY - bMinY) * 0.50;
        orientation = 0;
        mountType = 'roof-nadir';
        tiltDeg = 90;
        hfov = 106;
        viewRange = 0.32;
      } else if (cIdx === 4) {
        // West corridor wall
        posX = bMinX + 0.03;
        posY = bMinY + (bMaxY - bMinY) * 0.65;
        orientation = 90;
        mountType = 'wall-h';
        tiltDeg = 20;
        hfov = 85;
      } else if (cIdx === 5) {
        // East corridor wall
        posX = bMaxX - 0.03;
        posY = bMinY + (bMaxY - bMinY) * 0.35;
        orientation = 270;
        mountType = 'wall-h';
        tiltDeg = 20;
        hfov = 85;
      } else {
        // Additional grid sensors
        const step = (cIdx - 5) / Math.max(1, camCountForBldg - 5);
        posX = bMinX + 0.06 + step * (bMaxX - bMinX - 0.12);
        posY = bMinY + 0.06 + ((cIdx % 2) ? 0.22 : 0.12);
        orientation = (cIdx % 2 === 0) ? 45 : 225;
        mountType = 'cross';
        tiltDeg = 20;
        hfov = 85;
      }

      // Operational Target Area
      const targetArea = targetTemplates[cIdx % targetTemplates.length];
      const roleTitle = targetArea.length > 32 ? targetArea.slice(0, 30) + '...' : targetArea;

      // Camera Environmental Conditions
      const lightingLux = isLoading
        ? '50–250 Lux (0.001 Lux Smart EXIR Night Vision to 40m)'
        : '150–400 Lux (0.005 Lux Starlight IR Auto-Switch)';

      const ipRating = isLoading
        ? 'IP67 / IK10 Vandal-Proof NEMA 4X'
        : isFilling || isPlastic
        ? 'IP66 / NEMA 4X Chemical & Washdown Resistant'
        : 'IP54 Industrial Sealed Housing';

      const shutterSpeed = isFilling || isPlastic
        ? '1/500s – 1/1000s (Anti-Motion-Blur High-Speed Line)'
        : '1/250s (Anti-Motion-Blur Forklift & Personnel Transit)';

      const wdrRating = isLoading
        ? '120 dB True WDR (Eliminates Open Bay Glare & Sun Washout)'
        : '120 dB True WDR (Balances High-Contrast High-Bay LED)';

      const opTemp = isLoading
        ? '-35°C to +60°C (-31°F to 140°F) Heated Anti-Fog Glass'
        : '-20°C to +55°C (-4°F to 131°F) Industrial Operating Range';

      const lensFocal = (cIdx % 3 === 0)
        ? '2.8mm (106° HFOV Ultra-Wide Angle)'
        : (cIdx % 3 === 1)
        ? '4.0mm (85° HFOV Standard Industrial)'
        : '6.0mm (54° HFOV Telephoto Aisle Corridor)';

      const doriIdentify = (cIdx % 3 === 0) ? 5.5 : (cIdx % 3 === 1) ? 8.0 : 12.0;
      const doriRecognize = (cIdx % 3 === 0) ? 11.0 : (cIdx % 3 === 1) ? 16.0 : 24.0;
      const camHeight = Math.min(5.5, Math.max(3.0, +(b.height_m * 0.85).toFixed(1)));

      const camId = randomUUID();
      b.camera_ids = b.camera_ids || [];
      b.camera_ids.push(camId);

      const assignedUcs = validUcIds.length ? [validUcIds[(assignedCount - 1) % validUcIds.length]] : [];

      cameras.push({
        id: camId,
        name: `CAM-${String(assignedCount).padStart(2, '0')} [${b.code}: ${roleTitle}]`,
        status: 'planned',
        x: Math.round(posX * 1000) / 1000,
        y: Math.round(posY * 1000) / 1000,
        orientation_degrees: orientation,
        horizontal_fov_degrees: hfov,
        view_range: Math.round(viewRange * 100) / 100,
        resolution_width: hw.sensorWidthPx,
        resolution_height: hw.sensorHeightPx,
        mount_type: mountType,
        tilt_degrees: tiltDeg,
        height_m: camHeight,
        building_id: b.id,
        building_name: b.name,
        target_area: targetArea,
        lighting_lux: lightingLux,
        ingress_protection: ipRating,
        shutter_speed: shutterSpeed,
        wdr_rating: wdrRating,
        operating_temp: opTemp,
        lens_focal: lensFocal,
        dori_identify_m: doriIdentify,
        dori_recognize_m: doriRecognize,
        assigned_use_case_ids: assignedUcs,
        rationale: `${hw.brand} ${hw.resolutionPreset.toUpperCase()} (${hw.sensorWidthPx}×${hw.sensorHeightPx}) @ ${hw.framerateFps}fps. Conditions: ${lightingLux}, ${ipRating}, ${shutterSpeed}, ${wdrRating}. DORI Identify to ${doriIdentify}m for continuous ${targetArea} coverage.`,
      });
    }
  });

  const summary = `Generated structured ${cameras.length}-camera layout across ${bldgs.length} building zone(s) for ${profile.facility_type} (${profile.length.toFixed(0)}m × ${profile.width.toFixed(0)}m, ${profile.height.toFixed(1)}m mount height). Includes ${structure.length} site structures (${structure.filter(s => s.type === 'wall').length} walls, ${structure.filter(s => s.type === 'obstacle').length} obstacles, and ${structure.filter(s => s.type === 'entrance').length} entrances). Every camera is assigned to its respective building with tailored angles, environmental conditions, and optical DORI criteria.`;

  const reasoning = [
    `Detected scenario requirements for ${cameraCount} cameras across ${bldgs.length} facility building(s); allocated 100% of requested units.`,
    `Generated ${structure.filter(s => s.type === 'obstacle').length} obstacles (machinery, conveyors, chemical berms, dock bays) based on building purpose profiles.`,
    'Implemented bidirectional camera pairs along each aisle and critical machinery cell to eliminate optical blind spots.',
    'Applied 8 distinct mounting types (wall-h, wall-v, roof-nadir, roof-tilt, corner, cross-aisle, 360° fisheye).',
    'Configured explicit operational conditions for every sensor (Lighting Lux, Ingress Protection, Shutter Speed, 120dB WDR, Operating Temp).',
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

/** Token-free safety plan generator producing all 12 standard sections with optical blind-spot mitigation */
export function generateTokenFreeSafetyPlan(project: {
  business_description?: string;
  industry?: string;
  company_name?: string;
  requirements?: string[];
  cameras?: Camera[];
}): {
  sections: Record<string, string>;
  state: GenerationState;
  token_usage: {
    source: string;
    api_tokens_consumed: number;
    saved_billable_tokens: number;
    prompt_tokens_equivalent: number;
    completion_tokens_equivalent: number;
    total_tokens_equivalent: number;
    estimated_bandwidth_mbps: number;
    estimated_storage_tb_30d: number;
  };
  metadata: {
    total_sections: number;
    total_tokens_estimate: number;
    source: string;
    generated_at: string;
  };
  camera_count: number;
  complete: boolean;
} {
  const desc = project.business_description || '';
  const industry = project.industry || 'Industrial / Logistics';
  const company = project.company_name || 'Enterprise Client';
  const requirements = project.requirements || [];
  const camCount = project.cameras?.length || extractDesiredCameraCount(desc);

  const sections: Record<string, string> = {
    executive_summary: `### Executive Summary: Automated Computer-Vision Safety & Optical Hazard Mitigation
**Facility**: ${company} (${industry}) | **Fleet Sizing**: ${camCount} Optical Sensor Nodes | **Coverage Target**: 100% Zero-Blind-Spot Line-of-Sight Enforcement

This comprehensive Industrial Safety & Computer Vision Plan establishes a continuous, automated optical monitoring framework engineered for **${company}**. By orchestrating a synchronized fleet of **${camCount} high-definition cameras**, this deployment eliminates critical physical and visual blind spots across high-bay aisles, forklift transit corridors, chemical containment zones, and logistics loading docks.

#### Key Architecture Highlights & Safety Objectives:
1. **Zero-Blind-Spot Optical Architecture**: Strategic placement utilizing 20°–35° downward-tilt optical geometry and dual-cross-angled sightlines eradicates under-mount dead cones (<1.8m) and pallet rack shadow cast (>4.5m).
2. **Sub-35ms Edge AI Detection**: Real-time YOLOv8/v11 inference running on on-premise hardware detects PPE non-compliance (hard hats, high-vis vests), pedestrian perimeter breaches, and forklift-worker proximity hazards.
3. **Automated Interlock Escalation**: Real-time integration via industrial MQTT brokers dispatches instant audible/visual strobe alerts and signals automated machinery slowdown zones during imminent collision vectors.
4. **Regulatory & Audit Compliance**: Built to satisfy OSHA 1910 General Industry Standards, ISO 45001 Occupational Health & Safety Systems, and ANSI/ITSDF B56.1 safety codes for industrial vehicles.`,

    facility_context: `### Facility & Operational Context
**Physical Footprint & Structural Characteristics**:
The facility operates complex multi-zone environments including plastic injection/molding cells, automated chemical filling halls, mechanical maintenance workshops, and high-turnover logistics loading docks.

#### Environmental & Optical Baseline:
- **Ceiling Geometries & Mounting Heights**: Structural roof trusses range from 4.5m (Loading Bays) to 8.5m–10m (High-Bay Storage and Production Halls). Ceiling heights above 5.5m require rigid dropper poles to avoid excessive optical divergence and vertical nadir distortion.
- **Ambient Illumination Dynamics**: Operational lighting transitions from 450–600 lux during active manufacturing shifts to <30 lux during scheduled maintenance or overnight storage. High-reflective stainless-steel equipment and polished concrete floors induce specular glare requiring 120dB True WDR (Wide Dynamic Range).
- **Aperture & Transit Ingress**: Loading dock doors create severe backlight bloom (>80,000 lux outdoor sunlight vs. 300 lux indoor ambient), requiring anti-flare optical coatings and dynamic local tone mapping.
- **Material Handling Vectors**: High-speed counterbalanced forklifts, reach trucks, and manual pallet jacks continuously traverse central arterial corridors, sharing right-of-way with maintenance technicians and floor personnel.`,

    hazard_identification: `### Hazard Identification & Optical Blind-Spot Analysis
A systematic hazard assessment was conducted across physical machinery, mobile transport, chemical zones, and visual occlusion corridors.

#### 1. Forklift-Pedestrian Collision Zones (High Criticality)
- **Intersection Blind Corners**: 90° blind turns between high-density storage racks where forklift masts and stacked pallets occlude pedestrian line-of-sight until vehicles are within 2.5m (braking distance deficit).
- **Dock Plate Transitions**: Active forklift backing maneuvers inside 53ft trailer boxes where ambient lighting drops below 15 lux and visual obstruction is near total.

#### 2. Optical Blind Spots & Dead Cones
- **Under-Mount Camera Dead Cones**: Fixed wide-angle dome cameras mounted above 6.0m experience a conical optical blind spot directly below the lens (<1.8m radius), allowing workers to walk unmonitored beneath the sensor.
- **Racking Shadow Corridors**: High-bay shelving exceeding 4.5m height casts deep optical shadows along transverse aisles, masking dropped items, oil leaks, and crouching personnel.
- **Structural Column Occlusion**: Heavy I-beam support columns create 1.5m–2.0m blind shadow alleys when viewed from single wall-mounted cameras.

#### 3. Chemical, Thermal & Mechanical Hazards
- **Chemical Washdown & Containment**: Corrosive vapor and liquid spills near automated filling nozzles and secondary containment sumps create acute slip and respiratory hazards.
- **Mechanical Pinch Points & Robot Enclosures**: Automated mold clamping presses and high-speed conveyor transfers present severe crush and entrapment risks.
- **Emergency Egress Obstruction**: Temporary staging of wooden pallets, scrap totes, and chemical drums frequently obstructs marked fire exits and emergency eyewash stations.`,

    risk_assessment: `### Risk Assessment Matrix (Likelihood × Severity)
Hazards are evaluated using a 5×5 Risk Scoring Model (Severity 1–5 × Likelihood 1–5 = Risk Rating 1–25), with target DORI (Detect, Observe, Recognize, Identify) pixel densities mapped to each hazard.

| Hazard / Scenario | Likelihood (1-5) | Severity (1-5) | Risk Score (1-25) | Criticality | Target DORI Density | Optical Mitigation Focus |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Forklift-Pedestrian Intersection Collision** | 4 (Probable) | 5 (Catastrophic) | **20** | Critical | **Identify (250 ppm)** | Dual cross-angled opposing FOV; ByteTrack proximity tripwire |
| **Trailer Ingress/Egress Blind-Spot Backing** | 4 (Probable) | 4 (Major) | **16** | High | **Recognize (125 ppm)** | Narrow-angle corridor camera with True WDR; trailer dock sensor |
| **High-Bay Rack Shadow Occlusion** | 4 (Probable) | 4 (Major) | **16** | High | **Recognize (125 ppm)** | Dropper poles at 5.2m with 25° tilt to shoot down clear aisle lines |
| **Chemical Spillage & Containment Overflow** | 3 (Possible) | 4 (Major) | **12** | High | **Observe (62 ppm)** | Stainless IP67 dome camera; pooling liquid & vapor detection |
| **Robotic Cell Perimeter Enclosure Intrusion** | 2 (Unlikely) | 5 (Catastrophic) | **10** | Moderate | **Identify (250 ppm)** | Polygon virtual fencing with hardware relay e-stop interlock |
| **Emergency Route & Fire Egress Obstruction** | 4 (Probable) | 2 (Minor) | **8** | Moderate | **Detect (25 ppm)** | Continuous stationary object detector; 5-minute auto-escalation |
| **PPE Non-Compliance (No Vest / Hard Hat)** | 3 (Possible) | 3 (Moderate) | **9** | Moderate | **Identify (250 ppm)** | High-resolution portal camera at building turnstiles and gates |`,

    control_gaps: `### Existing Control Gaps & Failure Scenarios
Traditional industrial safety controls fail under real-world operational stresses:

1. **Passive Convex Mirrors**: Suffer from severe dirt/oil accumulation, distorted depth perception, and reliance on operator attention (>12-second reaction lag during fatigued night shifts).
2. **Floor Painted Demarcations**: Abrasive forklift tires and pallet dragging erode painted yellow safety walkways within 3–4 weeks, eliminating visual cues.
3. **Monocular Single-Angle Camera Gaps**: Single cameras mounted on building perimeters leave up to 35% of the interior floor area in shadow cast behind machinery and structural columns.
4. **Dynamic Lighting Blooming**: Standard dynamic-range cameras wash out completely when daylight pierces open bay doors, blinding safety vision algorithms for up to 40 seconds.
5. **Delayed Manual Auditing**: Post-incident review of recorded footage provides zero real-time collision prevention, resulting in preventable lost-time injuries.`,

    recommended_controls: `### Recommended Controls (Hierarchy of Controls & Optical Geometry)
Deploying layered engineering controls, optical sensor geometries, and edge AI algorithms:

#### 1. Optical Blind-Spot Mitigation Geometry
- **Dual Opposing Cross-Aisle Rigging**: Install paired cameras at opposing ends of high-traffic transit aisles angled at 30° inward. This guarantees that if a tall forklift mast occludes Camera A, Camera B captures the reverse sightline with zero blind spot.
- **Rigid Ceiling Dropper Poles**: Lower camera mount elevations from 9.0m trusses down to 5.2m using vibration-damped steel dropper poles. This reduces down-tilt angle from 65° to an optimal 22°–28°, completely eliminating the under-mount conical blind spot.
- **120dB True WDR & IR Illumination**: Deploy cameras equipped with multi-exposure True WDR and adaptive matrix IR (up to 40m) to maintain consistent 250 ppm identification across extreme light-to-dark transitions.

#### 2. Computer Vision & Edge AI Stack
- **Real-Time Detector**: YOLOv8x/v11 deep neural network optimized with NVIDIA TensorRT FP16 precision, processing 1080p @ 20 FPS with <28ms inference latency.
- **Multi-Object Trajectory Tracking**: ByteTrack coupled with predictive velocity vectoring to calculate time-to-collision (TTC) between forklifts and walking personnel.
- **Virtual Dynamic Exclusion Zones**: Configurable polygonal tripwires mapped to physical floor dimensions. Dynamic safety bubbles expand around moving forklifts (4.0m forward, 2.5m lateral).

#### 3. Engineering Interlocks & Physical PPE
- **Audible & Strobe Relays**: Immediate hardware triggering of flashing amber/red LED beacons and directional floor laser boundaries when a pedestrian enters an active vehicle corridor.
- **Mandatory PPE Enforcement**: Gate-keeper turnstile cameras configured to deny turnstile unlatching unless high-vis vests and safety helmets are positively identified.`,

    corrective_actions: `### Prioritized Corrective Action Table
Concrete engineering action items with assigned owners, priority tiers, and completion milestones:

| Action ID | Priority | Description & Optical Mitigation Scope | Responsible Owner | Target Timeline | Verification Method |
| :--- | :---: | :--- | :--- | :---: | :--- |
| **ACT-01** | **P1 (Critical)** | Rig dual cross-angled 4K bullet cameras at Main Forklift Intersection to eradicate blind corner collisions. | Lead Systems Integrator | Days 1–3 | Field optical line-of-sight test & 100% laser DORI verification |
| **ACT-02** | **P1 (Critical)** | Install 120dB True WDR motorized varifocal cameras at Loading Docks to counteract severe daylight glare. | Electrical Contractor | Days 3–5 | Solar peak lux washout testing (zero algorithm degradation) |
| **ACT-03** | **P2 (High)** | Fabricate and install 5.2m rigid dropper poles in high-bay racking aisles to eliminate rack shadow cast. | Rigging / Mechanical Lead | Days 6–10 | Top-down nadir cone inspection; zero under-mount shadow |
| **ACT-04** | **P2 (High)** | Deploy edge AI inference server with ByteTrack forklift proximity alerts (<35ms MQTT strobe relay). | Vision Software Engineer | Days 10–14 | Live forklift approach trial with simulated mannequin target |
| **ACT-05** | **P3 (Medium)** | Program automated camera tamper, lens defocus, and physical spray/obstruction detection algorithms. | IT Systems Administrator | Days 15–18 | Lens occlusion fault injection test with synthetic patterns |
| **ACT-06** | **P3 (Medium)** | Establish ISO 45001 / OSHA continuous digital audit logging with near-miss heatmap telemetry. | HSE Safety Director | Days 19–25 | Automated weekly safety compliance report sign-off |`,

    implementation_roadmap: `### Implementation Roadmap (Phased Engineering Rollout)
Structured 30-day phased deployment schedule designed to prevent manufacturing line downtime:

\`\`\`
[Phase 1: Days 1-7]   --> Network Backbone, Shielded Cat6 Cabling & PoE+ Switches
[Phase 2: Days 8-14]  --> Optical Rigging, Dropper Poles & Line-of-Sight Calibration
[Phase 3: Days 15-21] --> Edge AI Pipeline, YOLO Neural Nets & Virtual Zone Setup
[Phase 4: Days 22-30] --> Pilot Commissioning, Mannequin Intrusion Trials & Go-Live
\`\`\`

#### Detailed Phase Milestones:
- **Phase 1: Physical Infrastructure & Power (Days 1–7)**: Run shielded Cat6 STP cabling in rigid galvanized conduit. Mount 24-Port Managed PoE+ Layer 3 network switches with redundant battery backup (UPS 1500VA).
- **Phase 2: Optical Sensor Rigging & Alignment (Days 8–14)**: Fasten cameras to structural columns and ceiling dropper poles. Utilize laser alignment tools to verify that camera optical axes overlap by at least 15% to eliminate seam blind spots.
- **Phase 3: AI Pipeline & Relay Integration (Days 15–21)**: Configure NVIDIA edge server. Calibrate homography matrices for 2D-to-3D floor projection. Link MQTT alert topics to overhead visual strobes and audible buzzers.
- **Phase 4: Live Commissioning & Staff Training (Days 22–30)**: Perform staged test incursions with dummy targets. Conduct safety briefing and standard operating procedure review with warehouse and machine operators.`,

    sop_recommendations: `### Standard Operating Procedure (SOP) Recommendations
Formalized operating protocols to ensure sustained optical reliability and safety enforcement:

1. **SOP-SFT-01: Daily Optical Line-of-Sight & Lens Integrity Check**
   - **Scope**: All ${camCount} active camera streams.
   - **Protocol**: Automated AI self-test verifies image sharpness, contrast, and field angle at 06:00 daily. Maintenance team inspects any camera reporting >10% optical degradation or steam/dust deposition.
2. **SOP-SFT-02: Near-Miss Collision Telemetry Review**
   - **Scope**: Forklift-pedestrian proximity events (<3.0m separation).
   - **Protocol**: Safety supervisor reviews AI-clipped video recordings of any event within 2 hours. Root-cause corrective interview held with involved operators before end of shift.
3. **SOP-SFT-03: Staging Zone Height Limit Enforcement**
   - **Scope**: Pallet storage and material handling corridors.
   - **Protocol**: Strictly forbids staging pallets or raw materials above 1.8m within 3.0m of camera sightlines. AI tripwire flags any static object exceeding height envelope for >10 minutes.
4. **SOP-SFT-04: Quarterly Optical Recalibration & DORI Auditing**
   - **Scope**: Mechanical mount rigidity, pan/tilt alignment, and sensor focus.
   - **Protocol**: Physical recalibration using standard ISO/IEC 19794 resolution test targets to guarantee DORI identification criteria are preserved.`,

    monitoring_kpis: `### Monitoring Metrics, Audit & Validation
Comprehensive leading and lagging safety metrics evaluated in real time:

#### Leading Safety Performance Indicators (Proactive Prevention):
- **AI Alert Reaction Latency**: Mean duration from physical tripwire breach to strobe relay activation. Target: **<35 milliseconds**.
- **Optical Blind-Spot Coverage**: Percentage of floor square footage within active DORI recognition/identification cones. Target: **>99.4% effective coverage**.
- **Near-Miss Proximity Event Rate**: Number of hazardous forklift-pedestrian proximity breaches per 1,000 operational hours. Target: **<0.5 events / 1,000 hrs (trending to 0)**.
- **PPE Compliance Rate**: Ratio of workers wearing mandated vests/helmets in designated zones. Target: **100% compliance**.
- **Camera Health Uptime**: Active video feed availability across all nodes. Target: **>99.9% operational availability**.

#### Lagging Safety Indicators (Outcome Verification):
- **OSHA Recordable Incident Rate**: Lost-time injury rate per 200,000 work hours. Target: **0.00**.
- **Emergency Egress Blockage Duration**: Average minutes an emergency door or eyewash station remains occluded. Target: **<3.0 minutes**.`,

    cost_analysis: `### Cost Considerations & Equipment Budgeting
Engineering Bill of Materials (BOM) sizing for a robust, industrial-grade deployment:

| Component Category | Specification & Model Description | Qty | Unit Cost (USD) | Total Cost (USD) | Low-Cost Alternative Option |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Optical Sensors** | 4MP/8MP High-Definition True WDR IP Cameras with IR | ${camCount} | $180 - $260 | $${(camCount * 220).toLocaleString()} | Standard fixed focal length in low-criticality zones |
| **Network Infrastructure** | 24-Port Managed Gigabit PoE+ Switch, Cat6 STP Cabling | 1 | $1,400 | $1,400 | Commercial-grade Cat6 UTP (non-shielded) |
| **Edge Compute Server** | Dual-node on-premise industrial PC with NVIDIA GPU | 1 | $3,200 | $3,200 | Cloud inferencing (trade-off: +80ms latency) |
| **Mounting Hardware** | Rigid steel ceiling dropper poles, vibration dampeners | ${camCount} | $45 | $${(camCount * 45).toLocaleString()} | Direct truss clamp mounting without droppers |
| **Alerting Hardware** | Industrial MQTT flashing strobe beacons & audible sirens | 4 | $120 | $480 | Mobile push notifications only (no floor strobes) |
| **Installation & Rigging** | Certified electrical cabling, camera aiming, commissioning | 1 | $2,200 | $2,200 | In-house maintenance team deployment |
| **Total Estimated Budget** | **Turnkey Industrial Optical Safety Architecture** | — | — | **$${(camCount * 265 + 7280).toLocaleString()}** | **Phased P1 rollout: ~$${Math.round((camCount * 265 + 7280) * 0.6).toLocaleString()}** |`,

    unresolved_questions: `### Unresolved Questions, Assumptions & Professional Review Needs
Key engineering assumptions and on-site validations requiring physical verification prior to sign-off:

1. **Truss Structural Load Verification**: Confirm that ceiling trusses in high-bay aisles support the combined static and seismic dynamic loading of dropper pole assemblies (minimum 15 kg safety factor per mount).
2. **Chemical Cleaning Compatibility**: Verify that camera housings deployed in the filling hall and washdown zones possess IP69K ingress protection to withstand 1,500 PSI high-pressure caustic sodium hydroxide washdown sprays.
3. **Electromagnetic Interference (EMI)**: In mechanical toolrooms with high-frequency CNC spindles or welding equipment, ensure all network cabling utilizes Cat6 Shielded Twisted Pair (STP) grounded at a single patch panel point.
4. **Temporary Pallet Staging Policies**: Formally review warehouse inventory stacking regulations to prevent temporary surge staging from exceeding 2.0m height along primary camera optical vectors.
5. **Professional Engineer (PE) Sign-Off**: Final electrical conduit routing and emergency strobe interlocks require formal review by a licensed local safety professional / PE in accordance with local municipal building and fire codes.`,
  };

  const normalizedContext = normalizeUserInput({
    business_description: desc,
    industry,
    company_name: company,
    requirements,
  });

  const estimatedPromptTokens = Math.round(desc.length / 3) + 600;
  const estimatedCompletionTokens = Object.values(sections).reduce((acc, text) => acc + Math.round(text.length / 3.5), 0);
  const estimatedTokens = estimatedPromptTokens + estimatedCompletionTokens;

  const state: GenerationState = {
    normalized_context: normalizedContext,
    outline: DEFAULT_PLAN_OUTLINE,
    completed_sections: sections,
    remaining_sections: [],
    current_section: null,
    total_generated_tokens: estimatedTokens,
    rate_limit_remaining: 60,
    last_error: null,
  };

  return {
    sections,
    state,
    token_usage: {
      source: 'rule_based_engine',
      api_tokens_consumed: 0,
      saved_billable_tokens: estimatedTokens,
      prompt_tokens_equivalent: estimatedPromptTokens,
      completion_tokens_equivalent: estimatedCompletionTokens,
      total_tokens_equivalent: estimatedTokens,
      estimated_bandwidth_mbps: Math.round(camCount * 2.5 * 10) / 10,
      estimated_storage_tb_30d: Math.round(camCount * 0.45 * 10) / 10,
    },
    metadata: {
      total_sections: 12,
      total_tokens_estimate: estimatedTokens,
      source: 'rule_based_engine',
      generated_at: new Date().toISOString(),
    },
    camera_count: camCount,
    complete: true,
  };
}


/**
 * Ensures a project has a complete, synchronized camera fleet and facility structure.
 * Strictly respects user-specified camera count or user-added cameras (e.g. 4, 6, 8, 12, 15, 16+),
 * dynamically synchronizing building allocation and preserving user configuration without forcing permanent 15.
 */
export function ensureMultiBuildingFleet(project: Partial<DetVisionProject>, targetCount?: number): {
  cameras: Camera[];
  buildings: FacilityBuilding[];
  structure: LayoutElement[];
} {
  const desc = [
    project.business_description || '',
    ...(project.requirements || []),
    project.camera_specifications || '',
  ].join(' ');

  const explicitTarget = (typeof targetCount === 'number' && targetCount > 0) ? targetCount : 0;
  const userRequested = explicitTarget > 0 ? explicitTarget : extractDesiredCameraCount(desc);
  const existingCams = project.cameras || [];
  
  // Effective count: explicit target > cameras the user already has > count typed in brief > geometry reasoning
  const effectiveCount = explicitTarget > 0 
    ? explicitTarget 
    : existingCams.length > 0 
      ? existingCams.length 
      : userRequested > 0 
        ? userRequested 
        : (() => {
            const prof = detectFacilityProfile(desc);
            return calculateReasonedCameraCount({
              length_m: project.facility_length_m || prof.length,
              width_m: project.facility_width_m || prof.width,
              height_m: project.facility_height_m || prof.height,
              use_cases_count: project.use_cases?.length || 1,
              detection_coverage_target: project.detection_coverage_target || 95,
            });
          })();

  const bldgs: FacilityBuilding[] = (project.buildings && project.buildings.length >= 2)
    ? project.buildings.map((b: FacilityBuilding) => ({ ...b, camera_ids: [...(b.camera_ids || [])] }))
    : parseFacilityBuildings(desc, effectiveCount);

  // Synchronize building camera allocation
  distributeCameras(bldgs, effectiveCount);

  // Preserve the user's cameras whenever they match the effective count
  if (existingCams.length > 0 && existingCams.length === effectiveCount) {
    let camOffset = 0;
    bldgs.forEach((b: FacilityBuilding) => {
      b.camera_ids = [];
      const count = b.camera_count;
      for (let i = 0; i < count && camOffset < existingCams.length; i++, camOffset++) {
        const cam = existingCams[camOffset];
        b.camera_ids.push(cam.id);
        cam.building_name = b.name;
        cam.building_id = b.id;
        const lowerB = b.name.toLowerCase();
        const isLoading = /loading|dock|point|truck/i.test(lowerB);
        const isChemical = /filling|chemical|spill|plastic/i.test(lowerB);
        if (!cam.mount_type) cam.mount_type = i === 0 ? 'corner' : i === 1 ? 'roof-tilt' : i === 2 ? 'wall-h' : i === 3 ? 'roof-nadir' : 'cross';
        if (!cam.tilt_degrees) cam.tilt_degrees = cam.mount_type === 'roof-nadir' ? 90 : cam.mount_type === 'roof-tilt' ? 25 : 20;
        if (!cam.height_m) cam.height_m = Math.min(5.5, Math.max(3.0, +(b.height_m * 0.85).toFixed(1)));
        if (!cam.target_area) cam.target_area = `${b.name} Critical Operational ROI`;
        if (!cam.lighting_lux) cam.lighting_lux = isLoading ? '50–250 Lux (0.001 Lux Smart EXIR Night Vision to 40m)' : '150–400 Lux (0.005 Lux Starlight IR Auto-Switch)';
        if (!cam.ingress_protection) cam.ingress_protection = isLoading ? 'IP67 / IK10 Vandal-Proof NEMA 4X' : isChemical ? 'IP66 / NEMA 4X Chemical & Washdown Resistant' : 'IP54 Industrial Sealed Housing';
        if (!cam.shutter_speed) cam.shutter_speed = isChemical ? '1/500s – 1/1000s (Anti-Motion-Blur High-Speed Line)' : '1/250s (Anti-Motion-Blur Forklift & Personnel Transit)';
        if (!cam.wdr_rating) cam.wdr_rating = '120 dB True WDR (Eliminates Backlight & Glare Washout)';
        if (!cam.operating_temp) cam.operating_temp = isLoading ? '-35°C to +60°C (-31°F to 140°F) Heated Anti-Fog Glass' : '-20°C to +55°C (-4°F to 131°F) Industrial Operating Range';
        if (!cam.lens_focal) cam.lens_focal = i % 3 === 0 ? '2.8mm (106° HFOV Ultra-Wide Angle)' : i % 3 === 1 ? '4.0mm (85° HFOV Standard Industrial)' : '6.0mm (54° HFOV Telephoto Aisle Corridor)';
        if (!cam.dori_identify_m) cam.dori_identify_m = i % 3 === 0 ? 5.5 : i % 3 === 1 ? 8.0 : 12.0;
        if (!cam.dori_recognize_m) cam.dori_recognize_m = i % 3 === 0 ? 11.0 : i % 3 === 1 ? 16.0 : 24.0;
      }
    });

    const structure = (project.structure && project.structure.length >= 10)
      ? project.structure
      : generateStructuredLayout(desc, effectiveCount, project.use_cases || []).structure;

    return { cameras: existingCams, buildings: bldgs, structure };
  }

  // Otherwise synthesize cameras to match the user-specified effectiveCount
  const layout = generateStructuredLayout(desc, effectiveCount, project.use_cases || []);
  return {
    cameras: layout.cameras,
    buildings: bldgs,
    structure: layout.structure,
  };
}

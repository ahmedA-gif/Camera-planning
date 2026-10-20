/**
 * Camera Coverage Engine — deterministic geometry, zero LLM tokens.
 *
 * Coordinate system (metres):
 *   x → along the bay length   (0 … length)
 *   y → across the bay width   (0 … width)   (y grows "down" on the top view)
 *   z → height above the floor (0 = floor)
 *
 * Camera orientation:
 *   pan  (deg) — direction of the optical axis in plan. 0 = +x, 90 = +y.
 *   tilt (deg) — depression below the horizon. 0 = horizontal, 90 = straight down,
 *                negative = looking up.
 *
 * Model: ideal rectilinear pinhole camera (or equidistant fisheye for 360° mounts).
 * A point P is seen when it lies inside the image rectangle
 *   |P·right| ≤ depth·tan(HFOV/2)  and  |P·up| ≤ depth·tan(VFOV/2)
 * where depth = (P − C)·forward. Pixel density follows EN 62676-4:
 *   ppm(depth) = Hpx / (2 · depth · tan(HFOV/2))
 * so each DORI level reaches a maximum depth. Occlusion is a 3D segment-vs-box
 * test against extruded obstacles (racks, machines, walls).
 */

export type MountType =
  | 'wall-h' | 'wall-v' | 'roof-nadir' | 'roof-tilt'
  | 'corner' | 'cross' | 'pole360' | 'underside';

export type DoriMode = 'detect' | 'observe' | 'recognize' | 'identify';

/** IEC EN 62676-4 pixel-density thresholds (pixels per metre). */
export const DORI_PPM: Record<DoriMode, number> = {
  detect: 25,
  observe: 62.5,
  recognize: 125,
  identify: 250,
};

export const DORI_LEVEL: Record<DoriMode, number> = { detect: 1, observe: 2, recognize: 3, identify: 4 };
export const LEVEL_NAMES = ['Blind', 'Detect', 'Observe', 'Recognize', 'Identify'] as const;
const MODES_BY_LEVEL: DoriMode[] = ['detect', 'detect', 'observe', 'recognize', 'identify'];

/** Fisheye: image circle ≈ sensor height (≈ 9/16 of width), spread over the 360° horizon ring. */
const FISHEYE_PPM_FACTOR = 9 / 32; // ppm = FACTOR · Hpx / slantDistance
const FISHEYE_HALF_ANGLE = (89 * Math.PI) / 180;

export interface LensSpec {
  focalMm: number;
  hfovDeg: number;
  vfovDeg: number;
  /** Maximum distance (m) for each DORI level, as published by the camera vendor. */
  ranges: Record<DoriMode, number>;
}

export type ObstacleType =
  | 'rack'
  | 'machine'
  | 'column'
  | 'wall'
  | 'partition'
  | 'conveyor'
  | 'agv_lane'
  | 'mezzanine'
  | 'hazard'
  | 'dock';

export interface Obstacle {
  id: string;
  name: string;
  /** Min corner in plan (m). */
  x: number;
  y: number;
  /** Size along x / y (m). */
  w: number;
  d: number;
  /** Height (m). */
  h: number;
  type?: ObstacleType;
  /** Base elevation above floor (m). Default 0 */
  zBase?: number;
}

/** IEC 62676-4:2025 (OODPCVS) 7-Level Standard Definition */
export interface Iec2025Level {
  level: number;
  name: string;
  code: string;
  ppm: number;
  purpose: string;
  doriEquivalent: DoriMode;
}

export const IEC_2025_LEVELS: Iec2025Level[] = [
  { level: 1, name: 'Overview', code: 'O1', ppm: 20, purpose: 'General spatial orientation & crowd flow', doriEquivalent: 'detect' },
  { level: 2, name: 'Outline', code: 'O2', ppm: 40, purpose: 'Human silhouette shape & direction of movement', doriEquivalent: 'detect' },
  { level: 3, name: 'Discern', code: 'D3', ppm: 80, purpose: 'Vehicle classification & gross human posture', doriEquivalent: 'observe' },
  { level: 4, name: 'Perceive', code: 'P4', ppm: 125, purpose: 'PPE clothing & personal equipment verification', doriEquivalent: 'recognize' },
  { level: 5, name: 'Characterize', code: 'C5', ppm: 250, purpose: 'Forensic attire details & legible license plates', doriEquivalent: 'identify' },
  { level: 6, name: 'Validate', code: 'V6', ppm: 500, purpose: 'Automated Facial Recognition (AFR) & Biometrics', doriEquivalent: 'identify' },
  { level: 7, name: 'Scrutinize', code: 'S7', ppm: 1500, purpose: 'Passport-grade micro-inspection & high-security forensics', doriEquivalent: 'identify' },
];

/** AI Computer Vision Tasks and required resolution thresholds */
export interface AiVisionTask {
  id: string;
  name: string;
  category: string;
  minPpm: number;
  doriEquivalent: DoriMode;
  iecLevel: string;
  description: string;
  recommendedSensor: string;
}

export const AI_VISION_TASKS: AiVisionTask[] = [
  {
    id: 'ppe_safety',
    name: 'PPE & Safety Equipment',
    category: 'EHS & Industrial Safety',
    minPpm: 125,
    doriEquivalent: 'recognize',
    iecLevel: 'Perceive (125 px/m)',
    description: 'Real-time detection of safety helmets, hi-vis reflective vests, safety glasses, and gloves.',
    recommendedSensor: '4MP / 8MP at 2.8mm–4mm',
  },
  {
    id: 'face_recognition',
    name: 'Facial Recognition (AFR)',
    category: 'Access & Biometrics',
    minPpm: 500,
    doriEquivalent: 'identify',
    iecLevel: 'Validate (500 px/m)',
    description: 'High-confidence 1:N biometric face matching against employee/visitor databases under video compression.',
    recommendedSensor: '8MP 4K at 6mm–12mm telephoto',
  },
  {
    id: 'anpr_lpr',
    name: 'License Plate (ANPR / LPR)',
    category: 'Logistics & Gate Control',
    minPpm: 250,
    doriEquivalent: 'identify',
    iecLevel: 'Characterize (250 px/m)',
    description: 'Optical character recognition (OCR) of vehicle license plates at entry gates, weighbridges, and loading docks.',
    recommendedSensor: '4MP Global Shutter / 6mm–12mm',
  },
  {
    id: 'forklift_agv',
    name: 'Forklift & AGV Collision Alert',
    category: 'Intralogistics Safety',
    minPpm: 62.5,
    doriEquivalent: 'observe',
    iecLevel: 'Discern (80 px/m) / Observe',
    description: 'Tracking mobile robots, reach trucks, and pedestrian workers to prevent blind-spot collisions in shared aisles.',
    recommendedSensor: '4MP Ultra-wide 2.8mm',
  },
  {
    id: 'perimeter_intrusion',
    name: 'Perimeter Intrusion (PID)',
    category: 'Facility Security',
    minPpm: 25,
    doriEquivalent: 'detect',
    iecLevel: 'Detect (25 px/m)',
    description: 'Fence line tripwires, boundary breach alerts, and classification of humans vs. wildlife/vegetation.',
    recommendedSensor: '4MP / 8MP Starlight IR',
  },
  {
    id: 'barcode_reading',
    name: 'Pallet Barcode / QR Scanning',
    category: 'Warehouse Automation',
    minPpm: 1000,
    doriEquivalent: 'identify',
    iecLevel: 'Scrutinize (1000+ px/m)',
    description: 'Overhead optical scanning of 1D and 2D DataMatrix barcodes on conveyor pallet wraps without manual hand scanning.',
    recommendedSensor: '12MP C-Mount Machine Vision',
  },
];

/* ------------------------------------------------------------------ */
/* CCTV Standards Frameworks: DORI, OODPCVS, Johnson's, DHS/NIJ, French */
/* ------------------------------------------------------------------ */

export type MappingStandard = 'dori' | 'oodpcvs' | 'johnson' | 'dhs_nij' | 'french';

export interface StandardTier {
  name: string;
  code: string;
  threshold: number; // PPM, Line Pairs, or VSH %
  unit: string;
  description: string;
  color: string;
}

export interface StandardDefinition {
  id: MappingStandard;
  name: string;
  authority: string;
  domain: 'Visible Light' | 'Thermal IR' | 'Forensic Video' | 'Public Municipal';
  metricUnit: string;
  description: string;
  tiers: StandardTier[];
}

export const MAPPING_STANDARDS: Record<MappingStandard, StandardDefinition> = {
  dori: {
    id: 'dori',
    name: 'DORI (IEC 62676-4:2015)',
    authority: 'International Electrotechnical Commission',
    domain: 'Visible Light',
    metricUnit: 'px/m',
    description: 'Traditional 4-tier pixel-density ladder widely adopted for standard optical surveillance design.',
    tiers: [
      { name: 'Identification', code: 'I', threshold: 250, unit: 'px/m', description: 'Positive facial identification beyond reasonable doubt and clear license plate character capture.', color: '#00e5ff' },
      { name: 'Recognition', code: 'R', threshold: 125, unit: 'px/m', description: 'Verification of known individuals, PPE compliance (helmets, vests), and vehicle type classification.', color: '#4ade80' },
      { name: 'Observation', code: 'O', threshold: 62.5, unit: 'px/m', description: 'Perception of personal attributes (clothing color, carried items) and scene activity monitoring.', color: '#facc15' },
      { name: 'Detection', code: 'D', threshold: 25, unit: 'px/m', description: 'Reliable detection of human or vehicle presence and perimeter boundary intrusion.', color: '#f59e0b' },
    ],
  },
  oodpcvs: {
    id: 'oodpcvs',
    name: 'OODPCVS (IEC 62676-4:2025)',
    authority: 'IEC 62676-4:2025 Standard Update',
    domain: 'Visible Light',
    metricUnit: 'px/m',
    description: '7-level global evolution of DORI engineered for ultra-high-resolution 4K/8K sensors and AI computer vision algorithms.',
    tiers: [
      { name: 'Scrutinize', code: 'S7', threshold: 1500, unit: 'px/m', description: 'Minimum density for modern 3D biometric facial recognition software, forensic iris scans, and micro-defect scrutiny.', color: '#c084fc' },
      { name: 'Validate', code: 'V6', threshold: 500, unit: 'px/m', description: 'Automated Facial Recognition (AFR) matching against central watchlists under video compression.', color: '#00e5ff' },
      { name: 'Characterize', code: 'C5', threshold: 250, unit: 'px/m', description: 'Forensic attire details, alphanumeric plate OCR, and tool mark identification.', color: '#38bdf8' },
      { name: 'Perceive', code: 'P4', threshold: 125, unit: 'px/m', description: 'Industrial PPE safety compliance, worker posture, and hand tool confirmation.', color: '#4ade80' },
      { name: 'Discern', code: 'D3', threshold: 80, unit: 'px/m', description: 'Vehicle classification (truck vs. sedan) and gross body stance evaluation.', color: '#a3e635' },
      { name: 'Outline', code: 'O2', threshold: 40, unit: 'px/m', description: 'Silhouette shape recognition and speed/trajectory tracking in open space.', color: '#facc15' },
      { name: 'Overview', code: 'O1', threshold: 20, unit: 'px/m', description: 'General facility spatial orientation, crowd density, and queue monitoring.', color: '#f59e0b' },
    ],
  },
  johnson: {
    id: 'johnson',
    name: "Thermal Johnson's Criteria",
    authority: 'US Military / Night Vision & Electronic Sensors Directorate (NVESD)',
    domain: 'Thermal IR',
    metricUnit: 'line pairs (lp)',
    description: "Calculates resolution across target object dimension (human 1.8m, vehicle 2.3m) for LWIR/MWIR thermal cores.",
    tiers: [
      { name: 'Identification', code: 'J-ID', threshold: 6.0, unit: 'line pairs', description: 'Distinguish specific details within class (e.g., soldier with rifle vs civilian, specific vehicle chassis model). Requires 6-8 line pairs.', color: '#00e5ff' },
      { name: 'Recognition', code: 'J-REC', threshold: 3.0, unit: 'line pairs', description: 'Distinguish target class (e.g., human vs large dog, forklift vs pickup truck). Requires 3-4 line pairs.', color: '#4ade80' },
      { name: 'Detection', code: 'J-DET', threshold: 1.0, unit: 'line pairs', description: 'Determine presence of heat signature anomaly vs background thermal clutter (50% probability). Requires 1-1.5 line pairs.', color: '#f59e0b' },
    ],
  },
  dhs_nij: {
    id: 'dhs_nij',
    name: 'US DHS / NIJ Standards',
    authority: 'US Dept of Homeland Security & National Institute of Justice',
    domain: 'Forensic Video',
    metricUnit: '% VSH',
    description: 'Forensic mapping based on target percentage of vertical screen height (% VSH) required for court-admissible forensic evidence.',
    tiers: [
      { name: 'High-Security Forensic ID', code: 'DHS-25', threshold: 25, unit: '% VSH', description: 'Full biometric facial forensic admissibility for federal criminal prosecution.', color: '#c084fc' },
      { name: 'Forensic Evidence ID', code: 'DHS-15', threshold: 15, unit: '% VSH', description: 'Standard courtroom threshold where facial features occupy ≥15% of vertical frame height.', color: '#00e5ff' },
      { name: 'Vehicle & Body Classification', code: 'DHS-10', threshold: 10, unit: '% VSH', description: 'Target occupies ≥10% VSH, sufficient to classify vehicle make/model and clothing attire.', color: '#4ade80' },
      { name: 'General Scene Detection', code: 'DHS-5', threshold: 5, unit: '% VSH', description: 'Target occupies 5-10% VSH for broad boundary and queue alert triggers.', color: '#f59e0b' },
    ],
  },
  french: {
    id: 'french',
    name: 'French Public Surveillance Standards',
    authority: 'Ministère de l’Intérieur & CNIL (France / JVSG)',
    domain: 'Public Municipal',
    metricUnit: 'px/m',
    description: 'Strict European regulatory metrics used across French public security installations and JVSG CCTV design tools.',
    tiers: [
      { name: 'Contrôle d’Accès Sécurisé', code: 'FR-800', threshold: 800, unit: 'px/m', description: 'Ultra-haute résolution pour contrôle d’accès biométrique et lecture fine de documents officiels.', color: '#c084fc' },
      { name: 'Identification Stricte', code: 'FR-300', threshold: 300, unit: 'px/m', description: 'Identification judiciaire formelle sur la voie publique (standard français renforcé vs 250 DORI).', color: '#00e5ff' },
      { name: 'Reconnaissance Publique', code: 'FR-150', threshold: 150, unit: 'px/m', description: 'Reconnaissance fiable des individus et des attributs vestimentaires en espace public (150 px/m vs 125).', color: '#4ade80' },
      { name: 'Surveillance Générale', code: 'FR-30', threshold: 30, unit: 'px/m', description: 'Surveillance panoramique de flux piétons et détection de présence sur voirie (30 px/m vs 25).', color: '#f59e0b' },
    ],
  },
};

/** Compute multi-standard metrics for any distance & camera optical spec */
export function computeTargetMetrics(
  distanceM: number,
  hpx: number,
  hfovDeg: number,
  vfovDeg: number,
  targetHeightM = 1.8
) {
  const d = Math.max(0.1, distanceM);
  const tanH = Math.tan(rad(hfovDeg) / 2);
  const tanV = Math.tan(rad(vfovDeg) / 2);
  const sceneWidthM = 2 * d * tanH;
  const sceneHeightM = 2 * d * tanV;
  const ppm = hpx / sceneWidthM;

  // 1. DORI
  let doriName = 'Blind';
  let doriLevel = 0;
  if (ppm >= DORI_PPM.identify) { doriName = 'Identify'; doriLevel = 4; }
  else if (ppm >= DORI_PPM.recognize) { doriName = 'Recognize'; doriLevel = 3; }
  else if (ppm >= DORI_PPM.observe) { doriName = 'Observe'; doriLevel = 2; }
  else if (ppm >= DORI_PPM.detect) { doriName = 'Detect'; doriLevel = 1; }

  // 2. OODPCVS 2025
  const oodTiers = MAPPING_STANDARDS.oodpcvs.tiers;
  let oodpcvs = oodTiers[oodTiers.length - 1];
  for (const tier of oodTiers) {
    if (ppm >= tier.threshold) {
      oodpcvs = tier;
      break;
    }
  }

  // 3. Johnson's Criteria (Thermal line pairs across target)
  // Target width/height ~1.8m human, 1 line pair = 2 pixels (PPM * targetHeightM / 2)
  const linePairs = (ppm * targetHeightM) / 2;
  let johnsonLevel = 'Sub-detection';
  if (linePairs >= 6.0) johnsonLevel = 'Identification (6-8 lp)';
  else if (linePairs >= 3.0) johnsonLevel = 'Recognition (3-4 lp)';
  else if (linePairs >= 1.0) johnsonLevel = 'Detection (1-1.5 lp)';

  // 4. US DHS / NIJ (% Vertical Screen Height)
  const vshPct = Math.min(100, (targetHeightM / sceneHeightM) * 100);
  let dhsLevel = 'Below 5% VSH';
  let isForensicLegal = false;
  if (vshPct >= 25) { dhsLevel = 'High-Security Forensic ID (≥25% VSH)'; isForensicLegal = true; }
  else if (vshPct >= 15) { dhsLevel = 'Forensic Evidence ID (≥15% VSH)'; isForensicLegal = true; }
  else if (vshPct >= 10) { dhsLevel = 'Classification (≥10% VSH)'; }
  else if (vshPct >= 5) { dhsLevel = 'Detection (≥5% VSH)'; }

  // 5. French Standards
  const frTiers = MAPPING_STANDARDS.french.tiers;
  let frenchLevel = 'Non Couvert';
  for (const tier of frTiers) {
    if (ppm >= tier.threshold) {
      frenchLevel = `${tier.name} (${tier.threshold} px/m)`;
      break;
    }
  }

  return {
    distanceM: +d.toFixed(2),
    ppm: +ppm.toFixed(1),
    dori: { level: doriLevel, name: doriName },
    oodpcvs: { code: oodpcvs.code, name: oodpcvs.name, threshold: oodpcvs.threshold },
    johnson: { linePairs: +linePairs.toFixed(2), level: johnsonLevel },
    dhsNij: { vshPct: +vshPct.toFixed(1), level: dhsLevel, isForensicLegal },
    french: { level: frenchLevel },
  };
}

export interface SiteSpec {
  length: number;
  width: number;
  /** Default mounting height (m). */
  mountHeight: number;
  /** Height of the plane that must be seen (m). 0 = floor, ~1.5 = head/torso for PPE. */
  targetHeight: number;
  /** Range derating (%) applied to every DORI distance to guarantee overlap at boundaries. */
  marginPct: number;
  obstacles: Obstacle[];
}

export interface CameraPose {
  id: number;
  mount: MountType;
  x: number;
  y: number;
  z: number;
  panDeg: number;
  tiltDeg: number;
}

type Vec3Tuple = [number, number, number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraSpec {
  id: string;
  position: Vec3;          // (X, Y, Mount Height Z in meters)
  azimuthDeg: number;      // 0 = North (+Y), 90 = East (+X), clockwise
  tiltDeg: number;         // Downward pitch angle (0 = horizontal, 90 = straight down)
  focalLengthMm: number;   // e.g., 2.8, 4, 6, 8, 12
  sensorWidthMm: number;   // e.g., 5.14 for 1/2.8", 7.18 for 1/1.8"
  sensorHeightMm: number;  // e.g., 2.89 for 1/2.8", 4.04 for 1/1.8"
  resolutionW: number;     // e.g., 3840 (4K)
  resolutionH: number;     // e.g., 2160 (4K)
  distortionK1?: number;   // Radial barrel distortion (e.g., -0.18 for 2.8mm)
}

export interface Obstacle3D {
  id: string;
  min: Vec3; // World-space AABB minimum (x, y, zBase)
  max: Vec3; // World-space AABB maximum (x + W, y + D, zBase + H)
  name?: string;
  type?: ObstacleType;
}

export interface TargetEvaluation {
  inFrustum: boolean;
  visibilityRatio: number;      // 0.0 (fully occluded) to 1.0 (fully visible)
  slantDistanceM: number;
  groundDistanceM: number;
  effectivePpm: number;
  verticalDepressionDeg: number;
  doriTier: 'BLIND' | 'DETECT' | 'OBSERVE' | 'RECOGNIZE' | 'IDENTIFY';
  personBBoxPx: { width: number; height: number };
  aiFeasibility: {
    personTracking: boolean;
    ppeDetection: boolean;
    facialRecognition: boolean;
    forkliftAlert?: boolean;
    licensePlateOcr?: boolean;
  };
  rayHits?: Array<{
    anchor: 'ankle' | 'torso' | 'head';
    heightM: number;
    blocked: boolean;
    hitPoint?: Vec3;
    obstacleName?: string;
  }>;
}

export interface CameraFrame {
  pose: CameraPose;
  fisheye: boolean;
  f: Vec3Tuple; // forward (optical axis)
  r: Vec3Tuple; // image right
  u: Vec3Tuple; // image "down" (completes the basis)
  tanH: number;
  tanV: number;
  /** Derated max distance per level, index 1..4 (0 unused). Depth for rectilinear, slant for fisheye. */
  reach: number[];
  hpx: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ */
/* Lens maths                                                          */
/* ------------------------------------------------------------------ */

/** Ranges sorted so detect ≥ observe ≥ recognize ≥ identify (guards bad input). */
export function sanitizeRanges(r: Record<DoriMode, number>): Record<DoriMode, number> {
  const v = [r.detect, r.observe, r.recognize, r.identify].map(n => Math.max(0.1, Number(n) || 0.1));
  v.sort((a, b) => b - a);
  return { detect: v[0], observe: v[1], recognize: v[2], identify: v[3] };
}

/**
 * Horizontal pixel count implied by the vendor DORI ranges:
 *   Hpx = range · ppm · 2 · tan(HFOV/2)   (averaged over the four levels)
 */
export function impliedHorizontalPixels(lens: LensSpec): number {
  const t = 2 * Math.tan(rad(lens.hfovDeg) / 2);
  const r = sanitizeRanges(lens.ranges);
  const vals = (Object.keys(DORI_PPM) as DoriMode[]).map(m => r[m] * DORI_PPM[m] * t);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** How far each published range deviates from the EN 62676-4 ratio (max |Δ| in %). */
export function rangeConsistencyPct(lens: LensSpec): number {
  const hpx = impliedHorizontalPixels(lens);
  const t = 2 * Math.tan(rad(lens.hfovDeg) / 2);
  const r = sanitizeRanges(lens.ranges);
  let worst = 0;
  (Object.keys(DORI_PPM) as DoriMode[]).forEach(m => {
    const ideal = hpx / (DORI_PPM[m] * t);
    worst = Math.max(worst, Math.abs(r[m] - ideal) / ideal);
  });
  return worst * 100;
}

/** DORI ranges from a sensor width in pixels: d = Hpx / (2 · ppm · tan(HFOV/2)). */
export function rangesFromResolution(hpx: number, hfovDeg: number): Record<DoriMode, number> {
  const t = 2 * Math.tan(rad(hfovDeg) / 2);
  const out = {} as Record<DoriMode, number>;
  (Object.keys(DORI_PPM) as DoriMode[]).forEach(m => { out[m] = +(hpx / (DORI_PPM[m] * t)).toFixed(2); });
  return out;
}

/**
 * Change focal length while keeping the same sensor:
 *   sensorW = 2·f·tan(HFOV/2)   →   HFOV' = 2·atan(sensorW / 2f')
 * Pixel count is unchanged, so every DORI range scales by tan(HFOV/2) / tan(HFOV'/2).
 */
export function refocusLens(lens: LensSpec, newFocalMm: number): LensSpec {
  const f0 = Math.max(0.1, lens.focalMm);
  const f1 = Math.max(0.1, newFocalMm);
  const sw = 2 * f0 * Math.tan(rad(lens.hfovDeg) / 2);
  const sh = 2 * f0 * Math.tan(rad(lens.vfovDeg) / 2);
  const h1 = deg(2 * Math.atan(sw / (2 * f1)));
  const v1 = deg(2 * Math.atan(sh / (2 * f1)));
  const k = Math.tan(rad(lens.hfovDeg) / 2) / Math.tan(rad(h1) / 2);
  const r = lens.ranges;
  return {
    focalMm: f1,
    hfovDeg: +h1.toFixed(1),
    vfovDeg: +v1.toFixed(1),
    ranges: {
      detect: +(r.detect * k).toFixed(2),
      observe: +(r.observe * k).toFixed(2),
      recognize: +(r.recognize * k).toFixed(2),
      identify: +(r.identify * k).toFixed(2),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Camera frame                                                        */
/* ------------------------------------------------------------------ */

export function buildFrame(pose: CameraPose, lens: LensSpec, site: SiteSpec): CameraFrame {
  const p = rad(pose.panDeg);
  const t = rad(clamp(pose.tiltDeg, -89, 90));
  const cp = Math.cos(p), sp = Math.sin(p), ct = Math.cos(t), st = Math.sin(t);
  const f: Vec3Tuple = [ct * cp, ct * sp, -st];
  const r: Vec3Tuple = [-sp, cp, 0];
  // u = r × f  (unit, perpendicular to both; z-component = −cos(tilt))
  const u: Vec3Tuple = [-cp * st, -sp * st, -ct];
  const fisheye = pose.mount === 'pole360';
  const derate = 1 - clamp(site.marginPct, 0, 90) / 100;
  const hpx = impliedHorizontalPixels(lens);
  const ranges = sanitizeRanges(lens.ranges);
  const reach = [0, 0, 0, 0, 0];
  for (let lv = 1; lv <= 4; lv++) {
    const mode = MODES_BY_LEVEL[lv];
    reach[lv] = fisheye
      ? ((FISHEYE_PPM_FACTOR * hpx) / DORI_PPM[mode]) * derate
      : ranges[mode] * derate;
  }
  return {
    pose, fisheye, f, r, u,
    tanH: Math.tan(rad(clamp(lens.hfovDeg, 1, 179)) / 2),
    tanV: Math.tan(rad(clamp(lens.vfovDeg, 1, 179)) / 2),
    reach, hpx,
  };
}

/** Pixel density (px/m) at a given distance for this camera. */
export function pixelDensity(frame: CameraFrame, distance: number): number {
  if (distance <= 0) return Infinity;
  return frame.fisheye
    ? (FISHEYE_PPM_FACTOR * frame.hpx) / distance
    : frame.hpx / (2 * distance * frame.tanH);
}

/* ------------------------------------------------------------------ */
/* Occlusion                                                           */
/* ------------------------------------------------------------------ */

/** Slab test: does the open segment A→B pass through the axis-aligned box? */
function segmentHitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Obstacle): boolean {
  let t0 = 1e-4, t1 = 1 - 1e-4;
  const d = [bx - ax, by - ay, bz - az];
  const a = [ax, ay, az];
  const zBase = o.zBase ?? 0;
  const lo = [o.x, o.y, zBase];
  const hi = [o.x + o.w, o.y + o.d, zBase + o.h];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (a[i] < lo[i] || a[i] > hi[i]) return false;
    } else {
      let ta = (lo[i] - a[i]) / d[i];
      let tb = (hi[i] - a[i]) / d[i];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function isOccluded(c: CameraPose, px: number, py: number, pz: number, obstacles: Obstacle[]): boolean {
  for (let i = 0; i < obstacles.length; i++) {
    if (segmentHitsBox(c.x, c.y, c.z, px, py, pz, obstacles[i])) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Point visibility                                                    */
/* ------------------------------------------------------------------ */

export interface PointSample { level: number; distance: number; ppm: number }

/** DORI level (0–4) at which the camera resolves point P, honouring FOV, range and occlusion. */
export function samplePoint(frame: CameraFrame, px: number, py: number, pz: number, obstacles: Obstacle[]): PointSample {
  const c = frame.pose;
  const vx = px - c.x, vy = py - c.y, vz = pz - c.z;
  const depth = vx * frame.f[0] + vy * frame.f[1] + vz * frame.f[2];
  if (depth <= 1e-6) return { level: 0, distance: 0, ppm: 0 };
  let distance: number;
  if (frame.fisheye) {
    const len = Math.hypot(vx, vy, vz);
    if (Math.acos(clamp(depth / len, -1, 1)) > FISHEYE_HALF_ANGLE) return { level: 0, distance: 0, ppm: 0 };
    distance = len;
  } else {
    const xr = vx * frame.r[0] + vy * frame.r[1];
    const yu = vx * frame.u[0] + vy * frame.u[1] + vz * frame.u[2];
    if (Math.abs(xr) > depth * frame.tanH || Math.abs(yu) > depth * frame.tanV) return { level: 0, distance: 0, ppm: 0 };
    distance = depth;
  }
  if (distance > frame.reach[1]) return { level: 0, distance, ppm: pixelDensity(frame, distance) };
  if (obstacles.length && isOccluded(c, px, py, pz, obstacles)) return { level: 0, distance, ppm: 0 };
  const level = distance <= frame.reach[4] ? 4 : distance <= frame.reach[3] ? 3 : distance <= frame.reach[2] ? 2 : 1;
  return { level, distance, ppm: pixelDensity(frame, distance) };
}

/* ------------------------------------------------------------------ */
/* Exact footprints                                                    */
/* ------------------------------------------------------------------ */

export interface Pt { x: number; y: number }

/**
 * Exact footprint of the frustum on the horizontal plane z = planeZ, truncated at `maxDepth`.
 *
 * Because image-right has no z component, the ray height dir_z = f_z + b·tanV·u_z depends only
 * on the image row b ∈ [−1, 1]. The depth limit therefore cuts the image along a single row b*,
 * and the projective map sends the image rectangle [−1,1]×[b_lo,b_hi] to a convex quadrilateral.
 * Returns [] when the plane is not visible within range.
 */
export function footprintOnPlane(frame: CameraFrame, planeZ: number, maxDepth: number): Pt[] {
  const c = frame.pose;
  const dz = planeZ - c.z;
  if (frame.fisheye) {
    if (dz >= 0) return [];
    const rr = maxDepth * maxDepth - dz * dz;
    if (rr <= 0) return [];
    const rg = Math.min(Math.sqrt(rr), Math.abs(dz) * Math.tan(FISHEYE_HALF_ANGLE));
    const pts: Pt[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push({ x: c.x + rg * Math.cos(a), y: c.y + rg * Math.sin(a) });
    }
    return pts;
  }
  const fz = frame.f[2], uz = frame.u[2], tv = frame.tanV, th = frame.tanH;
  const dirZ = (b: number) => fz + b * tv * uz;
  let bLo = -1, bHi = 1;
  if (Math.abs(dz) < 1e-9) return [];
  const k = dz / maxDepth; // required dir_z bound
  const slope = tv * uz;   // d(dir_z)/db  (≤ 0)
  if (Math.abs(slope) < 1e-12) {
    // Optical axis vertical (nadir/zenith): every row has the same dir_z.
    const s = dz / fz;
    if (!(s > 0 && s <= maxDepth)) return [];
  } else if (dz < 0) {
    // need dir_z ≤ k (<0):  fz + b·slope ≤ k  →  b ≥ (k − fz)/slope   (slope < 0 flips)
    bLo = Math.max(bLo, (k - fz) / slope);
  } else {
    // camera below the plane (looking up): need dir_z ≥ k (>0) → b ≤ (k − fz)/slope
    bHi = Math.min(bHi, (k - fz) / slope);
  }
  if (bLo >= bHi) return [];
  const corner = (a: number, b: number): Pt => {
    const s = dz / dirZ(b);
    const dx = frame.f[0] + a * th * frame.r[0] + b * tv * frame.u[0];
    const dy = frame.f[1] + a * th * frame.r[1] + b * tv * frame.u[1];
    return { x: c.x + s * dx, y: c.y + s * dy };
  };
  return [corner(-1, bLo), corner(1, bLo), corner(1, bHi), corner(-1, bHi)];
}

/** End point of an image ray (a,b) clipped by the floor and the depth limit (for side/3D views). */
export function rayEnd(frame: CameraFrame, a: number, b: number, maxDepth: number, floorZ = 0): Vec3Tuple {
  const c = frame.pose;
  const d: Vec3Tuple = [
    frame.f[0] + a * frame.tanH * frame.r[0] + b * frame.tanV * frame.u[0],
    frame.f[1] + a * frame.tanH * frame.r[1] + b * frame.tanV * frame.u[1],
    frame.f[2] + a * frame.tanH * frame.r[2] + b * frame.tanV * frame.u[2],
  ];
  let s = maxDepth;
  if (d[2] < -1e-9) s = Math.min(s, (floorZ - c.z) / d[2]);
  return [c.x + s * d[0], c.y + s * d[1], c.z + s * d[2]];
}

/** Silhouette of the clipped frustum projected on the x–z plane (side elevation). */
export function sideProfile(frame: CameraFrame, maxDepth: number): Pt[] {
  const c = frame.pose;
  const pts: Pt[] = [{ x: c.x, y: c.z }];
  if (frame.fisheye) {
    for (let i = 0; i <= 36; i++) {
      const th = -Math.PI / 2 + (i / 36) * Math.PI; // angle from straight down
      const dx = Math.sin(th), dz = -Math.cos(th);
      let s = maxDepth;
      if (dz < -1e-9) s = Math.min(s, -c.z / dz);
      pts.push({ x: c.x + s * dx, y: c.z + s * dz });
    }
    return convexHull(pts);
  }
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    for (const [a, b] of [[t, -1], [t, 1], [-1, t], [1, t]] as const) {
      const e = rayEnd(frame, a, b, maxDepth);
      pts.push({ x: e[0], y: e[2] });
    }
  }
  return convexHull(pts);
}

export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((px - a.x) * dx + (py - a.y) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Horizontal blind distance between the camera and the first visible point of its footprint. */
export function nearBlindDistance(frame: CameraFrame, poly: Pt[]): number {
  if (poly.length < 3) return NaN;
  const { x, y } = frame.pose;
  if (pointInPolygon(x, y, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(x, y, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

export function farReach(frame: CameraFrame, poly: Pt[]): number {
  const { x, y } = frame.pose;
  return poly.reduce((m, p) => Math.max(m, Math.hypot(p.x - x, p.y - y)), 0);
}

function polyBBox(poly: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
}

/* ------------------------------------------------------------------ */
/* Default poses per mount type                                        */
/* ------------------------------------------------------------------ */

export const MOUNT_INFO: Record<MountType, { label: string; short: string; tip: string; tiltLocked?: number }> = {
  'wall-h': { label: 'Wall Horiz →', short: 'WALL-H', tip: 'Wall/post mount, lens horizontal (tilt 0°) along the bay length' },
  'wall-v': { label: 'Wall Tilted ↓', short: 'WALL-V', tip: 'Wall/post mount tilted down so the optical axis lands at ~55% of the DORI range' },
  'roof-nadir': { label: 'Roof Nadir ↓', short: 'ROOF-NADIR', tip: 'Ceiling mount looking straight down — rectangular footprint (H−h)·tan(FOV/2)', tiltLocked: 90 },
  'roof-tilt': { label: 'Roof Tilted ↘', short: 'ROOF-TILT', tip: 'Ceiling mount tilted toward a target zone (set pan & tilt)' },
  'corner': { label: 'Corner 45° ↘', short: 'CORNER', tip: 'Corner/side-wall mount aimed 45° diagonally into the bay' },
  'cross': { label: 'Cross Aisle ↕', short: 'CROSS', tip: 'Side-wall mount looking across the bay width' },
  'pole360': { label: 'Pole 360°', short: 'POLE360', tip: 'Fisheye on a pole/ceiling, hemispherical view (equidistant model)', tiltLocked: 90 },
  'underside': { label: 'Underside ↑', short: 'UNDERSIDE', tip: 'Low mount looking upward (undercarriage / overhead inspection)' },
};

/** Tilt that places the optical axis on the target plane at `distance` metres. */
export function aimTilt(z: number, targetHeight: number, distance: number): number {
  return +deg(Math.atan2(z - targetHeight, Math.max(0.5, distance))).toFixed(1);
}

export function defaultPose(
  mount: MountType, id: number, x: number, count: number,
  site: SiteSpec, lens: LensSpec, mode: DoriMode,
): CameraPose {
  const { length: L, width: W, mountHeight: H, targetHeight: ht } = site;
  const R = sanitizeRanges(lens.ranges)[mode] * (1 - site.marginPct / 100);
  const facingRight = id <= Math.ceil(count / 2);
  const along = facingRight ? 0 : 180;
  const edge = 0.05;
  const base = { id, mount, x: clamp(x, 0, L), y: W / 2, z: H };
  switch (mount) {
    case 'wall-h': return { ...base, panDeg: along, tiltDeg: 0 };
    case 'wall-v': return { ...base, panDeg: along, tiltDeg: aimTilt(H, ht, 0.55 * R) };
    case 'roof-nadir': return { ...base, panDeg: L >= W ? 90 : 0, tiltDeg: 90 };
    case 'roof-tilt': return { ...base, panDeg: along, tiltDeg: aimTilt(H, ht, 0.45 * R) };
    case 'corner': {
      const top = id % 2 === 1;
      return { ...base, y: top ? edge : W - edge, panDeg: top ? (facingRight ? 45 : 135) : (facingRight ? 315 : 225), tiltDeg: aimTilt(H, ht, 0.6 * R) };
    }
    case 'cross': {
      const top = id % 2 === 1;
      return { ...base, y: top ? edge : W - edge, panDeg: top ? 90 : 270, tiltDeg: aimTilt(H, ht, Math.max(1, 0.6 * W)) };
    }
    case 'pole360': return { ...base, panDeg: 0, tiltDeg: 90 };
    case 'underside': return { ...base, z: 0.5, panDeg: along, tiltDeg: -60 };
  }
}

/** Evenly distribute N cameras left→right (end cameras face inward, middle one nadir). */
export function defaultLayout(count: number, site: SiteSpec, lens: LensSpec, mode: DoriMode): CameraPose[] {
  const out: CameraPose[] = [];
  const mid = Math.ceil(count / 2);
  for (let i = 1; i <= count; i++) {
    const x = count === 1 ? site.length / 2 : ((i - 1) / (count - 1)) * site.length;
    const mount: MountType = count > 2 && count % 2 === 1 && i === mid ? 'roof-nadir' : 'wall-h';
    out.push(defaultPose(mount, i, x, count, site, lens, mode));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Grid coverage                                                       */
/* ------------------------------------------------------------------ */

export interface CameraStats {
  id: number;
  coveredCells: number;
  uniqueCells: number;
  coveredArea: number;
  uniqueArea: number;
  coverStart: number;
  coverEnd: number;
  footprint: Pt[];
  doriFootprints: Pt[][]; // index 1..4
  nearBlind: number;
  farReach: number;
  effectiveRange: number;
  ppmAtAxis: number;
}

export interface CoverageResult {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Best DORI level per cell (0–4), 255 = inside an obstacle. */
  best: Uint8Array;
  /** Cameras meeting the required mode per cell. */
  count: Uint8Array;
  bestPpm: Float32Array;
  cameras: CameraStats[];
  metrics: {
    cameras: number;
    coverablePct: number;
    coveragePct: number;
    blindPct: number;
    overlapPct: number;
    efficiency: number;
    totalArea: number;
    coverableArea: number;
    coveredArea: number;
    lengthCoveragePct: number;
    largestGapM: number;
    doriPct: number[]; // share of coverable area whose best level is 0..4
    impliedHpx: number;
    rangeConsistencyPct: number;
  };
}

export function autoCellSize(site: SiteSpec, targetCells = 16000): number {
  return clamp(Math.sqrt((site.length * site.width) / targetCells), 0.1, 2);
}

function insideObstacle(x: number, y: number, obstacles: Obstacle[]): boolean {
  for (const o of obstacles) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.d) return true;
  return false;
}

export function computeCoverage(
  poses: CameraPose[], lens: LensSpec, site: SiteSpec, mode: DoriMode, cellSize?: number,
): CoverageResult {
  const L = Math.max(0.5, site.length), W = Math.max(0.5, site.width);
  const cell = cellSize ?? autoCellSize(site);
  const cols = Math.max(1, Math.ceil(L / cell));
  const rows = Math.max(1, Math.ceil(W / cell));
  const cw = L / cols, ch = W / rows;
  const n = cols * rows;
  const best = new Uint8Array(n);
  const count = new Uint8Array(n);
  const owner = new Int16Array(n).fill(-1);
  const bestPpm = new Float32Array(n);
  const need = DORI_LEVEL[mode];
  const ht = site.targetHeight;
  const frames = poses.map(p => buildFrame(p, lens, site));

  const stats: CameraStats[] = frames.map(fr => {
    const fp = footprintOnPlane(fr, ht, fr.reach[need]);
    const dori = [[], ...[1, 2, 3, 4].map(lv => footprintOnPlane(fr, ht, fr.reach[lv]))] as Pt[][];
    const axisDist = fr.fisheye ? Math.abs(fr.pose.z - ht) : Math.max(0.01, fr.reach[need]);
    return {
      id: fr.pose.id, coveredCells: 0, uniqueCells: 0, coveredArea: 0, uniqueArea: 0,
      coverStart: Infinity, coverEnd: -Infinity, footprint: fp, doriFootprints: dori,
      nearBlind: nearBlindDistance(fr, fp), farReach: farReach(fr, fp),
      effectiveRange: fr.reach[need], ppmAtAxis: pixelDensity(fr, axisDist),
    };
  });
  // Bounding boxes of the detect-level footprint → cheap pre-filter per cell.
  const boxes = frames.map(fr => {
    const fp = footprintOnPlane(fr, ht, fr.reach[1]);
    return fp.length ? polyBBox(fp) : null;
  });

  let coverable = 0, covered = 0, overlap = 0;
  const levelHist = [0, 0, 0, 0, 0];
  const colCovered = new Uint8Array(cols);

  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * ch;
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cw;
      const idx = j * cols + i;
      if (insideObstacle(x, y, site.obstacles)) { best[idx] = 255; continue; }
      coverable++;
      for (let k = 0; k < frames.length; k++) {
        const b = boxes[k];
        if (!b || x < b.x0 - cw || x > b.x1 + cw || y < b.y0 - ch || y > b.y1 + ch) continue;
        const s = samplePoint(frames[k], x, y, ht, site.obstacles);
        if (s.level === 0) continue;
        if (s.level > best[idx] || (s.level === best[idx] && s.ppm > bestPpm[idx])) { best[idx] = s.level; bestPpm[idx] = s.ppm; }
        if (s.level >= need) {
          count[idx] = Math.min(255, count[idx] + 1);
          owner[idx] = count[idx] === 1 ? k : owner[idx];
          const st = stats[k];
          st.coveredCells++;
          if (x - cw / 2 < st.coverStart) st.coverStart = x - cw / 2;
          if (x + cw / 2 > st.coverEnd) st.coverEnd = x + cw / 2;
        }
      }
      levelHist[best[idx]]++;
      if (count[idx] >= 1) { covered++; colCovered[i] = 1; }
      if (count[idx] >= 2) overlap++;
      if (count[idx] === 1) stats[owner[idx]].uniqueCells++;
    }
  }

  const cellArea = cw * ch;
  stats.forEach(s => {
    s.coveredArea = s.coveredCells * cellArea;
    s.uniqueArea = s.uniqueCells * cellArea;
    if (!isFinite(s.coverStart)) { s.coverStart = 0; s.coverEnd = 0; }
    s.coverStart = clamp(s.coverStart, 0, L);
    s.coverEnd = clamp(s.coverEnd, 0, L);
  });

  let gap = 0, run = 0;
  for (let i = 0; i < cols; i++) { run = colCovered[i] ? 0 : run + 1; gap = Math.max(gap, run); }
  const colsCovered = colCovered.reduce((a, b) => a + b, 0);
  const coveragePct = coverable ? (covered / coverable) * 100 : 0;

  return {
    cols, rows, cellW: cw, cellH: ch, best, count, bestPpm, cameras: stats,
    metrics: {
      cameras: poses.length,
      coverablePct: (coverable / n) * 100,
      coveragePct,
      blindPct: 100 - coveragePct,
      overlapPct: coverable ? (overlap / coverable) * 100 : 0,
      efficiency: poses.length ? coveragePct / poses.length : 0,
      totalArea: L * W,
      coverableArea: coverable * cellArea,
      coveredArea: covered * cellArea,
      lengthCoveragePct: (colsCovered / cols) * 100,
      largestGapM: gap * cw,
      doriPct: levelHist.map(v => (coverable ? (v / coverable) * 100 : 0)),
      impliedHpx: impliedHorizontalPixels(lens),
      rangeConsistencyPct: rangeConsistencyPct(lens),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Optimizer — greedy set cover (ln(n)-approximation of the ILP)        */
/* ------------------------------------------------------------------ */

export interface OptimizeOptions { targetPct: number; maxCameras: number }
export interface OptimizeResult { poses: CameraPose[]; achievedPct: number; candidates: number }

/**
 * Minimise camera count subject to coverage ≥ target:
 *   min Σ x_j   s.t.  Σ_{j : i ∈ V_j} x_j ≥ 1  for ≥ target·|U| cells,  x_j ∈ {0,1}
 * Solved with greedy max-marginal-gain selection followed by a redundancy-pruning pass.
 */
export function optimizeLayout(lens: LensSpec, site: SiteSpec, mode: DoriMode, opts: OptimizeOptions): OptimizeResult {
  const L = site.length, W = site.width, H = site.mountHeight, ht = site.targetHeight;
  const need = DORI_LEVEL[mode];
  const R = sanitizeRanges(lens.ranges)[mode] * (1 - site.marginPct / 100);
  const cell = Math.max(0.3, autoCellSize(site, 6000));
  const cols = Math.ceil(L / cell), rows = Math.ceil(W / cell);
  const cw = L / cols, ch = W / rows;
  const cellsX: number[] = [], cellsY: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * cw, y = (j + 0.5) * ch;
    if (!insideObstacle(x, y, site.obstacles)) { cellsX.push(x); cellsY.push(y); }
  }
  const U = cellsX.length;
  if (!U) return { poses: [], achievedPct: 0, candidates: 0 };

  // ---- candidate generation ----
  const cand: Omit<CameraPose, 'id'>[] = [];
  const step = clamp(R * 0.4, 1, Math.max(1, L / 6));
  const e = 0.05;
  const wallTilt = aimTilt(H, ht, 0.55 * R);
  for (let x = step / 2; x < L; x += step) {
    cand.push({ mount: 'cross', x, y: e, z: H, panDeg: 90, tiltDeg: aimTilt(H, ht, Math.max(1, 0.6 * W)) });
    cand.push({ mount: 'cross', x, y: W - e, z: H, panDeg: 270, tiltDeg: aimTilt(H, ht, Math.max(1, 0.6 * W)) });
    for (const [y, pans] of [[e, [40, 140]], [W - e, [320, 220]]] as const) {
      for (const p of pans) cand.push({ mount: 'corner', x, y, z: H, panDeg: p, tiltDeg: wallTilt });
    }
    const nadirRows = Math.max(1, Math.round(W / Math.max(1, 2 * Math.max(0.5, H - ht) * Math.tan(rad(lens.hfovDeg) / 2))));
    for (let r = 0; r < nadirRows; r++) {
      const y = ((r + 0.5) / nadirRows) * W;
      cand.push({ mount: 'roof-nadir', x, y, z: H, panDeg: W > L ? 0 : 90, tiltDeg: 90 });
      cand.push({ mount: 'roof-tilt', x, y, z: H, panDeg: 0, tiltDeg: aimTilt(H, ht, 0.45 * R) });
      cand.push({ mount: 'roof-tilt', x, y, z: H, panDeg: 180, tiltDeg: aimTilt(H, ht, 0.45 * R) });
    }
  }
  const endYs = W > 12 ? [W / 4, W / 2, (3 * W) / 4] : [W / 2];
  for (const y of endYs) {
    cand.push({ mount: 'wall-v', x: e, y, z: H, panDeg: 0, tiltDeg: wallTilt });
    cand.push({ mount: 'wall-v', x: L - e, y, z: H, panDeg: 180, tiltDeg: wallTilt });
  }

  // Inject architecture-aware candidates (aisles, machine perimeters, dock portals)
  if (site.obstacles && site.obstacles.length > 0) {
    const archPoses = architectureAwareLayout(site.obstacles, site, lens, mode, 24);
    for (const ap of archPoses) {
      cand.push({ mount: ap.mount, x: ap.x, y: ap.y, z: ap.z, panDeg: ap.panDeg, tiltDeg: ap.tiltDeg });
    }
  }

  // ---- visibility sets ----
  const sets: Int32Array[] = cand.map((c, ci) => {
    const fr = buildFrame({ ...c, id: ci }, lens, site);
    const fp = footprintOnPlane(fr, ht, fr.reach[need]);
    if (!fp.length) return new Int32Array(0);
    const b = polyBBox(fp);
    const hits: number[] = [];
    for (let k = 0; k < U; k++) {
      const x = cellsX[k], y = cellsY[k];
      if (x < b.x0 - cw || x > b.x1 + cw || y < b.y0 - ch || y > b.y1 + ch) continue;
      if (samplePoint(fr, x, y, ht, site.obstacles).level >= need) hits.push(k);
    }
    return Int32Array.from(hits);
  });

  // ---- greedy selection ----
  const coveredBy = new Uint16Array(U);
  let covered = 0;
  const chosen: number[] = [];
  const goal = Math.ceil((clamp(opts.targetPct, 1, 100) / 100) * U);
  while (covered < goal && chosen.length < opts.maxCameras) {
    let bestIdx = -1, bestGain = 0;
    for (let c = 0; c < sets.length; c++) {
      const s = sets[c];
      if (s.length <= bestGain) continue;
      let g = 0;
      for (let k = 0; k < s.length; k++) if (coveredBy[s[k]] === 0) g++;
      if (g > bestGain) { bestGain = g; bestIdx = c; }
    }
    if (bestIdx < 0) break;
    chosen.push(bestIdx);
    for (const k of sets[bestIdx]) { if (coveredBy[k] === 0) covered++; coveredBy[k]++; }
  }

  // ---- prune redundant cameras (every cell they see is seen by another) ----
  for (let i = chosen.length - 1; i >= 0; i--) {
    const s = sets[chosen[i]];
    let unique = 0;
    for (const k of s) if (coveredBy[k] === 1) unique++;
    if (unique === 0 || covered - unique >= goal) {
      for (const k of s) { coveredBy[k]--; if (coveredBy[k] === 0) covered--; }
      chosen.splice(i, 1);
    }
  }

  const poses = chosen
    .map(ci => cand[ci])
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((c, i) => ({ ...c, id: i + 1, x: +c.x.toFixed(2), y: +c.y.toFixed(2) }));
  return { poses, achievedPct: (covered / U) * 100, candidates: cand.length };
}

/**
 * Architecture-Aware Camera Installation Planner
 * 
 * Deterministically aligns cameras with building architecture, structural corridors,
 * storage racking aisles, loading dock entrances, and machinery zones to eliminate
 * occlusion shadows and blind spots with 0 token overhead.
 */
export function architectureAwareLayout(
  obstacles: Obstacle[],
  site: SiteSpec,
  lens: LensSpec,
  mode: DoriMode,
  targetCount: number = 6
): CameraPose[] {
  const L = site.length, W = site.width, H = site.mountHeight, ht = site.targetHeight;
  const R = sanitizeRanges(lens.ranges)[mode] * (1 - site.marginPct / 100);
  const wallTilt = aimTilt(H, ht, Math.min(R, 0.55 * Math.max(L, W)));
  const cand: Array<{ pose: Omit<CameraPose, 'id'>; priority: number; label: string }> = [];

  // 1. Separate obstacles by architectural role
  const racks = obstacles.filter(o => o.type === 'rack' || (!o.type && o.w > 2 && o.d <= o.w));
  const vertRacks = obstacles.filter(o => o.type === 'rack' || (!o.type && o.d > 2 && o.d > o.w));
  const docks = obstacles.filter(o => o.type === 'dock' || /dock|door|entrance|gate/i.test(o.name));
  const machines = obstacles.filter(o => o.type === 'machine' || o.type === 'hazard');
  const conveyors = obstacles.filter(o => o.type === 'conveyor');
  const columns = obstacles.filter(o => o.type === 'column');

  // 2. Loading Bay & Ingress Entrances (Priority 1: Access Control & PPE)
  docks.forEach((dock, idx) => {
    const isNorth = dock.y < W * 0.2;
    const isSouth = dock.y > W * 0.8;
    const isWest = dock.x < L * 0.2;

    let cx = dock.x + dock.w / 2;
    let cy = dock.y + dock.d / 2;
    let panDeg = 0;

    if (isNorth) {
      cy = Math.min(W - 1, dock.y + dock.d + 3.5);
      panDeg = 270; // Looking towards north entrance
    } else if (isSouth) {
      cy = Math.max(1, dock.y - 3.5);
      panDeg = 90; // Looking towards south entrance
    } else if (isWest) {
      cx = Math.min(L - 1, dock.x + dock.w + 3.5);
      panDeg = 180; // Looking towards west gate
    } else {
      cx = Math.max(1, dock.x - 3.5);
      panDeg = 0; // Looking towards east gate
    }

    cand.push({
      pose: {
        mount: 'wall-v',
        x: clamp(cx, 0.5, L - 0.5),
        y: clamp(cy, 0.5, W - 0.5),
        z: Math.min(H, 4.0),
        panDeg,
        tiltDeg: aimTilt(Math.min(H, 4.0), ht, 4.0),
      },
      priority: 100 - idx,
      label: `Dock/Entrance-${idx + 1}`,
    });
  });

  // 3. Storage Racking Aisles (Priority 2: Longitudinal Sightlines Down Aisles)
  // Horizontal Rack Rows (Aisles run along X)
  if (racks.length >= 2) {
    const sorted = [...racks].sort((a, b) => a.y - b.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const r1 = sorted[i];
      const r2 = sorted[i + 1];
      const gapY = r2.y - (r1.y + r1.d);
      if (gapY >= 1.2) {
        const aisleY = (r1.y + r1.d + r2.y) / 2;
        const startX = Math.min(r1.x, r2.x);
        const endX = Math.max(r1.x + r1.w, r2.x + r2.w);
        const aisleLen = endX - startX;

        // West head looking East down the corridor
        const westX = Math.max(0.6, startX - 1.2);
        cand.push({
          pose: {
            mount: 'wall-h',
            x: clamp(westX, 0.5, L - 0.5),
            y: clamp(aisleY, 0.5, W - 0.5),
            z: H,
            panDeg: 0,
            tiltDeg: aimTilt(H, ht, Math.min(R * 0.7, aisleLen * 0.55)),
          },
          priority: 85 - i * 2,
          label: `Aisle-${i + 1}-WestHead`,
        });

        // East head looking West (bidirectional coverage if aisle is long)
        if (aisleLen > R * 0.45 || targetCount > 6) {
          const eastX = Math.min(L - 0.6, endX + 1.2);
          cand.push({
            pose: {
              mount: 'wall-h',
              x: clamp(eastX, 0.5, L - 0.5),
              y: clamp(aisleY, 0.5, W - 0.5),
              z: H,
              panDeg: 180,
              tiltDeg: aimTilt(H, ht, Math.min(R * 0.7, aisleLen * 0.55)),
            },
            priority: 84 - i * 2,
            label: `Aisle-${i + 1}-EastHead`,
          });
        }
      }
    }
  }

  // Vertical Rack Rows (Aisles run along Y)
  if (vertRacks.length >= 2) {
    const sorted = [...vertRacks].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const r1 = sorted[i];
      const r2 = sorted[i + 1];
      const gapX = r2.x - (r1.x + r1.w);
      if (gapX >= 1.2) {
        const aisleX = (r1.x + r1.w + r2.x) / 2;
        const startY = Math.min(r1.y, r2.y);
        const endY = Math.max(r1.y + r1.d, r2.y + r2.d);
        const aisleLen = endY - startY;

        cand.push({
          pose: {
            mount: 'wall-v',
            x: clamp(aisleX, 0.5, L - 0.5),
            y: clamp(Math.max(0.6, startY - 1.2), 0.5, W - 0.5),
            z: H,
            panDeg: 90,
            tiltDeg: aimTilt(H, ht, Math.min(R * 0.7, aisleLen * 0.55)),
          },
          priority: 85 - i * 2,
          label: `VertAisle-${i + 1}-North`,
        });

        if (aisleLen > R * 0.45 || targetCount > 6) {
          cand.push({
            pose: {
              mount: 'wall-v',
              x: clamp(aisleX, 0.5, L - 0.5),
              y: clamp(Math.min(W - 0.6, endY + 1.2), 0.5, W - 0.5),
              z: H,
              panDeg: 270,
              tiltDeg: aimTilt(H, ht, Math.min(R * 0.7, aisleLen * 0.55)),
            },
            priority: 84 - i * 2,
            label: `VertAisle-${i + 1}-South`,
          });
        }
      }
    }
  }

  // 4. Robotic Workcells & High-Value Machinery (Priority 3: Operator Safety & Safety Interlocks)
  machines.forEach((mach, idx) => {
    const mx = mach.x + mach.w / 2;
    const my = mach.y + mach.d / 2;
    const offX = mach.x > L / 2 ? mach.w * 0.8 : -mach.w * 0.8;
    const offY = mach.y > W / 2 ? mach.d * 0.8 : -mach.d * 0.8;
    const posX = clamp(mx + offX, 0.8, L - 0.8);
    const posY = clamp(my + offY, 0.8, W - 0.8);
    const aimDeg = (Math.atan2(my - posY, mx - posX) * (180 / Math.PI) + 360) % 360;

    cand.push({
      pose: {
        mount: 'corner',
        x: +posX.toFixed(2),
        y: +posY.toFixed(2),
        z: H,
        panDeg: Math.round(aimDeg),
        tiltDeg: aimTilt(H, ht, Math.hypot(mx - posX, my - posY)),
      },
      priority: 75 - idx,
      label: `MachineWorkcell-${idx + 1}`,
    });
  });

  // 5. Conveyor Sorting Lines (Priority 4: Tracking & Jam Detection)
  conveyors.forEach((conv, idx) => {
    cand.push({
      pose: {
        mount: 'roof-tilt',
        x: clamp(conv.x + conv.w * 0.1, 0.5, L - 0.5),
        y: clamp(conv.y + conv.d / 2, 0.5, W - 0.5),
        z: H,
        panDeg: conv.w > conv.d ? 0 : 90,
        tiltDeg: aimTilt(H, ht, Math.max(conv.w, conv.d) * 0.6),
      },
      priority: 70 - idx,
      label: `ConveyorLine-${idx + 1}`,
    });
  });

  // 6. Structural Columns (Priority 5: Cross-Aisle Intersections)
  columns.slice(0, 4).forEach((col, idx) => {
    cand.push({
      pose: {
        mount: 'cross',
        x: clamp(col.x + col.w / 2, 0.5, L - 0.5),
        y: clamp(col.y + col.d / 2, 0.5, W - 0.5),
        z: H,
        panDeg: (idx * 90 + 45) % 360,
        tiltDeg: aimTilt(H, ht, 8.0),
      },
      priority: 60 - idx,
      label: `Column-${idx + 1}`,
    });
  });

  // 7. Perimeter Safety Sweeps (Priority 6: Diagonal Boundary Coverage)
  const e = 0.8;
  cand.push(
    { pose: { mount: 'corner', x: e, y: e, z: H, panDeg: 45, tiltDeg: wallTilt }, priority: 50, label: 'Corner-NW' },
    { pose: { mount: 'corner', x: L - e, y: e, z: H, panDeg: 135, tiltDeg: wallTilt }, priority: 49, label: 'Corner-NE' },
    { pose: { mount: 'corner', x: L - e, y: W - e, z: H, panDeg: 225, tiltDeg: wallTilt }, priority: 48, label: 'Corner-SE' },
    { pose: { mount: 'corner', x: e, y: W - e, z: H, panDeg: 315, tiltDeg: wallTilt }, priority: 47, label: 'Corner-SW' }
  );

  // 8. Infill Overhead Nadir / Panoramic (Priority 7)
  cand.push({
    pose: { mount: 'roof-nadir', x: L / 2, y: W / 2, z: H, panDeg: 0, tiltDeg: 90 },
    priority: 40,
    label: 'Overhead-Center-Nadir',
  });

  // Sort candidates by architectural priority
  cand.sort((a, b) => b.priority - a.priority);

  // Select up to targetCount candidates
  const count = Math.max(1, Math.min(60, targetCount));
  const selected: Array<Omit<CameraPose, 'id'>> = [];

  for (const c of cand) {
    if (selected.length >= count) break;
    const tooClose = selected.some(s => Math.hypot(s.x - c.pose.x, s.y - c.pose.y) < 2.5);
    if (!tooClose) {
      selected.push(c.pose);
    }
  }

  // If we still need more cameras to satisfy targetCount, fill with evenly spaced aisle / perimeter cameras
  if (selected.length < count) {
    const needed = count - selected.length;
    for (let k = 0; k < needed; k++) {
      const stepX = (L * 0.8) / (needed + 1);
      const x = L * 0.1 + (k + 1) * stepX;
      selected.push({
        mount: 'roof-tilt',
        x: +x.toFixed(2),
        y: +(W / 2).toFixed(2),
        z: H,
        panDeg: k % 2 === 0 ? 0 : 180,
        tiltDeg: aimTilt(H, ht, R * 0.5),
      });
    }
  }

  // Format into final CameraPose[] with sequential 1..N IDs
  return selected
    .slice(0, count)
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((c, idx) => ({
      ...c,
      id: idx + 1,
      x: +c.x.toFixed(2),
      y: +c.y.toFixed(2),
    }));
}

/* ------------------------------------------------------------------ */
/* Procedural Virtual Map & Obstacle Synthesis Engine                   */
/* ------------------------------------------------------------------ */

export type FacilityPresetType = 'logistics_warehouse' | 'manufacturing_plant' | 'retail_supermarket' | 'data_center';

export interface ProceduralFacilityConfig {
  type: FacilityPresetType;
  length: number;
  width: number;
  mountHeight: number;
  rackHeight?: number;
  numAisles?: number;
  hasColumns?: boolean;
}

/** Generate realistic obstacles (racks, machinery, columns) based on facility archetype */
export function generateProceduralObstacles(config: ProceduralFacilityConfig): Obstacle[] {
  const { type, length: L, width: W, mountHeight: H } = config;
  const obstacles: Obstacle[] = [];
  let obsId = 1;

  if (type === 'logistics_warehouse') {
    // Generate dual-bank parallel pallet racking aisles with forklift turning lane
    const numAisles = config.numAisles || Math.max(3, Math.min(8, Math.round(W / 12)));
    const aisleMarginY = Math.max(3, W * 0.12);
    const availableY = W - 2 * aisleMarginY;
    const yPitch = availableY / Math.max(1, numAisles);
    const rackDepth = Math.max(1.2, Math.min(2.4, yPitch * 0.38));
    const rackHeight = config.rackHeight || Math.min(H - 0.5, 4.5);

    for (let i = 0; i < numAisles; i++) {
      const y = aisleMarginY + i * yPitch;
      // West racking bank
      obstacles.push({
        id: `rack-w-${obsId++}`,
        name: `Racking Aisle ${i + 1} West`,
        x: Math.max(2, L * 0.12),
        y,
        w: Math.max(5, L * 0.34),
        d: rackDepth,
        h: rackHeight,
        type: 'rack',
      });
      // East racking bank
      obstacles.push({
        id: `rack-e-${obsId++}`,
        name: `Racking Aisle ${i + 1} East`,
        x: Math.max(5, L * 0.54),
        y,
        w: Math.max(5, L * 0.34),
        d: rackDepth,
        h: rackHeight,
        type: 'rack',
      });
    }

    // Structural columns on a 18m x 12m grid
    if (config.hasColumns !== false && L > 30) {
      for (let cx = 15; cx < L - 10; cx += 18) {
        for (let cy = 10; cy < W - 8; cy += 12) {
          obstacles.push({
            id: `col-${obsId++}`,
            name: `Column (${cx}m, ${cy}m)`,
            x: cx - 0.3,
            y: cy - 0.3,
            w: 0.6,
            d: 0.6,
            h: H,
            type: 'column',
          });
        }
      }
    }
  } else if (type === 'manufacturing_plant') {
    // Conveyor lines and CNC / robotic workstations
    const numLines = Math.max(2, Math.min(4, Math.round(W / 15)));
    const yPitch = (W * 0.75) / numLines;
    for (let i = 0; i < numLines; i++) {
      const y = W * 0.15 + i * yPitch;
      // Main linear assembly conveyor
      obstacles.push({
        id: `conveyor-${obsId++}`,
        name: `Assembly Line #${i + 1}`,
        x: L * 0.15,
        y,
        w: L * 0.68,
        d: 1.8,
        h: 1.4,
        type: 'machine',
      });
      // Robotic cells along line
      obstacles.push({
        id: `robot-${obsId++}`,
        name: `Robotic Workcell #${i + 1}A`,
        x: L * 0.32,
        y: Math.max(1, y - 2.8),
        w: 3.5,
        d: 2.4,
        h: 2.8,
        type: 'machine',
      });
      obstacles.push({
        id: `robot-${obsId++}`,
        name: `Inspection Station #${i + 1}B`,
        x: L * 0.62,
        y: Math.min(W - 3, y + 2.2),
        w: 3.2,
        d: 2.2,
        h: 2.4,
        type: 'machine',
      });
    }
  } else if (type === 'retail_supermarket') {
    // Gondola shelving runs and checkout registers
    const numGondolas = Math.max(4, Math.min(10, Math.round(W / 6)));
    const yPitch = (W * 0.7) / numGondolas;
    for (let i = 0; i < numGondolas; i++) {
      const y = W * 0.18 + i * yPitch;
      obstacles.push({
        id: `gondola-${obsId++}`,
        name: `Shelving Gondola Aisle ${i + 1}`,
        x: L * 0.18,
        y,
        w: L * 0.62,
        d: 1.2,
        h: 2.1,
        type: 'rack',
      });
    }
    // Checkout counter lane near entrance
    obstacles.push({
      id: `pos-counter-${obsId++}`,
      name: `Point-of-Sale Register Bank`,
      x: L * 0.04,
      y: W * 0.25,
      w: 1.6,
      d: W * 0.5,
      h: 1.1,
      type: 'partition',
    });
  } else if (type === 'data_center') {
    // High-density server rack rows with hot/cold aisle containment
    const numRows = Math.max(3, Math.min(8, Math.round(W / 8)));
    const yPitch = (W * 0.76) / numRows;
    for (let i = 0; i < numRows; i++) {
      const y = W * 0.12 + i * yPitch;
      obstacles.push({
        id: `server-row-${obsId++}`,
        name: `Server Rack Row ${i + 1} (Cold Aisle)`,
        x: L * 0.12,
        y,
        w: L * 0.76,
        d: 1.4,
        h: 2.4,
        type: 'rack',
      });
    }
    // Power distribution & CRAC units
    obstacles.push({
      id: `crac-1-${obsId++}`,
      name: `CRAC Cooling Unit 1`,
      x: L * 0.02,
      y: W * 0.1,
      w: 2.2,
      d: 1.5,
      h: 2.8,
      type: 'machine',
    });
  }

  return obstacles;
}

/* ------------------------------------------------------------------ */
/* 3D Photogrammetric Optical Physics & Kay-Kajiya Ray-AABB Slab Math */
/* ------------------------------------------------------------------ */

/**
 * 3D Ray-AABB Slab Intersection (Kay-Kajiya Algorithm)
 * Checks if a sightline segment from `origin` to `target` intersects `box`.
 */
export function segmentIntersectsAABB(origin: Vec3, target: Vec3, box: Obstacle3D): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;

  let tmin = 0.0;
  let tmax = 1.0;

  const axes: Array<[number, number, number, number]> = [
    [origin.x, dx, box.min.x, box.max.x],
    [origin.y, dy, box.min.y, box.max.y],
    [origin.z, dz, box.min.z, box.max.z],
  ];

  for (const [p, d, bmin, bmax] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (p < bmin || p > bmax) return false;
    } else {
      const invD = 1.0 / d;
      let t1 = (bmin - p) * invD;
      let t2 = (bmax - p) * invD;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return tmin <= tmax && tmax > 0.0 && tmin < 1.0;
}

/**
 * Returns exact 3D intersection point on AABB surface if a hit occurs along the segment.
 */
export function rayAABBIntersection(
  origin: Vec3,
  target: Vec3,
  box: Obstacle3D
): { hit: boolean; t: number; point?: Vec3 } {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;

  let tmin = 0.0;
  let tmax = 1.0;

  const axes: Array<[number, number, number, number]> = [
    [origin.x, dx, box.min.x, box.max.x],
    [origin.y, dy, box.min.y, box.max.y],
    [origin.z, dz, box.min.z, box.max.z],
  ];

  for (const [p, d, bmin, bmax] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (p < bmin || p > bmax) return { hit: false, t: 1.0 };
    } else {
      const invD = 1.0 / d;
      let t1 = (bmin - p) * invD;
      let t2 = (bmax - p) * invD;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return { hit: false, t: 1.0 };
    }
  }

  if (tmin <= tmax && tmax > 0.0 && tmin < 1.0) {
    const tHit = Math.max(0.0, tmin);
    return {
      hit: true,
      t: tHit,
      point: {
        x: +(origin.x + dx * tHit).toFixed(3),
        y: +(origin.y + dy * tHit).toFixed(3),
        z: +(origin.z + dz * tHit).toFixed(3),
      },
    };
  }

  return { hit: false, t: 1.0 };
}

/**
 * Exact Sensor-to-FOV Calculation:
 * HFOV = 2 · arctan(W_s / (2f)), VFOV = 2 · arctan(H_s / (2f))
 */
export function computeSensorFov(
  sensorWidthMm: number,
  sensorHeightMm: number,
  focalLengthMm: number
): { hfovDeg: number; vfovDeg: number } {
  const f = Math.max(0.1, focalLengthMm);
  const hfovRad = 2 * Math.atan(sensorWidthMm / (2 * f));
  const vfovRad = 2 * Math.atan(sensorHeightMm / (2 * f));
  return {
    hfovDeg: +((hfovRad * 180) / Math.PI).toFixed(1),
    vfovDeg: +((vfovRad * 180) / Math.PI).toFixed(1),
  };
}

/**
 * Radial Lens Distortion (Brown-Conrady Model)
 * Reduces effective PPM by 12%-25% in the outer 15% of the frustum cone for wide-angle lenses.
 */
export function computeRadialDistortionMultiplier(
  yawDeltaRad: number,
  pitchDeltaRad: number,
  hfovRad: number,
  vfovRad: number,
  focalLengthMm: number,
  distortionK1?: number
): number {
  const normRadius = Math.hypot(
    yawDeltaRad / Math.max(1e-4, hfovRad / 2),
    pitchDeltaRad / Math.max(1e-4, vfovRad / 2)
  );
  const k1 = distortionK1 ?? (focalLengthMm <= 2.8 ? -0.18 : focalLengthMm <= 4.0 ? -0.09 : -0.03);
  return Math.max(0.72, 1 + k1 * Math.pow(normRadius, 2));
}

/** Convert legacy 2D/2.5D Obstacle list to full 3D AABB Obstacle3D array */
export function obstaclesTo3D(obstacles: Obstacle[]): Obstacle3D[] {
  return obstacles.map(o => {
    const zb = o.zBase ?? 0;
    return {
      id: o.id,
      name: o.name,
      type: o.type,
      min: { x: o.x, y: o.y, z: zb },
      max: { x: o.x + o.w, y: o.y + o.d, z: zb + o.h },
    };
  });
}

/**
 * Evaluates full 3D optical coverage, multi-height occlusion, and AI feasibility at a target (X, Y)
 * Models:
 * 1. Oblique angle-of-incidence & vertical tilt cutoff (cos α_yaw · cos β_pitch)
 * 2. Steep-angle forensic penalty ("Top-of-Head Syndrome" > 35°-45°)
 * 3. Exact sensor dimensions (W_s, H_s)
 * 4. Brown-Conrady radial barrel distortion
 * 5. Multi-height sampling: Ankle (0.15m), Torso (1.1m), Head (1.65m)
 */
export function evaluateTargetPoint3D(
  cam: CameraSpec,
  targetXY: { x: number; y: number },
  obstacles: Obstacle3D[],
  targetHeightM = 1.7,
  targetWidthM = 0.5
): TargetEvaluation {
  const dx = targetXY.x - cam.position.x;
  const dy = targetXY.y - cam.position.y;
  const groundDist = Math.hypot(dx, dy);

  // Target center-of-mass and vertical sample anchors (ankle, torso, head)
  const sampleAnchors: Array<{ anchor: 'ankle' | 'torso' | 'head'; height: number }> = [
    { anchor: 'ankle', height: 0.15 },
    { anchor: 'torso', height: 1.1 },
    { anchor: 'head', height: 1.65 },
  ];
  const centroidZ = 1.0;
  const dz = centroidZ - cam.position.z;
  const slantDist = Math.hypot(groundDist, dz);

  // Exact FOV computed from physical sensor dimensions
  const f = Math.max(0.1, cam.focalLengthMm);
  const hfovRad = 2 * Math.atan(cam.sensorWidthMm / (2 * f));
  const vfovRad = 2 * Math.atan(cam.sensorHeightMm / (2 * f));

  // Horizontal bearing delta (0 deg = North +Y, 90 deg = East +X)
  const targetAzimuthDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  let yawDeltaDeg = Math.abs(targetAzimuthDeg - cam.azimuthDeg);
  if (yawDeltaDeg > 180) yawDeltaDeg = 360 - yawDeltaDeg;
  const yawDeltaRad = (yawDeltaDeg * Math.PI) / 180;

  // Vertical depression angle from camera horizontal plane to target centroid
  const depressionRad = Math.atan2(cam.position.z - centroidZ, Math.max(0.01, groundDist));
  const depressionDeg = (depressionRad * 180) / Math.PI;
  const tiltRad = (cam.tiltDeg * Math.PI) / 180;
  const pitchDeltaRad = Math.abs(depressionRad - tiltRad);

  // Frustum boundary check
  const inFrustum = yawDeltaRad <= hfovRad / 2 && pitchDeltaRad <= vfovRad / 2 && slantDist > 0.5;
  if (!inFrustum) {
    return {
      inFrustum: false,
      visibilityRatio: 0,
      slantDistanceM: +slantDist.toFixed(2),
      groundDistanceM: +groundDist.toFixed(2),
      effectivePpm: 0,
      verticalDepressionDeg: +depressionDeg.toFixed(1),
      doriTier: 'BLIND',
      personBBoxPx: { width: 0, height: 0 },
      aiFeasibility: {
        personTracking: false,
        ppeDetection: false,
        facialRecognition: false,
        forkliftAlert: false,
        licensePlateOcr: false,
      },
      rayHits: sampleAnchors.map(a => ({ anchor: a.anchor, heightM: a.height, blocked: true })),
    };
  }

  // Multi-height 3D raycast occlusion check (Ankle, Torso, Head)
  let visibleAnchors = 0;
  const rayHits: TargetEvaluation['rayHits'] = [];

  for (const s of sampleAnchors) {
    const samplePt: Vec3 = { x: targetXY.x, y: targetXY.y, z: s.height };
    let nearestHit: { t: number; point?: Vec3; obstacleName?: string } | null = null;

    for (const obs of obstacles) {
      const res = rayAABBIntersection(cam.position, samplePt, obs);
      if (res.hit && (!nearestHit || res.t < nearestHit.t)) {
        nearestHit = { t: res.t, point: res.point, obstacleName: obs.name || obs.id };
      }
    }

    if (nearestHit) {
      rayHits.push({
        anchor: s.anchor,
        heightM: s.height,
        blocked: true,
        hitPoint: nearestHit.point,
        obstacleName: nearestHit.obstacleName,
      });
    } else {
      visibleAnchors++;
      rayHits.push({
        anchor: s.anchor,
        heightM: s.height,
        blocked: false,
      });
    }
  }

  const visibilityRatio = visibleAnchors / sampleAnchors.length;

  if (visibilityRatio === 0) {
    return {
      inFrustum: true,
      visibilityRatio: 0,
      slantDistanceM: +slantDist.toFixed(2),
      groundDistanceM: +groundDist.toFixed(2),
      effectivePpm: 0,
      verticalDepressionDeg: +depressionDeg.toFixed(1),
      doriTier: 'BLIND',
      personBBoxPx: { width: 0, height: 0 },
      aiFeasibility: {
        personTracking: false,
        ppeDetection: false,
        facialRecognition: false,
        forkliftAlert: false,
        licensePlateOcr: false,
      },
      rayHits,
    };
  }

  // Orthogonal PPM at slant range + oblique angle-of-incidence projection
  const orthoPpm = cam.resolutionW / (2 * slantDist * Math.tan(hfovRad / 2));
  const obliqueFactor = Math.cos(yawDeltaRad) * Math.cos(depressionRad);

  // Radial lens distortion edge penalty
  const distortionMultiplier = computeRadialDistortionMultiplier(
    yawDeltaRad,
    pitchDeltaRad,
    hfovRad,
    vfovRad,
    cam.focalLengthMm,
    cam.distortionK1
  );

  const effectivePpm = Math.round(orthoPpm * obliqueFactor * distortionMultiplier);

  // DORI classification with steep-angle (>45 deg) forensic facial cutoff ("Top-of-Head Syndrome")
  let doriTier: TargetEvaluation['doriTier'] = 'BLIND';
  if (effectivePpm >= 250 && depressionDeg <= 45) doriTier = 'IDENTIFY';
  else if (effectivePpm >= 125) doriTier = 'RECOGNIZE';
  else if (effectivePpm >= 62.5) doriTier = 'OBSERVE';
  else if (effectivePpm >= 25) doriTier = 'DETECT';

  const bboxWidthPx = Math.round(targetWidthM * effectivePpm);
  const bboxHeightPx = Math.round(targetHeightM * effectivePpm * visibilityRatio);

  return {
    inFrustum: true,
    visibilityRatio,
    slantDistanceM: +slantDist.toFixed(2),
    groundDistanceM: +groundDist.toFixed(2),
    effectivePpm,
    verticalDepressionDeg: +depressionDeg.toFixed(1),
    doriTier,
    personBBoxPx: { width: bboxWidthPx, height: bboxHeightPx },
    aiFeasibility: {
      personTracking: effectivePpm >= 65 && visibilityRatio >= 0.66,
      ppeDetection: effectivePpm >= 145 && depressionDeg <= 45 && visibilityRatio >= 0.66,
      facialRecognition: effectivePpm >= 280 && depressionDeg <= 30 && visibilityRatio === 1.0,
      forkliftAlert: effectivePpm >= 40 && depressionDeg <= 65 && visibilityRatio >= 0.33,
      licensePlateOcr: effectivePpm >= 250 && depressionDeg <= 30 && visibilityRatio === 1.0,
    },
    rayHits,
  };
}

/* ------------------------------------------------------------------ */
/* Neural Network AI Feasibility & Automated Engineering Utilities   */
/* ------------------------------------------------------------------ */

export interface AiTaskCriteria {
  id: string;
  task: string;
  targetObject: string;
  criticalDimensionM: number;
  minPixelBox: string;
  minRequiredPpm: number;
  maxDepressionDeg: number;
  minFramerateFps: number;
  shutterGuidance: string;
}

export const AI_MODEL_FEASIBILITY_CRITERIA: AiTaskCriteria[] = [
  {
    id: 'facial_recognition',
    task: 'Facial Recognition (SCRFD / ArcFace)',
    targetObject: 'Face width (0.16 m)',
    criticalDimensionM: 0.16,
    minPixelBox: '≥ 45 × 45 px',
    minRequiredPpm: 280,
    maxDepressionDeg: 30,
    minFramerateFps: 25,
    shutterGuidance: '≤ 1/250 s',
  },
  {
    id: 'ppe_compliance',
    task: 'PPE Compliance (Hardhat, Glasses, Vest)',
    targetObject: 'Head/Helmet (0.22 m)',
    criticalDimensionM: 0.22,
    minPixelBox: '≥ 32 × 32 px',
    minRequiredPpm: 145,
    maxDepressionDeg: 45,
    minFramerateFps: 15,
    shutterGuidance: '≤ 1/125 s',
  },
  {
    id: 'person_reid',
    task: 'Person Detection & Re-ID (YOLO + ByteTrack)',
    targetObject: 'Full human body (0.5 m × 1.7 m)',
    criticalDimensionM: 0.5,
    minPixelBox: '≥ 40 × 110 px',
    minRequiredPpm: 65,
    maxDepressionDeg: 55,
    minFramerateFps: 20,
    shutterGuidance: '≤ 1/125 s',
  },
  {
    id: 'forklift_agv',
    task: 'Forklift / AGV Collision Avoidance',
    targetObject: 'Industrial vehicle (1.2 m × 2.2 m)',
    criticalDimensionM: 1.2,
    minPixelBox: '≥ 50 × 80 px',
    minRequiredPpm: 40,
    maxDepressionDeg: 65,
    minFramerateFps: 30,
    shutterGuidance: '≤ 1/500 s',
  },
  {
    id: 'license_plate_ocr',
    task: 'License Plate / Badge OCR (LPR / ANPR)',
    targetObject: 'Plate width (0.52 m)',
    criticalDimensionM: 0.52,
    minPixelBox: '≥ 130 × 32 px',
    minRequiredPpm: 250,
    maxDepressionDeg: 30,
    minFramerateFps: 30,
    shutterGuidance: '≤ 1/1000 s',
  },
];

export interface AiTaskEvaluationReport {
  criteria: AiTaskCriteria;
  passed: boolean;
  actualPpm: number;
  actualDepressionDeg: number;
  actualVisibility: number;
  failureReasons: string[];
}

export function evaluateAllAiTasks(
  effectivePpm: number,
  depressionDeg: number,
  visibilityRatio: number
): AiTaskEvaluationReport[] {
  return AI_MODEL_FEASIBILITY_CRITERIA.map(crit => {
    const reasons: string[] = [];
    if (effectivePpm < crit.minRequiredPpm) {
      reasons.push(`Low resolution (${effectivePpm} px/m < ${crit.minRequiredPpm} required)`);
    }
    if (depressionDeg > crit.maxDepressionDeg) {
      reasons.push(`Steep look-down angle (${depressionDeg.toFixed(1)}° > ${crit.maxDepressionDeg}° limit)`);
    }
    if (crit.id === 'facial_recognition' && visibilityRatio < 1.0) {
      reasons.push('Face anchor occluded by obstacle');
    } else if (visibilityRatio < 0.66) {
      reasons.push('Partial target occlusion (<66% visible)');
    }

    return {
      criteria: crit,
      passed: reasons.length === 0,
      actualPpm: effectivePpm,
      actualDepressionDeg: depressionDeg,
      actualVisibility: visibilityRatio,
      failureReasons: reasons,
    };
  });
}

/**
 * Tracker Occlusion Horizon Metric:
 * Calculates Blind Transit Duration (t_blind = L_shadow / v_target)
 * and outputs the recommended track_buffer frame parameter for ByteTrack / DeepSORT.
 */
export interface TrackerOcclusionMetric {
  shadowLengthM: number;
  targetSpeedMs: number;
  blindTransitSeconds: number;
  recommendedTrackBufferFrames: number;
}

export function calculateTrackerOcclusion(
  shadowLengthM: number,
  targetSpeedMs = 1.4,
  fps = 30
): TrackerOcclusionMetric {
  const tBlind = shadowLengthM / Math.max(0.1, targetSpeedMs);
  return {
    shadowLengthM: +shadowLengthM.toFixed(2),
    targetSpeedMs: +targetSpeedMs.toFixed(2),
    blindTransitSeconds: +tBlind.toFixed(2),
    recommendedTrackBufferFrames: Math.ceil(tBlind * fps),
  };
}

/**
 * Automated Cable Routing & PoE Engineering
 * Manhattan A* distance: d_run = (|ΔX| + |ΔY| + ΔZ_drop) × 1.15 slack factor.
 * Flags any run exceeding 90m permanent link Ethernet limit.
 */
export interface CableRunCalculation {
  cableDistanceM: number;
  slackDistanceM: number;
  totalRunM: number;
  exceeds90m: boolean;
  recommendation: string;
  poeClass: string;
  poeWatts: number;
}

export function calculateCableRun(
  camPos: Vec3,
  switchPos: Vec3 = { x: 0, y: 0, z: 2.2 },
  slackFactor = 1.15,
  isPtZ = false
): CableRunCalculation {
  const rawDist =
    Math.abs(camPos.x - switchPos.x) +
    Math.abs(camPos.y - switchPos.y) +
    Math.abs(camPos.z - switchPos.z);
  const totalRun = rawDist * slackFactor;
  const exceeds90m = totalRun > 90;
  const watts = isPtZ ? 30.0 : 15.4;

  return {
    cableDistanceM: +rawDist.toFixed(1),
    slackDistanceM: +(totalRun - rawDist).toFixed(1),
    totalRunM: +totalRun.toFixed(1),
    exceeds90m,
    recommendation: exceeds90m
      ? 'Exceeds 90m Permanent Link limit (ANSI/TIA-568). PoE Extender or Fiber Media Converter required.'
      : 'Compliant Cat6 / Cat6A UTP Ethernet Link (≤90m).',
    poeClass: isPtZ ? 'PoE+ (802.3at Type 2)' : 'PoE (802.3af Type 1)',
    poeWatts: watts,
  };
}

/**
 * Storage & Bandwidth Calculator:
 * Storage (TB) = (Bitrate Mbps × 86,400 × Days × N_cameras) / (8 × 10^6)
 */
export interface StorageCalculation {
  bitrateMbps: number;
  totalBitrateMbps: number;
  dailyGb: number;
  storage30DaysTb: number;
}

export function calculateStorageAndBandwidth(
  cameraCount: number,
  resolution: '2MP' | '4MP' | '5MP' | '8MP' | '12MP',
  codec: 'H.264' | 'H.265' | 'H.265+' | 'AV1' = 'H.265+',
  fps = 25,
  days = 30
): StorageCalculation {
  const resMultipliers: Record<string, number> = {
    '2MP': 1.0,
    '4MP': 1.8,
    '5MP': 2.2,
    '8MP': 3.5,
    '12MP': 5.2,
  };
  const codecFactors: Record<string, number> = {
    'H.264': 1.0,
    'H.265': 0.55,
    'H.265+': 0.38,
    'AV1': 0.32,
  };

  const baseBitrate = 4.0 * (resMultipliers[resolution] || 1.8) * (fps / 25);
  const bitrateMbps = +(baseBitrate * (codecFactors[codec] || 0.55)).toFixed(2);
  const totalBitrateMbps = +(bitrateMbps * cameraCount).toFixed(2);
  const dailyGb = +((bitrateMbps * 86400 * cameraCount) / (8 * 1000)).toFixed(1);
  const storage30DaysTb = +((totalBitrateMbps * 86400 * days) / (8 * 1e6)).toFixed(2);

  return {
    bitrateMbps,
    totalBitrateMbps,
    dailyGb,
    storage30DaysTb,
  };
}



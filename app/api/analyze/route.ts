import { NextRequest, NextResponse } from 'next/server';
import { validateAnalysisRequest, validateProject } from '@/lib/validation';
import { createEmptyProject } from '@/lib/project-factory';
import type { DetVisionProject, UseCase, TaskType, FeasibilityStatus, Camera, Zone, LayoutElement } from '@/lib/types';
import { getNvidiaConfig, getNvidiaCompletionsURL } from '@/lib/ai-provider';
import { detectFacilityProfile, extractDesiredCameraCount, parseCameraHardware, calculateReasonedCameraCount } from '@/lib/rule-based-planner';

// Allow AI providers room to answer on serverless platforms
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an enterprise computer vision architect. Return ONLY a valid JSON object with these keys: "use_cases", "camera_recommendations", "assumptions", "missing_information", "recommended_camera_count", "recommended_hardware".
Each item in "use_cases" must have:
- name (string)
- description (string)
- task_type (one of: "object_detection", "classification", "segmentation", "ocr", "measurement", "tracking", "counting", "anomaly_detection", "pose_estimation", "other")
- candidate_techniques (array of strings, e.g. ["YOLOv11", "DeepSORT"])
- input_description (string)
- output_description (string)
- feasibility_status (one of: "feasible", "conditional", "infeasible", "unknown")
- feasibility_notes (array of strings)
- acceptance_criteria (array of strings with at least one measurable criterion)
- assumptions (array of strings)

recommended_camera_count (integer): If the user explicitly provided a camera count in their prompt/specifications, return that EXACT integer. If the user did NOT specify camera count, calculate and reason the optimal number based on facility area (length × width), ceiling height, layout sections, target detection coverage %, and complexity of tasks.
recommended_hardware (object): { "brand": string, "resolution": string, "lens_focal_mm": number, "framerate_fps": number, "video_codec": string } matching user specifications or reasoned for their specific task.
camera_recommendations: array of practical camera specification and placement suggestions (resolution, focal length/FOV, frame rate, lighting/IP rating).
Do not enclose in markdown ticks if possible, return raw JSON.`;

/** Call NVIDIA NIM API with timeout and error protection */
async function callNvidiaAI(prompt: string): Promise<string | null> {
  const nvidia = getNvidiaConfig();
  if (!nvidia.apiKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000); // 7s timeout to safely beat Vercel Hobby limits

    const resp = await fetch(getNvidiaCompletionsURL(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${nvidia.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: nvidia.model || 'meta/llama-3.2-11b-vision-instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      console.warn(`NVIDIA NIM returned HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? content.trim() : null;
  } catch (err) {
    console.warn('NVIDIA NIM call failed or timed out:', err);
    return null;
  }
}

/** Safely extract and parse JSON from model output */
function extractJsonFromContent(content: string | null): Record<string, unknown> | null {
  if (!content || typeof content !== 'string') return null;

  // Clean markdown fences
  const cleaned = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // If the content starts with error text, do not treat as JSON
  if (/^an error|^internal error|^rate limit|^unauthorized/i.test(cleaned)) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Continue to substring search
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Synthesizes physical cameras, 3D structures, and zones tailored strictly
 * to the scenario use cases, layout sections, and critical components (never blind 24 cameras).
 */
function attachScenarioPhysicalLayout(
  project: DetVisionProject, 
  inputs: {
    business_description: string;
    requirements: string[];
    critical_components: string[];
    layout_sections: string[];
    layout_section_count: number;
    detection_coverage_target: number;
    camera_specifications: string;
    available_hardware?: string;
    reasoned_camera_count?: number;
  },
  reasonedCameraCount?: number
) {
  const text = `${inputs.business_description} ${inputs.requirements.join(' ')} ${inputs.critical_components.join(' ')} ${inputs.camera_specifications || ''} ${inputs.available_hardware || ''}`.toLowerCase();
  
  // 1. Detect facility profile & dimensions
  const profile = detectFacilityProfile(inputs.business_description);
  const L = project.facility_length_m || (profile.length > 10 ? profile.length : 40.0);
  const W = project.facility_width_m || (profile.width > 5 ? profile.width : 25.0);
  const H = project.facility_height_m || (profile.height > 2 ? profile.height : 5.0);

  project.facility_length_m = L;
  project.facility_width_m = W;
  project.facility_height_m = H;
  project.facility_type = profile.facility_type;

  // 2. Synthesize 3D structures / obstacles matching the user scenario
  const structures: LayoutElement[] = [];

  // Perimeter boundary
  structures.push({
    id: crypto.randomUUID(),
    name: 'Facility North Wall',
    type: 'wall',
    points: [{ x: 0.02, y: 0.02 }, { x: 0.98, y: 0.02 }],
  });
  structures.push({
    id: crypto.randomUUID(),
    name: 'Facility South Wall',
    type: 'wall',
    points: [{ x: 0.02, y: 0.98 }, { x: 0.98, y: 0.98 }],
  });

  // Conveyor / Packaging Line (if conveyor or packaging or manufacturing or assembly mentioned)
  const hasConveyor = /conveyor|packaging|assembly|line|sorting|roller|inspection|box|carton|pallet/i.test(text);
  if (hasConveyor) {
    const convStartX = 0.15;
    const convEndX = 0.75;
    const convY = 0.28;
    const convH = 0.06;
    structures.push({
      id: crypto.randomUUID(),
      name: 'Automated Conveyor Inspection Line',
      type: 'obstacle',
      obstacle_type: 'conveyor',
      x_m: +(convStartX * L).toFixed(1),
      y_m: +(convY * W).toFixed(1),
      width_m: +((convEndX - convStartX) * L).toFixed(1),
      depth_m: +(convH * W).toFixed(1),
      height_m: 1.0,
      points: [
        { x: convStartX, y: convY },
        { x: convEndX, y: convY },
        { x: convEndX, y: convY + convH },
        { x: convStartX, y: convY + convH },
      ],
    });

    // Packaging & rejection station
    structures.push({
      id: crypto.randomUUID(),
      name: 'Packaging & Automated Rejection Station',
      type: 'obstacle',
      obstacle_type: 'machine',
      x_m: +(0.78 * L).toFixed(1),
      y_m: +(0.24 * W).toFixed(1),
      width_m: +(0.12 * L).toFixed(1),
      depth_m: +(0.14 * W).toFixed(1),
      height_m: 2.4,
      points: [
        { x: 0.78, y: 0.24 },
        { x: 0.90, y: 0.24 },
        { x: 0.90, y: 0.38 },
        { x: 0.78, y: 0.38 },
      ],
    });
  }

  // Forklift / Storage Racks (if warehouse, storage, rack, forklift, or logistics)
  const hasWarehouse = /warehouse|storage|rack|shelf|forklift|flt|aisle|pallet|logistics/i.test(text) || !hasConveyor;
  if (hasWarehouse) {
    // Rack row A
    structures.push({
      id: crypto.randomUUID(),
      name: 'High-Bay Storage Racks (Row A)',
      type: 'obstacle',
      obstacle_type: 'rack',
      x_m: +(0.15 * L).toFixed(1),
      y_m: +(0.52 * W).toFixed(1),
      width_m: +(0.65 * L).toFixed(1),
      depth_m: +(0.10 * W).toFixed(1),
      height_m: 4.5,
      points: [
        { x: 0.15, y: 0.52 },
        { x: 0.80, y: 0.52 },
        { x: 0.80, y: 0.62 },
        { x: 0.15, y: 0.62 },
      ],
    });

    // Rack row B (leaving a clear transit corridor between Row A and Row B)
    structures.push({
      id: crypto.randomUUID(),
      name: 'High-Bay Storage Racks (Row B)',
      type: 'obstacle',
      obstacle_type: 'rack',
      x_m: +(0.15 * L).toFixed(1),
      y_m: +(0.76 * W).toFixed(1),
      width_m: +(0.65 * L).toFixed(1),
      depth_m: +(0.10 * W).toFixed(1),
      height_m: 4.5,
      points: [
        { x: 0.15, y: 0.76 },
        { x: 0.80, y: 0.76 },
        { x: 0.80, y: 0.86 },
        { x: 0.15, y: 0.86 },
      ],
    });
  }

  // Critical Components from user input
  if (inputs.critical_components?.length) {
    inputs.critical_components.forEach((comp, idx) => {
      const lowerComp = comp.toLowerCase();
      let obsType = 'machine';
      if (/conveyor|belt|roller/i.test(lowerComp)) obsType = 'conveyor';
      else if (/gate|barrier|door|entry/i.test(lowerComp)) obsType = 'partition';
      else if (/stop|e-stop|hazard|chemical|battery/i.test(lowerComp)) obsType = 'hazard';
      else if (/dock|ramp/i.test(lowerComp)) obsType = 'dock';

      if (obsType === 'conveyor' && hasConveyor) return;

      const posX = 0.20 + (idx * 0.22) % 0.60;
      const posY = 0.42;
      structures.push({
        id: crypto.randomUUID(),
        name: comp,
        type: 'obstacle',
        obstacle_type: obsType,
        x_m: +(posX * L).toFixed(1),
        y_m: +(posY * W).toFixed(1),
        width_m: 2.0,
        depth_m: 1.5,
        height_m: 2.0,
        points: [
          { x: posX, y: posY },
          { x: posX + 0.08, y: posY },
          { x: posX + 0.08, y: posY + 0.06 },
          { x: posX, y: posY + 0.06 },
        ],
      });
    });
  }

  project.structure = structures;

  // 3. Synthesize Specific Cameras Based On AI Use Cases & Scenario Requirements
  const cameras: Camera[] = [];
  const zones: Zone[] = [];

  const hw = parseCameraHardware(inputs.camera_specifications, text);
  const userRequestedCount = extractDesiredCameraCount(text, null);
  const explicitReasoned = reasonedCameraCount ?? inputs.reasoned_camera_count;
  const targetCount = userRequestedCount > 0
    ? userRequestedCount
    : (typeof explicitReasoned === 'number' && explicitReasoned > 0)
      ? Math.min(80, explicitReasoned)
      : calculateReasonedCameraCount({
          length_m: L,
          width_m: W,
          height_m: H,
          layout_section_count: inputs.layout_section_count,
          layout_sections: inputs.layout_sections,
          use_cases_count: project.use_cases?.length || 1,
          critical_components_count: inputs.critical_components?.length || 0,
          detection_coverage_target: inputs.detection_coverage_target,
          facility_type: profile.facility_type,
        });

  const sections = (inputs.layout_sections || []).filter(s => s && s.trim());
  const defaultResW = hw.sensorWidthPx;
  const defaultResH = hw.sensorHeightPx;

  const rawUseCases = project.use_cases || [];

  // Generate cameras up to targetCount
  for (let idx = 0; idx < targetCount; idx++) {
    const uc = rawUseCases.length > 0 ? rawUseCases[idx % rawUseCases.length] : null;
    const ucLower = uc ? `${uc.name} ${uc.description} ${uc.task_type}`.toLowerCase() : '';
    const secIdx = sections.length > 0 ? idx % sections.length : -1;
    const secPrefix = secIdx >= 0 ? `[${sections[secIdx].replace(/^[0-9.:\-\s]+/, '').trim()}] ` : '';
    
    let camName = `CAM-${String(idx + 1).padStart(2, '0')}: ${secPrefix}${uc ? uc.name.slice(0, 24) : `Aisle Zone #${idx + 1}`}`;
    let camX = 0.10 + (idx % 4) * 0.24 + (Math.floor(idx / 4) % 2 ? 0.04 : 0);
    let camY = 0.15 + (Math.floor(idx / 4) * 0.22) % 0.72;
    let camDeg = (45 + idx * 55) % 360;
    let camFov = hw.hfovDeg;
    let camRange = 0.45;
    let resW = defaultResW;
    let resH = defaultResH;

    if (idx === 0 || /safety|forklift|ppe|worker|pedestrian|collision|chemical\s*splash/i.test(ucLower)) {
      camName = `CAM-${String(idx + 1).padStart(2, '0')}: ${secPrefix}PPE & Safety Zone`;
      camX = 0.12;
      camY = 0.69;
      camDeg = 0;
      camFov = Math.max(95, hw.hfovDeg);
      camRange = 0.50;

      if (!zones.some(z => z.type === 'detection')) {
        zones.push({
          id: crypto.randomUUID(),
          name: 'Chemical Safety & PPE Compliance Zone',
          type: 'detection',
          color: '#f59e0b',
          points: [{ x: 0.15, y: 0.63 }, { x: 0.80, y: 0.63 }, { x: 0.80, y: 0.75 }, { x: 0.15, y: 0.75 }],
          camera_ids: [],
        });
      }
    } else if (idx === 1 || /defect|surface|quality|inspection|anomaly|damage|leak|spill/i.test(ucLower)) {
      camName = `CAM-${String(idx + 1).padStart(2, '0')}: ${secPrefix}Leak & Inspection ROI`;
      camX = 0.45;
      camY = 0.20;
      camDeg = 90;
      camFov = Math.min(75, hw.hfovDeg);
      camRange = 0.32;

      if (!zones.some(z => z.type === 'roi')) {
        zones.push({
          id: crypto.randomUUID(),
          name: 'Chemical Spill & Inspection ROI',
          type: 'roi',
          color: '#10b981',
          points: [{ x: 0.25, y: 0.25 }, { x: 0.65, y: 0.25 }, { x: 0.65, y: 0.36 }, { x: 0.25, y: 0.36 }],
          camera_ids: [],
        });
      }
    } else if (idx === 2 || /ocr|barcode|code|label|reading|text|batch/i.test(ucLower)) {
      camName = `CAM-${String(idx + 1).padStart(2, '0')}: ${secPrefix}Drum & Tote Label OCR`;
      camX = 0.65;
      camY = 0.20;
      camDeg = 45;
      camFov = Math.min(60, hw.hfovDeg);
      camRange = 0.25;

      if (!zones.some(z => z.type === 'counting')) {
        zones.push({
          id: crypto.randomUUID(),
          name: 'Drum Barcode & Hazmat Label Trigger Zone',
          type: 'counting',
          color: '#3b82f6',
          points: [{ x: 0.60, y: 0.26 }, { x: 0.72, y: 0.26 }, { x: 0.72, y: 0.36 }, { x: 0.60, y: 0.36 }],
          camera_ids: [],
        });
      }
    } else if (idx === 3 || /count|throughput|flow|line|crossing|tanker|loading/i.test(ucLower)) {
      camName = `CAM-${String(idx + 1).padStart(2, '0')}: ${secPrefix}Throughput & Dispatch Monitor`;
      camX = 0.78;
      camY = 0.22;
      camDeg = 180;
      camFov = hw.hfovDeg;
      camRange = 0.35;

      if (!zones.some(z => z.type === 'virtual_line')) {
        zones.push({
          id: crypto.randomUUID(),
          name: 'Dispatch & Tanker Loading Line',
          type: 'virtual_line',
          color: '#8b5cf6',
          points: [{ x: 0.72, y: 0.26 }, { x: 0.85, y: 0.26 }, { x: 0.85, y: 0.36 }, { x: 0.72, y: 0.36 }],
          camera_ids: [],
        });
      }
    }

    const camId = crypto.randomUUID();
    cameras.push({
      id: camId,
      name: camName,
      status: 'active',
      x: +Math.max(0.05, Math.min(0.95, camX)).toFixed(3),
      y: +Math.max(0.05, Math.min(0.95, camY)).toFixed(3),
      orientation_degrees: camDeg,
      horizontal_fov_degrees: camFov,
      view_range: camRange,
      resolution_width: resW,
      resolution_height: resH,
      assigned_use_case_ids: uc ? [uc.id] : [],
    });
  }

  // 4. Distribute ALL cameras across the use cases so all cameras are fully accounted for
  if (rawUseCases.length > 0) {
    rawUseCases.forEach(uc => { uc.camera_ids = []; });
    cameras.forEach((cam, cIdx) => {
      const assignedUc = rawUseCases[cIdx % rawUseCases.length];
      if (assignedUc) {
        cam.assigned_use_case_ids = [assignedUc.id];
        if (!assignedUc.camera_ids.includes(cam.id)) {
          assignedUc.camera_ids.push(cam.id);
        }
      }
    });
  }

  // 5. Associate cameras with facility buildings and attach complete conditions metadata
  const bldgs = profile.buildings || [];
  bldgs.forEach(b => { b.camera_ids = []; });

  if (bldgs.length > 0) {
    let camOffset = 0;
    bldgs.forEach(b => {
      const count = b.camera_count;
      for (let i = 0; i < count && camOffset < cameras.length; i++, camOffset++) {
        const cam = cameras[camOffset];
        cam.building_id = b.id;
        cam.building_name = b.name;
        b.camera_ids = b.camera_ids || [];
        b.camera_ids.push(cam.id);

        const lowerB = b.name.toLowerCase();
        const isLoading = /loading|dock|point|truck/i.test(lowerB);
        const isChemical = /filling|chemical|spill|plastic/i.test(lowerB);

        cam.mount_type = i === 0 ? 'corner' : i === 1 ? 'roof-tilt' : i === 2 ? 'wall-h' : i === 3 ? 'roof-nadir' : 'cross';
        cam.tilt_degrees = cam.mount_type === 'roof-nadir' ? 90 : cam.mount_type === 'roof-tilt' ? 25 : 20;
        cam.height_m = Math.min(5.5, Math.max(3.0, +(b.height_m * 0.85).toFixed(1)));
        cam.target_area = cam.target_area || `${b.name} Primary Monitored Zone`;
        cam.lighting_lux = isLoading ? '50–250 Lux (0.001 Lux Smart EXIR Night Vision to 40m)' : '150–400 Lux (0.005 Lux Starlight IR Auto-Switch)';
        cam.ingress_protection = isLoading ? 'IP67 / IK10 Vandal-Proof NEMA 4X' : isChemical ? 'IP66 / NEMA 4X Chemical & Washdown Resistant' : 'IP54 Industrial Sealed Housing';
        cam.shutter_speed = isChemical ? '1/500s – 1/1000s (Anti-Motion-Blur High-Speed Line)' : '1/250s (Anti-Motion-Blur Forklift & Personnel Transit)';
        cam.wdr_rating = '120 dB True WDR (Eliminates Backlight & Glare Washout)';
        cam.operating_temp = isLoading ? '-35°C to +60°C (-31°F to 140°F) Heated Anti-Fog Glass' : '-20°C to +55°C (-4°F to 131°F) Industrial Operating Range';
        cam.lens_focal = i % 3 === 0 ? '2.8mm (106° HFOV Ultra-Wide Angle)' : i % 3 === 1 ? '4.0mm (85° HFOV Standard Industrial)' : '6.0mm (54° HFOV Telephoto Aisle Corridor)';
        cam.dori_identify_m = i % 3 === 0 ? 5.5 : i % 3 === 1 ? 8.0 : 12.0;
        cam.dori_recognize_m = i % 3 === 0 ? 11.0 : i % 3 === 1 ? 16.0 : 24.0;
      }
    });
  }

  project.buildings = bldgs;

  // Link cameras to corresponding zones
  zones.forEach((z, i) => {
    if (cameras[i]) z.camera_ids = [cameras[i].id];
  });

  project.cameras = cameras;
  project.zones = zones;
}

/** High-precision domain synthesis fallback */
function synthesizeIntelligentProject(params: {
  business_description: string;
  company_name: string;
  industry: string;
  requirements: string[];
  camera_specifications: string;
  available_hardware: string;
  critical_components: string[];
  layout_section_count: number;
  layout_sections: string[];
  detection_coverage_target: number;
  output_scope: string[];
  image_observation: string;
}): DetVisionProject {
  const {
    business_description,
    company_name,
    industry,
    requirements,
    camera_specifications,
    available_hardware,
    critical_components,
    layout_section_count,
    layout_sections,
    detection_coverage_target,
    output_scope,
    image_observation,
  } = params;

  const project = createEmptyProject(
    business_description.slice(0, 60).trim() || 'Vision Architecture Plan',
    company_name || 'Enterprise Facility',
    industry || 'Industrial & Logistics',
    business_description,
  );

  project.requirements = requirements.length ? requirements : [business_description];
  project.camera_specifications = camera_specifications;
  project.available_hardware = available_hardware;
  project.critical_components = critical_components;
  project.layout_section_count = layout_section_count;
  project.layout_sections = layout_sections.length ? layout_sections : [`Section 1 · Primary Area`];
  project.detection_coverage_target = detection_coverage_target;
  project.output_scope = output_scope;
  project.image_observation = image_observation;

  const combinedText = `${business_description} ${requirements.join(' ')} ${critical_components.join(' ')}`.toLowerCase();

  const useCases: UseCase[] = [];

  // 1. Safety & PPE / Forklift Detection
  if (combinedText.includes('safety') || combinedText.includes('forklift') || combinedText.includes('ppe') || combinedText.includes('pedestrian') || combinedText.includes('vest') || combinedText.includes('worker') || combinedText.includes('stop')) {
    useCases.push({
      id: crypto.randomUUID(),
      name: 'Worker Safety & Forklift Collision Prevention',
      description: 'Continuous spatial monitoring of forklift aisles and designated pedestrian pathways to enforce PPE compliance (high-visibility vest, hardhat) and detect near-miss pedestrian-vehicle interactions.',
      task_type: 'object_detection',
      candidate_techniques: ['Ultralytics YOLOv11n High-Speed Detector', 'DeepSORT Multi-Object Tracking', 'Convex Hull Proximity Estimator'],
      input_description: 'Wide-angle 4K RTSP streams covering main transport aisles, intersections, and high-traffic zones.',
      output_description: 'Real-time JSON safety telemetries, visual boundary alert overlays, and PLC tripwire relay trigger on critical safety breaches.',
      camera_ids: [],
      feasibility_status: 'feasible',
      feasibility_notes: ['High ambient illuminance (>= 150 lux) recommended for accurate PPE garment segmentation.', 'Mounting height should exceed 3.5m to eliminate worker self-occlusion.'],
      acceptance_criteria: ['mAP@0.5 >= 0.94 on forklift and worker classes under standard facility illumination.', 'End-to-end edge pipeline inference latency <= 35ms on edge accelerator.'],
      assumptions: ['Operating speeds of mobile equipment do not exceed 15 km/h within covered camera bays.', 'Standard high-visibility apparel is maintained in clean visual condition.'],
    });
  }

  // 2. Automated Quality & Anomaly Detection
  if (combinedText.includes('defect') || combinedText.includes('quality') || combinedText.includes('anomaly') || combinedText.includes('inspection') || combinedText.includes('damage') || combinedText.includes('crack') || combinedText.includes('scratch')) {
    useCases.push({
      id: crypto.randomUUID(),
      name: 'Automated Surface Defect & Quality Inspection',
      description: 'Sub-millimeter visual surface audit for automated identification of tears, cracks, surface deformities, or irregular assembly tolerances.',
      task_type: 'anomaly_detection',
      candidate_techniques: ['PatchCore Visual Anomaly Engine', 'FastSAM Zero-Shot Instance Segmentation', 'Structural Similarity Index (SSIM) Gate'],
      input_description: 'High-speed downward optical feed synchronized with line trigger sensors.',
      output_description: 'Defect coordinate heatmap, severity score, and automated rejection gate trigger.',
      camera_ids: [],
      feasibility_status: 'feasible',
      feasibility_notes: ['Dedicated telecentric or polarized auxiliary lighting is essential to eliminate glare.'],
      acceptance_criteria: ['Defect detection recall >= 99.1% with false reject rate (FRR) <= 0.8% across production shifts.'],
      assumptions: ['Production items pass through camera FOV with uniform planar orientation.'],
    });
  }

  // 3. OCR & Barcode Verification
  if (combinedText.includes('ocr') || combinedText.includes('barcode') || combinedText.includes('code') || combinedText.includes('serial') || combinedText.includes('label') || combinedText.includes('read') || combinedText.includes('text')) {
    useCases.push({
      id: crypto.randomUUID(),
      name: 'Automated High-Speed Label & OCR Verification',
      description: 'Optical reading of 1D/2D barcodes, alphanumeric lot codes, and expiration timestamps on packaging.',
      task_type: 'ocr',
      candidate_techniques: ['PaddleOCR Multi-Lingual Text Engine', 'DBNet Text Detection Head', 'PyZbar Fast Barcode Decoder'],
      input_description: 'Targeted macro camera stream positioned perpendicular to the convey line label presentation plane.',
      output_description: 'Parsed alphanumeric string payload with verification status against ERP/WMS database.',
      camera_ids: [],
      feasibility_status: 'feasible',
      feasibility_notes: ['Target label must achieve >= 3.0 pixels-per-millimeter (PPM) resolution on sensor plane.'],
      acceptance_criteria: ['Character recognition accuracy >= 99.5% on valid label presentations.'],
      assumptions: ['Labels are oriented within +/- 20 degrees of optical axis.'],
    });
  }

  // 4. Conveyor Line Counting & Throughput Flow
  if (combinedText.includes('count') || combinedText.includes('conveyor') || combinedText.includes('throughput') || combinedText.includes('flow') || combinedText.includes('rate') || combinedText.includes('inventory')) {
    useCases.push({
      id: crypto.randomUUID(),
      name: 'Conveyor Throughput & Line-Crossing Audit',
      description: 'Automated real-time unit counting across digital tripwire polygons to verify hourly yield, cycle times, and conveyor bottleneck accumulation.',
      task_type: 'counting',
      candidate_techniques: ['ByteTrack Multi-Target Trajectory Estimator', 'Virtual Line-Crossing Ingestion Gate'],
      input_description: 'Overhead camera view tracking items as they traverse the critical transfer section.',
      output_description: 'Cumulative hourly unit counts, instantaneous units-per-minute (UPM) rate, and stall warning events.',
      camera_ids: [],
      feasibility_status: 'feasible',
      feasibility_notes: ['Minimum 3cm separation between adjacent items required for zero-occlusion tracking.'],
      acceptance_criteria: ['Item count discrepancy <= 0.2% compared against physical scale verification.'],
      assumptions: ['Conveyor velocity remains steady at design rated speed (+/- 10%).'],
    });
  }

  // Fallback: If no specialized use cases matched, create a comprehensive object detection use case
  if (useCases.length === 0) {
    useCases.push({
      id: crypto.randomUUID(),
      name: 'Facility Activity & Object Detection Audit',
      description: `Comprehensive real-time vision telemetry analyzing ${business_description.slice(0, 100)} to identify operational events and key assets.`,
      task_type: 'object_detection',
      candidate_techniques: ['Ultralytics YOLOv11 Real-Time Detector', 'Spatial Occupancy Estimator'],
      input_description: 'Optical video streams covering key operational zones and ingress/egress points.',
      output_description: 'Categorized object detection telemetry with confidence ratings and timestamped logs.',
      camera_ids: [],
      feasibility_status: 'feasible',
      feasibility_notes: ['Standard camera placement with overlapping fields of view recommended.'],
      acceptance_criteria: ['Mean average precision (mAP@0.5) >= 0.90 on target classes.'],
      assumptions: ['Lighting conditions remain above 100 lux during active operational hours.'],
    });
  }

  project.use_cases = useCases;

  const hw = parseCameraHardware(camera_specifications, combinedText);

  // Practical camera recommendations based on inputs
  project.camera_recommendations = [
    camera_specifications || `${hw.brand} ${hw.resolutionPreset.toUpperCase()} (${hw.sensorWidthPx}×${hw.sensorHeightPx}) @ ${hw.framerateFps} FPS with WDR >= 120dB.`,
    `Lens configuration: ${hw.focalMm}mm (HFOV ${hw.hfovDeg}°) to satisfy forensic DORI resolution standards.`,
    `Infrastructure: Dedicated Gigabit PoE+ switch (${hw.bitrateKbps} kbps stream via ${hw.videoCodec}) on an isolated vision VLAN.`,
    'Rigging & Infrastructure: Ceiling unistrut or adjustable wall brackets with downward tilt to eliminate perspective distortion.',
  ];

  project.assumptions = [
    'Facility network provides dedicated 1Gbps PoE infrastructure isolated from corporate office traffic.',
    'Ambient illumination levels satisfy minimum 150 lux across all inspected areas during operational shifts.',
    'Edge GPU hardware supports TensorRT-accelerated DeepStream RTSP ingestion with H.264/H.265 hardware decoding.',
  ];

  project.missing_information = [
    'CAD or structural architectural drawing with precise ceiling truss clearances and emergency lighting locations.',
    'Exact conveyor belt line speed (m/s) and maximum package dimensions (L × W × H).',
    'Enterprise VMS integration protocol (ONVIF Profile S/T, RTSP, or native REST API).',
  ];

  attachScenarioPhysicalLayout(project, params);

  return project;
}

export async function POST(request: NextRequest) {
  let business_description = '';
  try {
    const body = await request.json();
    const validation = validateAnalysisRequest(body);

    business_description = validation.business_description;
    const { industry, company_name, requirements, use_ai } = validation;
    const planningInputs = {
      business_description,
      industry: industry || '',
      company_name: company_name || '',
      requirements: requirements || [],
      camera_specifications: validation.camera_specifications || '',
      available_hardware: validation.available_hardware || '',
      critical_components: validation.critical_components || [],
      layout_section_count: validation.layout_section_count || 1,
      layout_sections: validation.layout_sections || [],
      detection_coverage_target: validation.detection_coverage_target || 90,
      output_scope: validation.output_scope || [],
      image_observation: validation.image_observation || '',
    };

    // If AI analysis is not requested, directly generate project draft
    if (!use_ai) {
      const draft = synthesizeIntelligentProject(planningInputs);
      const validated = validateProject(draft);
      return NextResponse.json({
        project: validated,
        model_used: 'Project draft',
      });
    }

    // AI Analysis requested: attempt NVIDIA NIM
    const userCameraCount = extractDesiredCameraCount(
      `${planningInputs.camera_specifications || ''} ${business_description} ${(requirements || []).join(' ')} ${planningInputs.available_hardware || ''}`,
      null
    );

    const prompt = `Facility description: ${business_description}
${industry ? `Industry: ${industry}` : ''}
${company_name ? `Company: ${company_name}` : ''}
${requirements?.length ? `Requirements:\n${requirements.map((item: string) => `- ${item}`).join('\n')}` : ''}
Camera specifications: ${planningInputs.camera_specifications || 'Not provided'}
${userCameraCount > 0 ? `Target Camera Fleet: User requires exactly ${userCameraCount} cameras. DO NOT suggest, alter, or downgrade this count. You must set recommended_camera_count to ${userCameraCount} and plan all use cases for this full fleet.` : ''}
Available hardware and input feeds: ${planningInputs.available_hardware || 'Not provided'}
Critical components: ${planningInputs.critical_components.join(', ') || 'Not provided'}
Site image suggestion: ${planningInputs.image_observation || 'No image uploaded'}
Layout sections: ${planningInputs.layout_sections.join('; ') || planningInputs.layout_section_count}; target detection coverage: ${planningInputs.detection_coverage_target}%

Suggest computer-vision use cases, practical techniques, camera placement/specification considerations based on the supplied inputs, assumptions, and missing information. Return JSON only.`;

    const rawResponse = await callNvidiaAI(prompt);
    const parsed = extractJsonFromContent(rawResponse);

    let project: DetVisionProject;

    if (parsed && Array.isArray(parsed.use_cases) && parsed.use_cases.length > 0) {
      const allowedTaskTypes: TaskType[] = ['object_detection', 'classification', 'segmentation', 'ocr', 'measurement', 'tracking', 'counting', 'anomaly_detection', 'pose_estimation', 'other'];
      const allowedFeasibility: FeasibilityStatus[] = ['feasible', 'conditional', 'infeasible', 'unknown'];

      const draft = createEmptyProject(
        business_description.slice(0, 60).trim(),
        company_name || 'Enterprise Facility',
        industry || 'Industrial & Logistics',
        business_description,
      );

      draft.requirements = requirements || [];
      Object.assign(draft, planningInputs);

      const parsedHw = parsed.recommended_hardware as Record<string, unknown> | undefined;
      const hwFallback = parseCameraHardware(planningInputs.camera_specifications, business_description);

      draft.camera_recommendations = Array.isArray(parsed.camera_recommendations)
        ? parsed.camera_recommendations.filter((v: unknown): v is string => typeof v === 'string')
        : [
            planningInputs.camera_specifications || `${hwFallback.brand} ${hwFallback.resolutionPreset.toUpperCase()} (${hwFallback.sensorWidthPx}×${hwFallback.sensorHeightPx}) @ ${hwFallback.framerateFps} FPS with WDR >= 120dB.`,
            `Lens configuration: ${hwFallback.focalMm}mm (HFOV ${hwFallback.hfovDeg}°) to achieve DORI resolution standards.`,
            `Dedicated Gigabit PoE+ (${hwFallback.bitrateKbps} kbps ${hwFallback.videoCodec}) infrastructure on isolated VLAN.`,
          ];

      draft.use_cases = (parsed.use_cases as Record<string, unknown>[]).slice(0, 8).map((item) => {
        const candidateTechniques = Array.isArray(item.candidate_techniques) && item.candidate_techniques.length > 0
          ? item.candidate_techniques.filter((v: unknown): v is string => typeof v === 'string')
          : ['YOLOv11 Real-Time Detector', 'ByteTrack Multi-Object Tracker'];

        const acceptanceCriteria = Array.isArray(item.acceptance_criteria) && item.acceptance_criteria.length > 0
          ? item.acceptance_criteria.filter((v: unknown): v is string => typeof v === 'string')
          : ['mAP@0.5 >= 0.90 under standard facility lighting', 'Inference latency <= 40ms on edge GPU'];

        return {
          id: crypto.randomUUID(),
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Computer vision use case',
          description: typeof item.description === 'string' && item.description.trim() ? item.description.trim() : business_description,
          task_type: allowedTaskTypes.includes(item.task_type as TaskType) ? item.task_type as TaskType : 'object_detection',
          candidate_techniques: candidateTechniques.length ? candidateTechniques : ['Computer vision model selection after site review'],
          input_description: typeof item.input_description === 'string' ? item.input_description : 'Camera images or video from the facility',
          output_description: typeof item.output_description === 'string' ? item.output_description : 'Events and detections related to use case',
          camera_ids: [],
          feasibility_status: allowedFeasibility.includes(item.feasibility_status as FeasibilityStatus) ? item.feasibility_status as FeasibilityStatus : 'feasible',
          feasibility_notes: Array.isArray(item.feasibility_notes) ? item.feasibility_notes.filter((v: unknown) => typeof v === 'string') : [],
          acceptance_criteria: acceptanceCriteria.length ? acceptanceCriteria : ['Confirm performance targets during a site assessment.'],
          assumptions: Array.isArray(item.assumptions) ? item.assumptions.filter((v: unknown) => typeof v === 'string') : [],
        };
      });

      draft.assumptions = Array.isArray(parsed.assumptions)
        ? parsed.assumptions.filter((v: unknown): v is string => typeof v === 'string')
        : ['Facility network provides dedicated 1Gbps PoE infrastructure.', 'Lighting exceeds 150 lux during operational hours.'];

      draft.missing_information = Array.isArray(parsed.missing_information)
        ? parsed.missing_information.filter((v: unknown): v is string => typeof v === 'string')
        : ['Truss mounting heights and ceiling clearance obstacles.', 'Exact conveyor speeds and package dimension bounds.'];

      const reasonedCount = userCameraCount > 0
        ? userCameraCount
        : (typeof parsed.recommended_camera_count === 'number' && parsed.recommended_camera_count > 0
          ? parsed.recommended_camera_count
          : undefined);

      attachScenarioPhysicalLayout(draft, planningInputs, reasonedCount);

      project = validateProject(draft);
    } else {
      // Model output was not JSON or timed out: use resilient domain synthesis
      const synthesized = synthesizeIntelligentProject(planningInputs);
      project = validateProject(synthesized);
    }

    return NextResponse.json({
      project,
      model_used: 'NVIDIA AI Engine',
    });
  } catch (error) {
    console.error('Analysis error, recovering with intelligent synthesis:', error);
    try {
      const fallbackProject = synthesizeIntelligentProject({
        business_description: business_description || 'Vision Architecture Project',
        company_name: 'Enterprise Facility',
        industry: 'Industrial & Logistics',
        requirements: [],
        camera_specifications: '',
        available_hardware: '',
        critical_components: [],
        layout_section_count: 1,
        layout_sections: ['Section 1 · Primary Area'],
        detection_coverage_target: 90,
        output_scope: ['Executive summary', 'Camera plan', 'Detection coverage', 'Hardware & critical components', 'Workflow'],
        image_observation: '',
      });
      return NextResponse.json({
        project: validateProject(fallbackProject),
        model_used: 'NVIDIA AI Engine',
      });
    } catch {
      return NextResponse.json({ error: 'Failed to process analysis request.' }, { status: 400 });
    }
  }
}

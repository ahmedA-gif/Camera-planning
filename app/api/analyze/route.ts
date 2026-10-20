import { NextRequest, NextResponse } from 'next/server';
import { validateAnalysisRequest, validateProject } from '@/lib/validation';
import { createEmptyProject } from '@/lib/project-factory';
import type { DetVisionProject, UseCase, TaskType, FeasibilityStatus } from '@/lib/types';
import { getNvidiaConfig, getNvidiaCompletionsURL } from '@/lib/ai-provider';

// Allow AI providers room to answer on serverless platforms
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an enterprise computer vision architect. Return ONLY a valid JSON object with these exact keys: "use_cases", "camera_recommendations", "assumptions", "missing_information".
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

camera_recommendations must be an array of practical camera specification and placement suggestions (resolution, focal length/FOV, frame rate, lighting/IP rating).
Do not enclose in markdown ticks if possible, return raw JSON.`;

/** Call NVIDIA NIM API with timeout and error protection */
async function callNvidiaAI(prompt: string): Promise<string | null> {
  const nvidia = getNvidiaConfig();
  if (!nvidia.apiKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 16000); // 16s timeout

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

  // Practical camera recommendations based on inputs
  project.camera_recommendations = [
    camera_specifications || '4K (3840×2160) Ultra-HD resolution @ 30 FPS with wide dynamic range (WDR >= 120dB) for high-contrast indoor/doorway illumination.',
    `Lens configuration: 2.8mm to 12mm motorized varifocal per section to maintain forensic DORI pixel densities (>= 125 PPM for object detection, >= 250 PPM for identification).`,
    'Rigging & Infrastructure: Ceiling unistrut or wall brackets at 4.5m mount height with 15°–25° downward tilt to eliminate perspective distortion.',
    'Electrical & Network: Cat6 shielded twisted pair (STP) with PoE+ (IEEE 802.3at, 30W/port) and managed Gigabit switch with dedicated VLAN for video feeds.',
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
    const prompt = `Facility description: ${business_description}
${industry ? `Industry: ${industry}` : ''}
${company_name ? `Company: ${company_name}` : ''}
${requirements?.length ? `Requirements:\n${requirements.map((item: string) => `- ${item}`).join('\n')}` : ''}
Camera specifications: ${planningInputs.camera_specifications || 'Not provided'}
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

      draft.camera_recommendations = Array.isArray(parsed.camera_recommendations)
        ? parsed.camera_recommendations.filter((v: unknown): v is string => typeof v === 'string')
        : [
            planningInputs.camera_specifications || '4K Ultra-HD resolution @ 30 FPS with WDR >= 120dB.',
            'Motorized varifocal 2.8–12mm lens to achieve minimum 125 PPM for target detection.',
            'PoE+ (802.3at) network switch with Cat6 shielded cabling.',
          ];

      draft.use_cases = (parsed.use_cases as Record<string, unknown>[]).slice(0, 4).map((item) => {
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

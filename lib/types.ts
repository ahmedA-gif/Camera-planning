export interface DetVisionProject {
  id: string;
  name: string;
  company_name: string;
  industry: string;
  business_description: string;
  requirements: string[];
  use_cases: UseCase[];
  cameras: Camera[];
  zones: Zone[];
  structure?: LayoutElement[];
  workflow: Workflow;
  assumptions: string[];
  missing_information: string[];
  created_at: string;
  updated_at: string;
  floor_plan_image?: string;
  facility_image?: string;
  facility_image_name?: string;
  image_observation?: string;
  camera_specifications?: string;
  camera_recommendations?: string[];
  available_hardware?: string;
  critical_components?: string[];
  layout_section_count?: number;
  layout_sections?: string[];
  detection_coverage_target?: number;
  output_scope?: string[];
  facility_width_m?: number;
  facility_length_m?: number;
  facility_height_m?: number;
  facility_type?: string;
  safety_plan?: SafetyPlanDocument;
  revisions?: ProjectRevision[];
}

export interface ProjectRevision {
  id: string;
  created_at: string;
  label: string;
  changes: string[];
  snapshot: Omit<DetVisionProject, 'revisions' | 'facility_image' | 'floor_plan_image'>;
}

export interface SafetyPlanDocument {
  complete: boolean;
  sections: Record<string, string>;
  state: {
    normalized_context: unknown;
    outline: { sections: Array<{ id: string; title: string; description: string; required: boolean; estimated_tokens: number; dependencies: string[] }> };
    completed_sections: Record<string, string>;
    remaining_sections: string[];
    current_section: string | null;
    total_generated_tokens: number;
    rate_limit_remaining: number;
    last_error: string | null;
  };
  metadata?: { generated_at: string; total_sections?: number; total_tokens_estimate?: number };
}

export interface UseCase {
  id: string;
  name: string;
  description: string;
  task_type: TaskType;
  candidate_techniques: string[];
  input_description: string;
  output_description: string;
  camera_ids: string[];
  feasibility_status: FeasibilityStatus;
  feasibility_notes: string[];
  acceptance_criteria: string[];
  assumptions: string[];
}

export interface Camera {
  id: string;
  name: string;
  status: CameraStatus;
  x: number;
  y: number;
  orientation_degrees: number;
  horizontal_fov_degrees: number;
  view_range: number;
  resolution_width: number;
  resolution_height: number;
  assigned_use_case_ids: string[];
}

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  points: Point[];
  camera_ids: string[];
  color: string;
}

export interface LayoutElement {
  id: string;
  name: string;
  type: 'wall' | 'obstacle' | 'entrance';
  points: Point[];
  x_m?: number;
  y_m?: number;
  width_m?: number;
  depth_m?: number;
  height_m?: number;
  obstacle_type?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  type: NodeCategory;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export type TaskType = 
  | 'object_detection' 
  | 'classification' 
  | 'segmentation' 
  | 'ocr' 
  | 'measurement' 
  | 'tracking' 
  | 'counting' 
  | 'anomaly_detection' 
  | 'pose_estimation' 
  | 'other';

export type FeasibilityStatus = 'feasible' | 'conditional' | 'infeasible' | 'unknown';

export type CameraStatus = 'planned' | 'installed' | 'active' | 'maintenance' | 'offline';

export type ZoneType = 'detection' | 'counting' | 'exclusion' | 'roi' | 'virtual_line';

export type NodeCategory = 
  | 'camera_input' 
  | 'frame_sampling' 
  | 'preprocessing' 
  | 'object_detection' 
  | 'classification' 
  | 'segmentation' 
  | 'ocr' 
  | 'measurement' 
  | 'tracking' 
  | 'zone_logic' 
  | 'line_crossing' 
  | 'decision' 
  | 'alert' 
  | 'event_storage' 
  | 'manual_review';

export interface AnalysisRequest {
  business_description: string;
  industry?: string;
  company_name?: string;
  requirements?: string[];
}

export interface AnalysisResponse {
  project: Partial<DetVisionProject>;
  model_used?: string;
}

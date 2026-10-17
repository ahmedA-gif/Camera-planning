import { z } from 'zod';
import type {
  DetVisionProject,
  UseCase,
  Camera,
  Zone,
  LayoutElement,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  Point,
  TaskType,
  FeasibilityStatus,
  CameraStatus,
  ZoneType,
  NodeCategory,
} from './types';

export const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const useCaseSchema: z.ZodType<UseCase> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  task_type: z.enum([
    'object_detection',
    'classification',
    'segmentation',
    'ocr',
    'measurement',
    'tracking',
    'counting',
    'anomaly_detection',
    'pose_estimation',
    'other',
  ]),
  candidate_techniques: z.array(z.string()).min(1),
  input_description: z.string().min(1),
  output_description: z.string().min(1),
  camera_ids: z.array(z.string().uuid()),
  feasibility_status: z.enum(['feasible', 'conditional', 'infeasible', 'unknown']),
  feasibility_notes: z.array(z.string()),
  acceptance_criteria: z.array(z.string()).min(1),
  assumptions: z.array(z.string()),
});

export const cameraSchema: z.ZodType<Camera> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(['planned', 'installed', 'active', 'maintenance', 'offline']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  orientation_degrees: z.number().min(0).max(360),
  horizontal_fov_degrees: z.number().min(1).max(180),
  view_range: z.number().min(0.1).max(1),
  resolution_width: z.number().int().positive(),
  resolution_height: z.number().int().positive(),
  assigned_use_case_ids: z.array(z.string().uuid()),
});

export const zoneSchema: z.ZodType<Zone> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['detection', 'counting', 'exclusion', 'roi', 'virtual_line']),
  points: z.array(pointSchema).min(3),
  camera_ids: z.array(z.string().uuid()),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const layoutElementSchema: z.ZodType<LayoutElement> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['wall', 'obstacle', 'entrance']),
  points: z.array(pointSchema).min(2),
});

export const workflowNodeSchema: z.ZodType<WorkflowNode> = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'camera_input',
    'frame_sampling',
    'preprocessing',
    'object_detection',
    'classification',
    'segmentation',
    'ocr',
    'measurement',
    'tracking',
    'zone_logic',
    'line_crossing',
    'decision',
    'alert',
    'event_storage',
    'manual_review',
  ]),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.record(z.string(), z.unknown()),
});

export const workflowEdgeSchema: z.ZodType<WorkflowEdge> = z.object({
  id: z.string().uuid(),
  source: z.string().uuid(),
  target: z.string().uuid(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export const workflowSchema: z.ZodType<Workflow> = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export const safetyPlanSchema = z.object({
  complete: z.boolean(),
  sections: z.record(z.string(), z.string()),
  state: z.object({
    normalized_context: z.unknown(),
    outline: z.object({ sections: z.array(z.object({
      id: z.string(), title: z.string(), description: z.string(), required: z.boolean(), estimated_tokens: z.number(), dependencies: z.array(z.string()),
    })) }),
    completed_sections: z.record(z.string(), z.string()),
    remaining_sections: z.array(z.string()),
    current_section: z.string().nullable(),
    total_generated_tokens: z.number(),
    rate_limit_remaining: z.number(),
    last_error: z.string().nullable(),
  }),
  metadata: z.object({ generated_at: z.string(), total_sections: z.number().optional(), total_tokens_estimate: z.number().optional() }).optional(),
});

export const projectSchema: z.ZodType<DetVisionProject> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  company_name: z.string().min(1),
  industry: z.string().min(1),
  business_description: z.string().min(1),
  requirements: z.array(z.string()),
  use_cases: z.array(useCaseSchema),
  cameras: z.array(cameraSchema),
  zones: z.array(zoneSchema),
  structure: z.array(layoutElementSchema).optional(),
  floor_plan_image: z.string().optional(),
  facility_image: z.string().optional(),
  facility_image_name: z.string().optional(),
  image_observation: z.string().optional(),
  camera_specifications: z.string().optional(),
  camera_recommendations: z.array(z.string()).optional(),
  available_hardware: z.string().optional(),
  critical_components: z.array(z.string()).optional(),
  layout_section_count: z.number().int().min(1).max(50).optional(),
  layout_sections: z.array(z.string()).optional(),
  detection_coverage_target: z.number().int().min(1).max(100).optional(),
  output_scope: z.array(z.string()).optional(),
  safety_plan: safetyPlanSchema.optional(),
  workflow: workflowSchema,
  assumptions: z.array(z.string()),
  missing_information: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const analysisRequestSchema = z.object({
  business_description: z.string().min(10),
  industry: z.string().optional(),
  company_name: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  use_ai: z.boolean().optional(),
  camera_specifications: z.string().optional(),
  available_hardware: z.string().optional(),
  critical_components: z.array(z.string()).optional(),
  layout_section_count: z.number().int().min(1).max(50).optional(),
  layout_sections: z.array(z.string()).optional(),
  detection_coverage_target: z.number().int().min(1).max(100).optional(),
  output_scope: z.array(z.string()).optional(),
  image_observation: z.string().optional(),
});

export function validateProject(data: unknown): DetVisionProject {
  return projectSchema.parse(data);
}

export function validateAnalysisRequest(data: unknown) {
  return analysisRequestSchema.parse(data);
}

export function safeValidateProject(data: unknown) {
  return projectSchema.safeParse(data);
}

export function safeValidateAnalysisRequest(data: unknown) {
  return analysisRequestSchema.safeParse(data);
}

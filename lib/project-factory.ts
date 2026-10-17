import type { DetVisionProject } from './types';

export function createEmptyProject(name: string, company: string, industry: string, description: string): DetVisionProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    company_name: company,
    industry,
    business_description: description,
    requirements: [],
    use_cases: [],
    cameras: [],
    zones: [],
    structure: [],
    workflow: { nodes: [], edges: [] },
    assumptions: [],
    missing_information: [],
    camera_specifications: '',
    camera_recommendations: [],
    available_hardware: '',
    critical_components: [],
    layout_section_count: 1,
    layout_sections: ['Section 1'],
    detection_coverage_target: 90,
    output_scope: ['Executive summary', 'Camera plan', 'Detection coverage', 'Hardware & critical components', 'Workflow'],
    created_at: now,
    updated_at: now,
  };
}

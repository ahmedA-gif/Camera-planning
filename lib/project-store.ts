'use client';

import type { DetVisionProject, ProjectRevision } from './types';
import { createEmptyProject } from './project-factory';

const LEGACY_STORAGE_KEY = 'detvision_projects';

function getStorageKeys(userId: string) {
  if (!userId) throw new Error('A signed-in user is required to access project storage.');
  const owner = encodeURIComponent(userId);
  return { projects: `detvision_projects:${owner}`, active: `detvision_active_project:${owner}` };
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  return fallback;
}

export function getStoredProjects(userId: string): DetVisionProject[] {
  if (typeof window === 'undefined' || !userId) return [];
  const keys = getStorageKeys(userId);
  try {
    const data = localStorage.getItem(keys.projects);
    if (!data) return [];
    const projects = JSON.parse(data) as DetVisionProject[];
    let changed = false;
    const migrated = projects.map(project => {
      const normalized = {
        ...project,
        requirements: stringArray(project.requirements),
        critical_components: stringArray(project.critical_components),
        layout_sections: stringArray(project.layout_sections, ['Section 1']),
        output_scope: stringArray(project.output_scope, ['Executive summary', 'Camera plan', 'Detection coverage', 'Hardware & critical components', 'Workflow']),
      };
      if (JSON.stringify(normalized.requirements) !== JSON.stringify(project.requirements) || JSON.stringify(normalized.critical_components) !== JSON.stringify(project.critical_components) || JSON.stringify(normalized.layout_sections) !== JSON.stringify(project.layout_sections) || JSON.stringify(normalized.output_scope) !== JSON.stringify(project.output_scope)) changed = true;
      const hasOldPreset = project.workflow?.nodes?.some(node => {
        const details = node.data as Record<string, unknown>;
        const classes = Array.isArray(details.classes) ? details.classes.map(String).sort() : [];
        return details.model === 'YOLOv8n' && classes.join(',') === 'forklift,person,truck';
      });
      if (!hasOldPreset) return normalized;
      changed = true;
      return { ...normalized, workflow: { nodes: [], edges: [] } };
    });
    if (changed) localStorage.setItem(keys.projects, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

const REVISION_LIMIT = 20;

function versionSnapshot(project: DetVisionProject): ProjectRevision['snapshot'] {
  const { revisions: _revisions, facility_image: _facilityImage, floor_plan_image: _floorPlanImage, ...snapshot } = project;
  return snapshot;
}

function comparable(project: DetVisionProject): string {
  const { revisions: _revisions, updated_at: _updatedAt, facility_image: _facilityImage, floor_plan_image: _floorPlanImage, ...content } = project;
  return JSON.stringify(content);
}

export function saveProject(project: DetVisionProject, userId: string): DetVisionProject {
  if (typeof window === 'undefined' || !userId) return project;
  const keys = getStorageKeys(userId);
  const projects = getStoredProjects(userId);
  const idx = projects.findIndex(p => p.id === project.id);
  const now = new Date().toISOString();
  const old = idx >= 0 ? projects[idx] : null;
  const revisions = [...(old?.revisions ?? project.revisions ?? [])];
  if (!old) {
    revisions.unshift({ id: crypto.randomUUID(), created_at: now, label: 'Initial version', changes: ['Project created'], snapshot: versionSnapshot(project) });
  } else if (comparable(old) !== comparable(project)) {
    const changes = changedFields(old, project);
    revisions.unshift({ id: crypto.randomUUID(), created_at: now, label: changes.slice(0, 2).join(' · ') || 'Project edited', changes, snapshot: versionSnapshot(old) });
  }
  const updated = { ...project, revisions: revisions.slice(0, REVISION_LIMIT), updated_at: now };
  if (idx >= 0) {
    projects[idx] = updated;
  } else {
    projects.push(updated);
  }
  localStorage.setItem(keys.projects, JSON.stringify(projects));
  localStorage.setItem(keys.active, project.id);
  return updated;
}

function changedFields(before: DetVisionProject, after: DetVisionProject): string[] {
  const labels: Array<[keyof DetVisionProject, string]> = [
    ['name', 'Project name'], ['business_description', 'Project brief'], ['industry', 'Industry'],
    ['company_name', 'Company'], ['requirements', 'Requirements'], ['camera_specifications', 'Camera specifications'],
    ['available_hardware', 'Available hardware'], ['critical_components', 'Critical components'],
    ['layout_section_count', 'Layout sections'], ['detection_coverage_target', 'Coverage target'],
    ['cameras', 'Camera layout'], ['zones', 'Detection zones'], ['structure', 'Site structure'],
    ['use_cases', 'Use cases'], ['workflow', 'Workflow'], ['safety_plan', 'Safety plan'], ['output_scope', 'Report sections'],
  ];
  const changes = labels.filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(([, label]) => label);
  return changes.length ? changes : ['Project updated'];
}

export function deleteProjectRevision(userId: string, projectId: string, revisionId: string): DetVisionProject | null {
  const project = getProject(userId, projectId);
  if (!project) return null;
  const updated = { ...project, revisions: (project.revisions ?? []).filter(revision => revision.id !== revisionId) };
  const keys = getStorageKeys(userId);
  const projects = getStoredProjects(userId).map(item => item.id === projectId ? updated : item);
  localStorage.setItem(keys.projects, JSON.stringify(projects));
  return updated;
}

export function restoreProjectRevision(userId: string, projectId: string, revisionId: string): DetVisionProject | null {
  const current = getProject(userId, projectId);
  const revision = current?.revisions?.find(item => item.id === revisionId);
  if (!current || !revision) return null;
  const restored = { ...current, ...revision.snapshot, facility_image: current.facility_image, floor_plan_image: current.floor_plan_image };
  return saveProject(restored, userId);
}

export function getProject(userId: string, id: string): DetVisionProject | null {
  const projects = getStoredProjects(userId);
  return projects.find(p => p.id === id) || null;
}

export function getActiveProject(userId: string): DetVisionProject | null {
  if (typeof window === 'undefined' || !userId) return null;
  const activeId = localStorage.getItem(getStorageKeys(userId).active);
  if (!activeId) return null;
  return getProject(userId, activeId);
}

export function setActiveProject(userId: string, id: string): void {
  if (typeof window === 'undefined' || !userId) return;
  localStorage.setItem(getStorageKeys(userId).active, id);
}

export function deleteProject(userId: string, id: string): void {
  if (typeof window === 'undefined' || !userId) return;
  const keys = getStorageKeys(userId);
  const projects = getStoredProjects(userId).filter(p => p.id !== id);
  localStorage.setItem(keys.projects, JSON.stringify(projects));
  const activeId = localStorage.getItem(keys.active);
  if (activeId === id) {
    localStorage.removeItem(keys.active);
  }
}

export function createNewProject(userId: string, name: string, company: string, industry: string, description: string): DetVisionProject {
  const project = createEmptyProject(name, company, industry, description);
  return saveProject(project, userId);
}

export function exportProjectJSON(project: DetVisionProject): string {
  return JSON.stringify(project, null, 2);
}

export function importProjectJSON(userId: string, json: string): DetVisionProject {
  const project = JSON.parse(json) as DetVisionProject;
  project.id = crypto.randomUUID();
  project.created_at = new Date().toISOString();
  project.updated_at = new Date().toISOString();
  return saveProject(project, userId);
}

/** Legacy unscoped data is deliberately not loaded into any account automatically. */
export function hasLegacyProjects(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = localStorage.getItem(LEGACY_STORAGE_KEY);
    return !!value && Array.isArray(JSON.parse(value)) && JSON.parse(value).length > 0;
  } catch {
    return false;
  }
}

export function claimLegacyProjects(userId: string): DetVisionProject[] {
  if (typeof window === 'undefined' || !userId || getStoredProjects(userId).length) return [];
  try {
    const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
    const legacy = legacyValue ? JSON.parse(legacyValue) : null;
    if (!Array.isArray(legacy) || !legacy.length) return [];
    const claimed = legacy.filter((item): item is DetVisionProject => !!item && typeof item === 'object' && typeof item.id === 'string');
    if (!claimed.length) return [];
    const keys = getStorageKeys(userId);
    localStorage.setItem(keys.projects, JSON.stringify(claimed));
    const oldActiveId = localStorage.getItem('detvision_active_project');
    localStorage.setItem(keys.active, claimed.some(project => project.id === oldActiveId) ? oldActiveId! : claimed[0].id);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem('detvision_active_project');
    return claimed;
  } catch {
    return [];
  }
}

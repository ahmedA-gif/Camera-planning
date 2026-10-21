'use client';

import { Layers } from 'lucide-react';
import type { DetVisionProject } from '@/lib/types';
import { CameraCoveragePlanner } from './camera-coverage-planner';

interface CameraMapProps {
  project: DetVisionProject;
  projects: DetVisionProject[];
  onUpdate: (updates: Partial<DetVisionProject>) => void;
  onProjectSelect: (project: DetVisionProject) => void;
}

export function CameraMap({ project, projects, onUpdate, onProjectSelect }: CameraMapProps) {
  return (
    <div className="flex flex-1 min-h-0 flex-col bg-slate-50">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <label htmlFor="camera-map-project" className="text-sm font-semibold">Active Blueprint</label>
        <select
          id="camera-map-project"
          value={project.id}
          onChange={event => {
            const selected = projects.find(item => item.id === event.target.value);
            if (selected) onProjectSelect(selected);
          }}
          className="max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium"
        >
          {(projects.some(item => item.id === project.id) ? projects : [project, ...projects]).map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <span className="hidden md:inline truncate text-xs text-muted-foreground">
          Camera Coverage Planner · AI Architectural Layout & 3D Frustum Visualizer
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-cyan-500/10 text-cyan-700 border border-cyan-300 shadow-xs">
            <Layers className="w-3.5 h-3.5 text-cyan-600" />
            Coverage Planner Active
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <CameraCoveragePlanner
          project={project}
          onApplyToProject={(cams, structs, dims, wf) => {
            const rawUseCases = (project.use_cases || []).map(u => ({ ...u, camera_ids: [] as string[] }));
            if (rawUseCases.length > 0) {
              cams.forEach((cam, idx) => {
                const assignedUc = rawUseCases[idx % rawUseCases.length];
                if (assignedUc) {
                  cam.assigned_use_case_ids = [assignedUc.id];
                  if (!assignedUc.camera_ids.includes(cam.id)) {
                    assignedUc.camera_ids.push(cam.id);
                  }
                }
              });
            }
            const updatedZones = (project.zones || []).map((zone, zIdx) => {
              const assignedCamIds = cams.filter((_, cIdx) => cIdx % Math.max(1, (project.zones || []).length) === zIdx).map(c => c.id);
              return {
                ...zone,
                camera_ids: assignedCamIds.length > 0 ? assignedCamIds : (cams[0] ? [cams[0].id] : [])
              };
            });
            onUpdate({
              cameras: cams,
              use_cases: rawUseCases,
              zones: updatedZones,
              ...(structs ? { structure: structs } : {}),
              ...(dims || {}),
              ...(wf ? { workflow: wf } : {}),
            });
          }}
        />
      </div>
    </div>
  );
}

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
    <div className="flex flex-1 h-full min-h-0 flex-col bg-slate-50 overflow-hidden">
      <div className="flex-1 min-h-0 h-full overflow-hidden">
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

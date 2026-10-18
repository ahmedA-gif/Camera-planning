'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Line, Transformer, Rect, Text } from 'react-konva';
// Type-only import: importing `konva` at runtime here creates a second Konva
// instance alongside the copy bundled by react-konva ("Several Konva instances
// detected"). Types are erased at build time, so `react-konva` remains the
// single runtime instance.
import type Konva from 'konva';
import { 
  Plus, 
  Trash2, 
  RotateCw, 
  RotateCcw, 
  Eye, 
  EyeOff,
  Settings,
  Maximize2,
  Minimize2,
  Camera as CameraIcon,
  Lightbulb,
  MousePointer2,
  Brain,
  Loader2,
  AlertCircle,
  CheckCircle2,
  WandSparkles,
} from 'lucide-react';
import type { Camera, Zone, Point, DetVisionProject, LayoutElement } from '@/lib/types';

function uuid(): string {
  return crypto.randomUUID();
}

interface CameraMapProps {
  project: DetVisionProject;
  projects: DetVisionProject[];
  onUpdate: (updates: Partial<DetVisionProject>) => void;
  onProjectSelect: (project: DetVisionProject) => void;
}

interface SuggestedCamera {
  camera: Camera;
  zoneId?: string;
  target_area?: string;
  rationale?: string;
}

interface LayoutDraftMeta {
  source: 'ai' | 'local';
  summary: string;
  reasoning?: string[];
  model_used?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  notice?: string;
}

const CAMERA_COLORS = {
  planned: '#64748B',
  installed: '#3B82F6',
  active: '#10B981',
  maintenance: '#F59E0B',
  offline: '#EF4444',
};

const ZONE_COLORS = {
  detection: '#3B82F6',
  counting: '#10B981',
  exclusion: '#EF4444',
  roi: '#8B5CF6',
  virtual_line: '#F59E0B',
};

export function CameraMap({ project, projects, onUpdate, onProjectSelect }: CameraMapProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const zoneNodeRefs = useRef(new Map<string, Konva.Line>());
  const zoneTransformerRef = useRef<Konva.Transformer>(null);
  const zoneDragStartRef = useRef<Point | null>(null);
  const ignoreNextStageClickRef = useRef(false);
  const [floorPlan, setFloorPlan] = useState<string | null>(project.floor_plan_image ?? null);
  const [floorPlanImage, setFloorPlanImage] = useState<HTMLImageElement | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [showCones, setShowCones] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [tool, setTool] = useState<'select' | 'camera' | 'zone' | 'line' | 'structure'>('select');
  const [structureType, setStructureType] = useState<LayoutElement['type']>('wall');
  const [showSetupGuide, setShowSetupGuide] = useState(true);
  const [cameraReview, setCameraReview] = useState<{ summary: string; findings: Array<{ severity: string; title: string; detail: string }>; next_steps: string[]; mode?: string; model_used?: string; provider_notice?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pendingUseCaseId, setPendingUseCaseId] = useState<string | null>(null);
  const [zonePoints, setZonePoints] = useState<Point[]>([]);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<SuggestedCamera[]>([]);
  const [layoutStructureDraft, setLayoutStructureDraft] = useState<LayoutElement[]>([]);
  const [layoutDraftMeta, setLayoutDraftMeta] = useState<LayoutDraftMeta | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const autoLayoutForRef = useRef<string | null>(null);

  useEffect(() => {
    const canResize = project.zones.some(zone => zone.id === selectedZoneId && zone.type !== 'virtual_line');
    const node = selectedZoneId && canResize ? zoneNodeRefs.current.get(selectedZoneId) : null;
    zoneTransformerRef.current?.nodes(node && tool === 'select' ? [node] : []);
    zoneTransformerRef.current?.getLayer()?.batchDraw();
  }, [selectedZoneId, project.zones, tool]);

  useEffect(() => {
    if (!project.floor_plan_image) return;
    setFloorPlan(project.floor_plan_image);
  }, [project.floor_plan_image]);

  useEffect(() => {
    if (!floorPlan) {
      setFloorPlanImage(null);
      setImageLoaded(false);
      return;
    }
    const image = new Image();
    image.onload = () => {
      setFloorPlanImage(image);
      setStageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setImageLoaded(true);
    };
    image.onerror = () => setImageLoaded(false);
    image.src = floorPlan;
  }, [floorPlan]);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (ignoreNextStageClickRef.current) {
      ignoreNextStageClickRef.current = false;
      return;
    }
    if (tool === 'zone' || tool === 'structure') return;
    if (tool === 'camera') {
      const stage = stageRef.current;
      if (!stage) return;
      
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      const newCamera: Camera = {
        id: uuid(),
        name: `CAM-${project.cameras.length + 1}`,
        status: 'planned',
        x: pos.x / stageSize.width,
        y: pos.y / stageSize.height,
        orientation_degrees: 0,
        horizontal_fov_degrees: 90,
        view_range: 0.5,
        resolution_width: 1920,
        resolution_height: 1080,
        assigned_use_case_ids: pendingUseCaseId ? [pendingUseCaseId] : [],
      };

      onUpdate({
        cameras: [...project.cameras, newCamera],
        use_cases: pendingUseCaseId ? project.use_cases.map(useCase => useCase.id === pendingUseCaseId
          ? { ...useCase, camera_ids: [...new Set([...useCase.camera_ids, newCamera.id])] }
          : useCase) : project.use_cases,
      });
      setSelectedCameraId(newCamera.id);
      setPendingUseCaseId(null);
      setTool('select');
    } else if (tool === 'line') {
      const stage = stageRef.current;
      if (!stage) return;
      
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      setZonePoints(prev => [...prev, { 
        x: pos.x / stageSize.width, 
        y: pos.y / stageSize.height 
      }]);
    } else {
      // Deselect on background click
      setSelectedCameraId(null);
      setSelectedZoneId(null);
      setSelectedStructureId(null);
    }
  };

  const getNormalizedPointer = () => {
    const pos = stageRef.current?.getRelativePointerPosition();
    if (!pos) return null;
    return {
      x: Math.max(0, Math.min(1, pos.x / stageSize.width)),
      y: Math.max(0, Math.min(1, pos.y / stageSize.height)),
    };
  };

  const handleStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if ((tool !== 'zone' && tool !== 'structure') || (event.target !== event.target.getStage() && !event.target.hasName('map-background'))) return;
    const point = getNormalizedPointer();
    if (!point) return;
    zoneDragStartRef.current = point;
    setZonePoints([point, point]);
  };

  const handleStageMouseMove = () => {
    if ((tool !== 'zone' && tool !== 'structure') || !zoneDragStartRef.current) return;
    const point = getNormalizedPointer();
    if (point) setZonePoints([zoneDragStartRef.current, point]);
  };

  const handleStageMouseUp = () => {
    const start = zoneDragStartRef.current;
    if ((tool !== 'zone' && tool !== 'structure') || !start) return;
    const activeTool = tool;
    const end = getNormalizedPointer();
    zoneDragStartRef.current = null;
    if (!end) return;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    const width = (right - left) * stageSize.width;
    const height = (bottom - top) * stageSize.height;
    if (activeTool === 'zone' && (width < 12 || height < 12)) {
      setZonePoints([]);
      return;
    }
    if (activeTool === 'structure') {
      const isObstacle = structureType === 'obstacle';
      if (isObstacle ? width < 12 || height < 12 : Math.hypot(width, height) < 12) {
        setZonePoints([]);
        return;
      }
      const elements = project.structure ?? [];
      const typeName = structureType === 'wall' ? 'Wall' : structureType === 'entrance' ? 'Entrance' : 'Obstacle';
      const points = isObstacle
        ? [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
        : [start, end];
      const item: LayoutElement = { id: uuid(), name: `${typeName} ${elements.filter(element => element.type === structureType).length + 1}`, type: structureType, points };
      onUpdate({ structure: [...elements, item] });
      setSelectedCameraId(null);
      setSelectedZoneId(null);
      setSelectedStructureId(item.id);
      setZonePoints([]);
      setTool('select');
      ignoreNextStageClickRef.current = true;
      return;
    }
    const zones = project.zones;
    const newZone: Zone = {
      id: uuid(),
      name: `Zone ${zones.filter(zone => zone.type !== 'virtual_line').length + 1}`,
      type: 'detection',
      points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
      camera_ids: [],
      color: ZONE_COLORS.detection,
    };
    onUpdate({ zones: [...zones, newZone] });
    setSelectedCameraId(null);
    setSelectedZoneId(newZone.id);
    setZonePoints([]);
    setTool('select');
    ignoreNextStageClickRef.current = true;
  };

  const finishZone = () => {
    if (zonePoints.length < (tool === 'line' ? 2 : 3)) return;

    const newZone: Zone = {
      id: uuid(),
      name: tool === 'line'
        ? `Counting line ${project.zones.filter(zone => zone.type === 'virtual_line').length + 1}`
        : `Zone ${project.zones.filter(zone => zone.type !== 'virtual_line').length + 1}`,
      type: tool === 'line' ? 'virtual_line' : 'detection',
      points: zonePoints,
      camera_ids: [],
      color: ZONE_COLORS[tool === 'line' ? 'virtual_line' : 'detection'],
    };

    onUpdate({ zones: [...project.zones, newZone] });
    setZonePoints([]);
    setTool('select');
  };

  const layoutReview = getLayoutReview(project, stageSize);
  const zoneCoverage = getZoneCenterCoverage(project, stageSize);

  const createLocalStructureDraft = (): LayoutElement[] => {
    const wall = (name: string, from: Point, to: Point): LayoutElement => ({ id: uuid(), name, type: 'wall', points: [from, to] });
    return [
      wall('Suggested north wall', { x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }),
      wall('Suggested east wall', { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }),
      wall('Suggested south wall', { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }),
      wall('Suggested west wall', { x: 0.06, y: 0.94 }, { x: 0.06, y: 0.06 }),
      { id: uuid(), name: 'Suggested entrance', type: 'entrance', points: [{ x: 0.4, y: 0.94 }, { x: 0.6, y: 0.94 }] },
      { id: uuid(), name: 'Suggested obstacle block A', type: 'obstacle', points: [{ x: 0.62, y: 0.2 }, { x: 0.82, y: 0.2 }, { x: 0.82, y: 0.45 }, { x: 0.62, y: 0.45 }] },
      { id: uuid(), name: 'Suggested obstacle block B', type: 'obstacle', points: [{ x: 0.18, y: 0.55 }, { x: 0.4, y: 0.55 }, { x: 0.4, y: 0.8 }, { x: 0.18, y: 0.8 }] },
    ];
  };

  const createLocalLayoutDraft = (count: number, uncovered: Zone[]): SuggestedCamera[] => {
    const resolution = /4k|3840\s*[x×]\s*2160/i.test(project.camera_specifications || '') ? [3840, 2160] : [1920, 1080];
    return Array.from({ length: count }, (_, index) => {
      const zone = uncovered[index];
      const center = zone ? zone.points.reduce((point, current) => ({ x: point.x + current.x / zone.points.length, y: point.y + current.y / zone.points.length }), { x: 0, y: 0 }) : null;
      const x = center ? Math.max(0.05, Math.min(0.95, center.x + (center.x > 0.5 ? 0.14 : -0.14))) : (index + 1) / (count + 1);
      const y = center ? Math.max(0.05, Math.min(0.95, center.y + (center.y > 0.5 ? 0.14 : -0.14))) : (index % 2 === 0 ? 0.12 : 0.88);
      const orientation = center ? (Math.atan2((center.x - x) * stageSize.width, -(center.y - y) * stageSize.height) * 180 / Math.PI + 360) % 360 : (index % 2 === 0 ? 180 : 0);
      const assigned = project.use_cases.length ? [project.use_cases[index % project.use_cases.length].id] : [];
      return {
        zoneId: zone?.id,
        target_area: zone?.name || project.layout_sections?.[index % Math.max(1, project.layout_sections.length)] || `Layout section ${index + 1}`,
        rationale: 'Local placement suggestion based on the project zones and layout sections. Confirm dimensions and sight lines on site.',
        camera: { id: uuid(), name: `CAM-${project.cameras.length + index + 1}`, status: 'planned', x, y, orientation_degrees: orientation, horizontal_fov_degrees: 90, view_range: 0.5, resolution_width: resolution[0], resolution_height: resolution[1], assigned_use_case_ids: assigned },
      };
    });
  };

  const generateLayoutDraft = async () => {
    setShowSetupGuide(true);
    const uncovered = project.zones.filter(zone => zone.type !== 'virtual_line' && !zoneCoverage.coveredZoneIds.includes(zone.id));
    const inferredProjectCameraCount = Math.max(
      project.layout_sections?.length || 0,
      project.use_cases.length,
      project.critical_components?.length || 0,
      project.layout_section_count || 0,
      3,
    );
    const remainingCameraCount = Math.max(1, inferredProjectCameraCount - project.cameras.length);
    const count = Math.max(1, Math.min(8, uncovered.length || remainingCameraCount));
    setLayoutLoading(true);
    setLayoutDraft([]);
    setLayoutStructureDraft([]);
    setLayoutDraftMeta(null);
    try {
      const response = await fetch('/api/camera/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          desired_camera_count: count,
          project: {
            id: project.id, name: project.name, company_name: project.company_name, industry: project.industry,
            business_description: project.business_description, requirements: project.requirements,
            use_cases: project.use_cases, camera_specifications: project.camera_specifications,
            available_hardware: project.available_hardware, critical_components: project.critical_components,
            layout_section_count: project.layout_section_count, layout_sections: project.layout_sections,
            detection_coverage_target: project.detection_coverage_target, cameras: project.cameras,
            zones: project.zones, structure: project.structure,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const retryHint = data.retry_after_seconds ? ` Retry in about ${data.retry_after_seconds} seconds.` : '';
        throw new Error(`${data.error || 'AI layout generation failed.'}${retryHint}`);
      }
      if (data.fallback === 'local') {
        setLayoutDraft(createLocalLayoutDraft(count, uncovered));
        setLayoutStructureDraft((project.structure ?? []).length ? [] : createLocalStructureDraft());
        setLayoutDraftMeta({ source: 'local', summary: 'A locally generated camera draft is ready. Review it against the selected scenario and adjust its positions before applying.', notice: String(data.notice || '') });
        setSelectedCameraId(null);
        return;
      }
      if (data.project_id !== project.id) throw new Error('The selected project changed while the layout was generating. Please try again.');
      const generated: SuggestedCamera[] = data.cameras.map((camera: Camera & { target_area?: string; rationale?: string }, index: number) => ({
        camera,
        zoneId: uncovered[index]?.id,
        target_area: camera.target_area || uncovered[index]?.name || project.layout_sections?.[index] || `Layout section ${index + 1}`,
        rationale: camera.rationale,
      }));
      const generatedStructure: LayoutElement[] = Array.isArray(data.structure)
        ? data.structure
          .filter((item: Record<string, unknown>) => item && typeof item === 'object' && ['wall', 'obstacle', 'entrance'].includes(String(item.type)))
          .slice(0, 40)
          .map((item: Record<string, unknown>, index: number) => ({
            id: uuid(),
            name: String(item.name || `Suggested ${String(item.type)} ${index + 1}`).slice(0, 80),
            type: String(item.type) as LayoutElement['type'],
            points: Array.isArray(item.points)
              ? item.points.slice(0, 30).map((point: unknown) => {
                  const value = point && typeof point === 'object' ? point as Record<string, unknown> : {};
                  return { x: Math.max(0, Math.min(1, Number(value.x))), y: Math.max(0, Math.min(1, Number(value.y))) };
                }).filter((point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y))
              : [],
          }))
          .filter((item: LayoutElement) => item.points.length >= (item.type === 'obstacle' ? 3 : 2))
        : [];
      setLayoutDraft(generated);
      setLayoutStructureDraft(generatedStructure);
      setLayoutDraftMeta({
        source: 'ai',
        summary: data.summary,
        reasoning: Array.isArray(data.reasoning) ? data.reasoning.filter((item: unknown): item is string => typeof item === 'string').slice(0, 6) : undefined,
        model_used: data.model_used,
        usage: data.usage,
      });
      setSelectedCameraId(generated[0]?.camera.id ?? null);
    } catch (error) {
      const notice = error instanceof Error ? error.message : 'AI layout generation failed.';
      setLayoutDraft(createLocalLayoutDraft(count, uncovered));
      setLayoutStructureDraft((project.structure ?? []).length ? [] : createLocalStructureDraft());
      setLayoutDraftMeta({ source: 'local', summary: 'A locally generated camera draft is ready. Review it against the selected scenario and adjust its positions before applying.', notice });
      setSelectedCameraId(null);
    } finally {
      setLayoutLoading(false);
    }
  };

  const applyLayoutDraft = () => {
    if (!layoutDraft.length && !layoutStructureDraft.length) return;
    const cameras = [...project.cameras, ...layoutDraft.map(item => item.camera)];
    const zones = project.zones.map(zone => {
      const assigned = layoutDraft.filter(item => item.zoneId === zone.id).map(item => item.camera.id);
      return assigned.length ? { ...zone, camera_ids: [...new Set([...zone.camera_ids, ...assigned])] } : zone;
    });
    const use_cases = project.use_cases.map(useCase => ({ ...useCase, camera_ids: [...new Set([...useCase.camera_ids, ...layoutDraft.filter(item => item.camera.assigned_use_case_ids.includes(useCase.id)).map(item => item.camera.id)])] }));
    const structure = [...(project.structure ?? []), ...layoutStructureDraft];
    onUpdate({ cameras, zones, use_cases, structure });
    setSelectedCameraId(null);
    setLayoutDraft([]);
    setLayoutStructureDraft([]);
    setLayoutDraftMeta(null);
  };

  // If the user has not placed any cameras yet, generate a possible camera layout
  // (buildings, obstacles, and cameras) automatically once per project per browser
  // session. It stays an editable draft until the user applies it.
  useEffect(() => {
    if (typeof window === 'undefined' || autoLayoutForRef.current === project.id) return;
    if (!project.business_description.trim()) return;
    if (project.cameras.length > 0 || layoutDraft.length > 0 || layoutLoading) return;
    const storageKey = `detvision_auto_layout:${project.id}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, '1');
    autoLayoutForRef.current = project.id;
    void generateLayoutDraft();
    // generateLayoutDraft is intentionally read from the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.business_description, project.cameras.length, layoutDraft.length, layoutLoading]);

  const requestCameraReview = async () => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      const largestSide = Math.max(stageSize.width, stageSize.height);
      const pixelRatio = Math.min(1, 1400 / largestSide);
      const diagramImage = stageRef.current?.toDataURL({ mimeType: 'image/jpeg', quality: 0.78, pixelRatio });
      const response = await fetch('/api/camera/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, diagram_image: diagramImage }),
      });
      const data = await response.json();
      if (response.status === 429) {
        setCameraReview({
          summary: 'Groq reached a request or token limit, so these results use local checks from the selected project layout.',
          findings: layoutReview.map(detail => ({ severity: 'info', title: 'Local layout check', detail })),
          next_steps: ['Wait for the Groq limit to reset before requesting another AI review.', 'You can continue generating, editing, and applying a camera layout now.'],
          model_used: 'Local project checks',
          provider_notice: data.error,
        });
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Camera review failed.');
      setCameraReview(data);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Camera review failed.');
    } finally {
      setReviewLoading(false);
    }
  };

  const cancelZone = () => {
    setZonePoints([]);
    setTool('select');
  };

  const updateCamera = (id: string, updates: Partial<Camera>) => {
    if (layoutDraft.some(item => item.camera.id === id)) {
      setLayoutDraft(current => current.map(item => item.camera.id === id ? { ...item, camera: { ...item.camera, ...updates } } : item));
      return;
    }
    onUpdate({
      cameras: project.cameras.map(c => c.id === id ? { ...c, ...updates } : c),
    });
  };

  const updateZone = (id: string, updates: Partial<Zone>) => {
    onUpdate({
      zones: project.zones.map(z => z.id === id ? { ...z, ...updates } : z),
    });
  };

  const deleteCamera = (id: string) => {
    if (layoutDraft.some(item => item.camera.id === id)) {
      setLayoutDraft(current => current.filter(item => item.camera.id !== id));
      setSelectedCameraId(null);
      return;
    }
    onUpdate({
      cameras: project.cameras.filter(c => c.id !== id),
      zones: project.zones.map(zone => ({ ...zone, camera_ids: zone.camera_ids.filter(cameraId => cameraId !== id) })),
      use_cases: project.use_cases.map(useCase => ({
        ...useCase,
        camera_ids: useCase.camera_ids.filter(cameraId => cameraId !== id),
      })),
    });
    if (selectedCameraId === id) setSelectedCameraId(null);
  };

  const deleteZone = (id: string) => {
    onUpdate({
      zones: project.zones.filter(z => z.id !== id),
    });
    if (selectedZoneId === id) setSelectedZoneId(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    const source = new Image();
    source.onload = () => {
      const maxDimension = 1800;
      const scale = Math.min(1, maxDimension / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setFloorPlan(dataUrl);
      onUpdate({ floor_plan_image: dataUrl });
      URL.revokeObjectURL(objectUrl);
    };
    source.onerror = () => URL.revokeObjectURL(objectUrl);
    source.src = objectUrl;
    e.target.value = '';
  };

  const getConePoints = (camera: Camera, width: number, height: number) => {
    const range = camera.view_range * Math.min(width, height);
    const fov = camera.horizontal_fov_degrees;
    // The camera group already applies its orientation; the cone is drawn in local space.
    const angle = -Math.PI / 2;
    const halfFov = (fov / 2) * Math.PI / 180;

    return [
      0, 0,
      Math.cos(angle - halfFov) * range, Math.sin(angle - halfFov) * range,
      Math.cos(angle + halfFov) * range, Math.sin(angle + halfFov) * range,
    ];
  };

  const getSetupSuggestion = (useCase: (typeof project.use_cases)[number]) => {
    const context = `${useCase.name} ${useCase.description} ${useCase.task_type}`.toLowerCase();
    if (context.includes('count') || context.includes('cross')) {
      return 'Cover the full entry or movement path, then draw a virtual line across the point where objects should be counted.';
    }
    if (context.includes('ocr') || context.includes('text') || context.includes('plate')) {
      return 'Use a dedicated, close view of the label or plate. Keep the target unobstructed and avoid aiming into glare.';
    }
    if (context.includes('track') || context.includes('near-miss') || context.includes('proximity')) {
      return 'Favor an elevated, wide view of the interaction area. Add coverage around corners or obstructions where subjects disappear.';
    }
    if (context.includes('anomal') || context.includes('defect')) {
      return 'Keep the inspection view stable and evenly lit. Frame the entire inspection surface with enough detail for the target defect.';
    }
    return 'Choose a clear, unobstructed view of the target area. Check the viewing cone on the map and adjust its direction and width.';
  };

  const startSuggestedPlacement = (useCaseId: string) => {
    setPendingUseCaseId(useCaseId);
    setTool('camera');
    setShowSetupGuide(false);
  };

  const CameraMarker = ({ camera, isSelected, onSelect, onDelete, onRotateCw, onRotateCcw, isDraft = false }: {
    camera: Camera;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onRotateCw: () => void;
    onRotateCcw: () => void;
    isDraft?: boolean;
  }) => {
    const x = camera.x * stageSize.width;
    const y = camera.y * stageSize.height;
    const color = isDraft ? '#7c3aed' : CAMERA_COLORS[camera.status];

    return (
      <Group 
        x={x} 
        y={y} 
        rotation={camera.orientation_degrees}
        onClick={(e) => { e.cancelBubble = true; onSelect(); }}
        draggable
        onDragEnd={(e) => {
          const pos = e.target.position();
          updateCamera(camera.id, { 
            x: pos.x / stageSize.width, 
            y: pos.y / stageSize.height 
          });
        }}
      >
        {/* View Cone */}
        {showCones && (
          <Line
            points={getConePoints(camera, stageSize.width, stageSize.height)}
            fill={color + '20'}
            stroke={color + '80'}
            strokeWidth={1}
            strokeDash={[5, 5]}
            closed
          />
        )}

        {/* Camera Body */}
        <Circle
          x={0}
          y={0}
          radius={isSelected ? 18 : 14}
          fill={color}
          stroke={isSelected ? '#fff' : color}
          strokeWidth={isSelected ? 3 : 2}
          shadowColor="black"
          shadowBlur={4}
          shadowOffset={{ x: 0, y: 2 }}
          shadowOpacity={0.3}
        />

        {/* Direction Indicator */}
        <Line
          points={[0, 0, 0, -20]}
          stroke="white"
          strokeWidth={3}
          strokeLineCap="round"
        />

        {/* Keep the label level while the camera icon rotates. */}
        <Group rotation={-camera.orientation_degrees} listening={false}>
          <Rect x={-68} y={19} width={136} height={20} fill="#ffffff" opacity={0.96} stroke={color} strokeWidth={1} cornerRadius={5} shadowColor="#000000" shadowBlur={3} shadowOpacity={0.16} />
          <Text x={-63} y={22} width={126} height={14} text={`${isDraft ? 'DRAFT' : 'CAMERA'} · ${camera.name}`} fontSize={10} fontFamily="Inter, sans-serif" fontStyle="bold" fill="#0f172a" align="center" verticalAlign="middle" ellipsis />
        </Group>

        {/* Selection Controls */}
        {isSelected && (
          <Group x={25} y={-25}>
            <Circle x={0} y={0} radius={12} fill="white" stroke={color} strokeWidth={2} onClick={(e) => { e.cancelBubble = true; onRotateCcw(); }} />
            <Text x={0} y={0} text="↺" fontSize={12} fill={color} align="center" offset={{ x: 6, y: 4 }} />
            
            <Circle x={30} y={0} radius={12} fill="white" stroke={color} strokeWidth={2} onClick={(e) => { e.cancelBubble = true; onRotateCw(); }} />
            <Text x={30} y={0} text="↻" fontSize={12} fill={color} align="center" offset={{ x: 6, y: 4 }} />
            
            <Circle x={60} y={0} radius={12} fill="white" stroke="red" strokeWidth={2} onClick={(e) => { e.cancelBubble = true; onDelete(); }} />
            <Text x={60} y={0} text="🗑" fontSize={12} align="center" offset={{ x: 6, y: 4 }} />
          </Group>
        )}
      </Group>
    );
  };

  const MapLabel = ({ x, y, label, color }: { x: number; y: number; label: string; color: string }) => {
    const labelWidth = Math.min(220, Math.max(92, label.length * 6.2 + 18));
    const labelX = Math.max(labelWidth / 2 + 4, Math.min(stageSize.width - labelWidth / 2 - 4, x));
    const labelY = Math.max(13, Math.min(stageSize.height - 13, y));
    return (
      <Group x={labelX} y={labelY} listening={false}>
        <Rect x={-labelWidth / 2} y={-11} width={labelWidth} height={22} fill="#ffffff" opacity={0.96} stroke={color} strokeWidth={1.25} cornerRadius={6} shadowColor="#000000" shadowBlur={3} shadowOpacity={0.16} />
        <Text x={-labelWidth / 2 + 7} y={-7} width={labelWidth - 14} height={14} text={label} fontSize={10} fontFamily="Inter, sans-serif" fontStyle="bold" fill="#0f172a" align="center" verticalAlign="middle" ellipsis />
      </Group>
    );
  };

  const ZoneShape = ({ zone, isSelected }: { zone: Zone; isSelected: boolean }) => {
    const center = zone.points.reduce((acc, point) => ({ x: acc.x + point.x / zone.points.length, y: acc.y + point.y / zone.points.length }), { x: 0, y: 0 });
    const lineNumber = zone.name.match(/(\d+)\s*$/)?.[1] ?? `${project.zones.filter(item => item.type === 'virtual_line').findIndex(item => item.id === zone.id) + 1}`;
    const label = zone.type === 'virtual_line' ? `COUNTING LINE ${lineNumber}` : `ZONE · ${zone.name}`;
    const shapeProps = {
      ref: (node: Konva.Line | null) => {
        if (node) zoneNodeRefs.current.set(zone.id, node);
        else zoneNodeRefs.current.delete(zone.id);
      },
      draggable: tool === 'select',
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => { e.cancelBubble = true; setSelectedCameraId(null); setSelectedStructureId(null); setSelectedZoneId(zone.id); },
      onTap: (e: Konva.KonvaEventObject<TouchEvent>) => { e.cancelBubble = true; setSelectedCameraId(null); setSelectedStructureId(null); setSelectedZoneId(zone.id); },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target as Konva.Line;
        const offset = node.position();
        const points = node.points();
        node.position({ x: 0, y: 0 });
        updateZone(zone.id, { points: points.reduce<Point[]>((result, value, index) => {
          if (index % 2 === 0) result.push({ x: (value + offset.x) / stageSize.width, y: (points[index + 1] + offset.y) / stageSize.height });
          return result;
        }, []) });
      },
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
        const node = e.target as Konva.Line;
        const scale = node.scale();
        const offset = node.position();
        const points = node.points();
        node.position({ x: 0, y: 0 });
        node.scale({ x: 1, y: 1 });
        updateZone(zone.id, { points: points.reduce<Point[]>((result, value, index) => {
          if (index % 2 === 0) result.push({ x: (value * scale.x + offset.x) / stageSize.width, y: (points[index + 1] * scale.y + offset.y) / stageSize.height });
          return result;
        }, []) });
      },
      listening: tool === 'select',
    };
    if (zone.type === 'virtual_line' && zone.points.length >= 2) {
      return (
        <>
          <Line {...shapeProps} points={zone.points.flatMap(p => [p.x * stageSize.width, p.y * stageSize.height])} stroke={zone.color} strokeWidth={isSelected ? 4 : 2} strokeDash={[10, 5]} strokeLineCap="round" />
          <MapLabel x={center.x * stageSize.width} y={center.y * stageSize.height - 16} label={label} color={zone.color} />
        </>
      );
    }

    if (zone.points.length >= 3) {
      return (
        <>
          <Line {...shapeProps} points={zone.points.flatMap(p => [p.x * stageSize.width, p.y * stageSize.height])} fill={zone.color + '20'} stroke={zone.color} strokeWidth={isSelected ? 3 : 2} strokeDash={[5, 5]} closed />
          <MapLabel x={center.x * stageSize.width} y={center.y * stageSize.height} label={label} color={zone.color} />
        </>
      );
    }

    return null;
  };

  const StructureShape = ({ item, width, height, isSelected }: { item: LayoutElement; width: number; height: number; isSelected: boolean }) => {
    const colors: Record<LayoutElement['type'], string> = { wall: '#334155', obstacle: '#EF4444', entrance: '#10B981' };
    const points = item.points.flatMap(point => [point.x * width, point.y * height]);
    const center = item.points.reduce((acc, point) => ({ x: acc.x + point.x / item.points.length, y: acc.y + point.y / item.points.length }), { x: 0, y: 0 });
    return <>
      <Line points={points} closed={item.type === 'obstacle'} fill={item.type === 'obstacle' ? '#EF444433' : undefined} stroke={colors[item.type]} strokeWidth={(item.type === 'wall' ? 7 : 4) + (isSelected ? 2 : 0)} dash={item.type === 'entrance' ? [8, 5] : undefined} lineCap="round" lineJoin="round" onClick={event => { event.cancelBubble = true; setSelectedCameraId(null); setSelectedZoneId(null); setSelectedStructureId(item.id); }} onTap={event => { event.cancelBubble = true; setSelectedCameraId(null); setSelectedZoneId(null); setSelectedStructureId(item.id); }} />
      <MapLabel x={center.x * width} y={center.y * height} label={`${item.type.toUpperCase()} · ${item.name}`} color={colors[item.type]} />
    </>;
  };

  const StructureDraftShape = ({ item, width, height }: { item: LayoutElement; width: number; height: number }) => {
    const points = item.points.flatMap(point => [point.x * width, point.y * height]);
    const center = item.points.reduce((acc, point) => ({ x: acc.x + point.x / item.points.length, y: acc.y + point.y / item.points.length }), { x: 0, y: 0 });
    return <>
      <Line
        points={points}
        closed={item.type === 'obstacle'}
        fill={item.type === 'obstacle' ? '#7c3aed22' : undefined}
        stroke="#7c3aed"
        strokeWidth={item.type === 'wall' ? 6 : 3}
        dash={[8, 5]}
        lineCap="round"
        lineJoin="round"
        listening={false}
        opacity={0.9}
      />
      <MapLabel x={center.x * width} y={center.y * height} label={`DRAFT ${item.type.toUpperCase()} · ${item.name}`} color="#7c3aed" />
    </>;
  };

  const DrawingPreview = () => {
    if (zonePoints.length === 0) return null;
    
    const points = zonePoints.flatMap(p => [p.x * stageSize.width, p.y * stageSize.height]);

    if (tool === 'zone' && zonePoints.length >= 2) {
      const left = Math.min(zonePoints[0].x, zonePoints[1].x) * stageSize.width;
      const top = Math.min(zonePoints[0].y, zonePoints[1].y) * stageSize.height;
      const width = Math.abs(zonePoints[1].x - zonePoints[0].x) * stageSize.width;
      const height = Math.abs(zonePoints[1].y - zonePoints[0].y) * stageSize.height;
      return <Rect x={left} y={top} width={width} height={height} fill={`${ZONE_COLORS.detection}22`} stroke={ZONE_COLORS.detection} strokeWidth={2} dash={[6, 4]} listening={false} />;
    }
    
    if (tool === 'structure') {
      const color = structureType === 'wall' ? '#334155' : structureType === 'entrance' ? '#10B981' : '#EF4444';
      if (structureType === 'obstacle' && zonePoints.length >= 2) {
        const left = Math.min(zonePoints[0].x, zonePoints[1].x) * stageSize.width;
        const top = Math.min(zonePoints[0].y, zonePoints[1].y) * stageSize.height;
        return <Rect x={left} y={top} width={Math.abs(zonePoints[1].x - zonePoints[0].x) * stageSize.width} height={Math.abs(zonePoints[1].y - zonePoints[0].y) * stageSize.height} fill={`${color}33`} stroke={color} strokeWidth={3} dash={[6, 4]} listening={false} />;
      }
      return <Line points={points} stroke={color} strokeWidth={structureType === 'wall' ? 7 : 4} dash={structureType === 'entrance' ? [8, 5] : undefined} lineCap="round" lineJoin="round" />;
    }

    if (tool === 'line') {
      return (
        <>
          <Line
            points={points}
            stroke={ZONE_COLORS.virtual_line}
            strokeWidth={2}
            strokeDash={[10, 5]}
            strokeLineCap="round"
          />
          {zonePoints.length > 0 && (
            <Circle
              x={zonePoints[zonePoints.length - 1].x * stageSize.width}
              y={zonePoints[zonePoints.length - 1].y * stageSize.height}
              radius={6}
              fill={ZONE_COLORS.virtual_line}
              stroke="white"
              strokeWidth={2}
            />
          )}
        </>
      );
    }

    return (
      <>
        {zonePoints.length >= 2 && (
          <Line
            points={points}
            stroke={ZONE_COLORS.detection}
            strokeWidth={2}
            strokeDash={[5, 5]}
          />
        )}
        {zonePoints.length >= 3 && (
          <Line
            points={points}
            fill={ZONE_COLORS.detection + '20'}
            stroke={ZONE_COLORS.detection}
            strokeWidth={2}
            strokeDash={[5, 5]}
            closed
          />
        )}
        {zonePoints.map((p, i) => (
          <Circle
            key={i}
            x={p.x * stageSize.width}
            y={p.y * stageSize.height}
            radius={i === zonePoints.length - 1 ? 8 : 6}
            fill={i === zonePoints.length - 1 ? ZONE_COLORS.detection : 'white'}
            stroke={ZONE_COLORS.detection}
            strokeWidth={2}
          />
        ))}
      </>
    );
  };

  const selectedCamera = project.cameras.find(camera => camera.id === selectedCameraId)
    ?? layoutDraft.find(item => item.camera.id === selectedCameraId)?.camera;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <label htmlFor="camera-map-project" className="text-sm font-medium">Layout project</label>
        <select id="camera-map-project" value={project.id} onChange={event => {
          const selected = projects.find(item => item.id === event.target.value);
          if (selected) onProjectSelect(selected);
        }} className="max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm">
          {(projects.some(item => item.id === project.id) ? projects : [project, ...projects]).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <span className="truncate text-xs text-muted-foreground">AI layout suggestions use this project’s scenario and use cases.</span>
      </div>
      <div className="flex flex-1 min-h-0">
      {/* Toolbar */}
      <div className="w-24 shrink-0 bg-white border-r border-border flex flex-col p-2 gap-1">
        <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" id="floorplan-upload" />
        <label htmlFor="floorplan-upload" className="flex cursor-pointer flex-col items-center gap-1 rounded p-2 text-muted-foreground hover:bg-muted" title={floorPlan ? 'Replace floor plan' : 'Upload floor plan'}>
          <CameraIcon className="h-5 w-5" />
          <span className="text-center text-[10px] leading-tight">{floorPlan ? 'Change plan' : 'Add plan'}</span>
        </label>
        <button
          onClick={() => setTool('select')}
          className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${tool === 'select' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          title="Select objects"
        >
          <MousePointer2 className="w-5 h-5" /><span className="text-[10px]">Select</span>
        </button>
        
        <button
          onClick={() => setTool('camera')}
          className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${tool === 'camera' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          title="Add Camera (C)"
        >
          <Plus className="w-5 h-5" /><span className="text-[10px]">Add camera</span>
        </button>

        <button
          onClick={() => setTool('zone')}
          className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${tool === 'zone' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          title="Draw an area: drag to create a resizable rectangle"
        >
          <Settings className="w-5 h-5" /><span className="text-[10px]">Area zone</span>
        </button>

        <button
          onClick={() => setTool('line')}
          className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${tool === 'line' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          title="Draw a counting line: click two endpoints"
        >
          <Minimize2 className="w-5 h-5" /><span className="text-[10px]">Counting line</span>
        </button>

        <div className="my-1 border-t border-border" />
        <p className="px-1 text-[10px] font-semibold text-muted-foreground">Draw a specific item</p>
        {([
          { type: 'wall', label: 'Wall', hint: 'Drag a straight wall segment' },
          { type: 'obstacle', label: 'Obstacle', hint: 'Drag a rectangular obstacle' },
          { type: 'entrance', label: 'Entrance', hint: 'Drag across the opening' },
        ] as const).map(({ type, label, hint }) => (
          <button key={type} onClick={() => { setStructureType(type); setZonePoints([]); setSelectedCameraId(null); setSelectedZoneId(null); setSelectedStructureId(null); setTool('structure'); }} className={`flex flex-col items-center gap-1 rounded p-2 text-center transition-colors ${tool === 'structure' && structureType === type ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} title={hint} aria-label={`Draw ${label}: ${hint}`}>
            <Settings className="h-4 w-4" /><span className="text-[10px] leading-tight">{label}</span>
          </button>
        ))}

        <button
          onClick={() => setShowSetupGuide(value => !value)}
          className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${showSetupGuide ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          title="Camera setup guide"
        >
          <Lightbulb className="h-5 w-5" /><span className="text-center text-[10px] leading-tight">Setup guide</span>
        </button>
        <button onClick={generateLayoutDraft} disabled={layoutLoading || !project.business_description.trim()} className="flex flex-col items-center gap-1 rounded p-2 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50" title={!project.business_description.trim() ? 'Add a scenario description first' : 'Generate an AI camera layout for this project'}>
          {layoutLoading ? <Loader2 className="h-5 w-5 animate-spin"/> : <WandSparkles className="h-5 w-5"/>}<span className="text-center text-[10px] leading-tight">{layoutLoading ? 'Generating…' : 'AI layout'}</span>
        </button>

        <div className="border-t border-border my-1" />

        <label title="Show or hide camera viewing cones" className="flex items-center justify-center gap-1 px-1 py-1 text-[10px] text-muted-foreground cursor-pointer">
          <input aria-label="View cones" type="checkbox" checked={showCones} onChange={e => setShowCones(e.target.checked)} className="h-4 w-4 accent-primary" />
          <span>Cones</span>
        </label>

        <label title="Show or hide zones and virtual lines" className="flex items-center justify-center gap-1 px-1 py-1 text-[10px] text-muted-foreground cursor-pointer">
          <input aria-label="Show zones" type="checkbox" checked={showZones} onChange={e => setShowZones(e.target.checked)} className="h-4 w-4 accent-primary" />
          <span>Zones</span>
        </label>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 relative overflow-auto bg-gray-100">
      <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onClick={handleStageClick}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          style={{ cursor: tool === 'camera' || tool === 'zone' || tool === 'line' || tool === 'structure' ? 'crosshair' : 'default' }}
        >
          <Layer>
            {!floorPlan && <Rect name="map-background" x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#ffffff" />}
            {/* Floor Plan Image */}
            {floorPlan && imageLoaded && (
              <KonvaImage
                name="map-background"
                image={floorPlanImage!}
                x={0}
                y={0}
                width={stageSize.width}
                height={stageSize.height}
              />
            )}

            {(project.structure ?? []).map(item => <StructureShape key={item.id} item={item} width={stageSize.width} height={stageSize.height} isSelected={selectedStructureId === item.id} />)}

            {/* Drawing Preview */}
            {(tool === 'zone' || tool === 'line' || tool === 'structure') && <DrawingPreview />}

            {/* Zones */}
            {showZones && project.zones.map(zone => (
              <ZoneShape key={zone.id} zone={zone} isSelected={selectedZoneId === zone.id} />
            ))}
            <Transformer
              ref={zoneTransformerRef}
              rotateEnabled={false}
              flipEnabled={false}
              keepRatio={false}
              enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) => newBox.width < 18 || newBox.height < 18 ? oldBox : newBox}
              anchorSize={8}
              borderStroke={ZONE_COLORS.detection}
              anchorStroke={ZONE_COLORS.detection}
              anchorFill="#ffffff"
            />

            {/* Cameras */}
            {project.cameras.map(camera => (
              <CameraMarker
                key={camera.id}
                camera={camera}
                isSelected={selectedCameraId === camera.id}
                onSelect={() => { setSelectedZoneId(null); setSelectedStructureId(null); setSelectedCameraId(camera.id); }}
                onDelete={() => deleteCamera(camera.id)}
                onRotateCw={() => updateCamera(camera.id, { orientation_degrees: (camera.orientation_degrees + 15) % 360 })}
                onRotateCcw={() => updateCamera(camera.id, { orientation_degrees: (camera.orientation_degrees - 15 + 360) % 360 })}
              />
            ))}

            {layoutStructureDraft.map(item => (
              <StructureDraftShape key={`draft-structure-${item.id}`} item={item} width={stageSize.width} height={stageSize.height} />
            ))}

            {layoutDraft.map(item => (
              <CameraMarker
                key={`draft-${item.camera.id}`}
                camera={item.camera}
                isSelected={selectedCameraId === item.camera.id}
                isDraft
                onSelect={() => { setSelectedZoneId(null); setSelectedStructureId(null); setSelectedCameraId(item.camera.id); }}
                onDelete={() => deleteCamera(item.camera.id)}
                onRotateCw={() => updateCamera(item.camera.id, { orientation_degrees: (item.camera.orientation_degrees + 15) % 360 })}
                onRotateCcw={() => updateCamera(item.camera.id, { orientation_degrees: (item.camera.orientation_degrees - 15 + 360) % 360 })}
              />
            ))}

            {/* Zone Drawing Points */}
            {zonePoints.map((p, i) => (
              <Circle
                key={`draw-${i}`}
                x={p.x * stageSize.width}
                y={p.y * stageSize.height}
                radius={8}
                fill={tool === 'line' ? ZONE_COLORS.virtual_line : tool === 'structure' ? structureType === 'wall' ? '#334155' : structureType === 'entrance' ? '#10B981' : '#EF4444' : ZONE_COLORS.detection}
                stroke="white"
                strokeWidth={2}
              />
            ))}
          </Layer>
        </Stage>

        {/* Floor Plan Upload */}
        {!floorPlan && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
            <div className="text-center">
              <label htmlFor="floorplan-upload" className="pointer-events-auto cursor-pointer">
                <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                  <Plus className="w-8 h-8 text-primary" />
                </div>
                <p className="text-lg font-medium">Start with a blank layout or add a floor plan</p>
                <p className="text-sm text-muted-foreground mt-1">Draw walls, obstacles, and entrances directly on the canvas.</p>
              </label>
            </div>
          </div>
        )}

        {showSetupGuide && (
          <aside className="absolute right-4 top-4 z-20 max-h-[calc(100%-2rem)] w-[min(22rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-semibold"><Lightbulb className="h-4 w-4 text-amber-500" />Camera setup ideas</h2>
                <p className="mt-1 text-xs text-muted-foreground">AI review checks camera coverage, placement, and layout against your use cases. Workflow is not required.</p>
              </div>
              <button onClick={() => setShowSetupGuide(false)} aria-label="Close camera setup guide" className="rounded px-2 text-muted-foreground hover:bg-muted">×</button>
            </div>
            <div className="mb-3 rounded-lg border border-border bg-muted p-3 text-foreground">
              <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex items-center justify-between text-xs font-semibold"><span>Estimated zone-center coverage</span><span>{zoneCoverage.percent === null ? '—' : `${zoneCoverage.percent}%`}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{zoneCoverage.percent === null ? 'Draw a detection zone to estimate camera view coverage.' : `${zoneCoverage.covered}/${zoneCoverage.total} detection-zone centers fall inside an estimated camera cone. Target: ${project.detection_coverage_target ?? 90}%. This is a map estimate, not a measured site result.`}</p>{zoneCoverage.percent !== null && zoneCoverage.percent < (project.detection_coverage_target ?? 90) && <p className="mt-2 text-[11px] font-medium text-amber-700">Add or reposition a camera to reach the target; generate a layout suggestion.</p>}</div>
              {(layoutDraft.length > 0 || layoutStructureDraft.length > 0) && <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
                <p className="font-semibold">{layoutDraftMeta?.source === 'ai' ? 'AI camera layout draft' : 'Camera layout draft'} · {layoutDraft.length} camera{layoutDraft.length === 1 ? '' : 's'}{layoutStructureDraft.length > 0 ? ` · ${layoutStructureDraft.length} site element${layoutStructureDraft.length === 1 ? '' : 's'}` : ''}</p>
                <p className="mt-1">{layoutDraftMeta?.summary || 'Review the suggested positions and specifications before applying.'}</p>
                {layoutDraftMeta?.model_used && <p className="mt-1 text-[10px]">Model: {layoutDraftMeta.model_used}{layoutDraftMeta.usage ? ` · Tokens: ${layoutDraftMeta.usage.prompt_tokens} input + ${layoutDraftMeta.usage.completion_tokens} output = ${layoutDraftMeta.usage.total_tokens} total` : ''}</p>}
                {layoutDraftMeta?.reasoning?.length ? <div className="mt-1"><p className="font-medium">Model reasoning</p><ul className="mt-0.5 list-inside list-disc space-y-0.5 text-[10px]">{layoutDraftMeta.reasoning.map((line, index) => <li key={index}>{line}</li>)}</ul></div> : null}
                {layoutStructureDraft.length > 0 && <p className="mt-1 text-[10px]">Draft walls, obstacles, and entrances (purple dashed) will be added to the map when you apply this layout.</p>}
                {layoutDraftMeta?.notice && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">{layoutDraftMeta.notice} A local suggestion is shown so you can keep working.</p>}
                <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">{layoutDraft.map(item => <li key={item.camera.id}><b>{item.camera.name}</b> · {item.target_area || 'General coverage'}{item.rationale ? ` — ${item.rationale}` : ''}</li>)}</ul>
                <p className="mt-2">Drag a purple draft camera or select it to edit its properties. Changes stay as a draft until applied.</p>
                <div className="mt-2 flex gap-2"><button onClick={applyLayoutDraft} className="rounded-md bg-violet-700 px-2.5 py-1.5 font-medium text-white">Apply layout to {project.name}</button><button onClick={() => { setLayoutDraft([]); setLayoutStructureDraft([]); setLayoutDraftMeta(null); setSelectedCameraId(null); }} className="rounded-md border border-violet-300 px-2.5 py-1.5">Discard</button></div>
              </div>}
              <h3 className="text-xs font-semibold">Layout review</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">Rule-based checks from your drawing and camera assignments. Confirm dimensions and sight lines on site.</p>
              <ul className="mt-2 space-y-1.5 text-xs">{layoutReview.map((item, index) => <li key={index} className="flex gap-2"><span className="text-primary">•</span><span>{item}</span></li>)}</ul>
              <button onClick={requestCameraReview} disabled={reviewLoading} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60">
                {reviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                {reviewLoading ? 'Reviewing camera setup…' : cameraReview ? 'Refresh AI camera review' : 'Run AI camera setup review'}
              </button>
              {reviewError && <p className="mt-2 flex items-start gap-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{reviewError}</p>}
              {cameraReview && <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                {cameraReview.provider_notice && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-200">{cameraReview.provider_notice}</p>}
                <p className="flex gap-2 font-medium"><CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />{cameraReview.summary}</p>
                {cameraReview.model_used && <p className="text-[10px] text-muted-foreground">Generated by {cameraReview.model_used}{cameraReview.usage ? ` · Tokens: ${cameraReview.usage.prompt_tokens} input + ${cameraReview.usage.completion_tokens} output = ${cameraReview.usage.total_tokens} total` : ''}</p>}
                {cameraReview.findings.map((finding, index) => <div key={`${finding.title}-${index}`} className="rounded-md border border-border bg-card p-2">
                  <p className="font-medium"><span className={`mr-1 uppercase ${finding.severity === 'high' ? 'text-destructive' : finding.severity === 'medium' ? 'text-amber-600' : 'text-muted-foreground'}`}>{finding.severity}</span>{finding.title}</p>
                  <p className="mt-1 text-muted-foreground">{finding.detail}</p>
                </div>)}
                {cameraReview.next_steps.length > 0 && <div><p className="font-semibold">Suggested next steps</p><ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">{cameraReview.next_steps.map((step, index) => <li key={index}>{step}</li>)}</ul></div>}
              </div>}
              {(project.structure ?? []).length > 0 && <div className="mt-3 space-y-1 border-t border-border pt-2">{(project.structure ?? []).map(item => <div key={item.id} className="flex items-center justify-between gap-2 text-xs"><span>{item.name}</span><button onClick={() => onUpdate({ structure: (project.structure ?? []).filter(element => element.id !== item.id) })} className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${item.name}`}>Remove</button></div>)}</div>}
            </div>
            {project.use_cases.length ? (
              <div className="space-y-3">
                {project.use_cases.slice(0, 5).map(useCase => (
                  <div key={useCase.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{useCase.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{getSetupSuggestion(useCase)}</p>
                    <button onClick={() => startSuggestedPlacement(useCase.id)} className="mt-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15">Place a camera for this</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>Add cameras at clear views of important entrances, work areas, and inspection points.</p>
                <p>Use <strong>Add camera</strong> to click a position, then adjust direction and viewing angle in its properties.</p>
                <p>Use <strong>Draw zone</strong> for an area boundary or <strong>Draw line</strong> for a crossing/counting point.</p>
                <button onClick={() => setTool('camera')} className="mt-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Place first camera</button>
              </div>
            )}
            <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">Confirm position, lens, lighting, and coverage on site before installation.</p>
          </aside>
        )}

        {tool === 'camera' && (
          <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs text-foreground shadow-md">
            Click the plan to place a camera{pendingUseCaseId ? ' for this use case' : ''}.
          </div>
        )}

        {(tool === 'zone' || tool === 'line' || tool === 'structure') && zonePoints.length === 0 && (
          <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs text-foreground shadow-md">
            {tool === 'structure' ? structureType === 'obstacle' ? 'Drag to draw a rectangular obstacle.' : structureType === 'wall' ? 'Drag to place a straight wall segment.' : 'Drag across the opening to mark an entrance.' : tool === 'line' ? 'Click the two endpoints of the counting line.' : 'Drag to draw an area zone. Select it later to move or resize.'}
          </div>
        )}
      </div>

      {/* Properties Panel */}
      {(selectedCameraId || selectedZoneId || selectedStructureId) && (
        <div className="w-80 bg-white border-l border-border p-4 overflow-y-auto">
          {selectedCamera && (
            <CameraPropertiesPanel
              camera={selectedCamera}
              useCases={project.use_cases}
              onUpdate={updateCamera}
              onDelete={() => deleteCamera(selectedCameraId!)}
              onClose={() => setSelectedCameraId(null)}
            />
          )}

          {selectedZoneId && (
            <ZonePropertiesPanel
              zone={project.zones.find(z => z.id === selectedZoneId)!}
              cameras={project.cameras}
              onUpdate={updateZone}
              onDelete={() => deleteZone(selectedZoneId!)}
              onClose={() => setSelectedZoneId(null)}
            />
          )}

          {selectedStructureId && (() => {
            const item = (project.structure ?? []).find(element => element.id === selectedStructureId);
            if (!item) return null;
            const typeName = item.type === 'wall' ? 'Wall' : item.type === 'obstacle' ? 'Obstacle' : 'Entrance';
            return <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{typeName} properties</h3>
                <button onClick={() => setSelectedStructureId(null)} aria-label="Close properties" className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Name</label>
                <input type="text" value={item.name} onChange={event => onUpdate({ structure: (project.structure ?? []).map(element => element.id === item.id ? { ...element, name: event.target.value } : element) })} className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <button onClick={() => { onUpdate({ structure: (project.structure ?? []).filter(element => element.id !== item.id) }); setSelectedStructureId(null); }} className="w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium flex items-center justify-center gap-2">
                <Trash2 className="w-4 h-4" />Delete {typeName}
              </button>
            </div>;
          })()}
        </div>
      )}

      {/* Zone Drawing Controls */}
      {tool === 'line' && zonePoints.length > 0 && (
        <div className="fixed bottom-4 right-4 bg-white border border-border rounded-lg shadow-lg p-4 z-50">
          <p className="text-sm font-medium mb-2">Counting line</p>
          <p className="text-sm text-muted-foreground mb-3">{zonePoints.length} points placed</p>
          <div className="flex gap-2">
            <button onClick={finishZone} disabled={zonePoints.length < 2} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50">Finish line</button>
            <button onClick={cancelZone} className="px-3 py-1.5 border border-input rounded text-sm">Cancel</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function getZoneCenterCoverage(project: DetVisionProject, size: { width: number; height: number }) {
  const zones = project.zones.filter(zone => zone.type !== 'virtual_line' && zone.points.length > 0);
  const coveredZoneIds = zones.filter(zone => {
    const center = zone.points.reduce((point, current) => ({ x: point.x + current.x / zone.points.length, y: point.y + current.y / zone.points.length }), { x: 0, y: 0 });
    return project.cameras.some(camera => {
      const dx = (center.x - camera.x) * size.width;
      const dy = (center.y - camera.y) * size.height;
      const distance = Math.hypot(dx, dy);
      const bearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      const delta = Math.abs(((bearing - camera.orientation_degrees + 540) % 360) - 180);
      return distance <= camera.view_range * Math.min(size.width, size.height) && delta <= camera.horizontal_fov_degrees / 2;
    });
  }).map(zone => zone.id);
  return { total: zones.length, covered: coveredZoneIds.length, coveredZoneIds, percent: zones.length ? Math.round(coveredZoneIds.length / zones.length * 100) : null };
}

function getLayoutReview(project: DetVisionProject, size: { width: number; height: number }): string[] {
  const elements = project.structure ?? [];
  const walls = elements.filter(element => element.type === 'wall');
  const obstacles = elements.filter(element => element.type === 'obstacle');
  const entrances = elements.filter(element => element.type === 'entrance');
  const review: string[] = [];

  review.push(elements.length
    ? `Drawing includes ${walls.length} wall${walls.length === 1 ? '' : 's'}, ${obstacles.length} obstacle${obstacles.length === 1 ? '' : 's'}, and ${entrances.length} entrance${entrances.length === 1 ? '' : 's'}.`
    : 'Draw walls, obstacles, and entrances so the review can account for site structure.');

  if (!project.cameras.length) review.push('No cameras placed yet. Place cameras to review use-case coverage and sight lines.');
  const coverage = getZoneCenterCoverage(project, size);
  if (coverage.percent !== null) review.push(`Estimated camera-cone coverage: ${coverage.percent}% of detection-zone centers (${coverage.covered}/${coverage.total}); target ${project.detection_coverage_target ?? 90}%. This map estimate does not account for lens distortion, depth, lighting, or site conditions.`);
  const uncovered = project.use_cases.filter(useCase => !project.cameras.some(camera => camera.assigned_use_case_ids.includes(useCase.id) || useCase.camera_ids.includes(camera.id)));
  if (uncovered.length) review.push(`${uncovered.length} use case${uncovered.length === 1 ? ' has' : 's have'} no assigned camera: ${uncovered.slice(0, 2).map(item => item.name).join(', ')}${uncovered.length > 2 ? ', …' : ''}.`);

  const blockers: string[] = [];
  for (const camera of project.cameras) {
    const origin = { x: camera.x * size.width, y: camera.y * size.height };
    const angle = camera.orientation_degrees * Math.PI / 180;
    const ray = { x: Math.sin(angle) * camera.view_range * Math.min(size.width, size.height), y: -Math.cos(angle) * camera.view_range * Math.min(size.width, size.height) };
    const blocks = [...walls, ...obstacles].some(element => element.points.slice(0, -1).some((point, index) => {
      const next = element.points[index + 1];
      const start = { x: point.x * size.width, y: point.y * size.height };
      const segment = { x: (next.x - point.x) * size.width, y: (next.y - point.y) * size.height };
      const denominator = ray.x * segment.y - ray.y * segment.x;
      if (Math.abs(denominator) < 0.001) return false;
      const offset = { x: start.x - origin.x, y: start.y - origin.y };
      const alongRay = (offset.x * segment.y - offset.y * segment.x) / denominator;
      const alongSegment = (offset.x * ray.y - offset.y * ray.x) / denominator;
      return alongRay > 0.02 && alongRay < 1 && alongSegment >= 0 && alongSegment <= 1;
    }));
    if (blocks) blockers.push(camera.name);
  }
  if (blockers.length) review.push(`Check the forward sight line for ${blockers.join(', ')}; it intersects a drawn wall or obstacle.`);
  else if (project.cameras.length && elements.length) review.push('No drawn wall or obstacle crosses a camera’s center sight line.');
  if (!review.some(item => item.includes('no assigned camera')) && project.use_cases.length) review.push('Every listed use case is linked to at least one camera.');
  return review;
}

function CameraPropertiesPanel({ camera, useCases, onUpdate, onDelete, onClose }: {
  camera: Camera;
  useCases: any[];
  onUpdate: (id: string, updates: Partial<Camera>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Camera Properties</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1">Name</label>
          <input
            type="text"
            value={camera.name}
            onChange={e => onUpdate(camera.id, { name: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Status</label>
          <select
            value={camera.status}
            onChange={e => onUpdate(camera.id, { status: e.target.value as any })}
            className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="planned">Planned</option>
            <option value="installed">Installed</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">X Position</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={camera.x}
              onChange={e => onUpdate(camera.id, { x: parseFloat(e.target.value) })}
              className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Y Position</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={camera.y}
              onChange={e => onUpdate(camera.id, { y: parseFloat(e.target.value) })}
              className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">Orientation (°)</label>
            <input
              type="number"
              step="1"
              min="0"
              max="360"
              value={camera.orientation_degrees}
              onChange={e => onUpdate(camera.id, { orientation_degrees: parseInt(e.target.value) })}
              className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">FOV (°)</label>
            <input
              type="number"
              step="1"
              min="10"
              max="180"
              value={camera.horizontal_fov_degrees}
              onChange={e => onUpdate(camera.id, { horizontal_fov_degrees: parseInt(e.target.value) })}
              className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">View Range</label>
            <input
              type="range"
              step="0.05"
              min="0.1"
              max="1"
              value={camera.view_range}
              onChange={e => onUpdate(camera.id, { view_range: parseFloat(e.target.value) })}
              className="w-full h-2 accent-primary"
            />
            <div className="text-xs text-muted-foreground text-center mt-1">{(camera.view_range * 100).toFixed(0)}%</div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Resolution</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={camera.resolution_width}
                onChange={e => onUpdate(camera.id, { resolution_width: parseInt(e.target.value) })}
                className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="W"
              />
              <span className="self-center text-muted-foreground">×</span>
              <input
                type="number"
                value={camera.resolution_height}
                onChange={e => onUpdate(camera.id, { resolution_height: parseInt(e.target.value) })}
                className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="H"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Assigned Use Cases</label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {useCases.map(uc => (
              <label key={uc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={camera.assigned_use_case_ids.includes(uc.id)}
                  onChange={e => {
                    const ids = camera.assigned_use_case_ids;
                    if (e.target.checked) {
                      onUpdate(camera.id, { assigned_use_case_ids: [...ids, uc.id] });
                    } else {
                      onUpdate(camera.id, { assigned_use_case_ids: ids.filter(id => id !== uc.id) });
                    }
                  }}
                  className="w-4 h-4 accent-primary"
                />
                <span className="truncate">{uc.name}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={onDelete}
          className="w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Delete Camera
        </button>
      </div>
    </div>
  );
}

function ZonePropertiesPanel({ zone, cameras, onUpdate, onDelete, onClose }: {
  zone: any;
  cameras: any[];
  onUpdate: (id: string, updates: any) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{zone.type === 'virtual_line' ? 'Line' : 'Zone'} Properties</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1">Name</label>
          <input
            type="text"
            value={zone.name}
            onChange={e => onUpdate(zone.id, { name: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Type</label>
          <select
            value={zone.type}
            onChange={e => onUpdate(zone.id, { type: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="detection">Detection Zone</option>
            <option value="counting">Counting Zone</option>
            <option value="exclusion">Exclusion Zone</option>
            <option value="roi">ROI</option>
            <option value="virtual_line">Virtual Line</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Color</label>
          <input
            type="color"
            value={zone.color}
            onChange={e => onUpdate(zone.id, { color: e.target.value })}
            className="w-full h-8 border border-input rounded cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Assigned Cameras</label>
          <div className="space-y-1">
            {cameras.map(cam => (
              <label key={cam.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={zone.camera_ids.includes(cam.id)}
                  onChange={e => {
                    const ids = zone.camera_ids;
                    if (e.target.checked) {
                      onUpdate(zone.id, { camera_ids: [...ids, cam.id] });
                    } else {
                      onUpdate(zone.id, { camera_ids: ids.filter((id: string) => id !== cam.id) });
                    }
                  }}
                  className="w-4 h-4 accent-primary"
                />
                <span className="truncate">{cam.name}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={onDelete}
          className="w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Delete {zone.type === 'virtual_line' ? 'Line' : 'Zone'}
        </button>
      </div>
    </div>
  );
}

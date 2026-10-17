import type { DetVisionProject, UseCase, Workflow, WorkflowNode, WorkflowEdge } from './types';
import { v4 as uuidv4 } from 'uuid';

function uuid(): string {
  return crypto.randomUUID();
}

export function generateWorkflowFromUseCases(useCases: UseCase[], cameras: { id: string }[]): Workflow {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  
  const cameraIds = cameras.map(c => c.id);
  let x = 100;
  const y = 100;
  const spacing = 220;

  // Camera input node
  const cameraInputId = uuid();
  nodes.push({
    id: cameraInputId,
    type: 'camera_input',
    position: { x: x, y: y },
    data: { label: 'Camera Input', cameraIds },
  });
  x += spacing;

  // Frame sampling
  const frameSamplingId = uuid();
  nodes.push({
    id: frameSamplingId,
    type: 'frame_sampling',
    position: { x: x, y: y },
    data: { label: 'Frame Sampling' },
  });
  edges.push({ id: uuid(), source: cameraInputId, target: frameSamplingId });
  x += spacing;

  // Preprocessing
  const preprocessId = uuid();
  nodes.push({
    id: preprocessId,
    type: 'preprocessing',
    position: { x: x, y: y },
    data: { label: 'Preprocessing' },
  });
  edges.push({ id: uuid(), source: frameSamplingId, target: preprocessId });
  x += spacing;

  // Object detection (common to most use cases)
  const detectionId = uuid();
  const detectionTechniques = [...new Set(useCases
    .filter(uc => ['object_detection', 'tracking', 'counting', 'segmentation'].includes(uc.task_type))
    .flatMap(uc => uc.candidate_techniques))];
  nodes.push({
    id: detectionId,
    type: 'object_detection',
    position: { x: x, y: y },
    data: { label: 'Object Detection', suggestedTechniques: detectionTechniques, classes: [] },
  });
  edges.push({ id: uuid(), source: preprocessId, target: detectionId });
  x += spacing;

  // Tracking
  const trackingId = uuid();
  nodes.push({
    id: trackingId,
    type: 'tracking',
    position: { x: x, y: y },
    data: { label: 'Tracker', algorithm: 'Choose tracking algorithm' },
  });
  edges.push({ id: uuid(), source: detectionId, target: trackingId });
  x += spacing;

  // Check for zone/logic needs
  const hasZoneLogic = useCases.some(uc => 
    uc.task_type === 'counting' || 
    uc.feasibility_notes.some(n => n.toLowerCase().includes('zone'))
  );
  
  let zoneLogicId: string | null = null;
  if (hasZoneLogic) {
    zoneLogicId = uuid();
    nodes.push({
      id: zoneLogicId,
      type: 'zone_logic',
      position: { x: x - spacing, y: y + 200 },
      data: { label: 'Zone Logic', zones: [] },
    });
    edges.push({ id: uuid(), source: trackingId, target: zoneLogicId });
  }

  // Check for line crossing needs
  const hasLineCrossing = useCases.some(uc => 
    uc.task_type === 'counting' || 
    uc.feasibility_notes.some(n => n.toLowerCase().includes('line'))
  );

  let lineCrossingId: string | null = null;
  if (hasLineCrossing) {
    lineCrossingId = uuid();
    nodes.push({
      id: lineCrossingId,
      type: 'line_crossing',
      position: { x: x, y: y + 200 },
      data: { label: 'Line Crossing', lines: [] },
    });
    edges.push({ id: uuid(), source: trackingId, target: lineCrossingId });
  }

  // Classification/Segmentation branch if needed
  const hasClassification = useCases.some(uc => uc.task_type === 'classification');
  const hasSegmentation = useCases.some(uc => uc.task_type === 'segmentation');
  let classificationId: string | null = null;
  let segmentationId: string | null = null;

  if (hasClassification) {
    classificationId = uuid();
    nodes.push({
      id: classificationId,
      type: 'classification',
      position: { x: x - spacing, y: y - 200 },
      data: { label: 'Classification', model: 'Select classification model', classes: [] },
    });
    edges.push({ id: uuid(), source: detectionId, target: classificationId });
  }

  if (hasSegmentation) {
    segmentationId = uuid();
    nodes.push({
      id: segmentationId,
      type: 'segmentation',
      position: { x: x, y: y - 200 },
      data: { label: 'Segmentation', model: 'Select segmentation model', classes: [] },
    });
    edges.push({ id: uuid(), source: detectionId, target: segmentationId });
  }

  // Decision node
  const decisionId = uuid();
  const conditions = [];
  if (useCases.some(uc => uc.task_type === 'object_detection' || uc.task_type === 'tracking')) {
    conditions.push('proximity < threshold');
  }
  if (hasZoneLogic) conditions.push('zone_intrusion');
  if (hasLineCrossing) conditions.push('line_cross');
  if (hasClassification) conditions.push('class_match');
  if (hasSegmentation) conditions.push('segment_overlap');

  nodes.push({
    id: decisionId,
    type: 'decision',
    position: { x: x + spacing, y },
    data: { label: 'Decision', condition: conditions.join(' OR ') || 'event_detected' },
  });
  edges.push({ id: uuid(), source: trackingId, target: decisionId });
  if (zoneLogicId) edges.push({ id: uuid(), source: zoneLogicId, target: decisionId });
  if (lineCrossingId) edges.push({ id: uuid(), source: lineCrossingId, target: decisionId });
  if (classificationId) edges.push({ id: uuid(), source: classificationId, target: decisionId });
  if (segmentationId) edges.push({ id: uuid(), source: segmentationId, target: decisionId });

  // Alert
  const alertId = uuid();
  nodes.push({
    id: alertId,
    type: 'alert',
    position: { x: x + spacing * 2, y: y - 50 },
    data: { label: 'Alert', channels: [] },
  });
  edges.push({ id: uuid(), source: decisionId, target: alertId });

  // Event storage
  const storageId = uuid();
  nodes.push({
    id: storageId,
    type: 'event_storage',
    position: { x: x + spacing * 2, y: y + 50 },
    data: { label: 'Event Log' },
  });
  edges.push({ id: uuid(), source: decisionId, target: storageId });

  // Manual review for conditional feasibility
  const hasConditional = useCases.some(uc => uc.feasibility_status === 'conditional');
  if (hasConditional) {
    const reviewId = uuid();
    nodes.push({
      id: reviewId,
      type: 'manual_review',
      position: { x: x + spacing * 2, y: y + 150 },
      data: { label: 'Manual Review', reason: 'Conditional feasibility - requires validation' },
    });
    edges.push({ id: uuid(), source: decisionId, target: reviewId });
  }

  return { nodes, edges };
}

export function getNodeCategoryInfo(category: WorkflowNode['type']) {
  const info: Record<string, { label: string; icon: string; color: string; description: string }> = {
    camera_input: { label: 'Camera Input', icon: '📷', color: '#3B82F6', description: 'Video stream source' },
    frame_sampling: { label: 'Frame Sampler', icon: '⏱️', color: '#6366F1', description: 'Reduce frame rate for processing' },
    preprocessing: { label: 'Preprocess', icon: '🔧', color: '#8B5CF6', description: 'Resize, normalize, augment frames' },
    object_detection: { label: 'Object Detection', icon: '🎯', color: '#EF4444', description: 'Detect objects with bounding boxes' },
    classification: { label: 'Classification', icon: '🏷️', color: '#EC4899', description: 'Classify detected objects' },
    segmentation: { label: 'Segmentation', icon: '✂️', color: '#F59E0B', description: 'Pixel-level object masks' },
    ocr: { label: 'OCR', icon: '📝', color: '#10B981', description: 'Optical character recognition' },
    measurement: { label: 'Measurement', icon: '📏', color: '#06B6D4', description: 'Measure dimensions, distances' },
    tracking: { label: 'Tracker', icon: '🔄', color: '#64748B', description: 'Track objects across frames' },
    zone_logic: { label: 'Zone Logic', icon: '📦', color: '#84CC16', description: 'Zone entry/exit, occupancy' },
    line_crossing: { label: 'Line Crossing', icon: '📐', color: '#F97316', description: 'Virtual line crossing detection' },
    decision: { label: 'Decision', icon: '🤔', color: '#7C3AED', description: 'Conditional logic branch' },
    alert: { label: 'Alert', icon: '🚨', color: '#EF4444', description: 'Send notifications' },
    event_storage: { label: 'Event Log', icon: '💾', color: '#3B82F6', description: 'Store events for review' },
    manual_review: { label: 'Manual Review', icon: '👁️', color: '#F59E0B', description: 'Human-in-the-loop verification' },
  };
  return info[category] || { label: category, icon: '⬜', color: '#999', description: '' };
}

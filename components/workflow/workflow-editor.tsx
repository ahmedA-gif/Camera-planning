'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  ReactFlow, 
  Node, 
  Edge, 
  addEdge, 
  Connection, 
  NodeTypes, 
  EdgeTypes,
  Controls,
  Background,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { 
  Settings, 
  Trash2, 
  Plus, 
  Minimize2, 
  Maximize2,
  RefreshCw,
  Download,
  Upload,
  Search,
  Zap,
  Camera,
  Cpu,
  Filter,
  Tag,
  GitBranch,
  Eye,
  AlertTriangle,
  Database,
  UserCheck,
} from 'lucide-react';
import type { DetVisionProject, Workflow, WorkflowNode, WorkflowEdge, NodeCategory } from '@/lib/types';
import { getNodeCategoryInfo, generateWorkflowFromUseCases } from '@/lib/workflow-generator';
import { v4 as uuidv4 } from 'uuid';

function uuid(): string {
  return crypto.randomUUID();
}

interface WorkflowEditorProps {
  project: DetVisionProject;
  onUpdate: (workflow: Workflow) => void;
}

const nodeCategories: { category: string; types: NodeCategory[] }[] = [
  { category: 'Input', types: ['camera_input', 'frame_sampling'] },
  { category: 'Processing', types: ['preprocessing', 'object_detection', 'classification', 'segmentation', 'ocr', 'measurement'] },
  { category: 'Logic', types: ['tracking', 'zone_logic', 'line_crossing', 'decision'] },
  { category: 'Output', types: ['alert', 'event_storage', 'manual_review'] },
];

// Custom node components
const CustomNode = ({ data, selected, id }: { data: any; selected: boolean; id: string }) => {
  const info = getNodeCategoryInfo(data.category || 'camera_input');
  return (
    <div className={`workflow-node ${selected ? 'selected' : ''}`} style={{ backgroundColor: info.color + '15', borderColor: info.color }}>
      <Handle type="target" position={Position.Top} className="node-handle" id="input" />
      
      <div className="node-content">
        <div className="node-header">
          <span className="node-icon" style={{ color: info.color }}>{info.icon}</span>
          <span className="node-label">{data.label || info.label}</span>
        </div>
        <div className="node-details">
          {Object.entries(data).filter(([k]) => !['label', 'category'].includes(k)).map(([key, value]) => (
            <div key={key} className="node-detail">
              <span className="detail-key">{key}:</span>
              <span className="detail-value">{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}</span>
            </div>
          ))}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="node-handle" id="output" />
    </div>
  );
};

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

export function WorkflowEditor({ project, onUpdate }: WorkflowEditorProps) {
  const flowRef = useRef<any>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const loadedProjectId = useRef<string | null>(null);
  const generatedProjectId = useRef<string | null>(null);
  const fittedProjectId = useRef<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  useEffect(() => {
    if (!nodes.length || fittedProjectId.current === project.id) return;
    const frame = requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.22, duration: 0 });
      fittedProjectId.current = project.id;
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes.length, project.id]);

  useEffect(() => {
    const isNewProject = loadedProjectId.current !== project.id;
    if (isNewProject) {
      loadedProjectId.current = project.id;
      generatedProjectId.current = null;
      if (project.workflow?.nodes?.length) {
        setNodes(project.workflow.nodes.map(n => ({ id: n.id, type: 'custom', position: n.position, data: { ...n.data, category: n.type } })));
        setEdges(project.workflow.edges.map(e => ({
          id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
          type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        })));
        generatedProjectId.current = project.id;
        return;
      }
    }

    if (project.use_cases.length > 0 && generatedProjectId.current !== project.id) {
      generatedProjectId.current = project.id;
      const workflow = generateWorkflowFromUseCases(project.use_cases, project.cameras);
      const flowNodes: Node[] = workflow.nodes.map(n => ({
        id: n.id,
        type: 'custom',
        position: n.position,
        data: { ...n.data, category: n.type },
      }));
      setNodes(flowNodes);
      
      const flowEdges: Edge[] = workflow.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
        style: { stroke: '#94a3b8', strokeWidth: 2 },
      }));
      setEdges(flowEdges);
      onUpdate(workflow);
    }
  }, [project.id, project.workflow, project.use_cases, project.cameras, setNodes, setEdges, onUpdate]);

  const onConnect = useCallback((params: Connection) => {
    const nextEdges = addEdge({ 
      ...params, 
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    }, edges);
    setEdges(nextEdges);
    persistWorkflow(nodes, nextEdges);
  }, [setEdges, nodes, edges]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const addNode = (type: NodeCategory) => {
    const info = getNodeCategoryInfo(type);
    const bounds = canvasRef.current?.getBoundingClientRect();
    const position = bounds && flowRef.current
      ? flowRef.current.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      : { x: viewport.x + 200, y: viewport.y + 200 };
    const newNode: Node = {
      id: uuid(),
      type: 'custom',
      position,
      data: { 
        label: info.label, 
        category: type,
        ...getDefaultNodeData(type),
      },
    };
    const nextNodes = [...nodes, newNode];
    setNodes(nextNodes);
    persistWorkflow(nextNodes, edges);
  };

  const handlePaletteDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handlePaletteDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/reactflow');
    if (!raw || !flowRef.current) return;
    try {
      const payload = JSON.parse(raw) as { data?: { category?: NodeCategory } };
      const category = payload.data?.category;
      if (!category) return;
      const info = getNodeCategoryInfo(category);
      const nextNode: Node = {
        id: uuid(),
        type: 'custom',
        position: flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        data: { label: info.label, category, ...getDefaultNodeData(category) },
      };
      const nextNodes = [...nodes, nextNode];
      setNodes(nextNodes);
      persistWorkflow(nextNodes, edges);
    } catch {
      // Ignore invalid drag payloads from outside the node palette.
    }
  };

  const deleteNode = (nodeId: string) => {
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNode(null);
    persistWorkflow(nextNodes, nextEdges);
  };

  const updateNodeData = (nodeId: string, data: any) => {
    const nextNodes = nodes.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n);
    setNodes(nextNodes);
    setSelectedNode(nextNodes.find(n => n.id === nodeId) || null);
    persistWorkflow(nextNodes, edges);
  };

  const handleNodesChange = (changes: any[]) => {
    const nextNodes = applyNodeChanges(changes, nodes);
    setNodes(nextNodes);
    persistWorkflow(nextNodes, edges);
  };

  const handleEdgesChange = (changes: any[]) => {
    const nextEdges = applyEdgeChanges(changes, edges);
    setEdges(nextEdges);
    persistWorkflow(nodes, nextEdges);
  };

  function persistWorkflow(nextNodes: Node[], nextEdges: Edge[]) {
    onUpdate({
      nodes: nextNodes.map(n => ({ id: n.id, type: (n.data.category as NodeCategory) || 'camera_input', position: n.position, data: n.data })),
      edges: nextEdges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined })),
    });
  }

  const fitView = () => {
    flowRef.current?.fitView({ padding: 0.18, duration: 350 });
  };

  const exportWorkflow = () => {
    const workflow = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: (n.data.category as NodeCategory) || 'camera_input',
        position: n.position,
        data: n.data,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    };
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative flex flex-1 min-h-0 bg-white">
      {/* Node Palette */}
      {showPalette && (
        <div className="w-64 bg-white border-r border-border flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Node Palette</h3>
            <button onClick={() => setShowPalette(false)} className="text-muted-foreground hover:text-foreground p-1">
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {nodeCategories.map(({ category, types }) => (
              <div key={category} className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2">{category}</h4>
                <div className="space-y-1">
                  {types.map(type => {
                    const info = getNodeCategoryInfo(type);
                    return (
                      <button
                        key={type}
                        onClick={() => addNode(type)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-muted rounded transition-colors border border-transparent hover:border-border"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'custom', data: { label: info.label, category: type } }));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                      >
                        <span style={{ color: info.color }}>{info.icon}</span>
                        <span>{info.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!showPalette && (
        <button onClick={() => setShowPalette(true)} className="absolute left-3 top-3 z-10 rounded-lg border border-border bg-white px-3 py-2 text-sm shadow-sm hover:bg-muted">Show nodes</button>
      )}

{/* Canvas */}
       <div ref={canvasRef} className="relative min-w-0 min-h-0 flex-1">
         <ReactFlow
           onInit={(instance) => { flowRef.current = instance; }}
           onDrop={handlePaletteDrop}
           onDragOver={handlePaletteDragOver}
           nodes={nodes}
           edges={edges}
           onNodesChange={handleNodesChange}
           onEdgesChange={handleEdgesChange}
           onConnect={onConnect}
           onNodeClick={onNodeClick}
           onPaneClick={onPaneClick}
           nodeTypes={nodeTypes}
           fitView={nodes.length > 0}
           proOptions={{ hideAttribution: true }}
           nodesDraggable={true}
           elementsSelectable={true}
         >
          <Background color="var(--flow-dot)" gap={18} />
          <Controls />
          {showMiniMap && <MiniMap
            style={{ width: 180, height: 120 }}
            nodeColor={(node) => getNodeCategoryInfo((node.data.category as NodeCategory) || 'camera_input').color}
            maskColor="rgba(255,255,255,0.8)"
          />}
        </ReactFlow>

        {/* Toolbar */}
        <div className="absolute bottom-4 left-4 right-4 flex justify-center gap-2 pointer-events-none">
          <div className="flex gap-2 pointer-events-auto">
            <button onClick={fitView} className="px-3 py-2 bg-white border border-border rounded-lg shadow-lg hover:bg-muted transition-colors flex items-center gap-2" title="Fit View">
              <Maximize2 className="w-4 h-4" />
              <span className="hidden sm:inline">Fit View</span>
            </button>
            <button onClick={() => setShowMiniMap(value => !value)} className="px-3 py-2 bg-white border border-border rounded-lg shadow-lg hover:bg-muted transition-colors">{showMiniMap ? 'Hide map' : 'Show map'}</button>
            <button onClick={exportWorkflow} className="px-3 py-2 bg-white border border-border rounded-lg shadow-lg hover:bg-muted transition-colors flex items-center gap-2" title="Export Workflow">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button onClick={() => {
              const workflow = generateWorkflowFromUseCases(project.use_cases, project.cameras);
              const flowNodes: Node[] = workflow.nodes.map(n => ({
                id: n.id,
                type: 'custom',
                position: n.position,
                data: { ...n.data, category: n.type },
              }));
              setNodes(flowNodes);
              const flowEdges: Edge[] = workflow.edges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle,
                type: 'smoothstep',
                markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
                style: { stroke: '#94a3b8', strokeWidth: 2 },
              }));
              setEdges(flowEdges);
              onUpdate(workflow);
            }} className="px-3 py-2 bg-white border border-border rounded-lg shadow-lg hover:bg-muted transition-colors flex items-center gap-2" title="Regenerate from Use Cases">
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Regenerate</span>
            </button>
          </div>
        </div>
      </div>

      {/* Properties Panel */}
      {selectedNode && (
        <div className="w-80 bg-white border-l border-border p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Node Properties</h3>
            <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Label</label>
              <input
                type="text"
                value={(selectedNode.data.label as string) || ''}
                onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })}
                className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select
                value={(selectedNode.data.category as string) || 'camera_input'}
                onChange={e => updateNodeData(selectedNode.id, { category: e.target.value })}
                className="w-full px-2 py-1.5 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {nodeCategories.flatMap(({ types }) => types.map(t => (
                  <option key={t} value={t}>{getNodeCategoryInfo(t).label}</option>
                )))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Configuration</label>
              <div className="space-y-1">
                {Object.entries(selectedNode.data).filter(([k]) => !['label', 'category'].includes(k)).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-xs text-muted-foreground w-24">{key}:</span>
                    <input
                      type="text"
                      value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      onChange={e => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          updateNodeData(selectedNode.id, { [key]: parsed });
                        } catch {
                          updateNodeData(selectedNode.id, { [key]: e.target.value });
                        }
                      }}
                      className="flex-1 px-2 py-1 text-sm border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => deleteNode(selectedNode.id)}
              className="w-full px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Node
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {nodes.length === 0 && project.use_cases.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-gray-50/70">
          <div className="text-center p-8">
            <GitBranch className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">No Workflow Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Generate a scenario analysis first to create an initial workflow</p>
            <p className="text-xs text-muted-foreground">Or add nodes manually from the palette</p>
          </div>
        </div>
      )}
    </div>
  );
}

function getDefaultNodeData(type: NodeCategory): Record<string, any> {
  const defaults: Record<NodeCategory, Record<string, any>> = {
    camera_input: { cameraIds: [], label: 'Camera Input' },
    frame_sampling: { label: 'Frame Sampling' },
    preprocessing: { label: 'Preprocessing' },
    object_detection: { model: 'Select detection model', classes: [], label: 'Object Detection' },
    classification: { model: 'Select classification model', classes: [], label: 'Classification' },
    segmentation: { model: 'Select segmentation model', classes: [], label: 'Segmentation' },
    ocr: { label: 'OCR' },
    measurement: { label: 'Measurement' },
    tracking: { algorithm: 'Choose tracking algorithm', label: 'Tracker' },
    zone_logic: { zones: [], label: 'Zone Logic' },
    line_crossing: { lines: [], label: 'Line Crossing' },
    decision: { condition: 'Define event condition', label: 'Decision' },
    alert: { channels: [], label: 'Alert' },
    event_storage: { label: 'Event Log' },
    manual_review: { reason: 'Conditional feasibility', label: 'Manual Review' },
  };
  return defaults[type] || {};
}

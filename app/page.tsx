'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { Sidebar } from '@/components/dashboard/sidebar';
import { ProjectHeader } from '@/components/dashboard/project-header';
import { ScenarioForm } from '@/components/scenario/scenario-form';
import { CameraMap } from '@/components/camera-map/camera-map';
import { WorkflowEditor } from '@/components/workflow/workflow-editor';
import { ReportPreview } from '@/components/report/report-preview';
import { PlanGenerator } from '@/components/plan/plan-generator';
import Footer from '@/components/layout/footer';
import { getStoredProjects, getActiveProject, saveProject, createNewProject, exportProjectJSON, importProjectJSON, hasLegacyProjects, claimLegacyProjects } from '@/lib/project-store';
import { createEmptyProject } from '@/lib/project-factory';
import { deleteProject, setActiveProject, deleteProjectRevision, restoreProjectRevision } from '@/lib/project-store';
import type { DetVisionProject, AnalysisResponse } from '@/lib/types';
import { ensureMultiBuildingFleet } from '@/lib/rule-based-planner';
import { v4 as uuidv4 } from 'uuid';
import { 
  ListChecks, 
  Camera, 
  MapPin, 
  GitBranch, 
  FileText, 
  Zap,
  Search,
  Trash2,
  FolderOpen,
  CheckCircle,
  Pencil,
  History,
  RotateCcw,
  Sparkles,
  Loader2,
  ShieldCheck,
  Activity,
  HardDrive,
  Wifi,
  ChevronRight,
  ArrowUpRight,
  Maximize2,
  Cctv,
  Layers,
  Check,
} from 'lucide-react';
import { LiveDot, StatusPill, SectionHeader, useLiveValue } from '@/components/ui/telemetry-primitives';
import { ViewProvider, useView } from '@/components/view-context';
import { ViewInitializer } from '@/components/view-initializer';

function uuid(): string {
  return crypto.randomUUID();
}

function DashboardContent() {
  const { activeView, setActiveView } = useView();
  const { isLoaded: clerkLoaded, user } = useUser();
  const userId = user?.id || (clerkLoaded ? 'workspace-local' : 'workspace-local');
  const [project, setProject] = useState<DetVisionProject | null>(null);
  const projectRef = useRef<DetVisionProject | null>(project);
  projectRef.current = project;
  const [projects, setProjects] = useState<DetVisionProject[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [hasUnassignedLegacyProjects, setHasUnassignedLegacyProjects] = useState(false);

  // Keep browser storage separated by authenticated Clerk account, fallback to local workspace immediately
  useEffect(() => {
    const effectiveUserId = user?.id || 'workspace-local';
    const stored = getStoredProjects(effectiveUserId);
    setProjects(stored);
    const active = getActiveProject(effectiveUserId);
    if (active) {
      const fleet = ensureMultiBuildingFleet(active);
      const synced = { ...active, cameras: fleet.cameras, buildings: fleet.buildings, structure: fleet.structure };
      setProject(synced);
    } else if (stored.length > 0) {
      const first = stored[0];
      const fleet = ensureMultiBuildingFleet(first);
      const synced = { ...first, cameras: fleet.cameras, buildings: fleet.buildings, structure: fleet.structure };
      setProject(synced);
    } else {
      // Start with a real, empty workspace instead of silently loading sample data.
      const draft = createEmptyProject('Plan Vision Project', '', '', '');
      setProject(draft);
      setProjects([]);
    }
    setHasUnassignedLegacyProjects(stored.length === 0 && hasLegacyProjects());
    setHydrated(true);
  }, [clerkLoaded, user?.id]);

  const handleProjectUpdate = useCallback((updates: Partial<DetVisionProject>) => {
    if (!project) return;
    const briefChanged = ['business_description', 'industry', 'company_name', 'requirements'].some(key => key in updates);
    const updated = { ...project, ...updates, updated_at: new Date().toISOString() };
    if (briefChanged) updated.safety_plan = undefined;
    setProject(updated);
    setIsDirty(true);
  }, [project]);

  const handleSave = useCallback(() => {
    if (!project || !userId) return;
    const savedProject = saveProject({ ...project, updated_at: new Date().toISOString() }, userId);
    setProject(savedProject);
    setProjects(getStoredProjects(userId));
    setIsDirty(false);
  }, [project, userId]);

  const handlePlanUpdate = useCallback((updates: Partial<DetVisionProject>) => {
    const current = projectRef.current;
    if (!current || !userId) return;
    const saved = saveProject({ ...current, ...updates, updated_at: new Date().toISOString() }, userId);
    setProject(saved);
    setProjects(getStoredProjects(userId));
    setIsDirty(false);
  }, [userId]);

  const handleExportJSON = useCallback(() => {
    if (!project || !userId) return;
    const json = exportProjectJSON(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '-')}-${project.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project, userId]);

  const handleImportJSON = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!userId) return;
        const imported = importProjectJSON(userId, e.target?.result as string);
        setProjects(getStoredProjects(userId));
        setProject(imported);
        setIsDirty(true);
      } catch (err) {
        alert('Failed to import project: ' + (err instanceof Error ? err.message : 'Invalid file'));
      }
    };
    reader.readAsText(file);
  }, [userId]);

  const handlePrint = useCallback(() => {
    if (activeView !== 'report') {
      setActiveView('report');
      window.setTimeout(() => window.print(), 300);
      return;
    }
    window.print();
  }, [activeView]);

  const handleAnalysisComplete = useCallback((response: AnalysisResponse) => {
    if (!project || !userId) return;
    const fleet = ensureMultiBuildingFleet(response.project);
    const updatedProject: DetVisionProject = {
      ...project,
      ...response.project,
      cameras: fleet.cameras,
      buildings: fleet.buildings,
      structure: fleet.structure,
      id: project.id,
      name: project.name === 'Plan Vision Project' || project.name === 'Untitled Project' ? response.project.name || project.name : project.name,
      company_name: project.company_name || response.project.company_name || '',
      industry: project.industry || response.project.industry || '',
      created_at: project.created_at,
      updated_at: new Date().toISOString(),
    };
    setProject(updatedProject);
    setIsDirty(true);
  }, [project, userId]);

  const [isGeneratingAllInOne, setIsGeneratingAllInOne] = useState(false);

  const handleGenerateAllInOne = useCallback(async () => {
    const current = projectRef.current;
    if (!current || !userId) return;
    if (!current.business_description.trim()) {
      alert('Please enter your project scenario / requirements brief first.');
      setActiveView('scenario');
      return;
    }

    setIsGeneratingAllInOne(true);
    try {
      // 1. Run AI analysis strictly prioritizing user requirements and reasoning
      const analyzeResp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_description: current.business_description,
          industry: current.industry,
          company_name: current.company_name,
          requirements: current.requirements,
          use_ai: true,
          camera_specifications: current.camera_specifications,
          available_hardware: current.available_hardware,
          critical_components: current.critical_components,
          layout_section_count: current.layout_section_count,
          layout_sections: current.layout_sections,
          detection_coverage_target: current.detection_coverage_target || 95,
          output_scope: current.output_scope,
          image_observation: current.image_observation,
        }),
      });

      const analyzeText = await analyzeResp.text();
      let analyzeData: any = null;
      try {
        analyzeData = JSON.parse(analyzeText);
      } catch (err) {
        console.error('Failed to parse analysis response:', err);
      }

      if (!analyzeResp.ok || !analyzeData?.project) {
        throw new Error(analyzeData?.error || 'AI analysis failed to complete.');
      }

      const fleet = ensureMultiBuildingFleet(analyzeData.project);
      const analyzedProject: DetVisionProject = {
        ...current,
        ...analyzeData.project,
        cameras: fleet.cameras,
        buildings: fleet.buildings,
        structure: fleet.structure,
        id: current.id,
        name: current.name === 'Plan Vision Project' || current.name === 'Untitled Project' 
          ? (analyzeData.project.name || current.name) 
          : current.name,
        company_name: current.company_name || analyzeData.project.company_name || '',
        industry: current.industry || analyzeData.project.industry || '',
        updated_at: new Date().toISOString(),
      };

      // 2. Automatically generate comprehensive Safety Plan & technical blueprint
      try {
        const planResp = await fetch('/api/plan/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: analyzedProject,
            business_description: analyzedProject.business_description,
            industry: analyzedProject.industry,
            company_name: analyzedProject.company_name,
            requirements: analyzedProject.requirements,
            cameras: analyzedProject.cameras,
            provider: 'auto',
          }),
        });

        if (planResp.ok) {
          const planData = await planResp.json();
          const safetyPlan = planData?.safety_plan || planData;
          if (safetyPlan && (safetyPlan.sections || safetyPlan.state)) {
            analyzedProject.safety_plan = safetyPlan;
          }
        }
      } catch (planErr) {
        console.warn('Safety plan background generation warning:', planErr);
      }

      // 3. Save project to store and update active state
      const saved = saveProject(analyzedProject, userId);
      setProject(saved);
      setProjects(getStoredProjects(userId));
      setIsDirty(false);

      // 4. Transition view directly to Camera Map to show 3D structures and telemetry
      setActiveView('camera-map');
    } catch (err) {
      console.error('All-In-One design error:', err);
      alert(err instanceof Error ? err.message : 'All-in-one design failed. Please check inputs.');
    } finally {
      setIsGeneratingAllInOne(false);
    }
  }, [userId, setActiveView]);

  const handleNewProject = useCallback((name: string, company: string, industry: string, description: string) => {
    if (!userId) return;
    const newProject = createNewProject(userId, name, company, industry, description);
    setProjects(getStoredProjects(userId));
    setProject(newProject);
    setIsDirty(false);
    setActiveView('scenario');
  }, [userId, setActiveView]);

  const handleDeleteProject = (target: DetVisionProject) => {
    if (!userId || !window.confirm(`Delete “${target.name}”? This removes it from this account on this browser and cannot be undone.`)) return;
    deleteProject(userId, target.id);
    const remaining = getStoredProjects(userId);
    setProjects(remaining);
    if (project?.id === target.id) {
      if (remaining[0]) {
        setActiveProject(userId, remaining[0].id);
        setProject(remaining[0]);
      } else {
        setProject(createEmptyProject('Plan Vision Project', '', '', ''));
      }
      setIsDirty(false);
    }
  };

  const handleRenameProject = (target: DetVisionProject) => {
    const name = window.prompt('Project name', target.name)?.trim();
    if (!name || name === target.name) return;
    if (!userId) return;
    const saved = saveProject({ ...target, name }, userId);
    setProjects(getStoredProjects(userId));
    if (project?.id === saved.id) setProject(saved);
  };

  const handleRestoreRevision = (target: DetVisionProject, revisionId: string) => {
    if (!userId) return;
    const restored = restoreProjectRevision(userId, target.id, revisionId);
    if (!restored) return;
    setProjects(getStoredProjects(userId));
    if (project?.id === target.id) setProject(restored);
    setIsDirty(false);
  };

  const handleClaimLegacyProjects = () => {
    if (!userId || !window.confirm('Import projects saved before sign-in into this account? Only continue if these projects belong to you.')) return;
    const claimed = claimLegacyProjects(userId);
    setHasUnassignedLegacyProjects(hasLegacyProjects());
    const active = getActiveProject(userId);
    setProjects(getStoredProjects(userId));
    if (active) setProject(active);
    setIsDirty(false);
    if (!claimed.length) window.alert('No previous projects could be imported. The old browser data remains unchanged.');
  };

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  const renderView = () => {
    switch (activeView) {
      case 'overview': {
        const cameraCount = project?.cameras.length || 0;
        const useCaseCount = project?.use_cases.length || 0;

        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Executive Facility Command Banner */}
              <div className="panel p-6 sm:p-8 relative overflow-hidden bg-gradient-to-br from-card via-surface/60 to-card border-border/80 shadow-md">
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone="success" dot>
                        System Nominal · Operational
                      </StatusPill>
                      <span className="mono-num text-[11px] text-muted-foreground">
                        IEC 62676-4 Certified Standard
                      </span>
                    </div>

                    <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-foreground tracking-tight">
                      {project?.name || 'Computer Vision Architecture Command'}
                    </h1>

                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {project?.company_name ? `${project.company_name} · ` : ''}
                      Unified spatial telemetry, optical coverage solver, and automated client engineering blueprints.
                    </p>
                  </div>

                  {/* Direct Command Actions */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      onClick={handleGenerateAllInOne}
                      disabled={isGeneratingAllInOne || !project?.business_description?.trim()}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-xs hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                      title="Run automated 3D spatial geometry and neural pipeline generation"
                    >
                      {isGeneratingAllInOne ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Designing Fleet…</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 fill-current text-white animate-pulse" />
                          <span>AI All-In-One Design</span>
                        </>
                      )}
                    </button>

                    <button 
                      onClick={() => setActiveView('camera-map')}
                      className="px-3.5 py-2 border border-border bg-surface hover:bg-card text-foreground rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 shadow-2xs"
                    >
                      <Camera className="w-3.5 h-3.5 text-primary" />
                      <span>2D/3D Camera CAD</span>
                    </button>

                    <button 
                      onClick={() => setActiveView('report')}
                      className="px-3.5 py-2 border border-border bg-surface hover:bg-card text-foreground rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 shadow-2xs"
                    >
                      <FileText className="w-3.5 h-3.5 text-cyan-500" />
                      <span>3-Page Blueprint</span>
                    </button>

                    <button 
                      onClick={() => setActiveView('scenario')}
                      className="px-3.5 py-2 border border-border bg-surface hover:bg-card text-muted-foreground hover:text-foreground rounded-lg font-medium text-xs transition-all"
                    >
                      <span>Threat Briefing</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Shared Project Brief Card (Real Project Data) */}
              {project && (
                <section className="panel p-6 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        <h2 className="text-base font-bold text-foreground">Shared Project Brief</h2>
                      </div>
                      <p className="whitespace-pre-wrap text-xs sm:text-sm leading-relaxed text-muted-foreground">
                        {project.business_description || 'Add your facility and computer vision idea once. Scenario analysis and the safety plan will both use this brief.'}
                      </p>
                      {project.requirements.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {project.requirements.map((requirement, index) => (
                            <li key={`${index}-${requirement}`} className="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs text-primary font-medium">
                              {requirement}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button 
                        onClick={() => setActiveView('scenario')} 
                        className="rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold hover:bg-muted text-foreground transition-colors"
                      >
                        Edit Brief / Analyze
                      </button>
                      <button 
                        onClick={() => setActiveView('plan-generator')} 
                        disabled={project.business_description.trim().length < 20} 
                        className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-xs"
                      >
                        Generate Safety Plan
                      </button>
                    </div>
                  </div>

                  {project.use_cases.length > 0 && (
                    <div className="border-t border-border/60 pt-4">
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Scenario Analysis · {project.use_cases.length} Use Cases
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {project.use_cases.map(useCase => (
                          <span key={useCase.id} className="rounded-lg border border-border bg-surface/70 px-3 py-1.5 text-xs font-medium text-foreground">
                            {useCase.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {project.safety_plan && (
                    <p className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 pt-2 border-t border-border/40">
                      <CheckCircle className="h-4 w-4" />
                      Safety plan generated {project.safety_plan.metadata?.generated_at ? new Date(project.safety_plan.metadata.generated_at).toLocaleString() : 'and saved with this project'}.
                    </p>
                  )}
                </section>
              )}

              {/* Real Project Telemetry Counts Grid */}
              {project && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard title="Use Cases" value={project.use_cases.length} icon={<ListChecks className="w-5 h-5" />} color="blue" />
                  <StatCard title="Cameras" value={project.cameras.length} icon={<Camera className="w-5 h-5" />} color="green" />
                  <StatCard title="Zones" value={project.zones.length} icon={<MapPin className="w-5 h-5" />} color="purple" />
                  <StatCard title="Workflow Nodes" value={project.workflow.nodes.length} icon={<GitBranch className="w-5 h-5" />} color="orange" />
                </div>
              )}

              {/* Multi-Stage Engineering Pipeline */}
              <section className="space-y-3">
                <SectionHeader
                  title="Engineering Pipeline & Compliance Lifecycle"
                  subtitle="End-to-end computer vision lifecycle from operational threat modeling to legal client sign-off"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <EngineeringPipelineCard
                    stage="01"
                    title="Threat & Scenario Modeling"
                    desc="Define facility boundaries, operational risks, security objectives, and AI use cases."
                    icon={FileText}
                    status="Configure Brief"
                    isComplete={Boolean(project?.business_description && project.business_description.length > 20)}
                    onClick={() => setActiveView('scenario')}
                  />
                  <EngineeringPipelineCard
                    stage="02"
                    title="Spatial Layout & Clearance"
                    desc="Physics-based camera placement, height AFF, tilt optimization, and occlusion raycasting."
                    icon={Zap}
                    status="Compute Telemetry"
                    isComplete={Boolean(project?.safety_plan)}
                    onClick={() => setActiveView('plan-generator')}
                  />
                  <EngineeringPipelineCard
                    stage="03"
                    title="2D Blueprint & 3D Twin"
                    desc="Interactive multi-floor site CAD, clipped FOV cones, and 3D telemetry digital twin."
                    icon={Camera}
                    status="Launch CAD Map"
                    isComplete={cameraCount > 0}
                    onClick={() => setActiveView('camera-map')}
                  />
                  <EngineeringPipelineCard
                    stage="04"
                    title="Executive 3-Page Blueprint"
                    desc="Client-ready 3-page master document, IEC 62676-4 verification, and engineering sign-off."
                    icon={ShieldCheck}
                    status="Generate Blueprint"
                    isComplete={cameraCount > 0 && Boolean(project?.safety_plan)}
                    onClick={() => setActiveView('report')}
                  />
                </div>
              </section>

              {/* Project History & Revisions Archive */}
              <section className="panel p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                  <div>
                    <h2 className="text-sm font-bold tracking-wider text-foreground uppercase">
                      Workspace Project Archives
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Locally preserved engineering revisions and client projects.
                    </p>
                  </div>
                  <label className="relative block w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input 
                      value={historyQuery} 
                      onChange={(e) => setHistoryQuery(e.target.value)} 
                      placeholder="Search archives…" 
                      className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground" 
                    />
                  </label>
                </div>

                {projects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center">
                    <FolderOpen className="mx-auto mb-2 h-6 w-6 text-muted-foreground opacity-50" />
                    <p className="text-xs font-semibold text-foreground">No archived projects</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Save your active plan to create an archive.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...projects]
                      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                      .filter((p) => `${p.name} ${p.company_name} ${p.industry}`.toLowerCase().includes(historyQuery.trim().toLowerCase()))
                      .map((p) => (
                        <div 
                          key={p.id} 
                          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition-all ${
                            project?.id === p.id 
                              ? 'border-primary/50 bg-primary/5 shadow-2xs' 
                              : 'border-border bg-surface/40 hover:bg-surface hover:border-border-strong'
                          }`}
                        >
                          <button
                            onClick={() => { setProject(p); setIsDirty(false); setActiveProject(userId, p.id); }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-foreground truncate">{p.name}</span>
                              <span className="mono-num px-1.5 py-0.2 rounded bg-muted text-[10px] text-muted-foreground font-semibold">
                                {p.cameras?.length || 0} cams
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {p.company_name || 'No company'} {p.industry ? `· ${p.industry}` : ''}
                              <span className="ml-2 font-mono text-[10px] opacity-75">
                                Updated {new Date(p.updated_at).toLocaleDateString()}
                              </span>
                            </p>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button 
                              onClick={() => { setProject(p); setIsDirty(false); setActiveProject(userId, p.id); setActiveView('scenario'); }} 
                              className="px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 rounded-md transition-colors flex items-center gap-1"
                            >
                              <Pencil className="h-3 w-3" />
                              <span>Edit</span>
                            </button>
                            <button 
                              onClick={() => handleRenameProject(p)} 
                              className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleDeleteProject(p)}
                              className="px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
                              title="Delete project"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Revision Snapshots */}
                {project && projects.some((item) => item.id === project.id) && (
                  <div className="mt-4 rounded-lg border border-border bg-surface/30 p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <History className="h-3.5 w-3.5 text-primary" />
                      <span>Revision Timeline · {project.name}</span>
                    </div>

                    {(project.revisions ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Save project modifications to record revision history.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(project.revisions ?? []).map((revision) => (
                          <div 
                            key={revision.id} 
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">{revision.label}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {new Date(revision.created_at).toLocaleString()} · {revision.changes.join(', ')}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={() => handleRestoreRevision(project, revision.id)} 
                                className="px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10 rounded flex items-center gap-1"
                              >
                                <RotateCcw className="h-3 w-3" /> Restore
                              </button>
                              <button 
                                onClick={() => { 
                                  const updated = deleteProjectRevision(userId, project.id, revision.id); 
                                  if (updated) { setProjects(getStoredProjects(userId)); setProject(updated); } 
                                }} 
                                className="px-2 py-0.5 text-[11px] text-rose-500 hover:bg-rose-500/10 rounded"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Footer */}
              <div className="pt-2">
                <Footer />
              </div>
            </div>
          </div>
        );
      }

      case 'scenario':
        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">
            <div className="max-w-3xl mx-auto">
              {project && (
                <ScenarioForm 
                  key={project.id} 
                  initialData={{ 
                    ...project, 
                    business_description: project.business_description, 
                    industry: project.industry, 
                    company_name: project.company_name, 
                    requirements: project.requirements 
                  }} 
                  onBriefChange={handleProjectUpdate} 
                  onAnalysisComplete={handleAnalysisComplete}
                  onGenerateAllInOne={handleGenerateAllInOne}
                  isGeneratingAllInOne={isGeneratingAllInOne}
                />
              )}
            </div>
          </div>
        );

      case 'camera-map':
        return (
          <div className="flex-1 min-h-0 h-full flex flex-col">
            {project ? (
              <CameraMap
                key={project.id}
                project={project}
                projects={projects.some(item => item.id === project.id) ? projects : [project, ...projects]}
                onUpdate={handleProjectUpdate}
                onProjectSelect={selected => {
                  if (isDirty && project) saveProject(project, userId);
                  setActiveProject(userId, selected.id);
                  setProject(selected);
                  setProjects(getStoredProjects(userId));
                  setIsDirty(false);
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">No project loaded</p>
              </div>
            )}
          </div>
        );

      case 'workflow':
        return (
          <div className="flex-1 min-h-0 h-full flex flex-col">
            {project ? (
              <WorkflowEditor 
                project={project} 
                onUpdate={(workflow) => handleProjectUpdate({ workflow })} 
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">No project loaded</p>
              </div>
            )}
          </div>
        );

      case 'report':
        return (
          <div className="flex-1 min-h-0 h-full flex flex-col overflow-y-auto">
            {project ? (
              <ReportPreview 
                project={project} 
                onPrint={handlePrint}
                onExportJSON={handleExportJSON}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">No project loaded</p>
              </div>
            )}
          </div>
        );

      case 'plan-generator':
        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">
            <div className="max-w-5xl mx-auto">
              {project ? <PlanGenerator project={project} onUpdate={handlePlanUpdate} onSaveProject={handleSave} onEditBrief={() => setActiveView('scenario')} /> : <p className="text-muted-foreground">Create a project to generate a safety plan.</p>}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const handleSidebarNavigate = (view: string) => {
    setActiveView(view as typeof activeView);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {hasUnassignedLegacyProjects && (
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-5 py-2.5 text-sm text-amber-950">
          <p>Previous browser projects are unassigned. Import them only if they belong to your account.</p>
          <button onClick={handleClaimLegacyProjects} className="rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white hover:bg-amber-800">Import my previous projects</button>
        </div>
      )}
      <div className="flex flex-1 min-w-0 max-lg:flex-col">
        <Sidebar
          userId={userId}
          onNavigate={handleSidebarNavigate}
          activeView={activeView}
          projectList={projects}
          currentProject={project}
          onProjectSelect={(selected) => {
            if (isDirty && project) saveProject(project, userId);
            setActiveProject(userId, selected.id);
            setProject(selected);
            setProjects(getStoredProjects(userId));
            setIsDirty(false);
          }}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <ProjectHeader
            project={project}
            onSave={handleSave}
            onExportJSON={handleExportJSON}
            onImportJSON={handleImportJSON}
            onPrint={handlePrint}
            onGenerateAllInOne={handleGenerateAllInOne}
            isGeneratingAllInOne={isGeneratingAllInOne}
            isDirty={isDirty}
          />
          <main key={activeView} className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in">
            {renderView()}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <ViewProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div></div>}>
        <ViewInitializer />
        <DashboardContent />
      </Suspense>
    </ViewProvider>
  );
}

function StatCard({ 
  title, 
  value, 
  icon, 
  color 
}: { 
  title: string; 
  value: number; 
  icon: React.ReactNode; 
  color: 'blue' | 'green' | 'purple' | 'orange'; 
}) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    orange: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };

  return (
    <div className="panel p-5 flex items-center justify-between transition-all hover:border-primary/40 group">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
        <p className="text-3xl font-extrabold tracking-tight mt-1 text-foreground mono-num">{value}</p>
      </div>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${colorMap[color]} group-hover:scale-105 transition-transform`}>
        {icon}
      </div>
    </div>
  );
}

function EngineeringPipelineCard({
  stage,
  title,
  desc,
  icon: Icon,
  status,
  isComplete,
  onClick,
}: {
  stage: string;
  title: string;
  desc: string;
  icon: React.ElementType;
  status: string;
  isComplete: boolean;
  onClick: () => void;
}) {
  return (
    <div 
      onClick={onClick}
      className="panel p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group relative overflow-hidden flex flex-col justify-between"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="mono-num text-[10px] font-bold text-primary tracking-wider uppercase bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
          Stage {stage}
        </span>
        <div className="flex items-center gap-1">
          {isComplete ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              <Check className="w-3 h-3" /> Ready
            </span>
          ) : (
            <span className="text-[10px] font-medium text-muted-foreground">Active</span>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-primary mb-2.5 group-hover:scale-105 transition-transform">
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-sm text-foreground group-hover:text-primary transition-colors mb-1">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {desc}
        </p>
      </div>

      <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs text-primary font-semibold">
        <span>{status}</span>
        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </div>
  );
}

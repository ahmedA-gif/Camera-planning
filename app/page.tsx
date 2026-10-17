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
import { getStoredProjects, getActiveProject, saveProject, createNewProject, exportProjectJSON, importProjectJSON, hasLegacyProjects, claimLegacyProjects } from '@/lib/project-store';
import { createEmptyProject } from '@/lib/project-factory';
import { deleteProject, setActiveProject, deleteProjectRevision, restoreProjectRevision } from '@/lib/project-store';
import type { DetVisionProject, AnalysisResponse } from '@/lib/types';
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
} from 'lucide-react';
import { ViewProvider, useView } from '@/components/view-context';
import { ViewInitializer } from '@/components/view-initializer';

function uuid(): string {
  return crypto.randomUUID();
}

function DashboardContent() {
  const { activeView, setActiveView } = useView();
  const { isLoaded: clerkLoaded, user } = useUser();
  const userId = user?.id ?? null;
  const [project, setProject] = useState<DetVisionProject | null>(null);
  const projectRef = useRef<DetVisionProject | null>(project);
  projectRef.current = project;
  const [projects, setProjects] = useState<DetVisionProject[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [hasUnassignedLegacyProjects, setHasUnassignedLegacyProjects] = useState(false);

  // Keep browser storage separated by authenticated Clerk account.
  useEffect(() => {
    if (!clerkLoaded) return;
    if (!userId) {
      setProject(null);
      setProjects([]);
      setHydrated(false);
      return;
    }
    setHydrated(false);
    const stored = getStoredProjects(userId);
    setProjects(stored);
    const active = getActiveProject(userId);
    if (active) {
      setProject(active);
    } else if (stored.length > 0) {
      setProject(stored[0]);
    } else {
      // Start with a real, empty workspace instead of silently loading sample data.
      const draft = createEmptyProject('Plan Vision Project', '', '', '');
      setProject(draft);
      setProjects([]);
    }
    setHasUnassignedLegacyProjects(stored.length === 0 && hasLegacyProjects());
    setHydrated(true);
  }, [clerkLoaded, userId]);

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
    const updatedProject: DetVisionProject = {
      ...project,
      ...response.project,
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

  if (!clerkLoaded || !userId || !hydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  const renderView = () => {
    switch (activeView) {
      case 'overview':
        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Welcome Card */}
              <div className="bg-white border border-border rounded-xl p-8">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold mb-2">Your vision planning workspace</h1>
                    <p className="text-muted-foreground mb-4">
                      Keep your project idea, scenario analysis, camera layout, workflow, and safety plan together in one workspace.
                    </p>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setActiveView('scenario')}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                      >
                        Edit project brief
                      </button>
                      <button 
                        onClick={() => setActiveView('camera-map')}
                        className="px-4 py-2 border border-input rounded-lg font-medium hover:bg-muted transition-colors"
                      >
                        Open Camera Map
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {project && (
                <section className="rounded-xl border border-border bg-white p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-semibold">Shared project brief</h2>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {project.business_description || 'Add your facility and computer vision idea once. Scenario analysis and the safety plan will both use this brief.'}
                      </p>
                      {project.requirements.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {project.requirements.map((requirement, index) => <li key={`${index}-${requirement}`} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{requirement}</li>)}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setActiveView('scenario')} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Edit brief / analyze</button>
                      <button onClick={() => setActiveView('plan-generator')} disabled={project.business_description.trim().length < 20} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">Generate safety plan</button>
                    </div>
                  </div>
                  {project.use_cases.length > 0 && <div className="mt-5 border-t border-border pt-4"><h3 className="mb-2 text-sm font-semibold">Scenario analysis · {project.use_cases.length} use cases</h3><div className="flex flex-wrap gap-2">{project.use_cases.map(useCase => <span key={useCase.id} className="rounded-lg border border-border px-3 py-2 text-sm">{useCase.name}</span>)}</div></div>}
                  {project.safety_plan && <p className="mt-4 flex items-center gap-2 text-sm text-green-700"><CheckCircle className="h-4 w-4" />Safety plan generated {project.safety_plan.metadata?.generated_at ? new Date(project.safety_plan.metadata.generated_at).toLocaleString() : 'and saved with this project'}.</p>}
                </section>
              )}

              {/* Quick Stats */}
              {project && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <StatCard title="Use Cases" value={project.use_cases.length} icon={<ListChecks className="w-5 h-5" />} color="blue" />
                  <StatCard title="Cameras" value={project.cameras.length} icon={<Camera className="w-5 h-5" />} color="green" />
                  <StatCard title="Zones" value={project.zones.length} icon={<MapPin className="w-5 h-5" />} color="purple" />
                  <StatCard title="Workflow Nodes" value={project.workflow.nodes.length} icon={<GitBranch className="w-5 h-5" />} color="orange" />
                </div>
              )}

              <section className="bg-white border border-border rounded-xl p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">Project History</h2>
                    <p className="text-sm text-muted-foreground">Saved projects on this device, ordered by last update.</p>
                  </div>
                  <label className="relative block w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="Search projects" className="w-full rounded-lg border border-input py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
                  </label>
                </div>
                {projects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
                    <FolderOpen className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                    <p className="font-medium">No saved projects yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">Save a project to keep it in your history.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...projects]
                      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                      .filter(p => `${p.name} ${p.company_name} ${p.industry}`.toLowerCase().includes(historyQuery.trim().toLowerCase()))
                      .map(p => (
                        <div key={p.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 transition-colors ${project?.id === p.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                          <button
                            onClick={() => { setProject(p); setIsDirty(false); setActiveProject(userId, p.id); }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate font-medium">{p.name}</span>
                            <span className="mt-1 block truncate text-sm text-muted-foreground">{p.company_name || 'No company'}{p.industry ? ` · ${p.industry}` : ''}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">Updated {new Date(p.updated_at).toLocaleString()}</span>
                          </button>
                          <div className="flex flex-wrap items-center gap-1">
                            <button onClick={() => { setProject(p); setIsDirty(false); setActiveProject(userId, p.id); setActiveView('scenario'); }} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/10" title="Edit project brief"><Pencil className="h-4 w-4"/><span>Edit</span></button>
                            <button onClick={() => handleRenameProject(p)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted" title="Rename project">Rename</button>
                          <button
                            onClick={() => handleDeleteProject(p)}
                            aria-label={`Delete ${p.name}`}
                            title="Delete project"
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" /><span>Delete</span>
                          </button>
                          </div>
                        </div>
                      ))}
                    {projects.filter(p => `${p.name} ${p.company_name} ${p.industry}`.toLowerCase().includes(historyQuery.trim().toLowerCase())).length === 0 && (
                      <p className="py-6 text-center text-sm text-muted-foreground">No projects match “{historyQuery}”.</p>
                    )}
                  </div>
                )}
                {project && projects.some(item => item.id === project.id) && (
                  <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4 animate-fade-in">
                    <div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-primary"/><h3 className="font-semibold">Revision history · {project.name}</h3></div>
                    {(project.revisions ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Save an edit to start a revision history.</p> : <div className="space-y-2">
                      {(project.revisions ?? []).map(revision => <div key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white p-3">
                        <div className="min-w-0"><p className="text-sm font-medium">{revision.label}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(revision.created_at).toLocaleString()} · {revision.changes.join(', ')}</p></div>
                        <div className="flex items-center gap-1"><button onClick={() => handleRestoreRevision(project, revision.id)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"><RotateCcw className="h-3.5 w-3.5"/>Restore</button><button onClick={() => { const updated = deleteProjectRevision(userId, project.id, revision.id); if (updated) { setProjects(getStoredProjects(userId)); setProject(updated); } }} className="rounded-md px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50">Delete</button></div>
                      </div>)}
                    </div>}
                    <p className="mt-2 text-[11px] text-muted-foreground">Revision snapshots omit uploaded images to keep browser storage manageable.</p>
                  </div>
                )}
              </section>

              {/* Workflow Steps */}
              <div className="bg-white border border-border rounded-xl p-6">
                <h2 className="text-xl font-bold mb-6">Typical Workflow</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <StepCard number="1" title="Shared Project Brief" desc="Enter the facility and idea once; all project tools use the same brief" icon={<FileText className="w-5 h-5" />} />
                  <StepCard number="2" title="Scenario Analysis" desc="Create use cases and feasibility notes from the shared brief" icon={<Zap className="w-5 h-5" />} />
                  <StepCard number="3" title="Camera Layout" desc="Draw site structure and plan camera coverage for the use cases" icon={<Camera className="w-5 h-5" />} />
                  <StepCard number="4" title="Plan & Report" desc="Generate a saved safety plan and export the project report" icon={<FileText className="w-5 h-5" />} />
                </div>
              </div>
            </div>
          </div>
        );

      case 'scenario':
        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">
            <div className="max-w-3xl mx-auto">
              {project && <ScenarioForm key={project.id} initialData={{ ...project, business_description: project.business_description, industry: project.industry, company_name: project.company_name, requirements: project.requirements }} onBriefChange={handleProjectUpdate} onAnalysisComplete={handleAnalysisComplete} />}
            </div>
          </div>
        );

      case 'camera-map':
        return (
          <div className="min-h-0 flex-1 overflow-hidden">
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
          <div className="min-h-0 flex-1 overflow-hidden">
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
          <div className="min-h-0 flex-1 overflow-hidden">
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
    <>
    {hasUnassignedLegacyProjects && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-950"><p>Previous browser projects are unassigned. Import them only if they belong to your account.</p><button onClick={handleClaimLegacyProjects} className="rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white hover:bg-amber-800">Import my previous projects</button></div>}
    <div className="flex min-h-[calc(100dvh-7rem)] bg-background max-lg:flex-col">
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
          isDirty={isDirty}
        />
        <main key={activeView} className="flex-1 min-h-0 animate-fade-in">
          {renderView()}
        </main>
      </div>
    </div>
    </>
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

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  };
  return (
    <div className="bg-white border border-border rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color as keyof typeof colors]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function StepCard({ number, title, desc, icon }: { number: string; title: string; desc: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-border rounded-xl p-6 relative">
      <div className="absolute -top-3 left-6 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">
        {number}
      </div>
      <div className="pt-6">
        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-3 text-primary">
          {icon}
        </div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

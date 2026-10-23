'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  FileText, 
  Camera, 
  GitBranch, 
  FileOutput, 
  Zap,
  ChevronLeft,
  ChevronRight,
  Plus,
  ShieldCheck,
  Cpu,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { getStoredProjects, getActiveProject, setActiveProject, createNewProject } from '@/lib/project-store';
import type { DetVisionProject } from '@/lib/types';
import { LiveDot, StatusPill } from '@/components/ui/telemetry-primitives';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, view: 'overview' },
  { href: '/scenario', label: 'Threat & Scenario', icon: FileText, view: 'scenario' },
  { href: '/camera-map', label: '2D/3D Camera Map', icon: Camera, view: 'camera-map', hasBadge: true },
  { href: '/workflow', label: 'Vision Pipeline', icon: GitBranch, view: 'workflow' },
  { href: '/plan-generator', label: 'AI Safety Plan', icon: Zap, view: 'plan-generator' },
  { href: '/report', label: 'Client Blueprint', icon: FileOutput, view: 'report' },
];

interface SidebarProps {
  userId: string;
  onNavigate?: (view: string) => void;
  activeView?: string;
  onProjectSelect?: (project: DetVisionProject) => void;
  projectList?: DetVisionProject[];
  currentProject?: DetVisionProject | null;
}

export function Sidebar({ 
  userId, 
  onNavigate, 
  activeView, 
  onProjectSelect, 
  projectList, 
  currentProject 
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [storedProjects, setStoredProjects] = useState<DetVisionProject[]>([]);
  const projects = projectList ?? storedProjects;
  const [activeProject, setActiveProjectState] = useState<DetVisionProject | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);

  const loadProjects = () => {
    const stored = getStoredProjects(userId);
    setStoredProjects(stored);
    const active = getActiveProject(userId);
    setActiveProjectState(active);
  };

  useEffect(() => { loadProjects(); }, [userId]);
  useEffect(() => { if (currentProject) setActiveProjectState(currentProject); }, [currentProject]);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    
    const project = createNewProject(
      userId,
      newProjectName.trim(),
      newCompanyName.trim(),
      '',
      ''
    );
    setStoredProjects(getStoredProjects(userId));
    setActiveProjectState(project);
    onProjectSelect?.(project);
    setShowNewProject(false);
    setNewProjectName('');
    setNewCompanyName('');
    setIsProjectsOpen(false);
    onNavigate?.('scenario');
  };

  const handleProjectSelect = (project: DetVisionProject) => {
    setActiveProject(userId, project.id);
    setActiveProjectState(project);
    onProjectSelect?.(project);
    setIsProjectsOpen(false);
  };

  const handleNavClick = (item: typeof navigation[0]) => {
    if (onNavigate) {
      onNavigate(item.view);
    } else {
      router.push(item.href);
    }
  };

  return (
    <aside 
      className={`${collapsed ? 'w-16' : 'w-64'} h-full shrink-0 bg-card border-r border-border flex flex-col transition-[width] duration-200 select-none z-20 max-lg:h-auto max-lg:w-full max-lg:border-r-0 max-lg:border-b`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-3.5 border-b border-border/80 bg-background/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/25 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-bold tracking-tight text-foreground">
                Plan Vision <span className="text-[10px] text-primary font-mono font-normal">v2.4</span>
              </span>
              <span className="block truncate text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                CCTV & Spatial CAD
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Active Project Switcher */}
      <div className="p-3 border-b border-border/70">
        {!collapsed ? (
          <div>
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-1">
                <Layers className="w-3 h-3 text-primary" /> Active Project
              </span>
              <button
                onClick={() => setShowNewProject(true)}
                className="text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
                title="Create new project"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
            
            <div className="relative">
              <button
                onClick={() => setIsProjectsOpen(!isProjectsOpen)}
                className="w-full flex items-center justify-between p-2 rounded-lg bg-surface border border-border hover:border-primary/40 text-left transition-all group"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <p className="font-semibold text-xs truncate text-foreground group-hover:text-primary transition-colors">
                    {activeProject?.name || 'Select Project'}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {activeProject?.company_name || 'Personal Workspace'} · {activeProject?.cameras.length || 0} cams
                  </p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isProjectsOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Project Dropdown */}
              {isProjectsOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-56 overflow-y-auto">
                  <div className="p-1 space-y-0.5">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleProjectSelect(p)}
                        className={`w-full text-left p-2 rounded-md transition-colors text-xs flex items-center justify-between ${
                          activeProject?.id === p.id 
                            ? 'bg-primary/15 text-primary font-semibold' 
                            : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="truncate">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate font-normal">
                            {p.company_name || 'No company'}
                          </p>
                        </div>
                        <span className="mono-num text-[10px] text-muted-foreground shrink-0">
                          {p.cameras.length}c
                        </span>
                      </button>
                    ))}
                    {projects.length === 0 && (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        No projects yet
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={() => setShowNewProject(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-surface border border-border hover:bg-muted text-primary"
              title="Create New Project"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = activeView 
            ? activeView === item.view 
            : pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          
          return (
            <button
              key={item.href}
              onClick={() => handleNavClick(item)}
              title={item.label}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all w-full text-left text-xs font-medium group ${
                isActive 
                  ? 'bg-primary/15 text-primary font-semibold border border-primary/30 shadow-xs' 
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent'
              }`}
            >
              <item.icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-primary' : 'group-hover:text-foreground'}`} />
              {!collapsed && (
                <div className="flex items-center justify-between min-w-0 flex-1">
                  <span className="truncate">{item.label}</span>
                  {item.hasBadge && activeProject && activeProject.cameras.length > 0 && (
                    <span className="mono-num rounded px-1.5 py-0.2 bg-muted text-[10px] text-muted-foreground font-semibold">
                      {activeProject.cameras.length}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Telemetry Status Footer */}
      <div className="p-3 border-t border-border/80 bg-background/40 space-y-2">
        {!collapsed ? (
          <>
            <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-surface/70 border border-border/60 text-[10px]">
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                <LiveDot tone="success" /> System Engine
              </span>
              <span className="mono-num text-muted-foreground">99.8% Online</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 rounded-md bg-surface/40 text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3 text-cyan-500" /> NPU ACCELERATED
              </span>
              <span>12ms</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <LiveDot tone="success" />
            <Cpu className="w-3.5 h-3.5 text-cyan-500" />
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between bg-surface/50">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm text-foreground">New Vision Project</h3>
              </div>
              <button 
                onClick={() => setShowNewProject(false)} 
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleCreateProject} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Project Title *
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                  placeholder="e.g. Apex Logistics Terminal CCTV"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Client / Facility Organization
                </label>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                  placeholder="e.g. Metro Distribution Hub"
                />
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Your workspace will initialize with full 2D/3D camera planning, spatial telemetry calculations, and client blueprint export.
              </p>

              <div className="flex gap-2 justify-end pt-2 border-t border-border/60">
                <button 
                  type="button" 
                  onClick={() => setShowNewProject(false)} 
                  className="px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-xs"
                >
                  Initialize Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}

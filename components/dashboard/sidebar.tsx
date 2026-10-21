'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  FileText, 
  Camera, 
  GitBranch, 
  FileOutput, 
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getStoredProjects, getActiveProject, setActiveProject, createNewProject } from '@/lib/project-store';
import type { DetVisionProject } from '@/lib/types';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, view: 'overview' },
  { href: '/plan-generator', label: 'AI Plan Generator', icon: Zap, view: 'plan-generator' },
  { href: '/scenario', label: 'Scenario', icon: FileText, view: 'scenario' },
  { href: '/camera-map', label: 'Camera Map', icon: Camera, view: 'camera-map' },
  { href: '/workflow', label: 'Workflow', icon: GitBranch, view: 'workflow' },
  { href: '/report', label: 'Report', icon: FileOutput, view: 'report' },
];

interface SidebarProps {
  userId: string;
  onNavigate?: (view: string) => void;
  activeView?: string;
  onProjectSelect?: (project: DetVisionProject) => void;
  projectList?: DetVisionProject[];
  currentProject?: DetVisionProject | null;
}

export function Sidebar({ userId, onNavigate, activeView, onProjectSelect, projectList, currentProject }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [storedProjects, setStoredProjects] = useState<DetVisionProject[]>([]);
  const projects = projectList ?? storedProjects;
  const [activeProject, setActiveProjectState] = useState<DetVisionProject | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

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
      '',
      '',
      ''
    );
    setStoredProjects(getStoredProjects(userId));
    setActiveProjectState(project);
    onProjectSelect?.(project);
    setShowNewProject(false);
    setNewProjectName('');
    onNavigate?.('scenario');
  };

  const handleProjectSelect = (project: DetVisionProject) => {
    setActiveProject(userId, project.id);
    setActiveProjectState(project);
    onProjectSelect?.(project);
  };

  const handleNewProjectClick = () => {
    setShowNewProject(true);
  };

  const handleNavClick = (item: typeof navigation[0]) => {
    if (onNavigate) {
      onNavigate(item.view);
    } else {
      router.push(item.href);
    }
  };

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} h-full shrink-0 bg-white border-r border-border flex flex-col transition-[width] duration-200 max-lg:h-auto max-lg:w-full max-lg:border-r-0 max-lg:border-b`}>
      {/* Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-border">
        <div className="flex items-center gap-2">
          {collapsed ? <img src="/techhub-logo.svg" alt="TechHub" className="h-8 w-8 rounded object-cover object-left" /> : <img src="/techhub-logo.svg" alt="TechHub Plan Vision" className="h-10 w-36 rounded object-contain" />}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Project Switcher */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <span className={collapsed ? 'hidden' : 'text-sm font-medium text-muted-foreground'}>Active Project</span>
        </div>
        {!collapsed && (
          <div className="space-y-2">
            {projects.map(project => (
              <button
                key={project.id}
                onClick={() => handleProjectSelect(project)}
                className={`w-full text-left p-2 rounded transition-colors ${
                  activeProject?.id === project.id 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-muted'
                }`}
              >
                <div className="font-medium truncate">{project.name}</div>
                <div className="text-xs opacity-75 truncate">{project.company_name}</div>
              </button>
            ))}
            {projects.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-4">
                No projects yet
              </div>
            )}
          </div>
        )}
        <button
          onClick={handleNewProjectClick}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded transition-colors"
        >
          <span className="w-4 h-4">+</span>
          {!collapsed && <span>New Project</span>}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map(item => {
          const isActive = activeView ? activeView === item.view : pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <button
              key={item.href}
              onClick={() => handleNavClick(item)}
              className={`flex items-center gap-3 px-3 py-2 rounded transition-colors w-full text-left ${
                isActive 
                  ? 'bg-primary text-primary-foreground' 
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          {!collapsed && <span>Local Storage Mode</span>}
        </div>
      </div>

      {/* New Project Modal */}
      {showNewProject && !collapsed && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">New Project</h3>
              <button onClick={() => setShowNewProject(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <form onSubmit={handleCreateProject} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Project name"
                  autoFocus
                  required
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Next, add the company, industry, description, and requirements once in the shared project brief.</p>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowNewProject(false)} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}

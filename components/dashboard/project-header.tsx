'use client';

import { useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { 
  Save, 
  Download, 
  Upload, 
  AlertCircle, 
  FileText, 
  FileType, 
  Printer, 
  X, 
  Sparkles, 
  Loader2, 
  ChevronRight,
  Cctv,
  Activity,
  Layers
} from 'lucide-react';
import type { DetVisionProject } from '@/lib/types';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useClock, LiveDot, StatusPill } from '@/components/ui/telemetry-primitives';

interface ProjectHeaderProps {
  project: DetVisionProject | null;
  onSave?: () => void;
  onExportJSON?: () => void;
  onImportJSON?: (file: File) => void;
  onPrint?: () => void;
  onGenerateAllInOne?: () => void;
  isGeneratingAllInOne?: boolean;
  isDirty?: boolean;
}

export function ProjectHeader({ 
  project, 
  onSave, 
  onExportJSON, 
  onImportJSON, 
  onPrint,
  onGenerateAllInOne,
  isGeneratingAllInOne = false,
  isDirty = false 
}: ProjectHeaderProps) {
  const clock = useClock();
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState<'pdf' | 'docx' | null>(null);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportJSON?.(file);
  };

  const generateReport = async (format: 'pdf' | 'docx') => {
    if (!project) return;
    setReportError(null);
    setReportLoading(format);
    
    try {
      const response = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, format }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error([data.error, data.details].filter(Boolean).join(' ') || `Report generation failed (${response.status}).`);
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (format === 'pdf' && contentType.includes('text/html')) {
        if (onPrint) {
          onPrint();
          return;
        }
      }

      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') 
        || `plan-vision-report.${format}`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Report generation failed:', error);
      const message = error instanceof Error ? error.message : 'Report generation failed.';
      if (format === 'pdf' && onPrint) {
        setReportError(`${message} Opening print view; select "Save as PDF".`);
        onPrint();
      } else {
        setReportError(message);
      }
    } finally {
      setReportLoading(null);
    }
  };

  if (!project) {
    return (
      <header className="relative z-30 h-16 min-h-16 max-h-16 shrink-0 bg-card/90 backdrop-blur-md border-b border-border px-5 flex items-center justify-between select-none">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
          <span>Plan Vision Command Suite</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-foreground">No Project Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserButton />
        </div>
      </header>
    );
  }

  const cameraCount = project.cameras.length;
  const useCaseCount = project.use_cases.length;

  return (
    <header className="relative z-30 h-16 min-h-16 max-h-16 shrink-0 bg-card/90 backdrop-blur-md border-b border-border px-4 sm:px-6 flex items-center justify-between gap-3 select-none">
      {/* Left: Project Breadcrumbs & Metadata */}
      <div className="flex items-center gap-3 min-w-0 shrink">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium mb-0.5">
            <span className="truncate max-w-[100px]">{project.company_name || 'Personal Workspace'}</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
            <span className="text-foreground/80 font-semibold truncate max-w-[120px] sm:max-w-[180px]">
              {project.name}
            </span>
            {isDirty && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30 shrink-0 ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Unsaved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <h1 className="font-bold text-sm sm:text-base text-foreground truncate max-w-[180px] sm:max-w-xs" title={project.name}>
              {project.name}
            </h1>
            <div className="hidden md:flex items-center gap-1.5 mono-num text-[11px] text-muted-foreground">
              <span>·</span>
              <span className="flex items-center gap-1">
                <Cctv className="w-3 h-3 text-primary" /> {cameraCount} Cams
              </span>
              <span>·</span>
              <span>{useCaseCount} Use Cases</span>
            </div>
          </div>
        </div>

        {/* Missing details note badge */}
        {(project.missing_information.length > 0 || project.assumptions.length > 0) && (
          <div 
            className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-md shrink-0 cursor-default"
            title={`${project.missing_information.length} missing details, ${project.assumptions.length} engineering assumptions`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[11px] font-medium font-mono">{project.missing_information.length + project.assumptions.length} notes</span>
          </div>
        )}
      </div>

      {/* Right: Actions, AI Generator & Blueprint Exports */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Hero AI All-in-One Generator */}
        {onGenerateAllInOne && (
          <button
            onClick={onGenerateAllInOne}
            disabled={isGeneratingAllInOne}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:brightness-110 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50 shrink-0"
            title="Automatically design 3D camera placements, structures, and safety blueprint from requirements"
          >
            {isGeneratingAllInOne ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden sm:inline">Generating Design…</span>
                <span className="sm:hidden">Designing</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 fill-current text-white animate-pulse" />
                <span className="hidden sm:inline">AI All-In-One Design</span>
                <span className="sm:hidden">AI Design</span>
              </>
            )}
          </button>
        )}

        {/* Save button */}
        {onSave && (
          <button
            onClick={onSave}
            disabled={!isDirty}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              isDirty
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-400/50'
                : 'text-muted-foreground bg-muted/60 opacity-60 cursor-not-allowed'
            }`}
            title={isDirty ? 'Save changes to active project' : 'All changes saved'}
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save</span>
          </button>
        )}

        {/* Segmented Reports Control: PDF | DOCX | Print */}
        <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 text-xs font-medium shadow-xs">
          <button
            onClick={() => generateReport('pdf')}
            disabled={reportLoading !== null}
            className="px-2.5 py-1 rounded-md text-foreground hover:bg-card hover:shadow-xs transition-all disabled:opacity-60 flex items-center gap-1"
            title="Download Client 3-Page Blueprint PDF"
          >
            {reportLoading === 'pdf' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-cyan-500" />
            )}
            <span>PDF</span>
          </button>

          <div className="w-[1px] h-3.5 bg-border my-auto" />

          <button
            onClick={() => generateReport('docx')}
            disabled={reportLoading !== null}
            className="px-2.5 py-1 rounded-md text-foreground hover:bg-card hover:shadow-xs transition-all disabled:opacity-60 flex items-center gap-1"
            title="Download Editable DOCX Report"
          >
            {reportLoading === 'docx' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
            ) : (
              <FileType className="w-3.5 h-3.5 text-emerald-500" />
            )}
            <span>DOCX</span>
          </button>

          {onPrint && (
            <>
              <div className="w-[1px] h-3.5 bg-border my-auto" />
              <button
                onClick={onPrint}
                className="px-2.5 py-1 rounded-md text-foreground hover:bg-card hover:shadow-xs transition-all flex items-center gap-1"
                title="Print Blueprint"
              >
                <Printer className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="hidden lg:inline">Print</span>
              </button>
            </>
          )}
        </div>

        {/* JSON Export & Import Tools */}
        <div className="hidden sm:flex items-center gap-1">
          {onExportJSON && (
            <button
              onClick={onExportJSON}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors border border-transparent hover:border-border"
              title="Export Project JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}

          {onImportJSON && (
            <>
              <input
                type="file"
                accept=".json"
                onChange={handleFileImport}
                className="hidden"
                id="import-json"
              />
              <label
                htmlFor="import-json"
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors cursor-pointer border border-transparent hover:border-border"
                title="Import Project JSON"
              >
                <Upload className="w-3.5 h-3.5" />
              </label>
            </>
          )}
        </div>

        <div className="w-[1px] h-4 bg-border my-auto mx-0.5" />

        <ThemeToggle />
        <UserButton />
      </div>

      {/* Floating Report Error Toast */}
      {reportError && (
        <div 
          role="status" 
          className="absolute top-16 right-4 z-50 mt-1 max-w-md rounded-lg border border-destructive/40 bg-card px-3.5 py-2 text-xs text-destructive shadow-xl flex items-center justify-between gap-2 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
            <span>{reportError}</span>
          </div>
          <button 
            onClick={() => setReportError(null)} 
            className="text-muted-foreground hover:text-destructive p-0.5 rounded"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}

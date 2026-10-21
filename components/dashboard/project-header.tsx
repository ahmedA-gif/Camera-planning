'use client';

import { useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { Save, Download, Upload, AlertCircle, Info, FileText, FileType, ExternalLink, Camera, Sparkles, Loader2, Printer, X } from 'lucide-react';
import type { DetVisionProject } from '@/lib/types';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useView } from '@/components/view-context';

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
  let viewCtx: any = null;
  try {
    viewCtx = useView();
  } catch {
    // optional outside provider
  }
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
      // If server returned HTML fallback for PDF (e.g. on serverless Vercel), seamlessly open high-res print/PDF view
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
        setReportError(`${message} Opening the printable report; choose “Save as PDF” in the print dialog.`);
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
      <header className="relative z-30 h-16 min-h-16 max-h-16 shrink-0 bg-card/95 backdrop-blur-md border-b border-border px-4 sm:px-6 flex items-center justify-between gap-3 select-none">
        <div>
          <h1 className="text-lg font-bold text-foreground">Plan Vision</h1>
          <p className="text-xs text-muted-foreground">Select or create a project to begin</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserButton />
        </div>
      </header>
    );
  }

  return (
    <header className="relative z-30 h-16 min-h-16 max-h-16 shrink-0 bg-card/95 backdrop-blur-md border-b border-border px-4 sm:px-6 flex items-center justify-between gap-3 select-none">
      {/* Left Section: Project Identity & Status */}
      <div className="flex items-center gap-3 min-w-0 shrink">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold text-foreground truncate max-w-[140px] sm:max-w-[200px] md:max-w-xs xl:max-w-md" title={project.name}>
              {project.name}
            </h1>
            {isDirty && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-600/40 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Unsaved
              </span>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground truncate">
            {project.company_name && <span className="truncate max-w-[120px]">{project.company_name}</span>}
            {project.company_name && project.industry && <span>·</span>}
            {project.industry && <span className="truncate max-w-[100px]">{project.industry}</span>}
            {(project.company_name || project.industry) && <span>·</span>}
            <span>{project.cameras.length} cams</span>
            <span>·</span>
            <span>{project.use_cases.length} use cases</span>
          </div>
        </div>

        {/* Missing info / assumptions alert badge (compact) */}
        {(project.missing_information.length > 0 || project.assumptions.length > 0) && (
          <div 
            className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/30 rounded-md shrink-0 cursor-default"
            title={`${project.missing_information.length} missing details, ${project.assumptions.length} engineering assumptions`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[11px] font-medium">{project.missing_information.length + project.assumptions.length} notes</span>
          </div>
        )}
      </div>

      {/* Center Section: Hero AI Action */}
      {onGenerateAllInOne && (
        <button
          onClick={onGenerateAllInOne}
          disabled={isGeneratingAllInOne}
          className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white rounded-lg hover:opacity-95 transition-all shadow-xs hover:shadow-md disabled:opacity-50 shrink-0"
          title="Automatically design structures, 3D telemetry AI, camera placements, and safety plan from user requirements"
        >
          {isGeneratingAllInOne ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Designing System…</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 fill-current text-yellow-300 animate-pulse" />
              <span>Generate All-In-One Design</span>
            </>
          )}
        </button>
      )}

      {/* Right Section: Actions & Utilities */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Mobile/Compact trigger for All-in-one generator */}
        {onGenerateAllInOne && (
          <button
            onClick={onGenerateAllInOne}
            disabled={isGeneratingAllInOne}
            className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white rounded-lg hover:opacity-95 transition-all shadow-xs disabled:opacity-50"
            title="Generate All-In-One Design"
          >
            {isGeneratingAllInOne ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 fill-current text-yellow-300" />
            )}
            <span className="hidden xs:inline">Design</span>
          </button>
        )}

        {/* Save button */}
        {onSave && (
          <button
            onClick={onSave}
            disabled={!isDirty}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-xs ${
              isDirty
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-1 ring-emerald-500/50'
                : 'text-muted-foreground bg-muted/60 hover:bg-muted opacity-50 cursor-not-allowed'
            }`}
            title={isDirty ? 'Save changes to active project' : 'All changes saved'}
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save</span>
          </button>
        )}

        {/* Segmented Reports Control: PDF | DOCX | Print */}
        <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5 text-xs font-medium shadow-xs">
          <button
            onClick={() => generateReport('pdf')}
            disabled={reportLoading !== null}
            className="px-2.5 py-1 rounded-md text-foreground hover:bg-background hover:shadow-xs transition-all disabled:opacity-60 flex items-center gap-1"
            title="Download Professional PDF Report with 3D Diagrams"
          >
            {reportLoading === 'pdf' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-blue-600" />
            )}
            <span>PDF</span>
          </button>

          <div className="w-[1px] h-3.5 bg-border my-auto" />

          <button
            onClick={() => generateReport('docx')}
            disabled={reportLoading !== null}
            className="px-2.5 py-1 rounded-md text-foreground hover:bg-background hover:shadow-xs transition-all disabled:opacity-60 flex items-center gap-1"
            title="Download Editable DOCX Report"
          >
            {reportLoading === 'docx' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
            ) : (
              <FileType className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>DOCX</span>
          </button>

          {onPrint && (
            <>
              <div className="w-[1px] h-3.5 bg-border my-auto" />
              <button
                onClick={onPrint}
                className="px-2.5 py-1 rounded-md text-foreground hover:bg-background hover:shadow-xs transition-all flex items-center gap-1"
                title="Open Printable Report View"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                <span className="hidden lg:inline">Print</span>
              </button>
            </>
          )}
        </div>

        {/* JSON Tools (Export / Import) as sleek compact buttons */}
        <div className="hidden sm:flex items-center gap-0.5">
          {onExportJSON && (
            <button
              onClick={onExportJSON}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
              title="Export Project JSON"
            >
              <Download className="w-4 h-4" />
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
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer"
                title="Import Project JSON"
              >
                <Upload className="w-4 h-4" />
              </label>
            </>
          )}
        </div>

        <div className="w-[1px] h-4 bg-border my-auto mx-0.5" />

        {/* Utilities */}
        <ThemeToggle />
        <UserButton />
      </div>

      {/* Floating Non-Disruptive Report Error Toast */}
      {reportError && (
        <div 
          role="status" 
          className="absolute top-16 right-4 z-50 mt-1 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 backdrop-blur-md px-3.5 py-2 text-xs text-destructive shadow-lg flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-1"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
            <span>{reportError}</span>
          </div>
          <button 
            onClick={() => setReportError(null)} 
            className="text-destructive/70 hover:text-destructive p-0.5 rounded"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}

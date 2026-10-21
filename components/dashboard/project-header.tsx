'use client';

import { useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { Save, Download, Upload, AlertCircle, Info, FileText, FileType, ExternalLink, Camera, Sparkles, Loader2 } from 'lucide-react';
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
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportJSON?.(file);
  };

  const generateReport = async (format: 'pdf' | 'docx') => {
    if (!project) return;
    setReportError(null);
    
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
    }
  };

  if (!project) {
    return (
      <header className="sticky top-0 z-30 min-h-16 bg-card/90 backdrop-blur-xl border-b border-border px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Plan Vision</h1>
          <p className="text-sm text-muted-foreground">Select or create a project to begin</p>
        </div>
        <ThemeToggle />
        <UserButton />
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 min-h-16 bg-card/90 backdrop-blur-xl border-b border-border px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-semibold truncate">{project.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {project.company_name && <span>{project.company_name}</span>}
          {project.company_name && project.industry && <span>·</span>}
          {project.industry && <span>{project.industry}</span>}
          {(project.company_name || project.industry) && <span>·</span>}
          <span>{project.use_cases.length} use cases</span>
          <span>·</span>
          <span>{project.cameras.length} cameras</span>
        </div>
      </div>
      
      <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
        <ThemeToggle />
        <UserButton />
        {/* Missing info warning */}
        {(project.missing_information.length > 0 || project.assumptions.length > 0) && (
          <div className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-50 text-amber-700 rounded">
            <AlertCircle className="w-3 h-3" />
            <span>{project.missing_information.length} missing, {project.assumptions.length} assumptions</span>
          </div>
        )}

        {/* Save button */}
        {onSave && (
          <button
            onClick={onSave}
            disabled={!isDirty}
            className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <Save className="w-4 h-4" />
            <span>Save</span>
          </button>
        )}

        {/* Export JSON */}
        {onExportJSON && (
          <button
            onClick={onExportJSON}
            className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors flex items-center gap-1"
          >
            <Download className="w-4 h-4" />
            <span>Export JSON</span>
          </button>
        )}

        {/* Import JSON */}
        {onImportJSON && (
          <>
            <input
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className="hidden"
              id="import-json"
            />
            <label htmlFor="import-json" className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors flex items-center gap-1 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>Import</span>
            </label>
          </>
        )}

        {/* Unified "Generate All-In-One Design" Button */}
        {onGenerateAllInOne && (
          <button
            onClick={onGenerateAllInOne}
            disabled={isGeneratingAllInOne}
            className="px-3.5 py-1.5 text-xs sm:text-sm font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white rounded-lg hover:opacity-95 transition-all flex items-center gap-1.5 shadow-sm hover:shadow-md disabled:opacity-50"
            title="Automatically design structures, 3D telemetry AI, camera placements, and safety plan from user requirements"
          >
            {isGeneratingAllInOne ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Designing System…</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 fill-current text-yellow-300 animate-pulse" />
                <span>Generate All-In-One Design</span>
              </>
            )}
          </button>
        )}

        {/* Native 3D Camera Map Button */}
        <button
          onClick={() => viewCtx?.setActiveView('camera-map')}
          className="px-3 py-1.5 text-sm font-medium bg-cyan-600 text-white rounded hover:bg-cyan-700 transition-colors flex items-center gap-1.5 shadow-sm"
          title="Open Native 3D Camera Map & Coverage Planner"
        >
          <Camera className="w-4 h-4" />
          <span>Camera Map</span>
        </button>

        {/* Generate PDF Report */}
        <button
          onClick={() => generateReport('pdf')}
          className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
          title="Generate Professional PDF Report"
        >
          <FileText className="w-4 h-4" />
          <span>PDF</span>
        </button>

        {/* Generate DOCX Report */}
        <button
          onClick={() => generateReport('docx')}
          className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1"
          title="Generate Professional DOCX Report"
        >
          <FileType className="w-4 h-4" />
          <span>DOCX</span>
        </button>

        {/* Print report (browser print) */}
        {onPrint && (
          <button
            onClick={onPrint}
            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors flex items-center gap-1"
          >
            <Download className="w-4 h-4" />
            <span>Print</span>
          </button>
        )}
      </div>
      {reportError && <p role="status" className="w-full text-right text-xs text-destructive">{reportError}</p>}
    </header>
  );
}

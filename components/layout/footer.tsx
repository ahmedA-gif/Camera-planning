import { Camera, GitBranch, MapPin, Zap } from 'lucide-react';

const capabilities = [
  { label: 'Camera mapping', icon: Camera },
  { label: 'Workflow design', icon: GitBranch },
  { label: 'Zone planning', icon: MapPin },
  { label: 'Scenario analysis', icon: Zap },
];

export default function Footer() {
  return (
    <footer className="border-t border-border bg-white text-foreground">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Camera className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-semibold">Plan Vision</p>
            <p className="text-xs text-muted-foreground">Computer vision planning workspace</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {capabilities.map(({ label, icon: Icon }) => (
            <span key={label} className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5 text-primary" />{label}</span>
          ))}
        </div>
        <p className="w-full border-t border-border pt-3 text-xs text-muted-foreground sm:w-auto sm:border-0 sm:pt-0">© {new Date().getFullYear()} Plan Vision</p>
      </div>
    </footer>
  );
}

'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

type ActiveView = 'overview' | 'scenario' | 'camera-map' | 'workflow' | 'report' | 'plan-generator';

interface ViewContextType {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
}

const ViewContext = createContext<ViewContextType | null>(null);

export function ViewProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActiveView>('overview');
  
  return (
    <ViewContext.Provider value={{ activeView, setActiveView }}>
      {children}
    </ViewContext.Provider>
  );
}

export function useView() {
  const context = useContext(ViewContext);
  if (!context) {
    throw new Error('useView must be used within a ViewProvider');
  }
  return context;
}

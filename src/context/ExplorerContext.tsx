import { createContext, useContext, type ReactNode } from 'react';
import { useExplorerData } from '../hooks/useExplorerData';

type ExplorerContextType = ReturnType<typeof useExplorerData>;

const ExplorerContext = createContext<ExplorerContextType | undefined>(undefined);

export function ExplorerProvider({ children }: { children: ReactNode }) {
  const explorerData = useExplorerData();

  return (
    <ExplorerContext.Provider value={explorerData}>
      {children}
    </ExplorerContext.Provider>
  );
}

export function useExplorerContext() {
  const context = useContext(ExplorerContext);
  if (context === undefined) {
    throw new Error('useExplorerContext must be used within an ExplorerProvider');
  }
  return context;
}

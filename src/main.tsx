import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExplorerProvider } from './context/ExplorerContext';
import App from './App.tsx';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import '@fontsource-variable/outfit';
import './fonts.css';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fullPage>
      <QueryClientProvider client={queryClient}>
        <ExplorerProvider>
          <App />
        </ExplorerProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

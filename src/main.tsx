import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { rootStore } from './stores/RootStore';
import { StoreProvider } from './stores/context';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <StoreProvider store={rootStore}>
      <App />
    </StoreProvider>
  </StrictMode>,
);

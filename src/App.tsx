import React from 'react';
import { ToastProvider } from './components/ui/toast.tsx';
import { AppRoutes } from './routes.tsx';

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  );
}

export default App;

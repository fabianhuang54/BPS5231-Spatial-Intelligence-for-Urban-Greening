import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Work offline after the first visit: cache the app, then fetch the 3D chunk in idle time so it is cached too.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(() => {
    requestIdleCallback(() => void import('./components/Scene3D'));
  });
}

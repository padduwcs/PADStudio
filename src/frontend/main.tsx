import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './styles.css';
import './motionCanvas.css';
import './layout.css';
import './render.css';
import './content.css';
import './pronunciation.css';
import './production.css';
import './sceneReview.css';
import './theme.css';
import {initializeTheme} from './useTheme.ts';

initializeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

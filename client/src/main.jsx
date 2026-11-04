import { createRoot } from 'react-dom/client';
import { Router } from './lib/router.jsx';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <Router>
    <App />
  </Router>,
);

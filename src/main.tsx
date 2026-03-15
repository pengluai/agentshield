import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { currentLang, t } from './constants/i18n';
import './styles/globals.css';

document.documentElement.lang = currentLang;
document.title = t.appTitle;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

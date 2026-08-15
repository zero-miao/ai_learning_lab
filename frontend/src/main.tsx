import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ReadingPreferencesProvider } from './readingPreferences.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ReadingPreferencesProvider>
      <App />
    </ReadingPreferencesProvider>
  </BrowserRouter>,
)

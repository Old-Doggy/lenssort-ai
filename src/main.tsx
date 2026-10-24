import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import FolderControl from './FolderControl.tsx'
import ReviewPanel from './ReviewPanel.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('legacy') === '1' ? <App /> : new URLSearchParams(location.search).get('review') === '1' ? <ReviewPanel /> : <FolderControl />}
  </StrictMode>,
)

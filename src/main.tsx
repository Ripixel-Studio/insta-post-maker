import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import './index.css'
import App from './App.tsx'

// Cap the on-screen render resolution. Phones often report devicePixelRatio 3,
// which makes Konva back its canvases with ~9x the pixels and tanks frame rate.
// Export uses its own explicit pixelRatio, so output stays full-resolution.
Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

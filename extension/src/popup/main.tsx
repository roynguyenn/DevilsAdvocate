import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The popup is its own extension page, so a normal stylesheet import is fine here (unlike the content script).
import '../index.css'
import Popup from './Popup'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)

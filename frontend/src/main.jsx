import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ProtectedRoute from './ProtectedRoute.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ProtectedRoute>
      <App />
    </ProtectedRoute>
  </StrictMode>,
)
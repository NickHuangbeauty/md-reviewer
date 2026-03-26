import React from 'react'
import ReactDOM from 'react-dom/client'
import MdReviewer from './MdReviewer'
import 'katex/dist/katex.min.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MdReviewer />
  </React.StrictMode>
)

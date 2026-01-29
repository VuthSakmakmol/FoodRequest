// src/utils/api.js
import axios from 'axios'
import { useAuth } from '@/store/auth'

const api = axios.create({
  // e.g. http://localhost:4333/api  (no trailing slash)
  baseURL: (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''),
  timeout: 30000,
})

// ✅ Helper: detect FormData reliably (axios header keys can be lowercase)
function isFormDataPayload(cfg) {
  if (typeof FormData !== 'undefined' && cfg?.data instanceof FormData) return true

  const h = cfg?.headers || {}
  const ct =
    h['content-type'] ||
    h['Content-Type'] ||
    h.contentType ||
    h.ContentType

  return ct && String(ct).toLowerCase().includes('multipart/form-data')
}

api.interceptors.request.use((config) => {
  // Attach auth token if present
  const auth = (() => {
    try {
      return useAuth()
    } catch {
      return null
    }
  })()

  const token = auth?.token || localStorage.getItem('token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }

  const method = (config.method || '').toLowerCase()
  const hasBody = ['post', 'put', 'patch'].includes(method)
  const isFD = isFormDataPayload(config)

  if (hasBody) {
    config.headers = config.headers || {}

    if (isFD) {
      // ✅ CRITICAL: do not set multipart manually; let browser add boundary
      delete config.headers['Content-Type']
      delete config.headers['content-type']
      delete config.headers.contentType
      delete config.headers.ContentType
    } else {
      // JSON requests only
      if (!config.headers['Content-Type'] && !config.headers['content-type']) {
        config.headers['Content-Type'] = 'application/json'
      }
    }
  }

  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      try {
        useAuth().logout()
      } catch {
        // ignore if store not ready
      }
    }
    return Promise.reject(err)
  }
)

export default api

// src/utils/api.js
import axios from 'axios'
import { useAuth } from '@/store/auth'

const api = axios.create({
  // e.g. http://localhost:4333/api  (no trailing slash)
  baseURL: (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''),
  timeout: 30000,
})

// Helper: detect FormData
function isFormDataPayload(cfg) {
  if (typeof FormData !== 'undefined' && cfg?.data instanceof FormData) return true
  const ct = cfg?.headers?.['Content-Type'] || cfg?.headers?.contentType
  return ct && String(ct).toLowerCase().includes('multipart/form-data')
}

api.interceptors.request.use((config) => {
  // Attach auth token if present
  const auth = (() => { try { return useAuth() } catch { return null } })()
  const token = auth?.token || localStorage.getItem('token')
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }

  // Only set JSON header for non-FormData bodies
  const method = (config.method || '').toLowerCase()
  const hasBody = ['post', 'put', 'patch'].includes(method)
  const isFD = isFormDataPayload(config)

  if (hasBody) {
    config.headers = config.headers || {}
    if (isFD) {
      // Let the browser set the multipart boundary automatically
      delete config.headers['Content-Type']
      delete config.headers.contentType
    } else if (!config.headers['Content-Type'] && !config.headers.contentType) {
      config.headers['Content-Type'] = 'application/json'
    }
  }

  // console.debug('[api] →', method.toUpperCase(), config.url)
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      try { useAuth().logout() } catch {}
    }
    return Promise.reject(err)
  }
)

export default api

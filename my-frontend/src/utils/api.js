// src/utils/api.js
import axios from 'axios'
import { useAuth } from '@/store/auth'
import router from '@/router'

const api = axios.create({
  // e.g. http://localhost:4333/api  (no trailing slash)
  baseURL: (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''),
  timeout: 30000,
})

// ✅ Helper: detect FormData reliably (axios header keys can be lowercase)
function isFormDataPayload(cfg) {
  if (typeof FormData !== 'undefined' && cfg?.data instanceof FormData) return true

  const h = cfg?.headers || {}
  const ct = h['content-type'] || h['Content-Type'] || h.contentType || h.ContentType
  return ct && String(ct).toLowerCase().includes('multipart/form-data')
}

function safeAuth() {
  try {
    return useAuth()
  } catch {
    return null
  }
}

function isPublicPath(pathname) {
  const p = String(pathname || '')
  return (
    p === '/' ||
    p.startsWith('/greeting') ||
    p.startsWith('/admin/login') ||
    p.startsWith('/leave/login')
  )
}

function pickLoginRouteByPath(pathname) {
  const p = String(pathname || '')
  // If user was in leave portal → go to leave login
  if (p.startsWith('/leave')) return { name: 'leave-login' }
  // otherwise use admin login (or greeting if you prefer)
  return { name: 'admin-login' }
}

api.interceptors.request.use((config) => {
  // Attach auth token if present
  const auth = safeAuth()
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

let handling401 = false

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err?.response?.status
    if (status === 401) {
      // Avoid multiple redirects from parallel requests
      if (!handling401) {
        handling401 = true
        try {
          const auth = safeAuth()
          auth?.logout?.()

          const currentPath = router.currentRoute?.value?.path || window.location.pathname || '/'
          // Don’t redirect if already on public/login pages
          if (!isPublicPath(currentPath)) {
            const target = pickLoginRouteByPath(currentPath)
            // keep "next" so user can return after login if you want
            await router.push({ ...target, query: { next: router.currentRoute.value?.name || '' } })
          }
        } catch {
          // ignore
        } finally {
          // small delay prevents redirect loop if requests still failing
          setTimeout(() => {
            handling401 = false
          }, 300)
        }
      }
    }
    return Promise.reject(err)
  }
)

export default api
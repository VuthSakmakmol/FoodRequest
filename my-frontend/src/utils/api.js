// src/utils/api.js
import axios from 'axios'
import { useAuth } from '@/store/auth'
import router from '@/router'

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''),
  timeout: 30000,
})

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

  if (p.startsWith('/leave')) {
    return { name: 'leave-login' }
  }

  return { name: 'admin-login' }
}

api.interceptors.request.use((config) => {
  const auth = safeAuth()
  const token = auth?.token || localStorage.getItem('token')

  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }

  const method = String(config.method || '').toLowerCase()
  const hasBody = ['post', 'put', 'patch'].includes(method)
  const isFD = isFormDataPayload(config)

  if (hasBody) {
    config.headers = config.headers || {}

    if (isFD) {
      delete config.headers['Content-Type']
      delete config.headers['content-type']
      delete config.headers.contentType
      delete config.headers.ContentType
    } else if (!config.headers['Content-Type'] && !config.headers['content-type']) {
      config.headers['Content-Type'] = 'application/json'
    }
  }

  return config
})

let handling401 = false

api.interceptors.response.use(
  (response) => response,
  async (err) => {
    const status = err?.response?.status

    if (status === 401) {
      if (!handling401) {
        handling401 = true

        try {
          const auth = safeAuth()

          if (auth?.logout) {
            await auth.logout()
          }

          const currentRoute = router.currentRoute?.value
          const currentPath = currentRoute?.path || window.location.pathname || '/'

          if (!isPublicPath(currentPath)) {
            const target = pickLoginRouteByPath(currentPath)

            await router.replace({
              ...target,
              query: {
                next: currentRoute?.name || '',
              },
            })
          }
        } catch {
          // ignore redirect/logout race
        } finally {
          setTimeout(() => {
            handling401 = false
          }, 500)
        }
      }
    }

    return Promise.reject(err)
  }
)

export default api
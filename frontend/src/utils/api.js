// src/utils/api.js
import axios from 'axios'
import { useAuth } from '@/store/auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL // e.g. http://localhost:4333/api
})

api.interceptors.request.use((config) => {
  const auth = (() => { try { return useAuth() } catch { return null } })()
  const token = auth?.token || localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  // console.log('[api] →', config.method?.toUpperCase(), config.url, config.params || config.data || '')
  return config
})

api.interceptors.response.use(
  r => {
    // console.log('[api] ←', r.status, r.config.url)
    return r
  },
  err => {
    if (err?.response?.status === 401) {
      try { useAuth().logout() } catch {}
    }
    return Promise.reject(err)
  }
)

export default api

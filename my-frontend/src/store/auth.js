// src/store/auth.js
import { defineStore } from 'pinia'
import api from '@/utils/api'
import {
  subscribeRoles,
  unsubscribeRoles,
  setSocketAuthToken,
  resetSocketSubscriptions,
} from '@/utils/socket'

function normalizeRoles(user) {
  const raw = Array.isArray(user?.roles) ? user.roles : []
  const base = user?.role ? [user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').toUpperCase().trim()))].filter(Boolean)
}

function pickPrimaryRole(roles = []) {
  const PRIORITY = [
    'LEAVE_ADMIN',
    'LEAVE_COO',
    'LEAVE_GM',
    'LEAVE_MANAGER',
    'LEAVE_USER',
    'ROOT_ADMIN',
    'ADMIN',
    'CHEF',
    'DRIVER',
    'MESSENGER',
    'EMPLOYEE',
  ]
  for (const p of PRIORITY) if (roles.includes(p)) return p
  return roles[0] || ''
}

export const useAuth = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    token: localStorage.getItem('token') || '',
    ready: false,

    // ✅ NEW: prevent double logout / spam click
    isLoggingOut: false,
  }),

  actions: {
    _applyTokenHeader(token) {
      if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`
      else delete api.defaults.headers.common.Authorization
    },

    _persistSession() {
      localStorage.setItem('token', this.token || '')
      localStorage.setItem('user', JSON.stringify(this.user || null))

      const roles = normalizeRoles(this.user)
      const primaryRole = pickPrimaryRole(roles)

      localStorage.setItem('roles', JSON.stringify(roles))
      localStorage.setItem('primaryRole', primaryRole)

      if (primaryRole) localStorage.setItem('role', primaryRole)

      const loginKey = this.user?.id || this.user?.loginId || ''
      if (loginKey) localStorage.setItem('loginId', loginKey)
    },

    async _applyRealtimeSubscriptions() {
      const roles = normalizeRoles(this.user)
      if (!roles.length) return
      await subscribeRoles(roles)
    },

    async login(loginId, password) {
      const { data } = await api.post('/auth/login', { loginId, password })

      this.user = data.user
      this.token = data.token

      this._applyTokenHeader(this.token)
      setSocketAuthToken(this.token)

      this._persistSession()
      await this._applyRealtimeSubscriptions()

      return this.user
    },

    async fetchMe() {
      if (!this.token) {
        this.user = null
        this.ready = true
        return null
      }

      try {
        this._applyTokenHeader(this.token)
        setSocketAuthToken(this.token)

        const { data } = await api.get('/auth/me')
        this.user = data

        this._persistSession()
        await this._applyRealtimeSubscriptions()

        return data
      } catch (e) {
        await this.logout()
        throw e
      } finally {
        this.ready = true
      }
    },

    async restore() {
      const storedToken = localStorage.getItem('token') || ''
      const storedUser = localStorage.getItem('user')

      if (storedToken) {
        this.token = storedToken
        this._applyTokenHeader(this.token)
        setSocketAuthToken(this.token)
      }

      if (storedUser) {
        try {
          this.user = JSON.parse(storedUser)
        } catch {
          this.user = null
        }
      }

      this._persistSession()
      await this._applyRealtimeSubscriptions()

      this.ready = true
    },

    // ✅ FIXED LOGOUT (one time, clears storage immediately, no bounce)
    async logout() {
      if (this.isLoggingOut) return
      this.isLoggingOut = true

      const roles = normalizeRoles(this.user)

      // ✅ 1) Clear auth state FIRST (so router guard won't think you're still logged-in)
      this.user = null
      this.token = ''
      this.ready = true

      this._applyTokenHeader('')
      setSocketAuthToken('')

      // ✅ 2) Clear ALL storage (your request)
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {}

      // ✅ 3) Then clean sockets (best effort)
      try {
        if (roles.length) await unsubscribeRoles(roles)
      } catch {}

      try {
        resetSocketSubscriptions()
      } catch {}

      this.isLoggingOut = false
    },
  },
})

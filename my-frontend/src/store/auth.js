// src/store/auth.js
import { defineStore } from 'pinia'
import api from '@/utils/api'
import {
  subscribeRoles,
  unsubscribeRoles,
  setSocketAuthToken,
  resetSocketSubscriptions, // ✅ add this
} from '@/utils/socket'

function normalizeRoles(user) {
  const raw = Array.isArray(user?.roles) ? user.roles : []
  const base = user?.role ? [user.role] : []
  return [...new Set([...raw, ...base].map(r => String(r || '').toUpperCase().trim()))].filter(Boolean)
}

function pickPrimaryRole(roles = []) {
  const PRIORITY = [
    // Leave portal
    'LEAVE_ADMIN',
    'LEAVE_COO',
    'LEAVE_GM',
    'LEAVE_MANAGER',
    'LEAVE_USER',

    // Other portals
    'ROOT_ADMIN',
    'ADMIN',
    'CHEF',
    'DRIVER',
    'MESSENGER',
    'EMPLOYEE',
  ]

  for (const p of PRIORITY) {
    if (roles.includes(p)) return p
  }
  return roles[0] || ''
}

export const useAuth = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    token: localStorage.getItem('token') || '',
    ready: false,
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

      // ✅ store roles strongly
      localStorage.setItem('roles', JSON.stringify(roles))
      localStorage.setItem('primaryRole', primaryRole)

      // legacy key for old code paths
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

      // HTTP token
      this._applyTokenHeader(this.token)

      // WS token
      setSocketAuthToken(this.token)

      // persist
      this._persistSession()

      // ✅ subscribe ALL roles (not only 1)
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

      // ✅ re-sync storage keys in case old format existed
      this._persistSession()

      // ✅ subscribe ALL roles after refresh
      await this._applyRealtimeSubscriptions()

      this.ready = true
    },

    async logout() {
      const roles = normalizeRoles(this.user)

      // ✅ unsubscribe ALL roles
      if (roles.length) {
        try {
          await unsubscribeRoles(roles)
        } catch {
          // ignore socket errors
        }
      }

      // ✅ IMPORTANT: clear in-memory room sets so reconnect won't replay old rooms
      try {
        resetSocketSubscriptions()
      } catch {}

      // reset store
      this.user = null
      this.token = ''
      this.ready = false

      // clear auth headers + ws token
      this._applyTokenHeader('')
      setSocketAuthToken('')

      // clear storage
      try {
        const toRemove = [
          'token',
          'user',
          'loginId',
          'employeeId',
          'lastLoginId',
          'role',
          'roles',
          'primaryRole',
          'theme',
        ]
        toRemove.forEach(k => localStorage.removeItem(k))
        sessionStorage.clear()
      } catch {}

      // clear cookies
      try {
        const cookieNames = ['loginId', 'role', 'theme']
        cookieNames.forEach(name => {
          document.cookie = `${name}=; Max-Age=0; path=/`
        })
      } catch {}
    },
  },
})

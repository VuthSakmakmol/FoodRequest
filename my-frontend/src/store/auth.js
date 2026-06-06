// src/store/auth.js
import { defineStore } from 'pinia'
import api from '@/utils/api'
import {
  subscribeRoles,
  subscribeUserIfNeeded,
  subscribeEmployeeIfNeeded,
  setSocketAuthToken,
  resetSocketSubscriptions,
} from '@/utils/socket'

let restorePromise = null

function s(v) {
  return String(v ?? '').trim()
}

function normalizeRoles(user) {
  const raw = Array.isArray(user?.roles) ? user.roles : []
  const base = user?.role ? [user.role] : []
  return [...new Set([...raw, ...base].map((r) => s(r).toUpperCase()).filter(Boolean))]
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

  for (const p of PRIORITY) {
    if (roles.includes(p)) return p
  }

  return roles[0] || ''
}

function getLoginId(user) {
  return s(user?.loginId || user?.id || user?._id)
}

function getEmployeeId(user) {
  return s(user?.employeeId || user?.empId)
}

function looksLikeUser(value) {
  if (!value || typeof value !== 'object') return false

  return !!(
    value.loginId ||
    value.id ||
    value._id ||
    value.employeeId ||
    value.empId ||
    value.role ||
    Array.isArray(value.roles)
  )
}

function normalizeUserPayload(data) {
  const candidates = [
    data?.user,
    data?.data?.user,
    data?.profile,
    data?.data,
    data,
  ]

  return candidates.find(looksLikeUser) || null
}

function normalizeTokenPayload(data) {
  return s(
    data?.token ||
      data?.accessToken ||
      data?.data?.token ||
      data?.data?.accessToken
  )
}

const AUTH_STORAGE_KEYS = [
  'token',
  'user',
  'roles',
  'primaryRole',
  'role',
  'loginId',
  'employeeId',
]

function clearAuthLocalStorage() {
  for (const key of AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
}

export const useAuth = defineStore('auth', {
  state: () => ({
    user: null,
    token: localStorage.getItem('token') || '',
    ready: false,
    isLoggingOut: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token && !!state.user,
    roles: (state) => normalizeRoles(state.user),
    primaryRole: (state) => pickPrimaryRole(normalizeRoles(state.user)),
  },

  actions: {
    _applyTokenHeader(token) {
      if (token) {
        api.defaults.headers.common.Authorization = `Bearer ${token}`
      } else {
        delete api.defaults.headers.common.Authorization
      }
    },

    _persistSession() {
      if (!this.token || !this.user) {
        clearAuthLocalStorage()
        return
      }

      localStorage.setItem('token', this.token)
      localStorage.setItem('user', JSON.stringify(this.user))

      const roles = normalizeRoles(this.user)
      const primaryRole = pickPrimaryRole(roles)

      localStorage.setItem('roles', JSON.stringify(roles))
      localStorage.setItem('primaryRole', primaryRole)

      if (primaryRole) localStorage.setItem('role', primaryRole)
      else localStorage.removeItem('role')

      const loginId = getLoginId(this.user)
      const employeeId = getEmployeeId(this.user)

      if (loginId) localStorage.setItem('loginId', loginId)
      else localStorage.removeItem('loginId')

      if (employeeId) localStorage.setItem('employeeId', employeeId)
      else localStorage.removeItem('employeeId')
    },

    _applyRealtimeSubscriptions() {
      try {
        resetSocketSubscriptions()
      } catch {}

      const tokenAtStart = this.token
      const roles = normalizeRoles(this.user)
      const loginId = getLoginId(this.user)
      const employeeId = getEmployeeId(this.user)

      void Promise.resolve()
        .then(async () => {
          if (!tokenAtStart || this.token !== tokenAtStart) return

          if (roles.length) await subscribeRoles(roles)
          if (loginId) await subscribeUserIfNeeded(loginId)
          if (employeeId) await subscribeEmployeeIfNeeded(employeeId)
        })
        .catch((e) => {
          console.warn('[auth] realtime subscription skipped:', e?.message || e)
        })
    },

    async login(loginId, password) {
      const { data } = await api.post('/auth/login', { loginId, password })

      const token = normalizeTokenPayload(data)
      const user = normalizeUserPayload(data)

      if (!token || !user) {
        throw new Error('Invalid login response.')
      }

      this.token = token
      this.user = user
      this.ready = true

      this._applyTokenHeader(this.token)
      setSocketAuthToken(this.token)
      this._persistSession()
      this._applyRealtimeSubscriptions()

      return this.user
    },

    async fetchMe() {
      if (!this.token) {
        this.user = null
        this.ready = true
        this._applyTokenHeader('')
        setSocketAuthToken('')
        this._persistSession()
        return null
      }

      try {
        this._applyTokenHeader(this.token)
        setSocketAuthToken(this.token)

        const { data } = await api.get('/auth/me')
        const user = normalizeUserPayload(data)

        if (!user) {
          throw new Error('Invalid /auth/me response.')
        }

        this.user = user
        this.ready = true

        this._persistSession()
        this._applyRealtimeSubscriptions()

        return this.user
      } catch (e) {
        await this.logout()
        throw e
      } finally {
        this.ready = true
      }
    },

    async _restoreInternal() {
      const storedToken = localStorage.getItem('token') || ''

      if (!storedToken) {
        this.token = ''
        this.user = null
        this.ready = true
        this._applyTokenHeader('')
        setSocketAuthToken('')
        clearAuthLocalStorage()
        return null
      }

      this.token = storedToken
      this._applyTokenHeader(this.token)
      setSocketAuthToken(this.token)

      try {
        return await this.fetchMe()
      } catch {
        return null
      } finally {
        this.ready = true
      }
    },

    async restore() {
      if (restorePromise) return restorePromise

      restorePromise = this._restoreInternal().finally(() => {
        restorePromise = null
      })

      return restorePromise
    },

    async logout() {
      if (this.isLoggingOut) return

      this.isLoggingOut = true

      try {
        this.user = null
        this.token = ''
        this.ready = true

        this._applyTokenHeader('')
        setSocketAuthToken('')
        clearAuthLocalStorage()

        try {
          sessionStorage.clear()
        } catch {}

        try {
          resetSocketSubscriptions()
        } catch {}
      } finally {
        this.isLoggingOut = false
      }
    },
  },
})
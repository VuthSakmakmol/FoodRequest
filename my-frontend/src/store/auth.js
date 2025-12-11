// src/store/auth.js
import { defineStore } from 'pinia'
import api from '@/utils/api'
import {
  subscribeRole,
  unsubscribeRole,
  setSocketAuthToken,
} from '@/utils/socket'

export const useAuth = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    token: localStorage.getItem('token') || '',
    ready: false,
  }),

  actions: {
    _applyTokenHeader(token) {
      if (token) {
        api.defaults.headers.common.Authorization = `Bearer ${token}`
      } else {
        delete api.defaults.headers.common.Authorization
      }
    },

    async login(loginId, password) {
      const { data } = await api.post('/auth/login', { loginId, password })

      this.user = data.user
      this.token = data.token

      // persist full user + token
      localStorage.setItem('token', this.token)
      localStorage.setItem('user', JSON.stringify(this.user))

      // convenience: store loginId / employeeId / role separately
      const loginKey = this.user?.id || this.user?.loginId || loginId
      const empId    = this.user?.employeeId || ''
      const role     = this.user?.role || ''

      if (loginKey) localStorage.setItem('loginId', loginKey)
      if (empId)    localStorage.setItem('employeeId', empId)
      if (role)     localStorage.setItem('role', role)

      // attach token for HTTP
      this._applyTokenHeader(this.token)

      // attach token for WebSocket
      setSocketAuthToken(this.token)

      // join a role room for realtime updates
      if (role) {
        subscribeRole(role)
      }

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
        // in case of page refresh: make sure WS also has token
        setSocketAuthToken(this.token)

        const { data } = await api.get('/auth/me')
        this.user = data
        localStorage.setItem('user', JSON.stringify(this.user))

        const loginKey = this.user?.id || this.user?.loginId || ''
        const empId    = this.user?.employeeId || ''
        const role     = this.user?.role || ''

        if (loginKey) localStorage.setItem('loginId', loginKey)
        if (empId)    localStorage.setItem('employeeId', empId)
        if (role)     localStorage.setItem('role', role)

        if (role) subscribeRole(role)

        return data
      } catch (e) {
        this.logout()
        throw e
      } finally {
        this.ready = true
      }
    },

    restore() {
      const storedUser  = localStorage.getItem('user')
      const storedToken = localStorage.getItem('token')

      if (storedToken) {
        this.token = storedToken
        this._applyTokenHeader(this.token)
        setSocketAuthToken(this.token) // make sure WS has token too
      }

      if (storedUser) {
        this.user = JSON.parse(storedUser)
        const role = this.user?.role || localStorage.getItem('role') || ''
        if (role) subscribeRole(role)
      }
    },

    logout() {
      const role = this.user?.role || localStorage.getItem('role')

      // leave role room if any
      if (role) {
        try {
          unsubscribeRole(role)
        } catch {
          // ignore socket errors on logout
        }
      }

      // reset store state
      this.user  = null
      this.token = ''
      this.ready = false

      // clear HTTP + socket auth
      this._applyTokenHeader('')
      setSocketAuthToken('')

      // ---- CLEAR STORAGE KEYS ----
      try {
        const toRemove = [
          'token',
          'user',
          'loginId',
          'employeeId',
          'lastLoginId',
          'role',
          'theme',
        ]
        toRemove.forEach(k => localStorage.removeItem(k))

        // if you also store anything in sessionStorage, wipe it
        sessionStorage.clear()
      } catch {
        // ignore storage errors
      }

      // ---- CLEAR COOKIES (loginId / role / theme) ----
      try {
        const cookieNames = ['loginId', 'role', 'theme']
        cookieNames.forEach(name => {
          document.cookie = `${name}=; Max-Age=0; path=/`
        })
      } catch {
        // ignore cookie errors
      }
    },
  },
})

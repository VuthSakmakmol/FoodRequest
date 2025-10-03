// src/store/auth.js
import { defineStore } from 'pinia'
import api from '@/utils/api'
import socket, { subscribeRole, unsubscribeRole } from '@/utils/socket'

export const useAuth = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    token: localStorage.getItem('token') || '',
    ready: false
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

      this.user  = data.user
      this.token = data.token

      // persist
      localStorage.setItem('token', this.token)
      localStorage.setItem('user', JSON.stringify(this.user))

      // attach token for subsequent requests
      this._applyTokenHeader(this.token)

      // join a role room for realtime updates (ADMIN, CHEF, DRIVER, MESSENGER)
      if (this.user?.role) {
        subscribeRole(this.user.role)
      }

      return data.user
    },

    async fetchMe() {
      if (!this.token) {
        this.user = null
        this.ready = true
        return null
      }
      try {
        this._applyTokenHeader(this.token)
        const { data } = await api.get('/auth/me')
        this.user = data

        // persist updated user
        localStorage.setItem('user', JSON.stringify(this.user))

        if (this.user?.role) subscribeRole(this.user.role)
        return data
      } catch (e) {
        this.logout()
        throw e
      } finally {
        this.ready = true
      }
    },

    restore() {
      const storedUser = localStorage.getItem('user')
      const storedToken = localStorage.getItem('token')

      if (storedToken) {
        this.token = storedToken
        this._applyTokenHeader(this.token)
      }

      if (storedUser) {
        this.user = JSON.parse(storedUser)
        if (this.user?.role) subscribeRole(this.user.role)
      }
    },

    logout() {
      if (this.user?.role) {
        try { unsubscribeRole(this.user.role) } catch {}
      }

      this.user = null
      this.token = ''
      this.ready = false

      localStorage.removeItem('token')
      localStorage.removeItem('user')

      this._applyTokenHeader('')

      // Optional: if you kept manual emits, make them exhaustive, or remove entirely
      // try {
      //   socket.emit('unsubscribe', { role: 'ADMIN' })
      //   socket.emit('unsubscribe', { role: 'CHEF' })
      //   socket.emit('unsubscribe', { role: 'DRIVER' })
      //   socket.emit('unsubscribe', { role: 'MESSENGER' })
      // } catch {}
    }
  }
})

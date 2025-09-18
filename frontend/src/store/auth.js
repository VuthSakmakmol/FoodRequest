// src/store/auth.js
import { defineStore } from 'pinia'
import api from '@/utils/api'
import socket, { subscribeRole, unsubscribeRole } from '@/utils/socket'

export const useAuth = defineStore('auth', {
  state: () => ({
    user: null,
    token: localStorage.getItem('token') || '',
    ready: false
  }),
  actions: {
    async login(loginId, password) {
      const { data } = await api.post('/auth/login', { loginId, password })
      this.user  = data.user
      this.token = data.token
      localStorage.setItem('token', data.token)
      // join role room now (admins/chefs only)
      if (this.user?.role) {
        subscribeRole(this.user.role)
      }
      return data.user
    },
    async fetchMe() {
      if (!this.token) { this.user = null; this.ready = true; return null }
      try {
        const { data } = await api.get('/auth/me')
        this.user = data
        if (this.user?.role) subscribeRole(this.user.role)
        return data
      } catch (e) {
        this.logout()
        throw e
      } finally {
        this.ready = true
      }
    },
    logout() {
      if (this.user?.role) unsubscribeRole(this.user.role)
      this.user = null
      this.token = ''
      localStorage.removeItem('token')
      localStorage.removeItem('authRole')
      try {
        // best-effort: leaving rooms server-side (optional because disconnect will clear server state)
        socket.emit('unsubscribe', { role: 'ADMIN' })
        socket.emit('unsubscribe', { role: 'CHEF' })
      } catch {}
    }
  }
})

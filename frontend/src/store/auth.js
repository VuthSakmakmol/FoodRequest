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
    async login(loginId, password) {
      const { data } = await api.post('/auth/login', { loginId, password })
      this.user  = data.user
      this.token = data.token

      // persist
      localStorage.setItem('token', this.token)
      localStorage.setItem('user', JSON.stringify(this.user))

      // join role room now (admins/chefs only)
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
      if (storedUser) {
        this.user = JSON.parse(storedUser)
        if (this.user?.role) subscribeRole(this.user.role)
      }
    },

    logout() {
      if (this.user?.role) unsubscribeRole(this.user.role)
      this.user = null
      this.token = ''
      this.ready = false
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('authRole')

      try {
        socket.emit('unsubscribe', { role: 'ADMIN' })
        socket.emit('unsubscribe', { role: 'CHEF' })
      } catch {}
    }
  }
})

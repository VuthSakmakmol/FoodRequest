// src/utils/swapWorkingDay.api.js
import api from '@/utils/api'

export const swapWorkingDayApi = {
  // requests
  create(payload) {
    return api.post('/leave/swap-working-day', payload).then(r => r.data)
  },
  myList(params) {
    return api.get('/leave/swap-working-day/my', { params }).then(r => r.data)
  },
  update(id, payload) {
    return api.put(`/leave/swap-working-day/${id}`, payload).then(r => r.data)
  },
  cancel(id, payload = {}) {
    return api.post(`/leave/swap-working-day/${id}/cancel`, payload).then(r => r.data)
  },
  getOne(id) {
    return api.get(`/leave/swap-working-day/${id}`).then(r => r.data)
  },

  // evidence
  listEvidence(id) {
    return api.get(`/leave/swap-working-day/${id}/evidence`).then(r => r.data)
  },
  uploadEvidence(id, files /* File[] */) {
    const fd = new FormData()
    ;(files || []).forEach(f => fd.append('files', f))
    return api
      .post(`/leave/swap-working-day/${id}/evidence`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(r => r.data)
  },
  deleteEvidence(id, attId) {
    return api.delete(`/leave/swap-working-day/${id}/evidence/${attId}`).then(r => r.data)
  },

  // IMPORTANT: preview must be blob (authorized)
  async fetchEvidenceBlob(id, attId) {
    const res = await api.get(`/leave/swap-working-day/${id}/evidence/${attId}/content`, {
      responseType: 'blob',
    })
    return res.data // Blob
  },
}
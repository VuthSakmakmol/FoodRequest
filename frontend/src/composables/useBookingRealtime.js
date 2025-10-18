// frontend/src/composables/useBookingRealtime.js
import { ref, onMounted, onBeforeUnmount } from 'vue'
import api from '@/utils/api'
import { socket, subscribeRoleIfNeeded } from '@/utils/socket'

export function useBookingRealtime({ filtersRef } = {}) {
  const rows = ref([])
  const loading = ref(false)
  const error = ref('')

  async function reload() {
    loading.value = true
    error.value = ''
    try {
      const { date, status, category } = (filtersRef?.value || {})
      const params = {}
      if (date) params.date = date
      if (status && status !== 'ALL') params.status = status
      if (category && category !== 'ALL') params.category = category
      const { data } = await api.get('/admin/car-bookings', { params })
      rows.value = (Array.isArray(data) ? data : []).map(x => ({
        ...x,
        stops: x.stops || [],
        assignment: x.assignment || {},
      }))
    } catch (e) {
      error.value = e?.response?.data?.message || e?.message || 'Failed to load schedule'
    } finally {
      loading.value = false
    }
  }

  function onCreated(doc) {
    const exists = rows.value.some(x => String(x._id) === String(doc?._id))
    if (!exists) rows.value.unshift({ ...doc, stops: doc.stops || [], assignment: doc.assignment || {} })
  }
  function onAssigned(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (!it) return
    it.assignment = { ...(it.assignment || {}), driverId: p.driverId, driverName: p.driverName, driverAck: 'PENDING' }
    if (it.status === 'PENDING') it.status = 'ACCEPTED'
  }
  function onStatus(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (it) it.status = p.status
  }
  function onDriverAck(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (it) it.assignment = { ...(it.assignment || {}), driverAck: p.response, driverAckAt: p.at }
  }
  // 🔥 NEW: update + delete
  function onUpdated(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (!it) return
    const patch = p?.patch || {}
    Object.assign(it, patch)
  }
  function onDeleted(p) {
    const id = String(p?.bookingId || '')
    if (!id) return
    rows.value = rows.value.filter(x => String(x._id) !== id)
  }

  onMounted(() => {
    subscribeRoleIfNeeded({ role: 'ADMIN' })
    reload()
    socket.on('carBooking:created', onCreated)
    socket.on('carBooking:assigned', onAssigned)
    socket.on('carBooking:status', onStatus)
    socket.on('carBooking:driverAck', onDriverAck)
    socket.on('carBooking:updated', onUpdated)   // NEW
    socket.on('carBooking:deleted', onDeleted)   // NEW
  })
  onBeforeUnmount(() => {
    socket.off('carBooking:created', onCreated)
    socket.off('carBooking:assigned', onAssigned)
    socket.off('carBooking:status', onStatus)
    socket.off('carBooking:driverAck', onDriverAck)
    socket.off('carBooking:updated', onUpdated)
    socket.off('carBooking:deleted', onDeleted)
  })

  return { rows, loading, error, reload }
}

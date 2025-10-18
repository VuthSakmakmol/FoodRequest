// src/composables/useDriverBookingsRealtime.js
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { socket, subscribeBookingRooms } from '@/utils/socket'

/**
 * Realtime list for the ASSIGNEE (driver/messenger).
 * - Subscribes to booking rooms for every listed booking
 * - Applies status, assigned, ack, and delete deltas live
 */
export function useDriverBookingsRealtime({ filtersRef } = {}) {
  const rows = ref([])
  const loading = ref(false)
  const error = ref('')
  let cleanupRooms = null

  async function reload() {
    loading.value = true
    error.value = ''
    try {
      const { date, status } = (filtersRef?.value || {})
      const params = {}
      if (date) params.date = date
      if (status && status !== 'ALL') params.status = status

      // driver endpoint that returns bookings assigned to me
      const { data } = await api.get('/driver/car-bookings', { params })
      rows.value = (Array.isArray(data) ? data : []).map(x => ({
        ...x,
        stops: x.stops || [],
        assignment: x.assignment || {},
      }))

      // (re)join booking rooms so status pushes arrive live
      await resubscribeBookingRooms()
    } catch (e) {
      error.value = e?.response?.data?.message || e?.message || 'Failed to load bookings'
    } finally {
      loading.value = false
    }
  }

  async function resubscribeBookingRooms() {
    try {
      // cleanup previous joins
      if (typeof cleanupRooms === 'function') await cleanupRooms()
    } catch {}
    const ids = rows.value.map(r => r._id)
    cleanupRooms = await subscribeBookingRooms(ids)
  }

  // ---- socket handlers ----
  function onStatus(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (it) it.status = p.status
  }
  function onAssigned(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (!it) return
    it.assignment = {
      ...(it.assignment || {}),
      driverId: p.driverId,
      driverName: p.driverName,
      vehicleId: p.vehicleId,
      vehicleName: p.vehicleName,
    }
    if (p.status) it.status = p.status
  }
  function onDriverAck(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (it) it.assignment = { ...(it.assignment || {}), driverAck: p.response, driverAckAt: p.at }
  }
  function onDeleted(p) {
    const id = String(p?.bookingId || '')
    if (!id) return
    rows.value = rows.value.filter(x => String(x._id) !== id)
  }
  function onUpdated(p) {
    const it = rows.value.find(x => String(x._id) === String(p?.bookingId))
    if (!it) return
    Object.assign(it, p.patch || {})
  }

  // auto re-subscribe when filters change (e.g., driver switches date)
  watch(() => filtersRef?.value, () => { reload() }, { deep: true })

  onMounted(() => {
    reload()
    socket.on('carBooking:status', onStatus)
    socket.on('carBooking:assigned', onAssigned)
    socket.on('carBooking:driverAck', onDriverAck)
    socket.on('carBooking:deleted', onDeleted)
    socket.on('carBooking:updated', onUpdated)
  })

  onBeforeUnmount(async () => {
    socket.off('carBooking:status', onStatus)
    socket.off('carBooking:assigned', onAssigned)
    socket.off('carBooking:driverAck', onDriverAck)
    socket.off('carBooking:deleted', onDeleted)
    socket.off('carBooking:updated', onUpdated)
    try { if (typeof cleanupRooms === 'function') await cleanupRooms() } catch {}
  })

  return { rows, loading, error, reload }
}

// src/composables/useDriverBookingsRealtime.js
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import socket, { subscribeBookingRooms, subscribeRoleIfNeeded } from '@/utils/socket'

/**
 * Realtime list for the ASSIGNEE (driver/messenger).
 * - Loads bookings assigned to the current driver from /driver or /messenger endpoints
 * - Subscribes to booking rooms for every listed booking
 * - Applies status, assignment, ack, update, and delete deltas live
 * - Auto-reloads when a NEW booking is created/assigned for this driver
 */
export function useDriverBookingsRealtime({
  filtersRef,
  role = 'DRIVER',       // 'DRIVER' | 'MESSENGER'
} = {}) {
  const rows    = ref([])
  const loading = ref(false)
  const error   = ref('')
  let cleanupRooms = null

  async function reload() {
    loading.value = true
    error.value   = ''

    try {
      const { date, status } = (filtersRef?.value || {})
      const params = {}

      if (date) params.date = date
      if (status && status !== 'ALL') params.status = status

      const basePath =
        String(role).toUpperCase() === 'MESSENGER'
          ? '/messenger/car-bookings'
          : '/driver/car-bookings'

      // backend should use JWT to know "me"
      const { data } = await api.get(basePath, { params })

      rows.value = (Array.isArray(data) ? data : []).map((x) => ({
        ...x,
        stops: x.stops || [],
        assignment: x.assignment || {},
      }))

      await resubscribeBookingRooms()
    } catch (e) {
      error.value =
        e?.response?.data?.message ||
        e?.message ||
        'Failed to load bookings'
    } finally {
      loading.value = false
    }
  }

  async function resubscribeBookingRooms() {
    try {
      if (typeof cleanupRooms === 'function') {
        await cleanupRooms()
      }
    } catch {}

    const ids = rows.value.map((r) => r._id)
    cleanupRooms = await subscribeBookingRooms(ids)
  }

  // ---------- socket handlers ----------

  // NEW booking created; safest: reload, driver endpoint will filter only "my" jobs
  async function onCreated(doc) {
    // If your backend only emits created to ADMIN/COMPANY, this might never fire for driver.
    // But if it does (especially when booking is created already assigned to driver),
    // this guarantees the driver sees it without manual refresh.
    await reload()
  }

  function onStatus(p) {
    const it = rows.value.find(
      (x) => String(x._id) === String(p?.bookingId),
    )
    if (it && p?.status) {
      it.status = p.status
    }
  }

  // When a booking is assigned:
  // - If we already have it, patch assignment/status.
  // - If we DON'T have it, reload list so the new job appears.
  async function onAssigned(p) {
    const id = String(p?.bookingId || '')
    if (!id) return

    const it = rows.value.find(
      (x) => String(x._id) === id,
    )

    if (!it) {
      await reload()
      return
    }

    it.assignment = {
      ...(it.assignment || {}),
      driverId:    p.driverId    ?? it.assignment?.driverId,
      driverName:  p.driverName  ?? it.assignment?.driverName,
      messengerId: p.messengerId ?? it.assignment?.messengerId,
      messengerName: p.messengerName ?? it.assignment?.messengerName,
      vehicleId:   p.vehicleId   ?? it.assignment?.vehicleId,
      vehicleName: p.vehicleName ?? it.assignment?.vehicleName,
    }

    if (p.status) {
      it.status = p.status
    }
  }

  function onDriverAck(p) {
    const it = rows.value.find(
      (x) => String(x._id) === String(p?.bookingId),
    )
    if (it) {
      it.assignment = {
        ...(it.assignment || {}),
        driverAck: p.response,
        driverAckAt: p.at,
      }
    }
  }

  function onDeleted(p) {
    const id = String(p?.bookingId || '')
    if (!id) return

    rows.value = rows.value.filter(
      (x) => String(x._id) !== id,
    )
  }

  function onUpdated(p) {
    const it = rows.value.find(
      (x) => String(x._id) === String(p?.bookingId),
    )
    if (!it) return

    Object.assign(it, p.patch || {})
  }

  // auto reload when filters change (date / status)
  watch(
    () => filtersRef?.value,
    () => {
      reload()
    },
    { deep: true },
  )

  onMounted(() => {
    // VERY IMPORTANT: join DRIVER or MESSENGER role room
    subscribeRoleIfNeeded({ role })

    reload()

    socket.on('carBooking:created', onCreated)
    socket.on('carBooking:status', onStatus)
    socket.on('carBooking:assigned', onAssigned)
    socket.on('carBooking:driverAck', onDriverAck)
    socket.on('carBooking:deleted', onDeleted)
    socket.on('carBooking:updated', onUpdated)
  })

  onBeforeUnmount(async () => {
    socket.off('carBooking:created', onCreated)
    socket.off('carBooking:status', onStatus)
    socket.off('carBooking:assigned', onAssigned)
    socket.off('carBooking:driverAck', onDriverAck)
    socket.off('carBooking:deleted', onDeleted)
    socket.off('carBooking:updated', onUpdated)

    try {
      if (typeof cleanupRooms === 'function') {
        await cleanupRooms()
      }
    } catch {}
  })

  return { rows, loading, error, reload }
}

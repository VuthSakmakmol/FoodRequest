<!-- src/views/bookingRoom/admin/AdminRoomInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminRoomInbox' })

const { showToast } = useToast()

/* ───────── Helpers ───────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function arr(v) {
  return Array.isArray(v) ? v : []
}
function fmtDate(v) {
  return s(v) || '—'
}
function fmtTime(v) {
  return s(v) || '—'
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '—'
}
function cleanText(v) {
  return s(v) || '—'
}
function materialItemsToText(items = []) {
  return (
    arr(items)
      .map((x) => {
        const name = s(x?.materialName) || s(x?.materialCode)
        const qty = Number(x?.qty || 0)
        return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
      })
      .filter(Boolean)
      .join(', ') || '—'
  )
}

/* ───────── UI Helpers ───────── */
function overallStatusClass(v) {
  const x = up(v)
  if (x === 'APPROVED') return 'ui-badge ui-badge-success'
  if (x === 'REJECTED' || x === 'CANCELLED') return 'ui-badge ui-badge-danger'
  if (x === 'PARTIAL_APPROVED') return 'ui-badge ui-badge-warning'
  if (x.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge ui-badge-info'
}
function roomStatusClass(v) {
  const x = up(v)
  if (x === 'APPROVED') return 'ui-badge ui-badge-success'
  if (x === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (x === 'PENDING') return 'ui-badge ui-badge-warning'
  return 'ui-badge ui-badge-info'
}
function materialStatusClass(v) {
  const x = up(v)
  if (x === 'APPROVED') return 'ui-badge ui-badge-success'
  if (x === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (x === 'NOT_REQUIRED') return 'ui-badge'
  if (x === 'PENDING') return 'ui-badge ui-badge-warning'
  return 'ui-badge ui-badge-info'
}
function isPendingRoom(row) {
  return up(row?.roomStatus) === 'PENDING'
}
function isRowVisibleForScope(row, currentScope) {
  if (!row || !row._id) return false
  if (!row.roomRequired) return false
  if (up(row.overallStatus) === 'CANCELLED') return false

  if (up(currentScope) === 'ALL') {
    return ['PENDING', 'APPROVED', 'REJECTED'].includes(up(row.roomStatus))
  }

  return up(row.roomStatus) === 'PENDING'
}

/* ───────── Responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── State ───────── */
const loading = ref(false)
const submitting = ref(false)

const rows = ref([])
const scope = ref('ALL')
const q = ref('')

const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

const detailOpen = ref(false)
const detailRow = ref(null)

const decisionOpen = ref(false)
const decisionRow = ref(null)
const decisionType = ref('APPROVED')
const decisionNote = ref('')

let availabilityRefreshTimer = null

/* ───────── Computed ───────── */
const processedRows = computed(() => {
  const keyword = s(q.value).toLowerCase()
  const list = arr(rows.value)

  let result = list

  if (keyword) {
    result = result.filter((row) => {
      const fields = [
        row?.employeeId,
        row?.employee?.name,
        row?.employee?.department,
        row?.meetingTitle,
        row?.purpose,
        row?.roomCode,
        row?.roomName,
        row?.requirementNote,
        row?.overallStatus,
        row?.roomStatus,
        row?.materialStatus,
        materialItemsToText(row?.materials),
      ]
      return fields.some((x) => s(x).toLowerCase().includes(keyword))
    })
  }

  result.sort((a, b) => {
    const aTime = dayjs(a?.createdAt).isValid() ? dayjs(a.createdAt).valueOf() : 0
    const bTime = dayjs(b?.createdAt).isValid() ? dayjs(b.createdAt).valueOf() : 0
    return bTime - aTime
  })

  return result
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return processedRows.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return processedRows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(processedRows.value.length / per) || 1
})

const canSubmitDecision = computed(() => {
  return (
    !submitting.value &&
    !!decisionRow.value?._id &&
    ['APPROVED', 'REJECTED'].includes(up(decisionType.value))
  )
})

watch([q, perPage], () => {
  page.value = 1
})

/* ───────── API ───────── */
async function fetchRows({ silent = false } = {}) {
  try {
    if (!silent) loading.value = true
    const { data } = await api.get('/booking-room/room/inbox', {
      params: { scope: scope.value },
    })
    rows.value = Array.isArray(data) ? data : []
    syncDetailRow()
    syncDecisionRow()
  } catch (e) {
    console.error('fetchRows error', e)
    rows.value = []
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to load room inbox.' })
  } finally {
    if (!silent) loading.value = false
  }
}

async function submitDecision() {
  if (!canSubmitDecision.value) return

  try {
    submitting.value = true

    const { data } = await api.post(`/booking-room/${decisionRow.value._id}/room-decision`, {
      decision: up(decisionType.value),
      note: s(decisionNote.value),
    })

    upsertRealtimeRow(data)

    showToast({
      type: 'success',
      message: `Room request ${up(decisionType.value).toLowerCase()} successfully.`,
    })

    closeDecision()
  } catch (e) {
    console.error('submitDecision error', e)
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to submit decision.' })
  } finally {
    submitting.value = false
  }
}

/* ───────── Actions ───────── */
function refreshAll() {
  fetchRows()
}

function resetSearch() {
  q.value = ''
  scope.value = 'ALL'
}

function onScopeChange() {
  page.value = 1
  fetchRows()
}

function openDetail(row) {
  detailRow.value = row || null
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailRow.value = null
}

function openDecision(row, type) {
  decisionRow.value = row || null
  decisionType.value = up(type) === 'REJECTED' ? 'REJECTED' : 'APPROVED'
  decisionNote.value = ''
  decisionOpen.value = true
}

function closeDecision() {
  if (submitting.value) return
  decisionOpen.value = false
  decisionRow.value = null
  decisionType.value = 'APPROVED'
  decisionNote.value = ''
}

/* ───────── Live row sync ───────── */
function syncDetailRow() {
  if (!detailRow.value?._id) return
  const found = rows.value.find((x) => String(x._id) === String(detailRow.value._id))
  if (found) detailRow.value = found
}

function syncDecisionRow() {
  if (!decisionRow.value?._id) return
  const found = rows.value.find((x) => String(x._id) === String(decisionRow.value._id))
  if (found) decisionRow.value = found
}

function upsertRealtimeRow(doc) {
  if (!doc?._id) return

  const visible = isRowVisibleForScope(doc, scope.value)
  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)

  if (!visible) {
    if (idx >= 0) rows.value.splice(idx, 1)
    syncDetailRow()
    syncDecisionRow()
    return
  }

  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  syncDetailRow()
  syncDecisionRow()
}

function onReqCreated(doc) {
  if (!doc?.roomRequired) return
  upsertRealtimeRow(doc)
}

function onReqUpdated(doc) {
  if (!doc?._id) return
  upsertRealtimeRow(doc)
}

function onAvailabilityChanged() {
  if (!(detailOpen.value || decisionOpen.value)) return

  if (availabilityRefreshTimer) clearTimeout(availabilityRefreshTimer)
  availabilityRefreshTimer = setTimeout(() => {
    fetchRows({ silent: true })
  }, 250)
}

/* ───────── Modal UX ───────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  if (on) document.body.classList.add('overflow-hidden')
  else document.body.classList.remove('overflow-hidden')
}

watch([detailOpen, decisionOpen], ([det, dec]) => {
  lockBodyScroll(det || dec)
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (decisionOpen.value) return closeDecision()
  if (detailOpen.value) return closeDetail()
}

/* ───────── Lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  try {
    await subscribeRoleIfNeeded('ROOM_ADMIN')
  } catch {}

  await fetchRows()

  socket.on('bookingroom:req:created', onReqCreated)
  socket.on('bookingroom:req:updated', onReqUpdated)
  socket.on('bookingroom:availability:changed', onAvailabilityChanged)
})

onBeforeUnmount(() => {
  lockBodyScroll(false)

  if (availabilityRefreshTimer) {
    clearTimeout(availabilityRefreshTimer)
    availabilityRefreshTimer = null
  }

  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }

  socket.off('bookingroom:req:created', onReqCreated)
  socket.off('bookingroom:req:updated', onReqUpdated)
  socket.off('bookingroom:availability:changed', onAvailabilityChanged)
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- Hero / Filter -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div class="min-w-[220px]">
              <div class="text-sm font-extrabold">Meeting Room Inbox</div>
            </div>

            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[180px_260px_auto] md:items-end">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Scope</label>
                <select
                  v-model="scope"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                  @change="onScopeChange"
                >
                  <option value="ALL">All Requests</option>
                  <option value="ACTIONABLE">Actionable</option>
                </select>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="q"
                    type="text"
                    placeholder="Employee, title, room..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="flex gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  @click="refreshAll"
                  :disabled="loading"
                >
                  <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
                  Refresh
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  @click="resetSearch(); fetchRows()"
                >
                  <i class="fa-solid fa-broom text-[11px]" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="p-3">
          <div v-if="loading && !processedRows.length" class="space-y-2">
            <div class="ui-skeleton h-9 w-full" />
            <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-14 w-full" />
          </div>

          <div v-else>
            <!-- Mobile -->
            <div v-if="isMobile" class="space-y-2">
              <div
                v-if="!pagedRows.length"
                class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400"
              >
                No room requests found.
              </div>

              <div v-for="row in pagedRows" :key="row._id" class="ui-card p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ fmtDateTime(row.createdAt) }}
                    </div>

                    <div class="mt-1 text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                      {{ row.meetingTitle || 'No title' }}
                    </div>

                    <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {{ row.employee?.name || '—' }} • {{ row.employeeId || '—' }}
                    </div>

                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <span :class="roomStatusClass(row.roomStatus)">
                        {{ row.roomStatus || '—' }}
                      </span>
                      <span :class="overallStatusClass(row.overallStatus)">
                        {{ row.overallStatus || '—' }}
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <button class="ui-btn ui-btn-xs ui-btn-soft" type="button" @click="openDetail(row)">
                      Detail
                    </button>
                  </div>
                </div>

                <div class="mt-2 ui-divider" />

                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Booking Date</div>
                    <div>{{ fmtDate(row.bookingDate) }}</div>
                  </div>

                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Time</div>
                    <div class="font-extrabold">{{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}</div>
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="ui-label !mb-1">Room</div>
                      <div class="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                        {{ row.roomName || '—' }}
                      </div>
                      <div class="text-[10px] text-slate-500 dark:text-slate-400">
                        {{ row.roomCode || '—' }}
                      </div>
                    </div>
                    <span :class="roomStatusClass(row.roomStatus)">
                      {{ row.roomStatus || '—' }}
                    </span>
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="ui-label !mb-1">Materials</div>
                      <div class="text-[11px] text-slate-700 dark:text-slate-200">
                        {{ materialItemsToText(row.materials) || 'No materials' }}
                      </div>
                    </div>
                    <span :class="materialStatusClass(row.materialStatus)">
                      {{ row.materialStatus || '—' }}
                    </span>
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="ui-label !mb-1">Purpose</div>
                  <div class="text-[11px] text-slate-700 dark:text-slate-200">
                    {{ row.purpose || '—' }}
                  </div>
                </div>

                <div class="mt-3 flex justify-end gap-2">
                  <button
                    v-if="isPendingRoom(row)"
                    type="button"
                    class="ui-btn ui-btn-primary ui-btn-xs"
                    @click="openDecision(row, 'APPROVED')"
                  >
                    Approve
                  </button>

                  <button
                    v-if="isPendingRoom(row)"
                    type="button"
                    class="ui-btn ui-btn-rose ui-btn-xs"
                    @click="openDecision(row, 'REJECTED')"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>

            <!-- Desktop -->
            <div v-else class="ui-table-wrap">
              <table class="ui-table">
                <thead>
                  <tr>
                    <th class="ui-th">Created</th>
                    <th class="ui-th">Booking Date</th>
                    <th class="ui-th">Time</th>
                    <th class="ui-th">Employee</th>
                    <th class="ui-th">Meeting Title</th>
                    <th class="ui-th">Room</th>
                    <th class="ui-th">Materials</th>
                    <th class="ui-th">Room Status</th>
                    <th class="ui-th">Overall</th>
                    <th class="ui-th text-center">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-if="!pagedRows.length">
                    <td colspan="10" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                      No room requests found.
                    </td>
                  </tr>

                  <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover">
                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDateTime(row.createdAt) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDate(row.bookingDate) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}
                    </td>

                    <td class="ui-td">
                      <div class="min-w-0">
                        <div class="truncate font-semibold">{{ row.employee?.name || '—' }}</div>
                        <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {{ row.employeeId || '—' }} • {{ row.employee?.department || '—' }}
                        </div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="truncate font-semibold" :title="row.meetingTitle || '—'">
                        {{ row.meetingTitle || '—' }}
                      </div>
                      <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400" :title="row.purpose || '—'">
                        {{ row.purpose || '—' }}
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="min-w-0">
                        <div class="truncate font-semibold">{{ row.roomName || '—' }}</div>
                        <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {{ row.roomCode || '—' }}
                        </div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="truncate" :title="materialItemsToText(row.materials)">
                        {{ materialItemsToText(row.materials) || 'No materials' }}
                      </div>
                      <div class="mt-1">
                        <span :class="materialStatusClass(row.materialStatus)">{{ row.materialStatus || '—' }}</span>
                      </div>
                    </td>

                    <td class="ui-td">
                      <span :class="roomStatusClass(row.roomStatus)">
                        {{ row.roomStatus || '—' }}
                      </span>
                    </td>

                    <td class="ui-td">
                      <span :class="overallStatusClass(row.overallStatus)">
                        {{ row.overallStatus || '—' }}
                      </span>
                    </td>

                    <td class="ui-td text-center">
                      <div class="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          class="ui-btn ui-btn-soft ui-btn-xs"
                          @click="openDetail(row)"
                          title="View detail"
                        >
                          <i class="fa-solid fa-eye text-[11px]" />
                        </button>

                        <button
                          v-if="isPendingRoom(row)"
                          type="button"
                          class="ui-btn ui-btn-primary ui-btn-xs"
                          @click="openDecision(row, 'APPROVED')"
                          title="Approve"
                        >
                          Approve
                        </button>

                        <button
                          v-if="isPendingRoom(row)"
                          type="button"
                          class="ui-btn ui-btn-rose ui-btn-xs"
                          @click="openDecision(row, 'REJECTED')"
                          title="Reject"
                        >
                          Reject
                        </button>

                        <span
                          v-if="!isPendingRoom(row)"
                          class="text-[11px] text-slate-400 dark:text-slate-500"
                        >
                          —
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Pagination -->
            <div
              v-if="processedRows.length"
              class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                     dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-2">
                <select v-model="perPage" class="ui-select !py-1.5 !text-[11px] !rounded-full">
                  <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                </select>

                <span class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ processedRows.length }} request(s)
                </span>
              </div>

              <div class="flex items-center justify-end gap-1">
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
                <span class="px-2 font-extrabold">Page {{ page }} / {{ pageCount }}</span>
                <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
                <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Modal -->
      <div v-if="detailOpen && detailRow" class="ui-modal-backdrop" @click.self="closeDetail">
        <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Room Request Detail</div>
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {{ detailRow.meetingTitle || 'No title' }}
              </div>
            </div>

            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeDetail">
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>

          <div class="max-h-[calc(100vh-140px)] overflow-auto p-4 space-y-3">
            <div class="ui-frame p-3">
              <div class="grid gap-3 md:grid-cols-3">
                <div>
                  <div class="ui-label">Overall Status</div>
                  <span :class="overallStatusClass(detailRow.overallStatus)">
                    {{ detailRow.overallStatus || '—' }}
                  </span>
                </div>

                <div>
                  <div class="ui-label">Room Status</div>
                  <span :class="roomStatusClass(detailRow.roomStatus)">
                    {{ detailRow.roomStatus || '—' }}
                  </span>
                </div>

                <div class="md:text-right">
                  <div class="ui-label">Created At</div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ fmtDateTime(detailRow.createdAt) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="ui-card p-3">
                <div class="ui-section-title">Requester Information</div>
                <div class="mt-2 grid gap-3 sm:grid-cols-2 text-[12px]">
                  <div>
                    <div class="ui-label">Name</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.employee?.name) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Employee ID</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.employeeId) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Department</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.employee?.department) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Contact</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.employee?.contactNumber) }}</div>
                  </div>
                  <div class="sm:col-span-2">
                    <div class="ui-label">Submitted Via</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.submittedVia) }}</div>
                  </div>
                </div>
              </div>

              <div class="ui-card p-3">
                <div class="ui-section-title">Booking Information</div>
                <div class="mt-2 grid gap-3 sm:grid-cols-2 text-[12px]">
                  <div>
                    <div class="ui-label">Date</div>
                    <div class="font-extrabold">{{ fmtDate(detailRow.bookingDate) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Time</div>
                    <div class="font-extrabold">{{ fmtTime(detailRow.timeStart) }} - {{ fmtTime(detailRow.timeEnd) }}</div>
                  </div>
                  <div class="sm:col-span-2">
                    <div class="ui-label">Purpose</div>
                    <div class="whitespace-pre-wrap">{{ cleanText(detailRow.purpose) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Participants</div>
                    <div class="font-extrabold">{{ detailRow.participantEstimate ?? '—' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Updated At</div>
                    <div class="font-extrabold">{{ fmtDateTime(detailRow.updatedAt) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="ui-card p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="ui-section-title">Room Details</div>
                  <span :class="roomStatusClass(detailRow.roomStatus)">
                    {{ detailRow.roomStatus || '—' }}
                  </span>
                </div>

                <div class="mt-2 grid gap-3 sm:grid-cols-2 text-[12px]">
                  <div>
                    <div class="ui-label">Required</div>
                    <div class="font-extrabold">{{ detailRow.roomRequired ? 'YES' : 'NO' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Room Code</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.roomCode) }}</div>
                  </div>
                  <div class="sm:col-span-2">
                    <div class="ui-label">Room Name</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.roomName) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Decision By</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.roomApproval?.byName || detailRow.roomApproval?.byLoginId) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Decision At</div>
                    <div class="font-extrabold">{{ fmtDateTime(detailRow.roomApproval?.decidedAt) }}</div>
                  </div>
                  <div class="sm:col-span-2">
                    <div class="ui-label">Note</div>
                    <div class="whitespace-pre-wrap">{{ cleanText(detailRow.roomApproval?.note) }}</div>
                  </div>
                </div>
              </div>

              <div class="ui-card p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="ui-section-title">Material Details</div>
                  <span :class="materialStatusClass(detailRow.materialStatus)">
                    {{ detailRow.materialStatus || '—' }}
                  </span>
                </div>

                <div class="mt-2 grid gap-3 sm:grid-cols-2 text-[12px]">
                  <div>
                    <div class="ui-label">Required</div>
                    <div class="font-extrabold">{{ detailRow.materialRequired ? 'YES' : 'NO' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Decision</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.materialApproval?.decision) }}</div>
                  </div>
                  <div class="sm:col-span-2">
                    <div class="ui-label">Materials</div>
                    <div class="font-extrabold">{{ materialItemsToText(detailRow.materials) || '—' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Decision By</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Decision At</div>
                    <div class="font-extrabold">{{ fmtDateTime(detailRow.materialApproval?.decidedAt) }}</div>
                  </div>
                  <div class="sm:col-span-2">
                    <div class="ui-label">Note</div>
                    <div class="whitespace-pre-wrap">{{ cleanText(detailRow.materialApproval?.note) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Final Request Status</div>
              <div class="mt-2 grid gap-3 sm:grid-cols-3 text-[12px]">
                <div>
                  <div class="ui-label">Overall</div>
                  <span :class="overallStatusClass(detailRow.overallStatus)">
                    {{ detailRow.overallStatus || '—' }}
                  </span>
                </div>
                <div>
                  <div class="ui-label">Cancel Reason</div>
                  <div class="font-extrabold">{{ cleanText(detailRow.cancelReason) }}</div>
                </div>
                <div>
                  <div class="ui-label">Requirement Note</div>
                  <div class="font-extrabold whitespace-pre-wrap">{{ cleanText(detailRow.requirementNote) }}</div>
                </div>
              </div>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-ghost" @click="closeDetail">
                Close
              </button>

              <button
                v-if="isPendingRoom(detailRow)"
                type="button"
                class="ui-btn ui-btn-primary"
                @click="openDecision(detailRow, 'APPROVED')"
              >
                Approve Room
              </button>

              <button
                v-if="isPendingRoom(detailRow)"
                type="button"
                class="ui-btn ui-btn-rose"
                @click="openDecision(detailRow, 'REJECTED')"
              >
                Reject Room
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Decision Modal -->
      <div v-if="decisionOpen && decisionRow" class="ui-modal-backdrop" @click.self="closeDecision">
        <div class="ui-modal ui-modal-md p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="flex items-center gap-3">
              <div
                class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white"
                :class="decisionType === 'REJECTED' ? 'bg-rose-500' : 'bg-emerald-500'"
              >
                <i :class="decisionType === 'REJECTED' ? 'fa-solid fa-xmark' : 'fa-solid fa-check'" />
              </div>

              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                  {{ decisionType === 'REJECTED' ? 'Reject Room Request' : 'Approve Room Request' }}
                </div>
                <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {{ decisionRow.meetingTitle || 'No title' }}
                </div>
              </div>
            </div>

            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeDecision">
              <i class="fa-solid fa-xmark text-[11px]" />
            </button>
          </div>

          <div class="p-4 space-y-3">
            <div class="ui-frame p-3">
              <div class="grid gap-3 sm:grid-cols-2 text-[12px]">
                <div>
                  <div class="ui-label">Employee</div>
                  <div class="font-extrabold text-slate-900 dark:text-slate-50">
                    {{ decisionRow.employee?.name || '—' }} ({{ decisionRow.employeeId || '—' }})
                  </div>
                </div>

                <div>
                  <div class="ui-label">Booking Schedule</div>
                  <div class="font-extrabold text-slate-900 dark:text-slate-50">
                    {{ fmtDate(decisionRow.bookingDate) }} • {{ fmtTime(decisionRow.timeStart) }} - {{ fmtTime(decisionRow.timeEnd) }}
                  </div>
                </div>

                <div>
                  <div class="ui-label">Room Requested</div>
                  <div class="font-extrabold text-slate-900 dark:text-slate-50">
                    {{ decisionRow.roomName || '—' }} ({{ decisionRow.roomCode || '—' }})
                  </div>
                </div>

                <div>
                  <div class="ui-label">Current Status</div>
                  <span :class="roomStatusClass(decisionRow.roomStatus)">
                    {{ decisionRow.roomStatus || '—' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-label">Your Decision</div>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="ui-chip"
                  :class="decisionType === 'APPROVED' ? 'ui-chip-on !border-emerald-500/50 !bg-emerald-500/10 !text-emerald-600 dark:!text-emerald-300' : ''"
                  @click="decisionType = 'APPROVED'"
                >
                  <i class="fa-solid fa-check" />
                  Approve
                </button>

                <button
                  type="button"
                  class="ui-chip"
                  :class="decisionType === 'REJECTED' ? 'ui-chip-on !border-rose-500/50 !bg-rose-500/10 !text-rose-600 dark:!text-rose-300' : ''"
                  @click="decisionType = 'REJECTED'"
                >
                  <i class="fa-solid fa-xmark" />
                  Reject
                </button>
              </div>

              <div class="mt-3">
                <label class="ui-label">Decision Note (Optional)</label>
                <textarea
                  v-model="decisionNote"
                  rows="3"
                  class="ui-textarea"
                  placeholder="Add any remarks for the requester..."
                />
              </div>
            </div>

            <div class="flex items-center justify-end gap-2">
              <button type="button" class="ui-btn ui-btn-ghost" @click="closeDecision" :disabled="submitting">
                Cancel
              </button>

              <button
                type="button"
                class="ui-btn"
                :class="decisionType === 'REJECTED' ? 'ui-btn-rose' : 'ui-btn-primary'"
                @click="submitDecision"
                :disabled="!canSubmitDecision"
              >
                <i
                  :class="submitting ? 'fa-solid fa-spinner animate-spin' : decisionType === 'REJECTED' ? 'fa-solid fa-xmark' : 'fa-solid fa-check'"
                />
                {{ decisionType === 'REJECTED' ? 'Confirm Reject' : 'Confirm Approve' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-modal-xl {
  width: min(1100px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
}

.ui-modal-md {
  width: min(700px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
}
</style>
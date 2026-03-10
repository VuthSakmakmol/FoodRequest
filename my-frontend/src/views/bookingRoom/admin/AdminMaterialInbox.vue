<!-- src/views/bookingRoom/admin/AdminMaterialInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminMaterialInbox' })

const { showToast } = useToast()

/* ───────────────── Helpers ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function arr(v) {
  return Array.isArray(v) ? v : []
}
function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
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
        const qty = num(x?.qty, 0)
        return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
      })
      .filter(Boolean)
      .join(', ') || '—'
  )
}

function materialStatusClass(status) {
  const val = up(status)
  if (val === 'APPROVED') return 'ui-badge ui-badge-success'
  if (val === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (val === 'PENDING') return 'ui-badge ui-badge-warning'
  if (val === 'PARTIAL_APPROVED') return 'ui-badge ui-badge-info'
  if (val === 'NOT_REQUIRED') return 'ui-badge'
  if (val === 'CANCELLED') return 'ui-badge'
  return 'ui-badge'
}

function overallStatusClass(status) {
  const val = up(status)
  if (val === 'APPROVED') return 'ui-badge ui-badge-success'
  if (val === 'REJECTED' || val === 'CANCELLED') return 'ui-badge ui-badge-danger'
  if (val === 'PARTIAL_APPROVED') return 'ui-badge ui-badge-info'
  if (val.includes('PENDING')) return 'ui-badge ui-badge-warning'
  if (val === 'NOT_REQUIRED') return 'ui-badge'
  return 'ui-badge'
}

function roomStatusClass(status) {
  const val = up(status)
  if (val === 'APPROVED') return 'ui-badge ui-badge-success'
  if (val === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (val === 'PENDING') return 'ui-badge ui-badge-warning'
  if (val === 'NOT_REQUIRED') return 'ui-badge'
  return 'ui-badge ui-badge-info'
}

function isVisibleForScope(row, currentScope) {
  if (!row || !row._id) return false
  if (!row.materialRequired) return false
  if (up(row.overallStatus) === 'CANCELLED') return false

  if (up(currentScope) === 'ALL') {
    return ['PENDING', 'APPROVED', 'REJECTED'].includes(up(row.materialStatus))
  }

  return up(row.materialStatus) === 'PENDING'
}

function isActionable(row) {
  return up(row?.materialStatus) === 'PENDING'
}

/* ───────────────── Responsive ───────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── State ───────────────── */
const loading = ref(false)
const acting = ref(false)

const rows = ref([])
const search = ref('')
const scope = ref('ACTIONABLE')

const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

const detailOpen = ref(false)
const detailRow = ref(null)

const decisionOpen = ref(false)
const decisionMode = ref('APPROVED')
const decisionRow = ref(null)
const decisionNote = ref('')

let availabilityRefreshTimer = null

/* ───────────────── Computed ───────────────── */
const processedRows = computed(() => {
  const term = s(search.value).toLowerCase()

  let result = arr(rows.value).filter((row) => {
    if (!term) return true

    return [
      s(row?.employeeId),
      s(row?.employee?.name),
      s(row?.employee?.department),
      s(row?.employee?.position),
      s(row?.bookingDate),
      s(row?.timeStart),
      s(row?.timeEnd),
      s(row?.meetingTitle),
      s(row?.purpose),
      s(row?.requirementNote),
      s(row?.roomCode),
      s(row?.roomName),
      s(row?.materialStatus),
      s(row?.overallStatus),
      materialItemsToText(row?.materials),
    ]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })

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

const pendingCount = computed(() =>
  arr(rows.value).filter((x) => up(x?.materialStatus) === 'PENDING').length
)
const approvedCount = computed(() =>
  arr(rows.value).filter((x) => up(x?.materialStatus) === 'APPROVED').length
)
const rejectedCount = computed(() =>
  arr(rows.value).filter((x) => up(x?.materialStatus) === 'REJECTED').length
)

const canActOnDecision = computed(() => {
  return !acting.value && !!decisionRow.value?._id && ['APPROVED', 'REJECTED'].includes(up(decisionMode.value))
})

watch([search, perPage], () => {
  page.value = 1
})

/* ───────────────── Sync helpers ───────────────── */
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

  const visible = isVisibleForScope(doc, scope.value)
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

/* ───────────────── API ───────────────── */
async function loadRows({ silent = false } = {}) {
  try {
    if (!silent) loading.value = true
    const { data } = await api.get('/booking-room/material/inbox', {
      params: { scope: scope.value },
    })
    rows.value = arr(data)
    syncDetailRow()
    syncDecisionRow()
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Load failed',
      message: e?.response?.data?.message || 'Failed to load material inbox.',
    })
  } finally {
    if (!silent) loading.value = false
  }
}

async function submitDecision() {
  if (!decisionRow.value?._id || !canActOnDecision.value) return

  try {
    acting.value = true

    const { data } = await api.post(`/booking-room/${decisionRow.value._id}/material-decision`, {
      decision: decisionMode.value,
      note: s(decisionNote.value),
    })

    upsertRealtimeRow(data)

    showToast({
      type: 'success',
      title: 'Decision saved',
      message:
        up(decisionMode.value) === 'APPROVED'
          ? 'Material request approved successfully.'
          : 'Material request rejected successfully.',
    })

    closeDecision()
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Decision failed',
      message: e?.response?.data?.message || 'Unable to save decision.',
    })
  } finally {
    acting.value = false
  }
}

/* ───────────────── UI Actions ───────────────── */
function refreshAll() {
  loadRows()
}

function resetFilters() {
  search.value = ''
  scope.value = 'ACTIONABLE'
}

function onScopeChange() {
  page.value = 1
  loadRows()
}

function openDetail(row) {
  detailRow.value = row || null
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailRow.value = null
}

function openDecision(row, mode) {
  decisionRow.value = row || null
  decisionMode.value = up(mode) === 'REJECTED' ? 'REJECTED' : 'APPROVED'
  decisionNote.value = ''
  decisionOpen.value = true
}

function closeDecision() {
  if (acting.value) return
  decisionOpen.value = false
  decisionRow.value = null
  decisionNote.value = ''
}

/* ───────────────── Realtime ───────────────── */
function onReqCreated(doc) {
  if (!doc?.materialRequired) return
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
    loadRows({ silent: true })
  }, 250)
}

/* ───────────────── Modal UX ───────────────── */
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

/* ───────────────── Lifecycle ───────────────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  try {
    await subscribeRoleIfNeeded('MATERIAL_ADMIN')
  } catch {}

  await loadRows()

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
        <!-- Hero -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div class="min-w-[220px]">
              <div class="text-sm font-extrabold">Material Inbox</div>
            </div>

            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[180px_260px_auto] md:items-end">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Scope</label>
                <select
                  v-model="scope"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                  @change="onScopeChange"
                >
                  <option value="ACTIONABLE">Actionable</option>
                  <option value="ALL">All</option>
                </select>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Requester, meeting, room, material..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="flex gap-2">
                <button
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  type="button"
                  :disabled="loading"
                  @click="refreshAll"
                >
                  <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
                  Refresh
                </button>

                <button
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  type="button"
                  @click="resetFilters(); loadRows()"
                >
                  <i class="fa-solid fa-broom text-[11px]" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="p-3 space-y-3">
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
                No material requests found.
              </div>

              <div v-for="row in pagedRows" :key="row._id" class="ui-card p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ fmtDateTime(row.createdAt) }}
                    </div>

                    <div class="mt-1 text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                      {{ row.meetingTitle || '—' }}
                    </div>

                    <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {{ row.employee?.name || row.employeeId || '—' }}
                    </div>

                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <span :class="materialStatusClass(row.materialStatus)">
                        {{ row.materialStatus || '—' }}
                      </span>
                      <span :class="overallStatusClass(row.overallStatus)">
                        {{ row.overallStatus || '—' }}
                      </span>
                    </div>
                  </div>

                  <button class="ui-btn ui-btn-xs ui-btn-soft" type="button" @click="openDetail(row)">
                    Detail
                  </button>
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
                  <div class="ui-label !mb-1">Room</div>
                  <div class="text-[11px] text-slate-700 dark:text-slate-200">
                    {{ row.roomName || row.roomCode || '—' }}
                  </div>
                  <div class="mt-1">
                    <span :class="roomStatusClass(row.roomStatus)">{{ row.roomStatus || '—' }}</span>
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="ui-label !mb-1">Materials</div>
                  <div class="text-[11px] text-slate-700 dark:text-slate-200">
                    {{ materialItemsToText(row.materials) || '—' }}
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
                    v-if="isActionable(row)"
                    type="button"
                    class="ui-btn ui-btn-primary ui-btn-xs"
                    @click="openDecision(row, 'APPROVED')"
                  >
                    Approve
                  </button>

                  <button
                    v-if="isActionable(row)"
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
                    <th class="ui-th">Requester</th>
                    <th class="ui-th">Meeting</th>
                    <th class="ui-th">Room</th>
                    <th class="ui-th">Materials</th>
                    <th class="ui-th">Material Status</th>
                    <th class="ui-th">Overall</th>
                    <th class="ui-th text-center">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-if="!pagedRows.length">
                    <td colspan="10" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                      No material requests found.
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
                        <div class="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {{ row.employee?.name || row.employeeId || '—' }}
                        </div>
                        <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {{ row.employeeId || '—' }}
                          <span v-if="row.employee?.department"> • {{ row.employee.department }}</span>
                        </div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="min-w-0">
                        <div class="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {{ row.meetingTitle || '—' }}
                        </div>
                        <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {{ row.purpose || '—' }}
                        </div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="min-w-0">
                        <div class="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {{ row.roomName || row.roomCode || '—' }}
                        </div>
                        <div class="mt-1">
                          <span :class="roomStatusClass(row.roomStatus)">{{ row.roomStatus || '—' }}</span>
                        </div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="truncate" :title="materialItemsToText(row.materials)">
                        {{ materialItemsToText(row.materials) || '—' }}
                      </div>
                    </td>

                    <td class="ui-td">
                      <span :class="materialStatusClass(row.materialStatus)">
                        {{ row.materialStatus || '—' }}
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
                          v-if="isActionable(row)"
                          type="button"
                          class="ui-btn ui-btn-primary ui-btn-xs"
                          @click="openDecision(row, 'APPROVED')"
                          title="Approve"
                        >
                          Approve
                        </button>

                        <button
                          v-if="isActionable(row)"
                          type="button"
                          class="ui-btn ui-btn-rose ui-btn-xs"
                          @click="openDecision(row, 'REJECTED')"
                          title="Reject"
                        >
                          Reject
                        </button>

                        <span
                          v-if="!isActionable(row)"
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
      <div
        v-if="detailOpen && detailRow"
        class="ui-modal-backdrop"
        @click.self="closeDetail"
      >
        <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Material Request Detail</div>
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {{ detailRow.meetingTitle || 'Booking Detail' }}
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
                  <div class="ui-label">Material Status</div>
                  <span :class="materialStatusClass(detailRow.materialStatus)">
                    {{ detailRow.materialStatus || '—' }}
                  </span>
                </div>

                <div>
                  <div class="ui-label">Overall Status</div>
                  <span :class="overallStatusClass(detailRow.overallStatus)">
                    {{ detailRow.overallStatus || '—' }}
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
                    <div class="ui-label">Requester</div>
                    <div class="font-extrabold">{{ detailRow.employee?.name || '—' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Employee ID</div>
                    <div class="font-extrabold">{{ detailRow.employeeId || '—' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Department</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.employee?.department) }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Position</div>
                    <div class="font-extrabold">{{ cleanText(detailRow.employee?.position) }}</div>
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
                    <div class="ui-label">Meeting Title</div>
                    <div class="font-extrabold">{{ detailRow.meetingTitle || '—' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Room</div>
                    <div class="font-extrabold">{{ detailRow.roomName || detailRow.roomCode || '—' }}</div>
                  </div>
                  <div>
                    <div class="ui-label">Participants</div>
                    <div class="font-extrabold">{{ detailRow.participantEstimate || 1 }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="ui-card p-3">
                <div class="ui-section-title">Purpose</div>
                <div class="mt-2 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">
                  {{ detailRow.purpose || '—' }}
                </div>
              </div>

              <div class="ui-card p-3">
                <div class="ui-section-title">Requirement Note</div>
                <div class="mt-2 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">
                  {{ detailRow.requirementNote || '—' }}
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="ui-section-title">Material Items</div>
                <span :class="materialStatusClass(detailRow.materialStatus)">
                  {{ detailRow.materialStatus || '—' }}
                </span>
              </div>

              <div
                v-if="!arr(detailRow.materials).length"
                class="mt-2 ui-frame p-4 text-sm text-slate-500 dark:text-slate-400"
              >
                No materials requested.
              </div>

              <div v-else class="mt-2 overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-slate-50 dark:bg-slate-800/70">
                    <tr class="text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      <th class="px-3 py-2">Code</th>
                      <th class="px-3 py-2">Name</th>
                      <th class="px-3 py-2">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(item, idx) in detailRow.materials"
                      :key="`${item.materialCode || idx}-${idx}`"
                      class="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td class="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">
                        {{ item.materialCode || '—' }}
                      </td>
                      <td class="px-3 py-2 text-slate-900 dark:text-slate-100">
                        {{ item.materialName || '—' }}
                      </td>
                      <td class="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                        {{ item.qty || 0 }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div
              v-if="detailRow.materialApproval?.decision || detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId"
              class="ui-card p-3"
            >
              <div class="ui-section-title">Decision Info</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
                <div>
                  <div class="ui-label">Decision By</div>
                  <div class="font-extrabold">
                    {{ detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId || '—' }}
                  </div>
                </div>
                <div>
                  <div class="ui-label">Decided At</div>
                  <div class="font-extrabold">
                    {{ fmtDateTime(detailRow.materialApproval?.decidedAt) }}
                  </div>
                </div>
                <div class="md:col-span-2">
                  <div class="ui-label">Note</div>
                  <div class="font-extrabold whitespace-pre-wrap">
                    {{ detailRow.materialApproval?.note || '—' }}
                  </div>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <button type="button" class="ui-btn ui-btn-ghost" @click="closeDetail">
                Close
              </button>

              <button
                v-if="isActionable(detailRow)"
                type="button"
                class="ui-btn ui-btn-primary"
                @click="openDecision(detailRow, 'APPROVED')"
              >
                Approve
              </button>

              <button
                v-if="isActionable(detailRow)"
                type="button"
                class="ui-btn ui-btn-rose"
                @click="openDecision(detailRow, 'REJECTED')"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Decision Modal -->
      <div
        v-if="decisionOpen && decisionRow"
        class="ui-modal-backdrop"
        @click.self="closeDecision"
      >
        <div class="ui-modal ui-modal-md p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="flex items-center gap-3">
              <div
                class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white"
                :class="up(decisionMode) === 'APPROVED' ? 'bg-emerald-500' : 'bg-rose-500'"
              >
                <i :class="up(decisionMode) === 'APPROVED' ? 'fa-solid fa-check' : 'fa-solid fa-xmark'" />
              </div>

              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                  {{ up(decisionMode) === 'APPROVED' ? 'Approve Request' : 'Reject Request' }}
                </div>
                <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {{ decisionRow.meetingTitle || '—' }}
                </div>
              </div>
            </div>

            <button
              class="ui-btn ui-btn-ghost ui-btn-xs"
              type="button"
              :disabled="acting"
              @click="closeDecision"
            >
              <i class="fa-solid fa-xmark text-[11px]" />
            </button>
          </div>

          <div class="p-4 space-y-3">
            <div class="ui-frame p-3">
              <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Request Summary
              </div>

              <div class="mt-2 space-y-1 text-[12px]">
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Requester:</span> <span class="text-slate-900 dark:text-slate-100">{{ decisionRow.employee?.name || decisionRow.employeeId || '—' }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Meeting:</span> <span class="text-slate-900 dark:text-slate-100">{{ decisionRow.meetingTitle || '—' }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Date:</span> <span class="text-slate-900 dark:text-slate-100">{{ fmtDate(decisionRow.bookingDate) }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Time:</span> <span class="text-slate-900 dark:text-slate-100">{{ fmtTime(decisionRow.timeStart) }} - {{ fmtTime(decisionRow.timeEnd) }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Materials:</span> <span class="text-slate-900 dark:text-slate-100">{{ materialItemsToText(decisionRow.materials) || '—' }}</span></div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-label">Decision</div>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="ui-chip"
                  :class="up(decisionMode) === 'APPROVED' ? 'ui-chip-on !border-emerald-500/50 !bg-emerald-500/10 !text-emerald-600 dark:!text-emerald-300' : ''"
                  @click="decisionMode = 'APPROVED'"
                >
                  <i class="fa-solid fa-check" />
                  Approve
                </button>

                <button
                  type="button"
                  class="ui-chip"
                  :class="up(decisionMode) === 'REJECTED' ? 'ui-chip-on !border-rose-500/50 !bg-rose-500/10 !text-rose-600 dark:!text-rose-300' : ''"
                  @click="decisionMode = 'REJECTED'"
                >
                  <i class="fa-solid fa-xmark" />
                  Reject
                </button>
              </div>

              <div class="mt-3">
                <label class="ui-label">Note</label>
                <textarea
                  v-model="decisionNote"
                  rows="4"
                  :placeholder="up(decisionMode) === 'APPROVED' ? 'Optional note...' : 'Reason for rejection...'"
                  class="ui-textarea"
                />
              </div>
            </div>

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="ui-btn ui-btn-ghost"
                :disabled="acting"
                @click="closeDecision"
              >
                Cancel
              </button>

              <button
                type="button"
                class="ui-btn"
                :class="up(decisionMode) === 'APPROVED' ? 'ui-btn-primary' : 'ui-btn-rose'"
                :disabled="!canActOnDecision"
                @click="submitDecision"
              >
                <i v-if="acting" class="fa-solid fa-spinner animate-spin text-[11px]" />
                {{ up(decisionMode) === 'APPROVED' ? 'Approve Request' : 'Reject Request' }}
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
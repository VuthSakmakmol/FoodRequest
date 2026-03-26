<!-- src/views/bookingRoom/admin/AdminRoomInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminRoomInbox' })

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
function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}
function fmtDate(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function fmtTime(v) {
  return s(v) || '—'
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(v)
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
function normalizedMaterialCards(items = []) {
  return arr(items)
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const code = s(x?.materialCode)
      const qty = Math.max(1, Number(x?.qty || 1))
      return {
        key: `${code || name}-${qty}`,
        name: name || 'Unnamed Material',
        code: code || '—',
        qty,
      }
    })
    .filter(x => s(x.name))
}
function roomServiceItems(item) {
  const list = []

  if (item?.needCoffeeBreak) {
    list.push({
      key: 'coffee',
      label: 'Coffee Break',
      icon: 'fa-mug-hot',
    })
  }

  if (item?.needNameOnTable) {
    list.push({
      key: 'name-table',
      label: 'Name on Table',
      icon: 'fa-id-card',
    })
  }

  if (item?.needWifiPassword) {
    list.push({
      key: 'wifi',
      label: 'WiFi Password',
      icon: 'fa-wifi',
    })
  }

  return list
}
function toYmdSafe(v) {
  if (!v) return ''
  const sv = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(sv)) return sv
  const d = dayjs(sv)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}
function passDateFilter(date, from, to) {
  const d = toYmdSafe(date)
  const f1 = s(from)
  const f2 = s(to)

  if (!f1 && !f2) return true

  const start = f1 || f2
  const end = f2 || f1

  if (!d) return false
  return d >= start && d <= end
}

/* ───────────────── UI Helpers ───────────────── */
function overallStatusClass(v) {
  const st = up(v)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'PARTIAL_APPROVED') return 'ui-badge ui-badge-info'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function roomStatusClass(v) {
  const st = up(v)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'NOT_REQUIRED') return 'ui-badge'
  if (st === 'PENDING') return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function materialStatusClass(v) {
  const st = up(v)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'NOT_REQUIRED') return 'ui-badge'
  if (st === 'PENDING') return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function sectionBadgeUiClass(status) {
  const st = up(status)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'NOT_REQUIRED') return 'ui-badge'
  return 'ui-badge ui-badge-warning'
}

function typeBadgeUiClass(item) {
  const hasRoom = !!item?.roomRequired
  const hasMaterial = !!item?.materialRequired
  if (hasRoom && hasMaterial) return 'ui-badge ui-badge-info'
  if (hasRoom) return 'ui-badge ui-badge-success'
  if (hasMaterial) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function bookingTypeLabel(item) {
  const hasRoom = !!item?.roomRequired
  const hasMaterial = !!item?.materialRequired
  if (hasRoom && hasMaterial) return 'Room + Material'
  if (hasRoom) return 'Room Only'
  if (hasMaterial) return 'Material Only'
  return '—'
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

/* ───────────────── Responsive ───────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── State ───────────────── */
const loading = ref(false)
const submitting = ref(false)

const rows = ref([])
const scope = ref('ALL')
const q = ref('')
const dateFrom = ref('')
const dateTo = ref('')

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

/* ───────────────── Computed ───────────────── */
const processedRows = computed(() => {
  const keyword = s(q.value).toLowerCase()
  let result = arr(rows.value)

  if (keyword) {
    result = result.filter((row) => {
      const hay = [
        row?.employeeId,
        row?.employee?.name,
        row?.employee?.department,
        row?.meetingTitle,
        row?.roomCode,
        row?.roomName,
        row?.requirementNote,
        row?.overallStatus,
        row?.roomStatus,
        row?.materialStatus,
        materialItemsToText(row?.materials),
        bookingTypeLabel(row),
        row?.submittedVia,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')

      return hay.includes(keyword)
    })
  }

  result = result.filter((row) => passDateFilter(row?.bookingDate, dateFrom.value, dateTo.value))

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
  if (submitting.value) return false
  if (!decisionRow.value?._id) return false
  if (!['APPROVED', 'REJECTED'].includes(up(decisionType.value))) return false

  if (up(decisionType.value) === 'REJECTED' && !s(decisionNote.value)) {
    return false
  }

  return true
})

watch([q, perPage, dateFrom, dateTo], () => {
  page.value = 1
})

/* ───────────────── API ───────────────── */
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
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Unable to load room inbox.',
    })
  } finally {
    if (!silent) loading.value = false
  }
}

async function submitDecision() {
  if (!canSubmitDecision.value) {
    if (up(decisionType.value) === 'REJECTED' && !s(decisionNote.value)) {
      showToast({ type: 'warning', message: 'Reject reason is required.' })
    }
    return
  }

  try {
    submitting.value = true

    const currentId = decisionRow.value?._id
    const currentType = up(decisionType.value)
    const currentNote = compactText(decisionNote.value)

    const { data } = await api.post(`/booking-room/${currentId}/room-decision`, {
      decision: currentType,
      note: currentNote,
    })

    closeDecision(true)
    closeDetail()
    upsertRealtimeRow(data)

    showToast({
      type: 'success',
      message: `Room request ${currentType.toLowerCase()} successfully.`,
    })
  } catch (e) {
    console.error('submitDecision error', e)
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Unable to submit decision.',
    })
  } finally {
    submitting.value = false
  }
}

/* ───────────────── Actions ───────────────── */
function refreshAll() {
  fetchRows()
}

function resetSearch() {
  q.value = ''
  scope.value = 'ALL'
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
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

function closeDecision(force = false) {
  if (submitting.value && !force) return
  decisionOpen.value = false
  decisionRow.value = null
  decisionType.value = 'APPROVED'
  decisionNote.value = ''
}

function exportExcel() {
  try {
    const exportRows = processedRows.value.map((row, index) => ({
      No: index + 1,
      BookingDate: fmtDate(row.bookingDate),
      TimeStart: fmtTime(row.timeStart),
      TimeEnd: fmtTime(row.timeEnd),
      EmployeeID: s(row.employeeId),
      EmployeeName: s(row.employee?.name),
      Department: s(row.employee?.department),
      MeetingTitle: s(row.meetingTitle),
      RequestType: bookingTypeLabel(row),
      RoomCode: s(row.roomCode),
      RoomName: s(row.roomName),
      RoomStatus: s(row.roomStatus),
      MaterialStatus: s(row.materialStatus),
      Materials: row.materialRequired ? materialItemsToText(row.materials) : 'Not Required',
      OverallStatus: s(row.overallStatus),
      ParticipantEstimate: Number(row.participantEstimate || 0),
      RequirementNote: s(row.requirementNote),
      CancelReason: s(row.cancelReason),
      UpdatedAt: fmtDateTime(row.updatedAt),
    }))

    if (!exportRows.length) {
      showToast({ type: 'warning', message: 'No data to export.' })
      return
    }

    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Room Inbox')

    const today = dayjs().format('YYYYMMDD_HHmm')
    XLSX.writeFile(wb, `admin_room_inbox_${today}.xlsx`)
    showToast({ type: 'success', message: 'Excel exported successfully.' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', message: 'Failed to export Excel.' })
  }
}

/* ───────────────── Live row sync ───────────────── */
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

/* ───────────────── Modal UX ───────────────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  const b = document.body
  if (on) b.classList.add('overflow-hidden')
  else b.classList.remove('overflow-hidden')
}

watch([detailOpen, decisionOpen], ([det, dec]) => {
  lockBodyScroll(!!(det || dec))
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
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div
              class="grid w-full gap-2 md:w-auto md:grid-cols-[150px_220px_140px_140px_auto] md:items-end"
            >
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
                <div
                  class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]"
                >
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="q"
                    type="text"
                    placeholder="Employee, title, room..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Date From</label>
                <input
                  v-model="dateFrom"
                  type="date"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                />
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Date To</label>
                <input
                  v-model="dateTo"
                  type="date"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                />
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  :disabled="loading"
                  @click="refreshAll"
                >
                  <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
                  Refresh
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  @click="exportExcel"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
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

        <div class="p-3">
          <div v-if="loading && !processedRows.length" class="space-y-2">
            <div class="ui-skeleton h-9 w-full" />
            <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-14 w-full" />
          </div>

          <div v-else>
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
                      {{ fmtDate(row.bookingDate) }} • {{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}
                    </div>

                    <div class="mt-1 flex flex-wrap items-center gap-2">
                      <span :class="typeBadgeUiClass(row)">
                        {{ bookingTypeLabel(row) }}
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

                <div class="mt-2 ui-frame p-2">
                  <div class="ui-label !mb-1">Requester</div>
                  <div class="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                    {{ row.employee?.name || '—' }}
                  </div>
                  <div class="text-[10px] text-slate-500 dark:text-slate-400">
                    {{ row.employeeId || '—' }} • {{ row.employee?.department || '—' }}
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="ui-label !mb-1">Meeting Title</div>
                  <div class="text-[11px] text-slate-700 dark:text-slate-200">
                    {{ row.meetingTitle || '—' }}
                  </div>
                </div>

                <div class="mt-2 grid gap-2">
                  <div class="mini-resource-card">
                    <div class="mini-resource-head">
                      <div class="mini-resource-title-wrap">
                        <span class="mini-resource-icon mini-resource-icon-neutral">
                          <i class="fa-solid fa-door-open" />
                        </span>
                        <div>
                          <div class="mini-resource-title">Room</div>
                          <div class="mini-resource-sub">
                            {{ row.roomRequired ? (row.roomName || 'Unnamed Room') : 'Not Required' }}
                          </div>
                        </div>
                      </div>

                      <span :class="sectionBadgeUiClass(row.roomStatus)">
                        {{ row.roomStatus || '—' }}
                      </span>
                    </div>

                    <div v-if="row.roomRequired" class="mt-2 service-grid-1">
                      <span
                        v-for="service in roomServiceItems(row)"
                        :key="service.key"
                        class="mini-chip mini-chip-green mini-chip-block"
                      >
                        <i class="fa-solid" :class="service.icon" />
                        {{ service.label }}
                      </span>

                      <span
                        v-if="!roomServiceItems(row).length"
                        class="mini-chip mini-chip-green mini-chip-block"
                      >
                        <i class="fa-solid fa-minus" />
                        No extra service
                      </span>
                    </div>
                  </div>

                  <div class="mini-resource-card">
                    <div class="mini-resource-head">
                      <div class="mini-resource-title-wrap">
                        <span class="mini-resource-icon mini-resource-icon-neutral">
                          <i class="fa-solid fa-paperclip" />
                        </span>
                        <div>
                          <div class="mini-resource-title">Material</div>
                          <div class="mini-resource-sub">
                            {{ row.materialRequired ? 'Attached items' : 'Not Required' }}
                          </div>
                        </div>
                      </div>

                      <span :class="sectionBadgeUiClass(row.materialStatus)">
                        {{ row.materialStatus || '—' }}
                      </span>
                    </div>

                    <div v-if="row.materialRequired" class="mt-2 service-grid-1">
                      <span
                        v-for="material in normalizedMaterialCards(row.materials)"
                        :key="material.key"
                        class="mini-chip mini-chip-green mini-chip-block"
                      >
                        <i class="fa-solid fa-paperclip" />
                        {{ material.name }} x{{ material.qty }}
                      </span>

                      <span
                        v-if="!normalizedMaterialCards(row.materials).length"
                        class="mini-chip mini-chip-green mini-chip-block"
                      >
                        <i class="fa-solid fa-minus" />
                        No material selected
                      </span>
                    </div>
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

            <div v-else class="history-table-shell">
              <div class="history-table-scroll">
                <table class="ui-table history-table">
                  <thead>
                    <tr>
                      <th class="ui-th col-datetime text-center">Booking Date & Time</th>
                      <th class="ui-th col-requester text-center">Requester</th>
                      <th class="ui-th col-title text-center">Meeting Title</th>
                      <th class="ui-th col-type text-center">Type</th>
                      <th class="ui-th col-room text-center">Room</th>
                      <th class="ui-th col-material text-center">Material</th>
                      <th class="ui-th col-status text-center">Overall</th>
                      <th class="ui-th col-actions text-center">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-if="!pagedRows.length">
                      <td colspan="8" class="ui-td py-8 text-center text-slate-500 dark:text-slate-400">
                        No room requests found.
                      </td>
                    </tr>

                    <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover">
                      <td class="ui-td align-middle text-center">
                        <div class="flex flex-col items-center justify-center text-center">
                          <span class="font-semibold text-slate-900 dark:text-slate-100">
                            {{ fmtDate(row.bookingDate) }}
                          </span>
                          <span class="text-[11px] text-slate-500 dark:text-slate-400">
                            {{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}
                          </span>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex flex-col items-center justify-center text-center">
                          <div
                            class="font-semibold text-slate-900 dark:text-slate-50 break-words"
                            :title="row.employee?.name || '—'"
                          >
                            {{ row.employee?.name || '—' }}
                          </div>
                          <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                            {{ row.employeeId || '—' }} • {{ row.employee?.department || '—' }}
                          </div>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex items-center justify-center text-center">
                          <div
                            class="font-semibold text-slate-900 dark:text-slate-50 break-words"
                            :title="row.meetingTitle || '—'"
                          >
                            {{ row.meetingTitle || '—' }}
                          </div>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex items-center justify-center">
                          <span :class="typeBadgeUiClass(row)">
                            {{ bookingTypeLabel(row) }}
                          </span>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex justify-center">
                          <div class="resource-cell-card resource-cell-card-centered">
                            <div class="resource-cell-head resource-cell-head-centered">
                              <div class="resource-cell-main resource-cell-main-centered">
                                <div class="min-w-0 w-full">
                                  <div class="resource-cell-title text-center">
                                    {{ row.roomRequired ? (row.roomName || 'Unnamed Room') : 'Not Required' }}
                                  </div>
                                </div>
                              </div>

                              <span :class="sectionBadgeUiClass(row.roomStatus)">
                                {{ row.roomStatus || '—' }}
                              </span>
                            </div>

                            <div v-if="row.roomRequired" class="mt-2 service-grid-1">
                              <span
                                v-for="service in roomServiceItems(row)"
                                :key="service.key"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block mini-chip-centered"
                              >
                                <i class="fa-solid" :class="service.icon" />
                                {{ service.label }}
                              </span>

                              <span
                                v-if="!roomServiceItems(row).length"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block mini-chip-centered"
                              >
                                <i class="fa-solid fa-minus" />
                                No extra service
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex justify-center">
                          <div class="resource-cell-card resource-cell-card-centered">
                            <div class="resource-cell-head resource-cell-head-centered">
                              <div class="resource-cell-main resource-cell-main-centered">
                                <div class="min-w-0 w-full">
                                  <div class="resource-cell-title text-center">
                                    {{ row.materialRequired ? 'Attached Items' : '' }}
                                  </div>
                                </div>
                              </div>

                              <span :class="sectionBadgeUiClass(row.materialStatus)">
                                {{ row.materialStatus || '—' }}
                              </span>
                            </div>

                            <div v-if="row.materialRequired" class="mt-2 service-grid-1">
                              <span
                                v-for="material in normalizedMaterialCards(row.materials)"
                                :key="material.key"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block mini-chip-centered"
                              >
                                <i class="fa-solid fa-paperclip" />
                                {{ material.name }} x{{ material.qty }}
                              </span>

                              <span
                                v-if="!normalizedMaterialCards(row.materials).length"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block mini-chip-centered"
                              >
                                <i class="fa-solid fa-minus" />
                                No material selected
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex items-center justify-center">
                          <span :class="overallStatusClass(row.overallStatus)">
                            {{ row.overallStatus || '—' }}
                          </span>
                        </div>
                      </td>

                      <td class="ui-td align-middle text-center">
                        <div class="flex items-center justify-center gap-2">
                          <button class="ui-btn ui-btn-soft ui-btn-xs" type="button" @click="openDetail(row)">
                            <i class="fa-solid fa-eye text-[11px]" />
                          </button>

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
            </div>

            <div
              v-if="processedRows.length"
              class="mt-3 flex flex-col gap-1.5 border-t border-slate-200 pt-2 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-2">
                <select
                  v-model="perPage"
                  class="ui-select !h-8 !min-h-8 !w-[78px] !py-0 !pl-2.5 !pr-7 !text-[11px] !rounded-full"
                >
                  <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                </select>
              </div>

              <div class="flex items-center justify-end gap-1">
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">
                  Prev
                </button>
                <span class="px-2 font-extrabold">Page {{ page }} / {{ pageCount }}</span>
                <button
                  type="button"
                  class="ui-pagebtn"
                  :disabled="page >= pageCount"
                  @click="page = Math.min(pageCount, page + 1)"
                >
                  Next
                </button>
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
                Created: {{ fmtDateTime(detailRow.createdAt) }}
              </div>
            </div>

            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeDetail">
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>

          <div class="p-4 space-y-3 max-h-[calc(100vh-140px)] overflow-auto">
            <div class="ui-frame p-3">
              <div class="grid gap-3 md:grid-cols-3">
                <div>
                  <div class="ui-label">Overall Status</div>
                  <span :class="overallStatusClass(detailRow.overallStatus)">
                    {{ detailRow.overallStatus || '—' }}
                  </span>
                </div>

                <div>
                  <div class="ui-label">Request Type</div>
                  <span :class="typeBadgeUiClass(detailRow)">
                    {{ bookingTypeLabel(detailRow) }}
                  </span>
                </div>

                <div class="md:text-right">
                  <div class="ui-label">Booking Date</div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ fmtDate(detailRow.bookingDate) }} • {{ fmtTime(detailRow.timeStart) }} - {{ fmtTime(detailRow.timeEnd) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Requester Information</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
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
                  <div>{{ cleanText(detailRow.employee?.department) }}</div>
                </div>
                <div>
                  <div class="ui-label">Contact</div>
                  <div>{{ cleanText(detailRow.employee?.contactNumber) }}</div>
                </div>
                <div class="md:col-span-2">
                  <div class="ui-label">Submitted Via</div>
                  <div>{{ cleanText(detailRow.submittedVia) }}</div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Meeting Info</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
                <div>
                  <div class="ui-label">Meeting Title</div>
                  <div class="font-extrabold">{{ cleanText(detailRow.meetingTitle) }}</div>
                </div>
                <div>
                  <div class="ui-label">Time</div>
                  <div class="font-extrabold">
                    {{ fmtTime(detailRow.timeStart) }} - {{ fmtTime(detailRow.timeEnd) }}
                  </div>
                </div>
                <div>
                  <div class="ui-label">Participant Estimate</div>
                  <div>{{ detailRow.participantEstimate ?? '—' }}</div>
                </div>
                <div>
                  <div class="ui-label">Updated At</div>
                  <div>{{ fmtDateTime(detailRow.updatedAt) }}</div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Resource Status</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
                <div class="resource-detail-card">
                  <div class="resource-detail-head">
                    <div class="resource-detail-title-wrap">
                      <span class="resource-detail-icon resource-detail-icon-neutral">
                        <i class="fa-solid fa-door-open" />
                      </span>
                      <div>
                        <div class="resource-detail-title">Room</div>
                        <div class="resource-detail-name">
                          {{ detailRow.roomRequired ? cleanText(detailRow.roomName) : 'Not Required' }}
                        </div>
                      </div>
                    </div>

                    <span :class="sectionBadgeUiClass(detailRow.roomStatus)">
                      {{ detailRow.roomStatus || '—' }}
                    </span>
                  </div>

                  <div v-if="detailRow.roomRequired" class="mt-3 service-grid-1">
                    <span
                      v-for="service in roomServiceItems(detailRow)"
                      :key="service.key"
                      class="mini-chip mini-chip-green mini-chip-block"
                    >
                      <i class="fa-solid" :class="service.icon" />
                      {{ service.label }}
                    </span>

                    <span
                      v-if="!roomServiceItems(detailRow).length"
                      class="mini-chip mini-chip-green mini-chip-block"
                    >
                      <i class="fa-solid fa-minus" />
                      No extra service
                    </span>
                  </div>

                  <div class="mt-3 grid gap-2 sm:grid-cols-2 text-[12px]">
                    <div>
                      <div class="ui-label">Decision By</div>
                      <div>{{ cleanText(detailRow.roomApproval?.byName || detailRow.roomApproval?.byLoginId) }}</div>
                    </div>
                    <div>
                      <div class="ui-label">Decision At</div>
                      <div>{{ fmtDateTime(detailRow.roomApproval?.decidedAt) }}</div>
                    </div>
                    <div class="sm:col-span-2">
                      <div class="ui-label">Note</div>
                      <div class="whitespace-pre-wrap text-[11px] text-slate-500 dark:text-slate-400">
                        {{ cleanText(detailRow.roomApproval?.note) }}
                      </div>
                    </div>
                  </div>
                </div>

                <div class="resource-detail-card">
                  <div class="resource-detail-head">
                    <div class="resource-detail-title-wrap">
                      <span class="resource-detail-icon resource-detail-icon-neutral">
                        <i class="fa-solid fa-paperclip" />
                      </span>
                      <div>
                        <div class="resource-detail-title">Material</div>
                        <div class="resource-detail-name">
                          {{ detailRow.materialRequired ? 'Attached Items' : 'Not Required' }}
                        </div>
                      </div>
                    </div>

                    <span :class="sectionBadgeUiClass(detailRow.materialStatus)">
                      {{ detailRow.materialStatus || '—' }}
                    </span>
                  </div>

                  <div v-if="detailRow.materialRequired" class="mt-3 service-grid-1">
                    <span
                      v-for="material in normalizedMaterialCards(detailRow.materials)"
                      :key="material.key"
                      class="mini-chip mini-chip-green mini-chip-block"
                    >
                      <i class="fa-solid fa-paperclip" />
                      {{ material.name }} x{{ material.qty }}
                    </span>

                    <span
                      v-if="!normalizedMaterialCards(detailRow.materials).length"
                      class="mini-chip mini-chip-green mini-chip-block"
                    >
                      <i class="fa-solid fa-minus" />
                      No material selected
                    </span>
                  </div>

                  <div class="mt-3 grid gap-2 sm:grid-cols-2 text-[12px]">
                    <div>
                      <div class="ui-label">Decision</div>
                      <div>{{ cleanText(detailRow.materialApproval?.decision) }}</div>
                    </div>
                    <div>
                      <div class="ui-label">Decision By</div>
                      <div>{{ cleanText(detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId) }}</div>
                    </div>
                    <div>
                      <div class="ui-label">Decision At</div>
                      <div>{{ fmtDateTime(detailRow.materialApproval?.decidedAt) }}</div>
                    </div>
                    <div class="sm:col-span-2">
                      <div class="ui-label">Note</div>
                      <div class="whitespace-pre-wrap text-[11px] text-slate-500 dark:text-slate-400">
                        {{ cleanText(detailRow.materialApproval?.note) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Requirement Note</div>
              <div class="mt-1 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">
                {{ cleanText(detailRow.requirementNote) }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Final Request Status</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
                <div>
                  <div class="ui-label">Overall</div>
                  <span :class="overallStatusClass(detailRow.overallStatus)">
                    {{ detailRow.overallStatus || '—' }}
                  </span>
                </div>

                <div>
                  <div class="ui-label">Cancel Reason</div>
                  <div>{{ cleanText(detailRow.cancelReason) }}</div>
                </div>
              </div>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-ghost" @click="closeDetail">Close</button>

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

      <div v-if="decisionOpen && decisionRow" class="ui-modal-backdrop" @click.self="closeDecision">
        <div class="ui-modal ui-modal-md p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                {{ decisionType === 'REJECTED' ? 'Reject Room Request' : 'Approve Room Request' }}
              </div>
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {{ decisionRow.meetingTitle || '—' }}
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
              <div class="mt-3">
                <label class="ui-label">
                  {{ decisionType === 'REJECTED' ? 'Reject Reason *' : 'Decision Note (Optional)' }}
                </label>
                <textarea
                  v-model="decisionNote"
                  rows="3"
                  class="ui-textarea"
                  :class="decisionType === 'REJECTED' && !decisionNote.trim()
                    ? '!border-rose-300 !ring-1 !ring-rose-200 dark:!border-rose-700'
                    : ''"
                  :placeholder="decisionType === 'REJECTED'
                    ? 'Please enter reject reason...'
                    : 'Add any remarks for the requester...'"
                />
              </div>
            </div>

            <div class="flex items-center justify-end gap-2">
              <button type="button" class="ui-btn ui-btn-ghost" :disabled="submitting" @click="closeDecision">
                Cancel
              </button>

              <button
                type="button"
                class="ui-btn"
                :class="decisionType === 'REJECTED' ? 'ui-btn-rose' : 'ui-btn-primary'"
                :disabled="!canSubmitDecision"
                @click="submitDecision"
              >
                <i
                  :class="submitting
                    ? 'fa-solid fa-spinner animate-spin'
                    : decisionType === 'REJECTED'
                      ? 'fa-solid fa-xmark'
                      : 'fa-solid fa-check'"
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

.history-table-shell {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border-radius: 18px;
}

.history-table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}

.history-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}

.col-datetime {
  min-width: 155px;
  width: 155px;
  white-space: nowrap;
}

.col-requester {
  min-width: 160px;
  width: 170px;
}

.col-title {
  min-width: 180px;
  width: auto;
}

.col-type {
  width: 145px;
  white-space: nowrap;
}

.col-room {
  min-width: 210px;
  width: 220px;
}

.col-material {
  min-width: 220px;
  width: 230px;
}

.col-status {
  width: 1%;
  white-space: nowrap;
}

.col-actions {
  width: 1%;
  white-space: nowrap;
}

.history-table-scroll::-webkit-scrollbar {
  height: 10px;
}

.history-table-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.55);
  border-radius: 999px;
}

.history-table-scroll::-webkit-scrollbar-track {
  background: rgba(226, 232, 240, 0.55);
  border-radius: 999px;
}

.dark .history-table-scroll::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.8);
}

.dark .history-table-scroll::-webkit-scrollbar-track {
  background: rgba(30, 41, 59, 0.85);
}

.mini-resource-card {
  border: 1px solid rgba(226, 232, 240, 1);
  background: rgba(248, 250, 252, 0.95);
  border-radius: 16px;
  padding: 12px;
}

.dark .mini-resource-card {
  border-color: rgba(51, 65, 85, 1);
  background: rgba(15, 23, 42, 0.72);
}

.mini-resource-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mini-resource-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.mini-resource-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  flex-shrink: 0;
}

.mini-resource-icon-neutral {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
}

.dark .mini-resource-icon-neutral {
  background: rgba(51, 65, 85, 0.7);
  color: rgb(226 232 240);
}

.mini-resource-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(100 116 139);
}

.dark .mini-resource-title {
  color: rgb(148 163 184);
}

.mini-resource-sub {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 700;
  color: rgb(15 23 42);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .mini-resource-sub {
  color: rgb(241 245 249);
}

.resource-cell-card {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(226, 232, 240, 1);
  background: rgba(248, 250, 252, 0.95);
  border-radius: 16px;
  padding: 10px;
}

.dark .resource-cell-card {
  border-color: rgba(51, 65, 85, 1);
  background: rgba(15, 23, 42, 0.7);
}

.resource-cell-card-centered {
  margin-left: auto;
  margin-right: auto;
}

.resource-cell-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: 10px;
}

.resource-cell-head-centered {
  grid-template-columns: 1fr;
  justify-items: center;
  text-align: center;
}

.resource-cell-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.resource-cell-main-centered {
  justify-content: center;
  text-align: center;
}

.resource-cell-icon {
  width: 30px;
  height: 30px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.resource-cell-icon-neutral {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
}

.dark .resource-cell-icon-neutral {
  background: rgba(51, 65, 85, 0.7);
  color: rgb(226 232 240);
}

.resource-cell-title {
  font-size: 12px;
  font-weight: 700;
  color: rgb(15 23 42);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .resource-cell-title {
  color: rgb(241 245 249);
}

.resource-cell-sub {
  margin-top: 2px;
  font-size: 10px;
  color: rgb(100 116 139);
}

.dark .resource-cell-sub {
  color: rgb(148 163 184);
}

.resource-detail-card {
  border: 1px solid rgba(226, 232, 240, 1);
  background: rgba(248, 250, 252, 0.95);
  border-radius: 18px;
  padding: 14px;
}

.dark .resource-detail-card {
  border-color: rgba(51, 65, 85, 1);
  background: rgba(15, 23, 42, 0.72);
}

.resource-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.resource-detail-title-wrap {
  display: flex;
  gap: 10px;
  min-width: 0;
}

.resource-detail-icon {
  width: 38px;
  height: 38px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.resource-detail-icon-neutral {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
}

.dark .resource-detail-icon-neutral {
  background: rgba(51, 65, 85, 0.7);
  color: rgb(226 232 240);
}

.resource-detail-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(100 116 139);
}

.dark .resource-detail-title {
  color: rgb(148 163 184);
}

.resource-detail-name {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
  color: rgb(15 23 42);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .resource-detail-name {
  color: rgb(241 245 249);
}

.service-grid-1 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  min-width: 0;
}

.mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(203, 213, 225, 1);
  background: white;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(51 65 85);
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .mini-chip {
  border-color: rgba(71, 85, 105, 1);
  background: rgba(15, 23, 42, 1);
  color: rgb(226 232 240);
}

.mini-chip-sm {
  padding: 4px 8px;
  font-size: 10px;
}

.mini-chip-block {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
}

.mini-chip-centered {
  justify-content: center;
  text-align: center;
}

.mini-chip-green {
  border-color: rgb(134 239 172);
  background: rgb(240 253 244);
  color: rgb(22 101 52);
}

.dark .mini-chip-green {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(20, 83, 45, 0.45);
  color: rgb(187 247 208);
}

@media (max-width: 1279px) {
  .col-room,
  .col-material {
    min-width: 190px;
  }
}

@media (max-width: 1023px) {
  .history-table {
    min-width: 1180px;
  }
}
</style>
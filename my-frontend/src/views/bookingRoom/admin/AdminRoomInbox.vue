<!-- src/views/bookingRoom/admin/AdminRoomInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminRoomInbox' })

const { showToast } = useToast()

/* ───────── Formatters ───────── */
function s(v) { return String(v ?? '').trim() }
function up(v) { return s(v).toUpperCase() }
function arr(v) { return Array.isArray(v) ? v : [] }
function fmtDate(v) { return s(v) || '—' }
function fmtTime(v) { return s(v) || '—' }
function fmtDateTime(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '—'
}
function materialItemsToText(items = []) {
  return arr(items)
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const qty = Number(x?.qty || 0)
      return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
}

/* ───────── UI Badges & Helpers ───────── */
function overallStatusClass(v) {
  const x = up(v)
  if (x === 'APPROVED') return 'ui-badge-success'
  if (x === 'REJECTED' || x === 'CANCELLED') return 'ui-badge-danger'
  if (x === 'PARTIAL_APPROVED') return 'ui-badge-warning'
  return 'ui-badge-info'
}
function roomStatusClass(v) {
  const x = up(v)
  if (x === 'APPROVED') return 'ui-badge-success'
  if (x === 'REJECTED') return 'ui-badge-danger'
  if (x === 'PENDING') return 'ui-badge-warning'
  return 'ui-badge-info'
}
function cleanText(v) {
  return s(v) || '—'
}

/* ───────── Responsive State ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 1024 // lg breakpoint
}

/* ───────── State ───────── */
const loading = ref(false)
const submitting = ref(false)

const rows = ref([])
// ✅ Changed default scope to ALL
const scope = ref('ALL')
const q = ref('')

const detailOpen = ref(false)
const detailRow = ref(null)

const decisionOpen = ref(false)
const decisionRow = ref(null)
const decisionType = ref('APPROVED')
const decisionNote = ref('')

/* ───────── Computed ───────── */
const filteredRows = computed(() => {
  const keyword = s(q.value).toLowerCase()
  const list = arr(rows.value)

  if (!keyword) return list

  return list.filter((row) => {
    const fields = [
      row?.employeeId,
      row?.employee?.name,
      row?.employee?.department,
      row?.meetingTitle,
      row?.purpose,
      row?.roomCode,
      row?.roomName,
      row?.requirementNote,
    ]
    return fields.some((x) => s(x).toLowerCase().includes(keyword))
  })
})


const canSubmitDecision = computed(() => {
  return !submitting.value && !!decisionRow.value?._id && ['APPROVED', 'REJECTED'].includes(up(decisionType.value))
})

/* ───────── API ───────── */
async function fetchRows() {
  try {
    loading.value = true
    const { data } = await api.get('/booking-room/room/inbox', {
      params: { scope: scope.value },
    })
    rows.value = Array.isArray(data) ? data : []
  } catch (e) {
    console.error('fetchRows error', e)
    rows.value = []
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to load room inbox.' })
  } finally {
    loading.value = false
  }
}

async function submitDecision() {
  if (!canSubmitDecision.value) return

  try {
    submitting.value = true
    await api.post(`/booking-room/${decisionRow.value._id}/room-decision`, {
      decision: up(decisionType.value),
      note: s(decisionNote.value),
    })

    showToast({ type: 'success', message: `Room request ${up(decisionType.value).toLowerCase()} successfully.` })
    closeDecision()
    await fetchRows()
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
  decisionOpen.value = false
  decisionRow.value = null
  decisionType.value = 'APPROVED'
  decisionNote.value = ''
}

/* ───────── Modal UX: Body Lock & ESC ───────── */
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
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }
  fetchRows()
})

onBeforeUnmount(() => {
  lockBodyScroll(false)
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <div class="ui-page min-h-[calc(100vh-48px)] p-2 sm:p-4">
    
    <div class="mx-auto w-full max-w-7xl space-y-4">
      
      <div class="ui-card overflow-hidden">
        
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">

            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <button type="button" class="ui-hero-btn" @click="refreshAll" :disabled="loading">
                <i :class="loading ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-rotate-right'" class="text-[11px]" />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div class="p-4 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="grid gap-3 grid-cols-1 md:grid-cols-3 lg:grid-cols-4">
            <div class="ui-field">
              <label class="ui-label">Scope</label>
              <select v-model="scope" class="ui-select" @change="fetchRows">
                <!-- Swapped order so ALL is the first option visually too -->
                <option value="ALL">All Requests</option>
                <option value="ACTIONABLE">Actionable (Needs Decision)</option>
              </select>
            </div>
            
            <div class="ui-field lg:col-span-2">
              <label class="ui-label">Search Keyword</label>
              <div class="relative">
                <input v-model="q" type="text" class="ui-input pl-9" placeholder="Employee, title, room..." @keyup.enter="fetchRows" />
                <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400" />
              </div>
            </div>

            <div class="flex items-end gap-2 h-full pt-1">
              <button type="button" class="ui-btn ui-btn-soft w-full" @click="resetSearch(); fetchRows();">Clear</button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div v-if="loading && !rows.length" class="space-y-3">
          <div class="ui-skeleton h-12 w-full" />
          <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-16 w-full" />
        </div>

        <div v-else>
          <div v-if="isMobile" class="space-y-3">
            <div v-if="!filteredRows.length" class="ui-frame p-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
              No room requests found.
            </div>

            <div v-for="row in filteredRows" :key="row._id" class="ui-card p-4 border-l-4" :class="up(row.roomStatus) === 'PENDING' ? 'border-l-sky-500' : 'border-l-transparent'">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[14px] font-black text-slate-900 dark:text-slate-50 break-words">
                    {{ row.meetingTitle || 'No title' }}
                  </div>
                  <div class="mt-1 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                    {{ row.employee?.name || '—' }} • {{ row.employeeId || '—' }}
                  </div>
                </div>
                <span class="ui-badge shrink-0" :class="roomStatusClass(row.roomStatus)">{{ row.roomStatus }}</span>
              </div>

              <div class="my-3 ui-divider" />

              <div class="grid grid-cols-2 gap-3">
                <div class="ui-frame p-3">
                  <div class="ui-label">Booking Date</div>
                  <div class="mt-1 text-[12px] font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(row.bookingDate) }}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}</div>
                </div>
                <div class="ui-frame p-3">
                  <div class="ui-label">Room</div>
                  <div class="mt-1 text-[12px] font-bold text-slate-900 dark:text-slate-50 truncate">{{ row.roomName || '—' }}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ row.roomCode || '—' }}</div>
                </div>
              </div>

              <div class="mt-3 flex flex-col gap-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="ui-badge" :class="overallStatusClass(row.overallStatus)">Overall: {{ row.overallStatus || '—' }}</span>
                  <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="openDetail(row)">
                    <i class="fa-solid fa-eye" /> View Detail
                  </button>
                </div>
                
                <!-- Action Buttons if Pending -->
                <div v-if="up(row.roomStatus) === 'PENDING'" class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button type="button" class="ui-btn ui-btn-primary" @click="openDecision(row, 'APPROVED')">
                    <i class="fa-solid fa-check" /> Approve
                  </button>
                  <button type="button" class="ui-btn ui-btn-rose" @click="openDecision(row, 'REJECTED')">
                    <i class="fa-solid fa-xmark" /> Reject
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="ui-table-wrap ui-scrollbar w-full overflow-x-auto block border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm bg-white dark:bg-slate-900">
            <table class="ui-table min-w-[1000px] w-full text-left">
              <thead>
                <tr>
                  <th class="ui-th w-[130px] text-center">Date & Time</th>
                  <th class="ui-th w-[160px] text-center">Employee</th>
                  <th class="ui-th min-w-[150px] text-center">Meeting Title</th>
                  <th class="ui-th min-w-[150px] text-center">Room & Materials</th>
                  <th class="ui-th text-center w-[110px]">Room Status</th>
                  <th class="ui-th text-center w-[110px]">Overall</th>
                  <th class="ui-th text-center w-[200px]">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!filteredRows.length">
                  <td colspan="7" class="ui-td py-10 text-slate-500 dark:text-slate-400 text-center">
                    No room requests found.
                  </td>
                </tr>

                <tr v-for="row in filteredRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td whitespace-nowrap text-center">
                    <div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(row.bookingDate) }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}</div>
                  </td>
                  <td class="ui-td text-center">
                    <div class="font-bold text-slate-900 dark:text-slate-50 truncate max-w-[150px]">{{ row.employee?.name || '—' }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[150px]">{{ row.employeeId || '—' }} • {{ row.employee?.department || '—' }}</div>
                  </td>
                  <td class="ui-td text-center font-bold text-slate-800 dark:text-slate-100">
                    {{ row.meetingTitle || '—' }}
                  </td>
                  <td class="ui-td text-center">
                    <div class="font-bold text-slate-900 dark:text-slate-50">{{ row.roomName || '—' }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]" :title="materialItemsToText(row.materials)">
                      {{ materialItemsToText(row.materials) || 'No materials' }}
                    </div>
                  </td>
                  <td class="ui-td text-center">
                    <span class="ui-badge" :class="roomStatusClass(row.roomStatus)">{{ row.roomStatus || '—' }}</span>
                  </td>
                  <td class="ui-td text-center">
                    <span class="ui-badge" :class="overallStatusClass(row.overallStatus)">{{ row.overallStatus || '—' }}</span>
                  </td>
                  <td class="ui-td text-right pr-4">
                    <div class="flex items-center justify-end gap-2">
                      <button type="button" class="ui-btn ui-btn-soft ui-btn-xs" @click="openDetail(row)" title="View Detail">
                        <i class="fa-solid fa-eye" />
                      </button>

                      <template v-if="up(row.roomStatus) === 'PENDING'">
                        <button type="button" class="ui-btn ui-btn-primary ui-btn-xs" @click="openDecision(row, 'APPROVED')" title="Approve">
                          <i class="fa-solid fa-check" />
                        </button>
                        <button type="button" class="ui-btn ui-btn-rose ui-btn-xs" @click="openDecision(row, 'REJECTED')" title="Reject">
                          <i class="fa-solid fa-xmark" />
                        </button>
                      </template>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>

    <!-- ✅ Detail Modal -->
    <div v-if="detailOpen && detailRow" class="ui-modal-backdrop" @click.self="closeDetail">
      <div class="ui-modal !max-w-4xl p-0 overflow-hidden">
        
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Room Request Detail</div>
            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ detailRow.meetingTitle || 'No title' }}</div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-sm shrink-0" type="button" @click="closeDetail">
            <i class="fa-solid fa-xmark text-[12px]" /> Close
          </button>
        </div>

        <div class="p-5 space-y-4 max-h-[75vh] overflow-y-auto ui-scrollbar">
          
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="ui-frame p-4">
              <div class="ui-section-title mb-3">Requester Information</div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Name</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employee?.name) }}</div></div>
                <div class="ui-field"><div class="ui-label">Employee ID</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employeeId) }}</div></div>
                <div class="ui-field"><div class="ui-label">Department</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employee?.department) }}</div></div>
                <div class="ui-field"><div class="ui-label">Contact</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employee?.contactNumber) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Submitted Via</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.submittedVia) }}</div></div>
              </div>
            </div>

            <div class="ui-frame p-4">
              <div class="ui-section-title mb-3">Booking Information</div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Date</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(detailRow.bookingDate) }}</div></div>
                <div class="ui-field"><div class="ui-label">Time</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtTime(detailRow.timeStart) }} - {{ fmtTime(detailRow.timeEnd) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Purpose</div><div class="font-bold text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{{ cleanText(detailRow.purpose) }}</div></div>
                <div class="ui-field"><div class="ui-label">Participants</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ detailRow.participantEstimate ?? '—' }}</div></div>
                <div class="ui-field"><div class="ui-label">Created At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.createdAt) }}</div></div>
              </div>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <div class="ui-frame p-4">
              <div class="flex items-center justify-between mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div class="ui-section-title">Room Details</div>
                <span class="ui-badge" :class="roomStatusClass(detailRow.roomStatus)">{{ detailRow.roomStatus || '—' }}</span>
              </div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Required</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ detailRow.roomRequired ? 'YES' : 'NO' }}</div></div>
                <div class="ui-field"><div class="ui-label">Room Code</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.roomCode) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Room Name</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.roomName) }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision By</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.roomApproval?.byName || detailRow.roomApproval?.byLoginId) }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.roomApproval?.decidedAt) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Note</div><div class="font-bold text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{{ cleanText(detailRow.roomApproval?.note) }}</div></div>
              </div>
            </div>

            <div class="ui-frame p-4">
              <div class="flex items-center justify-between mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div class="ui-section-title">Material Details</div>
                <span class="ui-badge" :class="overallStatusClass(detailRow.materialStatus)">{{ detailRow.materialStatus || '—' }}</span>
              </div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Required</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ detailRow.materialRequired ? 'YES' : 'NO' }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.materialApproval?.decision) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Materials</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ materialItemsToText(detailRow.materials) || '—' }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision By</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId) }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.materialApproval?.decidedAt) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Note</div><div class="font-bold text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{{ cleanText(detailRow.materialApproval?.note) }}</div></div>
              </div>
            </div>
          </div>

          <div class="ui-frame p-4 border-l-4" :class="up(detailRow.roomStatus) === 'PENDING' ? 'border-l-sky-500' : 'border-l-slate-300'">
             <div class="flex items-center justify-between mb-3">
                <div class="ui-section-title">Final Request Status</div>
                <span class="ui-badge" :class="overallStatusClass(detailRow.overallStatus)">{{ detailRow.overallStatus || '—' }}</span>
             </div>
             <div class="grid grid-cols-3 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Updated At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.updatedAt) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Cancel Reason</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.cancelReason) }}</div></div>
             </div>
          </div>

        </div>

        <div class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-soft" @click="closeDetail">
            <i class="fa-solid fa-xmark" /> Close
          </button>
          
          <button
            v-if="up(detailRow.roomStatus) === 'PENDING'"
            type="button"
            class="ui-btn ui-btn-primary"
            @click="openDecision(detailRow, 'APPROVED')"
          >
            <i class="fa-solid fa-check" /> Approve Room
          </button>

          <button
            v-if="up(detailRow.roomStatus) === 'PENDING'"
            type="button"
            class="ui-btn ui-btn-rose"
            @click="openDecision(detailRow, 'REJECTED')"
          >
            <i class="fa-solid fa-xmark" /> Reject Room
          </button>
        </div>
      </div>
    </div>

    <!-- ✅ Decision Modal -->
    <div v-if="decisionOpen && decisionRow" class="ui-modal-backdrop" @click.self="closeDecision">
      <div class="ui-modal !max-w-xl p-0 overflow-hidden">
        
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white" :class="decisionType === 'REJECTED' ? 'bg-rose-500 shadow-rose-500/30' : 'bg-emerald-500 shadow-emerald-500/30'">
              <i :class="decisionType === 'REJECTED' ? 'fa-solid fa-xmark' : 'fa-solid fa-check'" class="text-lg" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                {{ decisionType === 'REJECTED' ? 'Reject Room Request' : 'Approve Room Request' }}
              </div>
              <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {{ decisionRow.meetingTitle || 'No title' }}
              </div>
            </div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-sm shrink-0" type="button" @click="closeDecision">
            <i class="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>

        <div class="p-5 space-y-4">
          
          <div class="ui-frame p-4">
            <div class="grid gap-4 sm:grid-cols-2 text-[12px]">
              <div class="ui-field">
                <div class="ui-label">Employee</div>
                <div class="font-bold text-slate-900 dark:text-slate-50">{{ decisionRow.employee?.name || '—' }} ({{ decisionRow.employeeId || '—' }})</div>
              </div>
              <div class="ui-field">
                <div class="ui-label">Booking Schedule</div>
                <div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(decisionRow.bookingDate) }} • {{ fmtTime(decisionRow.timeStart) }} - {{ fmtTime(decisionRow.timeEnd) }}</div>
              </div>
              <div class="ui-field">
                <div class="ui-label">Room Requested</div>
                <div class="font-bold text-slate-900 dark:text-slate-50">{{ decisionRow.roomName || '—' }} ({{ decisionRow.roomCode || '—' }})</div>
              </div>
              <div class="ui-field">
                <div class="ui-label">Current Status</div>
                <div>
                  <span class="ui-badge" :class="roomStatusClass(decisionRow.roomStatus)">
                    {{ decisionRow.roomStatus || '—' }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="ui-field">
              <label class="ui-label">Your Decision</label>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="ui-chip"
                  :class="decisionType === 'APPROVED' ? 'ui-chip-on !border-emerald-500/50 !bg-emerald-500/10 !text-emerald-600' : ''"
                  @click="decisionType = 'APPROVED'"
                >
                  <i class="fa-solid fa-check" /> Approve
                </button>

                <button
                  type="button"
                  class="ui-chip"
                  :class="decisionType === 'REJECTED' ? 'ui-chip-on !border-rose-500/50 !bg-rose-500/10 !text-rose-600' : ''"
                  @click="decisionType = 'REJECTED'"
                >
                  <i class="fa-solid fa-xmark" /> Reject
                </button>
              </div>
            </div>

            <div class="ui-field">
              <label class="ui-label">Decision Note (Optional)</label>
              <textarea
                v-model="decisionNote"
                rows="3"
                class="ui-textarea"
                placeholder="Add any remarks for the requester..."
              />
            </div>
          </div>
        </div>

        <div class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex items-center justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-soft" @click="closeDecision" :disabled="submitting">
            Cancel
          </button>
          <button
            type="button"
            class="ui-btn"
            :class="decisionType === 'REJECTED' ? 'ui-btn-rose' : 'ui-btn-primary'"
            @click="submitDecision"
            :disabled="!canSubmitDecision"
          >
            <i :class="submitting ? 'fa-solid fa-spinner animate-spin' : decisionType === 'REJECTED' ? 'fa-solid fa-xmark' : 'fa-solid fa-check'" />
            {{ decisionType === 'REJECTED' ? 'Confirm Reject' : 'Confirm Approve' }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
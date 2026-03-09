<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

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
function materialItemsToText(items = []) {
  return arr(items)
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const qty = num(x?.qty, 0)
      return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
}
function statusClass(status) {
  const val = up(status)
  if (val === 'APPROVED') {
    return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/50'
  }
  if (val === 'REJECTED') {
    return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/50'
  }
  if (val === 'PENDING') {
    return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50'
  }
  if (val === 'PARTIAL_APPROVED') {
    return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800/50'
  }
  if (val === 'NOT_REQUIRED') {
    return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }
  if (val === 'CANCELLED') {
    return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600'
  }
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
}

/* ───────────────── State ───────────────── */
const loading = ref(false)
const acting = ref(false)

const rows = ref([])
const search = ref('')
const scope = ref('ACTIONABLE') // ACTIONABLE | ALL

const detailOpen = ref(false)
const detailRow = ref(null)

const decisionOpen = ref(false)
const decisionMode = ref('APPROVED') // APPROVED | REJECTED
const decisionRow = ref(null)
const decisionNote = ref('')

/* ───────────────── Computed ───────────────── */
const filteredRows = computed(() => {
  const term = s(search.value).toLowerCase()

  return arr(rows.value).filter((row) => {
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

const canActOnDecision = computed(() => up(decisionMode.value) === 'APPROVED' || up(decisionMode.value) === 'REJECTED')

/* ───────────────── API ───────────────── */
async function loadRows() {
  try {
    loading.value = true
    const { data } = await api.get('/booking-room/material/inbox', {
      params: { scope: scope.value },
    })
    rows.value = arr(data)
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Load failed',
      message: e?.response?.data?.message || 'Failed to load material inbox.',
    })
  } finally {
    loading.value = false
  }
}

async function submitDecision() {
  if (!decisionRow.value?._id || !canActOnDecision.value) return

  try {
    acting.value = true

    await api.post(`/booking-room/${decisionRow.value._id}/material-decision`, {
      decision: decisionMode.value,
      note: s(decisionNote.value),
    })

    showToast({
      type: 'success',
      title: 'Decision saved',
      message:
        up(decisionMode.value) === 'APPROVED'
          ? 'Material request approved successfully.'
          : 'Material request rejected successfully.',
    })

    decisionOpen.value = false
    decisionRow.value = null
    decisionNote.value = ''

    await loadRows()
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

/* ───────────────── Lifecycle ───────────────── */
onMounted(loadRows)
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div class="text-[11px] font-extrabold uppercase tracking-[0.24em] text-white/80">
                Booking Room Admin
              </div>
              <div class="mt-1 text-sm font-extrabold text-white sm:text-base">
                Material Inbox
              </div>
              <div class="mt-1 text-[12px] text-white/80">
                Review and decide material requests for meeting room bookings.
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button
                class="ui-btn ui-btn-soft border-white/25 bg-white/10 text-white"
                type="button"
                :disabled="loading"
                @click="loadRows"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div class="space-y-3 p-3">
          <!-- Summary -->
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-800/60 dark:bg-amber-950/20">
              <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                Pending
              </div>
              <div class="mt-2 text-2xl font-extrabold text-amber-700 dark:text-amber-300">
                {{ pendingCount }}
              </div>
            </div>

            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/20">
              <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                Approved
              </div>
              <div class="mt-2 text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
                {{ approvedCount }}
              </div>
            </div>

            <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm dark:border-rose-800/60 dark:bg-rose-950/20">
              <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">
                Rejected
              </div>
              <div class="mt-2 text-2xl font-extrabold text-rose-700 dark:text-rose-300">
                {{ rejectedCount }}
              </div>
            </div>
          </div>

          <!-- Filters -->
          <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div class="grid gap-3 lg:grid-cols-12">
              <div class="lg:col-span-8">
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Search
                </label>
                <div class="relative">
                  <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <i class="fa-solid fa-magnifying-glass text-[12px]" />
                  </span>
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Search requester, meeting, room, material..."
                    class="block w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-[13px]
                           text-slate-900 shadow-sm outline-none transition
                           focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                           dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                  />
                </div>
              </div>

              <div class="lg:col-span-4">
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Scope
                </label>
                <select
                  v-model="scope"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                         text-slate-900 shadow-sm outline-none transition
                         focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                         dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                  @change="loadRows"
                >
                  <option value="ACTIONABLE">Actionable</option>
                  <option value="ALL">All</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Mobile -->
          <div class="grid gap-3 xl:hidden">
            <div
              v-if="loading"
              class="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            >
              <i class="fa-solid fa-spinner animate-spin mr-2" />
              Loading inbox...
            </div>

            <div
              v-else-if="!filteredRows.length"
              class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            >
              No material requests found.
            </div>

            <div
              v-for="row in filteredRows"
              :key="row._id"
              class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-extrabold text-slate-900 dark:text-slate-100">
                    {{ row.meetingTitle || '—' }}
                  </div>
                  <div class="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                    {{ row.employee?.name || row.employeeId || '—' }}
                  </div>
                </div>

                <span
                  class="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold"
                  :class="statusClass(row.materialStatus)"
                >
                  {{ row.materialStatus || '—' }}
                </span>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <div class="font-bold text-slate-500 dark:text-slate-400">Date</div>
                  <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {{ fmtDate(row.bookingDate) }}
                  </div>
                </div>

                <div>
                  <div class="font-bold text-slate-500 dark:text-slate-400">Time</div>
                  <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}
                  </div>
                </div>

                <div class="col-span-2">
                  <div class="font-bold text-slate-500 dark:text-slate-400">Materials</div>
                  <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {{ materialItemsToText(row.materials) || '—' }}
                  </div>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  @click="openDetail(row)"
                >
                  <i class="fa-solid fa-eye" />
                  View
                </button>

                <button
                  v-if="up(row.materialStatus) === 'PENDING'"
                  type="button"
                  class="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300"
                  @click="openDecision(row, 'APPROVED')"
                >
                  <i class="fa-solid fa-check" />
                  Approve
                </button>

                <button
                  v-if="up(row.materialStatus) === 'PENDING'"
                  type="button"
                  class="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-300"
                  @click="openDecision(row, 'REJECTED')"
                >
                  <i class="fa-solid fa-xmark" />
                  Reject
                </button>
              </div>
            </div>
          </div>

          <!-- Desktop -->
          <div class="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:block">
            <div v-if="loading" class="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <i class="fa-solid fa-spinner animate-spin mr-2" />
              Loading inbox...
            </div>

            <template v-else>
              <div v-if="!filteredRows.length" class="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No material requests found.
              </div>

              <div v-else class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-slate-50 dark:bg-slate-800/70">
                    <tr class="text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      <th class="px-4 py-3">Date</th>
                      <th class="px-4 py-3">Time</th>
                      <th class="px-4 py-3">Requester</th>
                      <th class="px-4 py-3">Meeting</th>
                      <th class="px-4 py-3">Materials</th>
                      <th class="px-4 py-3">Material Status</th>
                      <th class="px-4 py-3">Overall</th>
                      <th class="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr
                      v-for="row in filteredRows"
                      :key="row._id"
                      class="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        {{ fmtDate(row.bookingDate) }}
                      </td>

                      <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                        {{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}
                      </td>

                      <td class="px-4 py-3">
                        <div class="font-semibold text-slate-900 dark:text-slate-100">
                          {{ row.employee?.name || row.employeeId || '—' }}
                        </div>
                        <div class="text-[12px] text-slate-500 dark:text-slate-400">
                          {{ row.employeeId || '—' }}
                        </div>
                      </td>

                      <td class="px-4 py-3">
                        <div class="font-semibold text-slate-900 dark:text-slate-100">
                          {{ row.meetingTitle || '—' }}
                        </div>
                        <div class="text-[12px] text-slate-500 dark:text-slate-400">
                          {{ row.roomName || row.roomCode || '—' }}
                        </div>
                      </td>

                      <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                        {{ materialItemsToText(row.materials) || '—' }}
                      </td>

                      <td class="px-4 py-3">
                        <span
                          class="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold"
                          :class="statusClass(row.materialStatus)"
                        >
                          {{ row.materialStatus || '—' }}
                        </span>
                      </td>

                      <td class="px-4 py-3">
                        <span
                          class="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold"
                          :class="statusClass(row.overallStatus)"
                        >
                          {{ row.overallStatus || '—' }}
                        </span>
                      </td>

                      <td class="px-4 py-3">
                        <div class="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            @click="openDetail(row)"
                          >
                            <i class="fa-solid fa-eye" />
                            View
                          </button>

                          <button
                            v-if="up(row.materialStatus) === 'PENDING'"
                            type="button"
                            class="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300"
                            @click="openDecision(row, 'APPROVED')"
                          >
                            <i class="fa-solid fa-check" />
                            Approve
                          </button>

                          <button
                            v-if="up(row.materialStatus) === 'PENDING'"
                            type="button"
                            class="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-300"
                            @click="openDecision(row, 'REJECTED')"
                          >
                            <i class="fa-solid fa-xmark" />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Modal -->
    <teleport to="body">
      <div
        v-if="detailOpen && detailRow"
        class="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 p-4"
        @click.self="closeDetail"
      >
        <div class="w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div class="bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-5 py-4 text-white">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Material Request Detail
                </div>
                <div class="mt-1 text-base font-extrabold">
                  {{ detailRow.meetingTitle || 'Booking Detail' }}
                </div>
              </div>

              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
                @click="closeDetail"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>
          </div>

          <div class="space-y-4 p-5">
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Requester</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                  {{ detailRow.employee?.name || '—' }}
                </div>
                <div class="text-[12px] text-slate-500 dark:text-slate-400">
                  {{ detailRow.employeeId || '—' }}
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Date</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                  {{ fmtDate(detailRow.bookingDate) }}
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Time</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                  {{ fmtTime(detailRow.timeStart) }} - {{ fmtTime(detailRow.timeEnd) }}
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Participants</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                  {{ detailRow.participantEstimate || 1 }}
                </div>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-2">
              <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Meeting Title</div>
                <div class="mt-2 font-semibold text-slate-900 dark:text-slate-100">
                  {{ detailRow.meetingTitle || '—' }}
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Room</div>
                <div class="mt-2 font-semibold text-slate-900 dark:text-slate-100">
                  {{ detailRow.roomName || detailRow.roomCode || '—' }}
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Purpose</div>
                <div class="mt-2 text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                  {{ detailRow.purpose || '—' }}
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Requirement Note</div>
                <div class="mt-2 text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                  {{ detailRow.requirementNote || '—' }}
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Material Items
                </div>

                <span
                  class="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold"
                  :class="statusClass(detailRow.materialStatus)"
                >
                  {{ detailRow.materialStatus || '—' }}
                </span>
              </div>

              <div
                v-if="!arr(detailRow.materials).length"
                class="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              >
                No materials requested.
              </div>

              <div v-else class="overflow-x-auto">
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
              class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
            >
              <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Decision Info
              </div>
              <div class="mt-2 grid gap-3 md:grid-cols-2">
                <div>
                  <div class="text-[12px] text-slate-500 dark:text-slate-400">Decision By</div>
                  <div class="font-semibold text-slate-900 dark:text-slate-100">
                    {{ detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId || '—' }}
                  </div>
                </div>
                <div>
                  <div class="text-[12px] text-slate-500 dark:text-slate-400">Decided At</div>
                  <div class="font-semibold text-slate-900 dark:text-slate-100">
                    {{ fmtDateTime(detailRow.materialApproval?.decidedAt) }}
                  </div>
                </div>
                <div class="md:col-span-2">
                  <div class="text-[12px] text-slate-500 dark:text-slate-400">Note</div>
                  <div class="font-semibold text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
                    {{ detailRow.materialApproval?.note || '—' }}
                  </div>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                class="ui-btn ui-btn-soft"
                @click="closeDetail"
              >
                Close
              </button>

              <button
                v-if="up(detailRow.materialStatus) === 'PENDING'"
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl border border-emerald-500 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
                @click="openDecision(detailRow, 'APPROVED')"
              >
                <i class="fa-solid fa-check" />
                Approve
              </button>

              <button
                v-if="up(detailRow.materialStatus) === 'PENDING'"
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl border border-rose-500 bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600"
                @click="openDecision(detailRow, 'REJECTED')"
              >
                <i class="fa-solid fa-xmark" />
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    </teleport>

    <!-- Decision Modal -->
    <teleport to="body">
      <div
        v-if="decisionOpen && decisionRow"
        class="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/50 p-4"
        @click.self="closeDecision"
      >
        <div class="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div
            class="px-5 py-4 text-white"
            :class="up(decisionMode) === 'APPROVED'
              ? 'bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-400'
              : 'bg-gradient-to-r from-rose-700 via-rose-500 to-pink-400'"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Material Decision
                </div>
                <div class="mt-1 text-base font-extrabold">
                  {{ up(decisionMode) === 'APPROVED' ? 'Approve Request' : 'Reject Request' }}
                </div>
              </div>

              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
                :disabled="acting"
                @click="closeDecision"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>
          </div>

          <div class="space-y-4 p-5">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
              <div class="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Request Summary
              </div>
              <div class="mt-2 space-y-1 text-sm">
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Requester:</span> <span class="text-slate-900 dark:text-slate-100">{{ decisionRow.employee?.name || decisionRow.employeeId || '—' }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Meeting:</span> <span class="text-slate-900 dark:text-slate-100">{{ decisionRow.meetingTitle || '—' }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Date:</span> <span class="text-slate-900 dark:text-slate-100">{{ fmtDate(decisionRow.bookingDate) }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Time:</span> <span class="text-slate-900 dark:text-slate-100">{{ fmtTime(decisionRow.timeStart) }} - {{ fmtTime(decisionRow.timeEnd) }}</span></div>
                <div><span class="font-semibold text-slate-700 dark:text-slate-200">Materials:</span> <span class="text-slate-900 dark:text-slate-100">{{ materialItemsToText(decisionRow.materials) || '—' }}</span></div>
              </div>
            </div>

            <div>
              <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Note
              </label>
              <textarea
                v-model="decisionNote"
                rows="4"
                :placeholder="up(decisionMode) === 'APPROVED' ? 'Optional note...' : 'Reason for rejection...'"
                class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px]
                       text-slate-900 shadow-sm outline-none transition
                       focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                       dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
              />
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                class="ui-btn ui-btn-soft"
                :disabled="acting"
                @click="closeDecision"
              >
                Cancel
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                :class="up(decisionMode) === 'APPROVED'
                  ? 'border border-emerald-500 bg-emerald-500 hover:bg-emerald-600'
                  : 'border border-rose-500 bg-rose-500 hover:bg-rose-600'"
                :disabled="acting"
                @click="submitDecision"
              >
                <i v-if="acting" class="fa-solid fa-spinner animate-spin text-[11px]" />
                {{ up(decisionMode) === 'APPROVED' ? 'Approve Request' : 'Reject Request' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>
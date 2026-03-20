<script setup>
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'

defineOptions({ name: 'ContractReminderList' })

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  reminders: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'close',
  'refresh',
  'open-profile',
  'renew',
])

const query = ref('')
const urgency = ref('ALL')
const stageFilter = ref('ALL')
const sortBy = ref('URGENT')

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v))
}

function nextDayYMD(ymd) {
  const raw = s(ymd)
  if (!isValidYMD(raw)) return ''
  const [y, m, d] = raw.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function fmtDate(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}

function daysLeftLabel(daysLeft) {
  const n = num(daysLeft, 0)
  if (n < 0) return `${Math.abs(n)} days overdue`
  if (n === 0) return 'Ends today'
  if (n === 1) return '1 day left'
  return `${n} days left`
}

function stageLabel(stage) {
  const n = num(stage, 0)
  if (!n) return '—'
  return `${n}-day reminder`
}

function urgencyKey(daysLeft) {
  const n = num(daysLeft, 9999)
  if (n < 0) return 'OVERDUE'
  if (n <= 1) return 'CRITICAL'
  if (n <= 7) return 'URGENT'
  if (n <= 14) return 'WARNING'
  return 'UPCOMING'
}

function urgencyRank(daysLeft) {
  const key = urgencyKey(daysLeft)
  if (key === 'OVERDUE') return 0
  if (key === 'CRITICAL') return 1
  if (key === 'URGENT') return 2
  if (key === 'WARNING') return 3
  return 4
}

function urgencyBadgeClass(daysLeft) {
  const key = urgencyKey(daysLeft)
  if (key === 'OVERDUE') {
    return 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-700/60'
  }
  if (key === 'CRITICAL') {
    return 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-700/60'
  }
  if (key === 'URGENT') {
    return 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700/60'
  }
  if (key === 'WARNING') {
    return 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-700/60'
  }
  return 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-700/60'
}

const normalizedRows = computed(() => {
  return (Array.isArray(props.reminders) ? props.reminders : []).map((item, index) => {
    const endDate = s(item?.endDate || item?.contractEndDate || item?.to)
    const currentContractEndDate = s(item?.currentContractEndDate || endDate)

    return {
      ...item,
      _idx: index,
      employeeId: s(item?.employeeId),
      name: s(item?.name || item?.employeeName),
      employeeName: s(item?.employeeName || item?.name),
      department: s(item?.department),
      managerLoginId: s(item?.managerLoginId),
      contractNo: num(item?.contractNo),
      startDate: s(item?.startDate),
      endDate,
      currentContractEndDate,
      newContractDate: s(item?.newContractDate) || nextDayYMD(currentContractEndDate),
      daysLeft: num(item?.daysLeft, 0),
      reminderType: up(item?.reminderType),
      reminderStage: num(item?.reminderStage || item?.stage || item?.triggerDays, 0),
      urgencyKey: urgencyKey(item?.daysLeft),
      urgencyRank: urgencyRank(item?.daysLeft),
    }
  })
})

const filteredRows = computed(() => {
  const q = s(query.value).toLowerCase()

  let rows = normalizedRows.value.filter((row) => {
    const matchUrgency = urgency.value === 'ALL' ? true : row.urgencyKey === urgency.value
    const matchStage =
      stageFilter.value === 'ALL' ? true : num(row.reminderStage) === num(stageFilter.value)

    const haystack = [
      row.employeeId,
      row.name,
      row.employeeName,
      row.department,
      row.managerLoginId,
      row.contractNo,
      row.startDate,
      row.endDate,
      row.currentContractEndDate,
      row.newContractDate,
      row.reminderType,
      row.urgencyKey,
      row.reminderStage,
    ]
      .join(' ')
      .toLowerCase()

    const matchQuery = !q || haystack.includes(q)
    return matchUrgency && matchStage && matchQuery
  })

  rows = rows.slice().sort((a, b) => {
    if (sortBy.value === 'END_DATE') {
      return s(a.endDate).localeCompare(s(b.endDate)) || a.employeeId.localeCompare(b.employeeId)
    }

    if (sortBy.value === 'NAME') {
      return s(a.name).localeCompare(s(b.name)) || a.employeeId.localeCompare(b.employeeId)
    }

    if (sortBy.value === 'STAGE') {
      return (
        num(a.reminderStage, 9999) - num(b.reminderStage, 9999) ||
        a.daysLeft - b.daysLeft ||
        s(a.endDate).localeCompare(s(b.endDate)) ||
        a.employeeId.localeCompare(b.employeeId)
      )
    }

    return (
      a.urgencyRank - b.urgencyRank ||
      a.daysLeft - b.daysLeft ||
      num(a.reminderStage, 9999) - num(b.reminderStage, 9999) ||
      s(a.endDate).localeCompare(s(b.endDate)) ||
      a.employeeId.localeCompare(b.employeeId)
    )
  })

  return rows
})

const totalCount = computed(() => normalizedRows.value.length)
const overdueCount = computed(() => normalizedRows.value.filter((x) => x.urgencyKey === 'OVERDUE').length)
const urgentCount = computed(() =>
  normalizedRows.value.filter((x) => x.urgencyKey === 'CRITICAL' || x.urgencyKey === 'URGENT').length
)

function resetFilters() {
  query.value = ''
  urgency.value = 'ALL'
  stageFilter.value = 'ALL'
  sortBy.value = 'URGENT'
}

function handleClose() {
  emit('close')
}

function openProfile(row) {
  emit('open-profile', row)
}

function renew(row) {
  emit('renew', row)
}

watch(
  () => props.open,
  (v) => {
    if (!v) resetFilters()
  }
)
</script>

<template>
  <transition name="modal-fade">
    <div v-if="open" class="ui-modal-backdrop" @click.self="handleClose">
      <div class="ui-modal max-h-[calc(100vh-2rem)] w-full max-w-5xl flex flex-col overflow-hidden">
        <div class="ui-hero rounded-b-none px-4 py-3 sm:px-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-[15px] font-extrabold text-ui-fg">Contract reminders</div>

                <span
                  class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold
                         bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200
                         dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700/60"
                >
                  {{ totalCount }} total
                </span>

                <span
                  v-if="urgentCount > 0"
                  class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold
                         bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200
                         dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-700/60"
                >
                  {{ urgentCount }} urgent
                </span>

                <span
                  v-if="overdueCount > 0"
                  class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold
                         bg-red-100 text-red-800 ring-1 ring-inset ring-red-200
                         dark:bg-red-950/40 dark:text-red-200 dark:ring-red-700/60"
                >
                  {{ overdueCount }} overdue
                </span>
              </div>

              <div class="mt-1 text-[11px] text-ui-muted">
                Review expiring contracts and take action directly from this list.
              </div>
            </div>

            <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="handleClose">
              <i class="fa-solid fa-xmark text-xs" />
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-4 sm:px-5 space-y-4">
          <section class="grid grid-cols-1 gap-3 xl:grid-cols-[1.3fr_0.9fr_0.9fr_0.9fr_auto]">
            <div class="ui-card !rounded-2xl px-3 py-3">
              <div class="ui-label">Search</div>
              <div class="mt-1 relative">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ui-muted">
                  <i class="fa-solid fa-magnifying-glass text-[11px]" />
                </span>
                <input
                  v-model="query"
                  type="text"
                  class="ui-input w-full pl-9"
                  placeholder="Search employee, department, manager, date..."
                />
              </div>
            </div>

            <div class="ui-card !rounded-2xl px-3 py-3">
              <div class="ui-label">Urgency</div>
              <select v-model="urgency" class="ui-select mt-1 w-full">
                <option value="ALL">All</option>
                <option value="OVERDUE">Overdue</option>
                <option value="CRITICAL">Critical</option>
                <option value="URGENT">Urgent</option>
                <option value="WARNING">Warning</option>
                <option value="UPCOMING">Upcoming</option>
              </select>
            </div>

            <div class="ui-card !rounded-2xl px-3 py-3">
              <div class="ui-label">Reminder stage</div>
              <select v-model="stageFilter" class="ui-select mt-1 w-full">
                <option value="ALL">All</option>
                <option value="30">30 days</option>
                <option value="14">14 days</option>
                <option value="7">7 days</option>
                <option value="1">1 day</option>
              </select>
            </div>

            <div class="ui-card !rounded-2xl px-3 py-3">
              <div class="ui-label">Sort by</div>
              <select v-model="sortBy" class="ui-select mt-1 w-full">
                <option value="URGENT">Urgency</option>
                <option value="END_DATE">End date</option>
                <option value="NAME">Name</option>
                <option value="STAGE">Reminder stage</option>
              </select>
            </div>

            <div class="flex items-end gap-2">
              <button type="button" class="ui-btn ui-btn-ghost w-full lg:w-auto" @click="resetFilters">
                <i class="fa-solid fa-filter-circle-xmark text-[11px]" />
                Reset
              </button>

              <button type="button" class="ui-btn ui-btn-primary w-full lg:w-auto" @click="$emit('refresh')">
                <i class="fa-solid" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'" />
                Refresh
              </button>
            </div>
          </section>

          <section class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="ui-card !rounded-2xl px-4 py-3">
              <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">Total reminders</div>
              <div class="mt-1 text-[22px] font-black text-ui-fg">{{ totalCount }}</div>
            </div>

            <div class="ui-card !rounded-2xl px-4 py-3">
              <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">Urgent</div>
              <div class="mt-1 text-[22px] font-black text-ui-fg">{{ urgentCount }}</div>
            </div>

            <div class="ui-card !rounded-2xl px-4 py-3">
              <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">Overdue</div>
              <div class="mt-1 text-[22px] font-black text-ui-fg">{{ overdueCount }}</div>
            </div>
          </section>

          <!-- mobile cards -->
          <section class="space-y-3 lg:hidden">
            <div v-if="loading" class="space-y-3">
              <div v-for="n in 4" :key="n" class="ui-card !rounded-2xl p-4">
                <div class="h-4 w-32 animate-pulse rounded bg-ui-bg-2/80" />
                <div class="mt-3 h-3 w-48 animate-pulse rounded bg-ui-bg-2/80" />
                <div class="mt-2 h-3 w-28 animate-pulse rounded bg-ui-bg-2/80" />
                <div class="mt-4 h-9 w-full animate-pulse rounded-xl bg-ui-bg-2/80" />
              </div>
            </div>

            <template v-else>
              <article
                v-for="row in filteredRows"
                :key="`${row.employeeId}-${row.contractNo}-${row.endDate}`"
                class="ui-card !rounded-2xl p-4"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-[13px] font-extrabold text-ui-fg">
                      {{ row.name || row.employeeId || '—' }}
                    </div>
                    <div class="mt-0.5 text-[11px] text-ui-muted">
                      {{ row.employeeId || '—' }}
                      <span v-if="row.department"> · {{ row.department }}</span>
                    </div>
                    <div class="mt-1 text-[11px] text-ui-muted">
                      {{ stageLabel(row.reminderStage) }}
                    </div>
                  </div>

                  <span
                    class="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold"
                    :class="urgencyBadgeClass(row.daysLeft)"
                  >
                    {{ daysLeftLabel(row.daysLeft) }}
                  </span>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="rounded-xl bg-ui-bg-2/70 px-3 py-2">
                    <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">Contract</div>
                    <div class="mt-1 font-mono font-semibold text-ui-fg">#{{ row.contractNo || '—' }}</div>
                  </div>

                  <div class="rounded-xl bg-ui-bg-2/70 px-3 py-2">
                    <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">End date</div>
                    <div class="mt-1 font-mono font-semibold text-ui-fg">{{ fmtDate(row.endDate) }}</div>
                  </div>

                  <div class="rounded-xl bg-ui-bg-2/70 px-3 py-2 col-span-2">
                    <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">Manager</div>
                    <div class="mt-1 font-mono font-semibold text-ui-fg">
                      {{ row.managerLoginId || '—' }}
                    </div>
                  </div>
                </div>

                <div class="mt-3 flex items-center gap-2">
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm flex-1" @click="openProfile(row)">
                    <i class="fa-solid fa-up-right-from-square text-[11px]" />
                    Open profile
                  </button>

                  <button type="button" class="ui-btn ui-btn-primary ui-btn-sm flex-1" @click="renew(row)">
                    <i class="fa-solid fa-arrows-rotate text-[11px]" />
                    Renew
                  </button>
                </div>
              </article>

              <div
                v-if="!filteredRows.length"
                class="ui-card !rounded-2xl border border-dashed border-ui-border/70 px-4 py-8 text-center text-[12px] text-ui-muted"
              >
                No reminders found for current filters.
              </div>
            </template>
          </section>

          <!-- desktop table -->
          <section class="hidden lg:block">
            <div class="overflow-hidden rounded-2xl border border-ui-border/70 bg-white/80 dark:bg-slate-950/40">
              <div class="overflow-x-auto ui-scrollbar">
                <table class="w-full min-w-[1100px] text-[12px]">
                  <thead class="bg-ui-bg-2/70">
                    <tr class="text-left text-ui-muted">
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Employee</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Department</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Manager</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Contract</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">End date</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Stage</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Countdown</th>
                      <th class="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.18em]">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-if="loading" v-for="n in 5" :key="`sk-${n}`" class="border-t border-ui-border/60">
                      <td class="px-4 py-3" colspan="8">
                        <div class="h-5 animate-pulse rounded bg-ui-bg-2/80" />
                      </td>
                    </tr>

                    <tr
                      v-else
                      v-for="row in filteredRows"
                      :key="`${row.employeeId}-${row.contractNo}-${row.endDate}`"
                      class="border-t border-ui-border/60 hover:bg-ui-bg-2/40"
                    >
                      <td class="px-4 py-3 align-middle">
                        <div class="font-extrabold text-ui-fg">{{ row.name || row.employeeId || '—' }}</div>
                        <div class="mt-0.5 text-[11px] text-ui-muted">{{ row.employeeId || '—' }}</div>
                      </td>

                      <td class="px-4 py-3 align-middle text-ui-fg">
                        {{ row.department || '—' }}
                      </td>

                      <td class="px-4 py-3 align-middle font-mono text-ui-fg">
                        {{ row.managerLoginId || '—' }}
                      </td>

                      <td class="px-4 py-3 align-middle">
                        <span class="font-mono font-semibold text-ui-fg">#{{ row.contractNo || '—' }}</span>
                      </td>

                      <td class="px-4 py-3 align-middle font-mono text-ui-fg">
                        {{ fmtDate(row.endDate) }}
                      </td>

                      <td class="px-4 py-3 align-middle text-ui-fg">
                        {{ stageLabel(row.reminderStage) }}
                      </td>

                      <td class="px-4 py-3 align-middle">
                        <span
                          class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                          :class="urgencyBadgeClass(row.daysLeft)"
                        >
                          {{ daysLeftLabel(row.daysLeft) }}
                        </span>
                      </td>

                      <td class="px-4 py-3 align-middle">
                        <div class="flex items-center gap-2">
                          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="openProfile(row)">
                            <i class="fa-solid fa-up-right-from-square text-[11px]" />
                            Open profile
                          </button>

                          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="renew(row)">
                            <i class="fa-solid fa-arrows-rotate text-[11px]" />
                            Renew
                          </button>
                        </div>
                      </td>
                    </tr>

                    <tr v-if="!loading && !filteredRows.length" class="border-t border-ui-border/60">
                      <td colspan="8" class="px-4 py-10 text-center text-[12px] text-ui-muted">
                        No reminders found for current filters.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3 sm:px-5">
          <button type="button" class="ui-btn ui-btn-ghost" @click="handleClose">
            Close
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
:deep(.modal-fade-enter-active),
:deep(.modal-fade-leave-active) {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
:deep(.modal-fade-enter-from),
:deep(.modal-fade-leave-to) {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>
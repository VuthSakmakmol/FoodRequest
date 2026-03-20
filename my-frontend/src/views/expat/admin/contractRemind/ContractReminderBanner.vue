<!-- src/views/expat/admin/contractRemind/ContractReminderBanner.vue -->
<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'

defineOptions({ name: 'ContractReminderBanner' })

const props = defineProps({
  reminders: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Contract action required',
  },
})

const emit = defineEmits([
  'refresh',
  'open-list',
  'open-profile',
  'renew',
])

function s(v) {
  return String(v ?? '').trim()
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function fmtDate(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}

function urgencyRank(daysLeft) {
  const n = num(daysLeft, 9999)
  if (n <= 1) return 0
  if (n <= 7) return 1
  if (n <= 14) return 2
  return 3
}

const sortedReminders = computed(() => {
  return [...(Array.isArray(props.reminders) ? props.reminders : [])].sort((a, b) => {
    const ua = urgencyRank(a?.daysLeft)
    const ub = urgencyRank(b?.daysLeft)
    if (ua !== ub) return ua - ub

    const da = num(a?.daysLeft, 9999)
    const db = num(b?.daysLeft, 9999)
    if (da !== db) return da - db

    return s(a?.employeeId).localeCompare(s(b?.employeeId))
  })
})

const count = computed(() => sortedReminders.value.length)

const urgentCount = computed(() => {
  return sortedReminders.value.filter((x) => num(x?.daysLeft, 9999) <= 7).length
})

const summaryText = computed(() => {
  if (props.loading) return 'Loading contract reminders...'
  if (!count.value) return 'No contract reminders at the moment.'
  if (count.value === 1) return '1 employee contract needs review soon.'
  return `${count.value} employee contracts need review soon.`
})

const topThree = computed(() => sortedReminders.value.slice(0, 3))

function badgeClass(daysLeft) {
  const n = num(daysLeft, 9999)
  if (n <= 1) {
    return 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-700/60'
  }
  if (n <= 7) {
    return 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700/60'
  }
  if (n <= 14) {
    return 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-700/60'
  }
  return 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-700/60'
}

function daysLeftLabel(daysLeft) {
  const n = num(daysLeft, 0)
  if (n < 0) return `${Math.abs(n)} days overdue`
  if (n === 0) return 'Ends today'
  if (n === 1) return '1 day left'
  return `${n} days left`
}

function openProfile(item) {
  emit('open-profile', item)
}

function renew(item) {
  emit('renew', item)
}
</script>

<template>
  <section
    class="relative overflow-hidden rounded-2xl border border-amber-200/80 bg-white/90 shadow-sm
           dark:border-amber-800/60 dark:bg-slate-900/90"
  >
    <div
      class="pointer-events-none absolute inset-0
             bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(244,63,94,0.10),transparent_28%),linear-gradient(135deg,rgba(255,251,235,0.95),rgba(255,255,255,0.92))]
             dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(244,63,94,0.08),transparent_28%),linear-gradient(135deg,rgba(41,37,36,0.92),rgba(15,23,42,0.95))]"
    />

    <div class="relative z-[1] p-3 sm:p-4">
      <div class="min-w-0">
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl
                   bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200
                   dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700/60"
          >
            <i class="fa-solid fa-bell text-sm" />
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-[14px] font-extrabold tracking-tight text-ui-fg">
                {{ title }}
              </h2>

              <span
                class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold
                       bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200
                       dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700/60"
              >
                {{ count }} reminder{{ count === 1 ? '' : 's' }}
              </span>

              <span
                v-if="urgentCount > 0"
                class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold
                       bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200
                       dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-700/60"
              >
                {{ urgentCount }} urgent
              </span>
            </div>

            <p class="mt-1 text-[11px] leading-5 text-ui-muted">
              {{ summaryText }}
              <span v-if="!loading && count > 0" class="font-medium text-ui-fg/90">
                Please review whether to renew contract or end contract.
              </span>
            </p>
          </div>
        </div>

        <div v-if="loading" class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="n in 3"
            :key="n"
            class="rounded-xl border border-ui-border/60 bg-white/70 p-3 shadow-sm dark:bg-slate-950/40"
          >
            <div class="h-4 w-28 animate-pulse rounded bg-ui-bg-2/80" />
            <div class="mt-3 h-3 w-40 animate-pulse rounded bg-ui-bg-2/80" />
            <div class="mt-2 h-3 w-24 animate-pulse rounded bg-ui-bg-2/80" />
            <div class="mt-4 h-8 w-full animate-pulse rounded-xl bg-ui-bg-2/80" />
          </div>
        </div>

        <div
          v-else-if="count > 0"
          class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          <article
            v-for="item in topThree"
            :key="`${item.employeeId}-${item.contractNo}-${item.endDate}`"
            class="rounded-xl border border-ui-border/70 bg-white/80 p-3 shadow-sm backdrop-blur
                   dark:border-ui-border/60 dark:bg-slate-950/50"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-[13px] font-extrabold text-ui-fg">
                  {{ item.name || item.employeeName || item.employeeId || '—' }}
                </div>
                <div class="mt-0.5 text-[11px] text-ui-muted">
                  {{ item.employeeId || '—' }}
                  <span v-if="item.department"> · {{ item.department }}</span>
                </div>
              </div>

              <span
                class="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold"
                :class="badgeClass(item.daysLeft)"
              >
                {{ daysLeftLabel(item.daysLeft) }}
              </span>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div class="rounded-xl bg-ui-bg-2/70 px-3 py-2">
                <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">
                  Contract
                </div>
                <div class="mt-1 font-mono font-semibold text-ui-fg">
                  #{{ item.contractNo || '—' }}
                </div>
              </div>

              <div class="rounded-xl bg-ui-bg-2/70 px-3 py-2">
                <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted">
                  End Date
                </div>
                <div class="mt-1 font-mono font-semibold text-ui-fg">
                  {{ fmtDate(item.endDate) }}
                </div>
              </div>
            </div>

            <div class="mt-3 flex items-center gap-2">
              <button
                type="button"
                class="ui-btn ui-btn-ghost ui-btn-sm flex-1"
                @click="openProfile(item)"
              >
                <i class="fa-solid fa-up-right-from-square text-[11px]" />
                Open profile
              </button>

              <button
                type="button"
                class="ui-btn ui-btn-primary ui-btn-sm flex-1"
                @click="renew(item)"
              >
                <i class="fa-solid fa-arrows-rotate text-[11px]" />
                Renew now
              </button>
            </div>
          </article>
        </div>

        <div
          v-else
          class="mt-3 rounded-xl border border-dashed border-ui-border/70 bg-white/60 px-4 py-4 text-[12px] text-ui-muted dark:bg-slate-950/30"
        >
          No contract reminders found. This section will show expiring contracts here.
        </div>
      </div>
    </div>
  </section>
</template>
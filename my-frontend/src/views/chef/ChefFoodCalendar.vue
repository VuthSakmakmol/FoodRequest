<!-- src/views/chef/ChefFoodCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const auth   = useAuth()
const { showToast } = useToast()

/* ───────── Status colors ───────── */
const STATUS_COLOR = {
  NEW:       '#94a3b8',
  ACCEPTED:  '#6366f1',
  COOKING:   '#f97316',
  READY:     '#0d9488',
  DELIVERED: '#16a34a',
  CANCELED:  '#ef4444',
}

/* ───────── state ───────── */
const currentMonth = ref(dayjs())
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))

const loading   = ref(false)
const loadError = ref('')
const rows      = ref([]) // normalized food requests

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')

const fmtTimeRange = r =>
  (r?.eatTimeStart || r?.eatTimeEnd)
    ? [r.eatTimeStart || '', r.eatTimeEnd || ''].filter(Boolean).join(' – ')
    : '—'

const fmtMeals = (r) =>
  Array.isArray(r.meals) && r.meals.length
    ? r.meals.join(', ')
    : '—'

const asArray = v => (Array.isArray(v) ? v : [])

const normalize = o => {
  const eat = o?.eatDate || o?.serveDate || null
  return {
    ...o,
    _id: String(o?._id || ''),
    requestId: String(o?.requestId || ''),
    orderType: o?.orderType || '',
    quantity: Number(o?.quantity || 0),
    meals: asArray(o?.meals),
    location: o?.location || {},
    menuChoices: asArray(o?.menuChoices),
    menuCounts: asArray(o?.menuCounts),
    dietary: asArray(o?.dietary),
    dietaryCounts: asArray(o?.dietaryCounts),
    specialInstructions: o?.specialInstructions || '',
    dietaryOther: o?.dietaryOther || '',
    cancelReason: o?.cancelReason || '',
    recurring: o?.recurring || {},
    status: o?.status || 'NEW',
    statusHistory: asArray(o?.statusHistory),
    notified: o?.notified || {},
    stepDates: o?.stepDates || {},
    orderDate: o?.orderDate || null,
    eatDate: eat,
    serveDate: o?.serveDate || null,
    createdAt: o?.createdAt || null,
    updatedAt: o?.updatedAt || null,
    employee: o?.employee || {},
    eatTimeStart: o?.eatTimeStart || '',
    eatTimeEnd: o?.eatTimeEnd || '',
  }
}

/* ───────── group by date ───────── */
const byDate = computed(() => {
  const map = {}
  for (const r of rows.value) {
    const key = fmtDate(r.eatDate) || fmtDate(r.serveDate)
    if (!key) continue
    if (!map[key]) map[key] = []
    map[key].push(r)
  }
  return map
})

function listForDate(dateStr) {
  const list = byDate.value[dateStr] || []
  return list.slice().sort((a, b) => {
    const tA = (a.eatTimeStart || '') + (a.eatTimeEnd || '')
    const tB = (b.eatTimeStart || '') + (b.eatTimeEnd || '')
    return (
      tA.localeCompare(tB) ||
      (a.status || '').localeCompare(b.status || '') ||
      (a.employee?.name || '').localeCompare(b.employee?.name || '')
    )
  })
}

/* panel for selected date */
const selectedList = computed(() => listForDate(selectedDate.value))

/* ───────── month grid ───────── */
const monthLabel   = computed(() => currentMonth.value.format('MMMM YYYY'))
const startOfMonth = computed(() => currentMonth.value.startOf('month'))
const endOfMonth   = computed(() => currentMonth.value.endOf('month'))
const startOfGrid  = computed(() => startOfMonth.value.startOf('week')) // Sunday
const endOfGrid    = computed(() => endOfMonth.value.endOf('week'))

const days = computed(() => {
  const arr = []
  let d = startOfGrid.value
  while (d.isBefore(endOfGrid.value) || d.isSame(endOfGrid.value, 'day')) {
    arr.push(d)
    d = d.add(1, 'day')
  }
  return arr
})

/* ───────── API (chef namespace) ───────── */
async function loadMonth () {
  loading.value = true
  loadError.value = ''
  try {
    const from = startOfGrid.value.format('YYYY-MM-DD')
    const to   = endOfGrid.value.format('YYYY-MM-DD')

    let { data } = await api.get('/chef/food-requests', {
      params: { from, to }
    })

    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    // Fallback if API ignores from/to
    if (!Array.isArray(list) || list.length === 0) {
      const resp2 = await api.get('/chef/food-requests')
      data = resp2.data
      list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    }

    rows.value = (list || []).map(normalize)
  } catch (e) {
    console.error('[ChefFoodCalendar] loadMonth error:', e)
    loadError.value =
      e?.response?.data?.message || e?.message || 'Failed to load food calendar.'
    rows.value = []
    showToast({
      type: 'error',
      title: 'Load failed',
      message: loadError.value,
      timeout: 2500,
    })
  } finally {
    loading.value = false
  }
}

/* ───────── realtime upsert/remove ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(x => x._id === d._id)
  if (i === -1) rows.value.push(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const idx = rows.value.findIndex(x => x._id === id)
  if (idx !== -1) rows.value.splice(idx, 1)
}

/* ───────── navigation ───────── */
function nextMonth () {
  currentMonth.value = currentMonth.value.add(1, 'month')
}
function prevMonth () {
  currentMonth.value = currentMonth.value.subtract(1, 'month')
}
function goToday () {
  currentMonth.value = dayjs()
  selectedDate.value = dayjs().format('YYYY-MM-DD')
}

/* ───────── click handlers ───────── */
function selectDay(d) {
  selectedDate.value = d.format('YYYY-MM-DD')
}

function openChefListForSelected() {
  if (!selectedList.value.length) {
    showToast({
      type: 'info',
      title: 'No requests',
      message: `No meal requests on ${selectedDate.value}.`,
      timeout: 2000,
    })
    return
  }

  router.push({
    name: 'chef-requests',
    query: { date: selectedDate.value }
  })
}

function openRowInChef(r) {
  router.push({
    name: 'chef-requests',
    query: { date: selectedDate.value, focus: r._id }
  })
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  await loadMonth()

  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id || '')))
})
onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
})

watch(currentMonth, () => loadMonth())
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Toolbar -->
      <header
        class="flex flex-wrap items-center justify-between gap-2
               px-3 py-2
               rounded-t-2xl border-b border-slate-200
               bg-gradient-to-r from-[#0f719e] via-[#b3b4df] to-[#ae9aea]
               text-white
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full
                   border border-slate-900/70 bg-white text-slate-900 text-base
                   shadow-sm hover:bg-slate-100"
            @click="prevMonth"
          >
            ‹
          </button>
          <div class="flex flex-col">
            <span class="text-sm sm:text-base font-semibold">
              {{ monthLabel }}
            </span>
            <span class="text-[11px] text-slate-100/80">
              Tap a day to review requests
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-slate-100/70
                   bg-white/10 px-3 py-1.5 text-[11px] font-medium
                   hover:bg-white/15"
            @click="loadMonth"
          >
            Refresh
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-sky-200
                   bg-sky-600 px-3 py-1.5 text-[11px] font-semibold
                   hover:bg-sky-500"
            @click="goToday"
          >
            Today
          </button>
        </div>
      </header>

      <!-- Error banner -->
      <div
        v-if="loadError"
        class="mx-3 mt-2 rounded-md border border-rose-500 bg-rose-50 px-3 py-2
               text-[11px] text-rose-700
               dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ loadError }}
      </div>

      <!-- Main layout: calendar + side panel -->
      <div
        class="flex flex-col lg:flex-row border-t border-slate-200
               bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/80"
      >
        <!-- Calendar -->
        <section
          class="flex-1 border-b border-slate-200 lg:border-b-0 lg:border-r
                 bg-white dark:bg-slate-950"
        >
          <div class="overflow-x-auto">
            <div class="w-full sm:min-w-[800px]">
              <!-- Week header -->
              <div
                class="grid grid-cols-7 border-b border-slate-200
                       bg-slate-100 text-[11px] sm:text-xs font-semibold text-slate-700
                       dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <div
                  v-for="w in ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']"
                  :key="w"
                  class="py-2 text-center"
                >
                  {{ w }}
                </div>
              </div>

              <!-- Grid -->
              <div class="grid grid-cols-7 text-[10px] sm:text-xs">
                <button
                  v-for="d in days"
                  :key="d.format('YYYY-MM-DD')"
                  type="button"
                  class="relative min-h-[72px] sm:min-h-[96px]
                         border border-slate-200 bg-white
                         px-1.5 pt-1.5 pb-1 text-left
                         transition-colors duration-150
                         hover:bg-sky-50 hover:border-sky-300
                         dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                  :class="{
                    'bg-slate-100 opacity-60 dark:bg-slate-900/80':
                      !d.isSame(currentMonth, 'month'),
                    'border-sky-500 dark:border-sky-500':
                      d.isSame(dayjs(), 'day'),
                    'ring-2 ring-sky-500 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-900':
                      selectedDate === d.format('YYYY-MM-DD')
                  }"
                  @click="selectDay(d)"
                >
                  <div class="flex items-center justify-between gap-1">
                    <span
                      class="text-[11px] sm:text-xs font-semibold"
                      :class="{ 'text-red-600 dark:text-red-400': d.day() === 0 }"
                    >
                      {{ d.date() }}
                    </span>
                    <span
                      v-if="d.isSame(dayjs(), 'day')"
                      class="rounded-full bg-sky-600 px-1.5 py-0.5
                             text-[9px] sm:text-[10px] font-semibold text-white"
                    >
                      Today
                    </span>
                  </div>

                  <div class="mt-1 space-y-0.5">
                    <div
                      v-for="(r, i) in byDate[d.format('YYYY-MM-DD')] || []"
                      :key="i"
                      class="flex items-center gap-1 rounded-full border border-slate-900/60
                             px-1 py-0.5 text-[9px] sm:text-[10px] text-white truncate"
                      :style="{ backgroundColor: STATUS_COLOR[r.status] || '#94a3b8' }"
                    >
                      <span class="truncate">
                        {{ r.employee?.name || r.employee?.employeeId || '—' }}
                      </span>
                      <span class="text-[9px] opacity-95">
                        ({{ r.quantity || 0 }})
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Legend -->
          <div
            class="flex flex-wrap items-center justify-center gap-2
                   border-t border-slate-200 bg-slate-50 px-3 py-2
                   text-[10px] sm:text-xs text-slate-600
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <div
              v-for="(color, status) in STATUS_COLOR"
              :key="status"
              class="flex items-center gap-1.5"
            >
              <span
                class="h-2.5 w-2.5 rounded-full border border-slate-800"
                :style="{ backgroundColor: color }"
              />
              <span>{{ status }}</span>
            </div>
          </div>
        </section>

        <!-- Selected-day panel -->
        <aside
          class="w-full lg:w-80 xl:w-96 bg-slate-50/95
                 border-t border-slate-200 lg:border-t-0 lg:border-l
                 px-3 py-3 text-xs
                 dark:bg-slate-950 dark:border-slate-700"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                {{ selectedDate }}
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ selectedList.length }}
                request{{ selectedList.length === 1 ? '' : 's' }} on this day
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="rounded-full border border-slate-500 bg-white
                       px-2.5 py-1 text-[11px] font-medium text-slate-800
                       hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-100"
                @click="openChefListForSelected"
              >
                Open list
              </button>
            </div>
          </div>

          <div
            v-if="!selectedList.length"
            class="mt-3 rounded-lg border border-dashed border-slate-500
                   bg-white px-3 py-2 text-[11px] text-slate-600
                   dark:bg-slate-950 dark:text-slate-300"
          >
            No meal requests on this date.
          </div>

          <div v-else class="mt-3 space-y-2">
            <article
              v-for="r in selectedList"
              :key="r._id"
              class="flex flex-col gap-1 rounded-xl border border-slate-600
                     bg-white px-3 py-2 text-[11px]
                     shadow-sm
                     dark:border-slate-600 dark:bg-slate-950"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-full border border-slate-700
                           px-2 py-0.5 text-[10px] font-semibold text-slate-900
                           dark:border-slate-400 dark:text-slate-100"
                    :style="{ backgroundColor: (STATUS_COLOR[r.status] || '#e2e8f0') + '33' }"
                  >
                    {{ r.status }}
                  </span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ r.orderType }}
                  </span>
                </div>
                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtTimeRange(r) }}
                </div>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Meals</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ fmtMeals(r) }} (Qty {{ r.quantity }})
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Location</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r?.location?.kind || '—' }}
                  <span v-if="r?.location?.other">
                    — {{ r.location.other }}
                  </span>
                </span>
              </div>

              <div class="flex gap-2">
                <span class="min-w-[70px] text-slate-500">Requester</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">
                  {{ r?.employee?.name || '—' }}
                  <span class="block text-[10px] font-normal text-slate-500 dark:text-slate-400">
                    ID {{ r?.employee?.employeeId || '—' }} •
                    {{ r?.employee?.department || '—' }}
                  </span>
                </span>
              </div>

              <div class="mt-1 flex justify-end">
                <button
                  type="button"
                  class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                  @click="openRowInChef(r)"
                >
                  View in requests
                </button>
              </div>
            </article>
          </div>
        </aside>
      </div>

      <!-- Loader -->
      <div
        v-if="loading"
        class="border-t border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px]
               text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        Loading…
      </div>
    </div>
  </div>
</template>

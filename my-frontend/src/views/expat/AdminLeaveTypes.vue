<!-- src/views/expat/AdminLeaveTypes.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminLeaveTypes' })

const { showToast } = useToast()

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loadingTypes = ref(false)
const loadError = ref('')
const leaveTypes = ref([])

const search = ref('')
const activeFilter = ref('ALL') // ALL | ACTIVE | INACTIVE

// pagination
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

/* ───────── HELPERS / COMPUTED ───────── */
function safeBool(v) {
  // backend may omit isActive for system types → treat as active by default
  if (v === undefined || v === null) return true
  return !!v
}

const processedTypes = computed(() => {
  const items = [...leaveTypes.value]

  // sort by order then code
  items.sort((a, b) => {
    const ao = Number(a.order ?? 0)
    const bo = Number(b.order ?? 0)
    if (ao !== bo) return ao - bo
    return (a.code || '').localeCompare(b.code || '')
  })

  // search
  const q = search.value.trim().toLowerCase()
  let result = items
  if (q) {
    result = result.filter((t) =>
      (t.code || '').toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)
    )
  }

  // active filter
  if (activeFilter.value === 'ACTIVE') result = result.filter((t) => safeBool(t.isActive))
  if (activeFilter.value === 'INACTIVE') result = result.filter((t) => !safeBool(t.isActive))

  return result
})

const pagedTypes = computed(() => {
  if (perPage.value === 'All') return processedTypes.value
  const per = Number(perPage.value || 20)
  const start = (page.value - 1) * per
  return processedTypes.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 20)
  return Math.ceil(processedTypes.value.length / per) || 1
})

watch([search, activeFilter, perPage], () => {
  page.value = 1
})

/* ───────── API ───────── */
async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    loadError.value = ''
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load leave types.'
    showToast({ type: 'error', title: 'Failed to load leave types', message: loadError.value })
  } finally {
    loadingTypes.value = false
  }
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  await fetchLeaveTypes()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <section class="w-full">
    <div class="ui-card overflow-hidden !rounded-2xl">
      <!-- ✅ Tailwind-safe header (no inline styles) -->
      <header class="ui-hero-gradient">
        <div class="relative">
          <!-- Desktop -->
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="min-w-[220px]">
              <div class="flex items-center gap-2">
                <h1 class="text-[15px] font-semibold tracking-tight">Leave Types</h1>
                <span class="rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                  Read-only
                </span>
              </div>
              <p class="mt-0.5 text-[11px] text-white/85">
                System-defined leave types (managed by backend rules).
              </p>
            </div>

            <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
              <!-- Search -->
              <div class="min-w-[260px] max-w-sm">
                <label class="mb-1 block text-[11px] font-semibold text-white/90">Search</label>
                <div class="flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-3 py-2">
                  <i class="fa-solid fa-magnifying-glass text-[12px] text-white/85" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Code or name..."
                    class="flex-1 bg-transparent text-[12px] outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <!-- Status segmented -->
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-semibold text-white/90">Status</span>

                <div class="flex rounded-full border border-white/25 bg-white/10 p-1">
                  <button
                    type="button"
                    class="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                    :class="activeFilter === 'ALL' ? 'bg-white text-slate-900 shadow' : 'text-white/90 hover:bg-white/10'"
                    @click="activeFilter = 'ALL'"
                  >All</button>

                  <button
                    type="button"
                    class="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                    :class="activeFilter === 'ACTIVE' ? 'bg-white text-slate-900 shadow' : 'text-white/90 hover:bg-white/10'"
                    @click="activeFilter = 'ACTIVE'"
                  >Active</button>

                  <button
                    type="button"
                    class="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                    :class="activeFilter === 'INACTIVE' ? 'bg-white text-slate-900 shadow' : 'text-white/90 hover:bg-white/10'"
                    @click="activeFilter = 'INACTIVE'"
                  >Inactive</button>
                </div>
              </div>

              <!-- Refresh -->
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2
                       text-[11px] font-semibold text-white transition hover:bg-white/15
                       disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="loadingTypes"
                @click="fetchLeaveTypes()"
              >
                <i class="fa-solid fa-rotate text-[11px]" :class="loadingTypes ? 'fa-spin' : ''" />
                Refresh
              </button>
            </div>
          </div>

          <!-- Mobile -->
          <div v-else class="space-y-2">
            <div>
              <p class="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/75">
                Expat Holiday
              </p>
              <div class="mt-0.5 flex items-center gap-2">
                <h1 class="text-[15px] font-semibold tracking-tight">Leave Types</h1>
                <span class="rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                  Read-only
                </span>
              </div>
              <p class="text-[11px] text-white/85">System-defined leave types (backend-managed).</p>
            </div>

            <div class="space-y-2">
              <div>
                <label class="mb-1 block text-[11px] font-semibold text-white/90">Search</label>
                <div class="flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-3 py-2">
                  <i class="fa-solid fa-magnifying-glass text-[12px] text-white/85" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Code or name..."
                    class="flex-1 bg-transparent text-[12px] outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-[11px] font-semibold text-white/90">Status</span>
                  <div class="flex rounded-full border border-white/25 bg-white/10 p-1">
                    <button
                      type="button"
                      class="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                      :class="activeFilter === 'ALL' ? 'bg-white text-slate-900 shadow' : 'text-white/90 hover:bg-white/10'"
                      @click="activeFilter = 'ALL'"
                    >All</button>

                    <button
                      type="button"
                      class="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                      :class="activeFilter === 'ACTIVE' ? 'bg-white text-slate-900 shadow' : 'text-white/90 hover:bg-white/10'"
                      @click="activeFilter = 'ACTIVE'"
                    >Active</button>

                    <button
                      type="button"
                      class="rounded-full px-3 py-1 text-[11px] font-semibold transition"
                      :class="activeFilter === 'INACTIVE' ? 'bg-white text-slate-900 shadow' : 'text-white/90 hover:bg-white/10'"
                      @click="activeFilter = 'INACTIVE'"
                    >Inactive</button>
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2
                         text-[11px] font-semibold text-white transition hover:bg-white/15
                         disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="loadingTypes"
                  @click="fetchLeaveTypes()"
                >
                  <i class="fa-solid fa-rotate text-[11px]" :class="loadingTypes ? 'fa-spin' : ''" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <!-- Body -->
      <div class="px-2 pb-3 pt-3 sm:px-4">
        <div
          v-if="loadError"
          class="mb-3 rounded-2xl border border-rose-400/60 bg-rose-50 px-3 py-2 text-[12px] text-rose-800
                 dark:border-rose-500/60 dark:bg-rose-950/35 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <div v-if="loadingTypes" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-2xl bg-slate-200/80 dark:bg-slate-800/60"></div>
          <div v-for="i in 5" :key="'sk-' + i" class="h-14 w-full animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50"></div>
        </div>

        <div v-else class="space-y-3">
          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!pagedTypes.length" class="py-8 text-center text-[12px] text-slate-500 dark:text-slate-400">
              No leave types found.
            </p>

            <article
              v-for="t in pagedTypes"
              :key="t._id || t.code"
              class="rounded-3xl border border-slate-200/70 bg-white/85 p-3
                     shadow-[0_14px_35px_rgba(15,23,42,0.10)]
                     dark:border-slate-800/70 dark:bg-slate-950/55"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white dark:text-slate-900">
                      {{ t.code }}
                    </span>

                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      :class="(t.isActive ?? true)
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ (t.isActive ?? true) ? 'Active' : 'Inactive' }}
                    </span>
                  </div>

                  <div class="mt-1 text-[14px] font-semibold text-slate-900 dark:text-slate-50">
                    {{ t.name || '—' }}
                  </div>
                  <div class="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300">
                    {{ t.description || 'No description' }}
                  </div>
                </div>

                <div class="text-right text-[12px] text-slate-600 dark:text-slate-300">
                  <div>
                    Entitlement:
                    <span class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ Number(t.yearlyEntitlement || 0).toLocaleString() }} days
                    </span>
                  </div>
                  <div class="mt-0.5">
                    Order:
                    <span class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ Number(t.order ?? 0) }}
                    </span>
                  </div>
                  <div class="mt-1">
                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      :class="t.requiresBalance
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.requiresBalance ? 'Requires Balance' : 'No Balance Check' }}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <!-- Desktop table -->
          <div
            v-else
            class="overflow-x-auto rounded-3xl border border-slate-200/70 bg-white/85 dark:border-slate-800/70 dark:bg-slate-950/55"
          >
            <div class="border-b border-slate-200/70 px-3 py-2 dark:border-slate-800/70">
              <div class="flex items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                <span class="h-2 w-2 rounded-full bg-sky-500"></span>
                <span class="h-2 w-2 rounded-full bg-indigo-500"></span>
                <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span class="ml-2">Types List</span>
              </div>
            </div>

            <table class="w-full min-w-[980px] table-fixed border-collapse text-[13px] text-slate-700 dark:text-slate-100">
              <colgroup>
                <col style="width: 110px" />
                <col style="width: 520px" />
                <col style="width: 210px" />
                <col style="width: 180px" />
                <col style="width: 120px" />
              </colgroup>

              <thead class="text-[11px] uppercase tracking-wide text-white">
                <tr class="bg-gradient-to-r from-sky-600 via-indigo-600 to-emerald-600">
                  <th class="px-3 py-3 text-left font-semibold">Code</th>
                  <th class="px-3 py-3 text-left font-semibold">Name</th>
                  <th class="px-3 py-3 text-left font-semibold">Requires Balance</th>
                  <th class="px-3 py-3 text-right font-semibold">Yearly Entitlement</th>
                  <th class="px-3 py-3 text-center font-semibold">Active</th>
                </tr>
              </thead>

              <tbody class="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                <tr
                  v-for="(t, idx) in pagedTypes"
                  :key="t._id || t.code"
                  class="transition"
                  :class="[
                    idx % 2 === 0 ? 'bg-white/80 dark:bg-slate-950/25' : 'bg-sky-50/60 dark:bg-slate-900/40',
                    'hover:bg-emerald-50/70 dark:hover:bg-emerald-900/20'
                  ]"
                >
                  <td class="px-3 py-3">
                    <span class="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white dark:text-slate-900">
                      {{ t.code }}
                    </span>
                  </td>

                  <td class="px-3 py-3">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ t.name || '—' }}
                    </div>
                    <div class="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300">
                      {{ t.description || '—' }}
                    </div>
                  </td>

                  <td class="px-3 py-3">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      :class="t.requiresBalance
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.requiresBalance ? 'Yes' : 'No' }}
                    </span>
                  </td>

                  <td class="px-3 py-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-50">
                    {{ Number(t.yearlyEntitlement || 0).toLocaleString() }}
                  </td>

                  <td class="px-3 py-3 text-center">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      :class="(t.isActive ?? true)
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ (t.isActive ?? true) ? 'Yes' : 'No' }}
                    </span>
                  </td>
                </tr>

                <tr v-if="!pagedTypes.length">
                  <td colspan="5" class="px-3 py-10 text-center text-[12px] text-slate-500 dark:text-slate-400">
                    No leave types found.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="mt-2 rounded-3xl border border-slate-200/70 bg-white/75 px-3 py-3 dark:border-slate-800/70 dark:bg-slate-950/55">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
                <span class="font-semibold">Rows per page</span>
                <select
                  v-model="perPage"
                  class="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold
                         dark:border-slate-700 dark:bg-slate-900"
                >
                  <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                </select>
              </div>

              <div class="flex items-center justify-end gap-1">
                <button
                  type="button"
                  class="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800
                         hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  :disabled="page <= 1"
                  @click="page = 1"
                >«</button>

                <button
                  type="button"
                  class="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800
                         hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  :disabled="page <= 1"
                  @click="page = Math.max(1, page - 1)"
                >Prev</button>

                <span class="px-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                  Page {{ page }} / {{ pageCount }}
                </span>

                <button
                  type="button"
                  class="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800
                         hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  :disabled="page >= pageCount"
                  @click="page = Math.min(pageCount, page + 1)"
                >Next</button>

                <button
                  type="button"
                  class="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800
                         hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  :disabled="page >= pageCount"
                  @click="page = pageCount"
                >»</button>
              </div>
            </div>

            <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Leave types are managed by backend rules. Contact Admin/IT if anything looks incorrect.
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

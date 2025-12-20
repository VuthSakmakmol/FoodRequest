<!-- src/views/expat/AdminLeaveTypes.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

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
    result = result.filter(t =>
      (t.code || '').toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q)
    )
  }

  // active filter
  if (activeFilter.value === 'ACTIVE') {
    result = result.filter(t => safeBool(t.isActive))
  } else if (activeFilter.value === 'INACTIVE') {
    result = result.filter(t => !safeBool(t.isActive))
  }

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
    showToast({
      type: 'error',
      title: 'Failed to load leave types',
      message: loadError.value
    })
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
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Gradient header / filters -->
      <div class="rounded-t-2xl bg-gradient-to-r from-indigo-600 via-violet-500 to-sky-500 px-4 py-3 text-white">
        <!-- Desktop -->
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-[220px]">
            <div class="flex items-center gap-2">
              <p class="text-sm font-semibold">Leave Types</p>
              <span class="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold">
                Read-only
              </span>
            </div>
            <p class="text-[11px] text-indigo-50/90">
              System-defined leave types (managed by backend rules).
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-indigo-50">Search</label>
              <div class="flex items-center rounded-xl border border-indigo-200/80 bg-indigo-900/25 px-2.5 py-1.5 text-xs">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-indigo-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Code or name..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-indigo-100/80"
                />
              </div>
            </div>

            <!-- Active filter -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="mr-1 text-indigo-50/80">Status</span>
              <div class="flex rounded-full bg-indigo-900/20 p-0.5">
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="activeFilter === 'ALL' ? 'bg-white/95 text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-900/40'"
                  @click="activeFilter = 'ALL'"
                >All</button>

                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="activeFilter === 'ACTIVE' ? 'bg-white/95 text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-900/40'"
                  @click="activeFilter = 'ACTIVE'"
                >Active</button>

                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="activeFilter === 'INACTIVE' ? 'bg-white/95 text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-900/40'"
                  @click="activeFilter = 'INACTIVE'"
                >Inactive</button>
              </div>
            </div>

            <!-- Refresh -->
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed"
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
            <p class="text-[10px] uppercase tracking-[0.25em] text-indigo-100/80">Expat Holiday</p>
            <div class="flex items-center gap-2">
              <p class="text-sm font-semibold">Leave Types</p>
              <span class="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold">
                Read-only
              </span>
            </div>
            <p class="text-[11px] text-indigo-50/90">System-defined leave types (backend-managed).</p>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-indigo-50">Search</label>
              <div class="flex items-center rounded-xl border border-indigo-200/80 bg-indigo-900/25 px-2.5 py-1.5 text-[11px]">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-indigo-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Code or name..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-indigo-100/80"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div class="flex items-center gap-1">
                <span class="text-indigo-50/80">Status</span>
                <div class="flex rounded-full bg-indigo-900/20 p-0.5">
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="activeFilter === 'ALL' ? 'bg-white/95 text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-900/40'"
                    @click="activeFilter = 'ALL'"
                  >All</button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="activeFilter === 'ACTIVE' ? 'bg-white/95 text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-900/40'"
                    @click="activeFilter = 'ACTIVE'"
                  >Active</button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="activeFilter === 'INACTIVE' ? 'bg-white/95 text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-900/40'"
                    @click="activeFilter = 'INACTIVE'"
                  >Inactive</button>
                </div>
              </div>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed"
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

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error banner -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading skeleton -->
        <div v-if="loadingTypes" class="space-y-2">
          <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70"></div>
          <div v-for="i in 4" :key="'sk-' + i" class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60"></div>
        </div>

        <!-- Content -->
        <div v-else>
          <!-- MOBILE: cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!pagedTypes.length" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No leave types found.
            </p>

            <article
              v-for="t in pagedTypes"
              :key="t._id || t.code"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      {{ t.code }}
                    </span>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                      :class="(t.isActive ?? true) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ (t.isActive ?? true) ? 'Active' : 'Inactive' }}
                    </span>
                  </div>

                  <div class="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                    {{ t.name || '—' }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ t.description || 'No description' }}
                  </div>
                </div>

                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  <div>
                    Entitlement:
                    <span class="font-semibold text-slate-800 dark:text-slate-100">
                      {{ Number(t.yearlyEntitlement || 0).toLocaleString() }} days
                    </span>
                  </div>
                  <div>
                    Order:
                    <span class="font-semibold text-slate-800 dark:text-slate-100">{{ Number(t.order ?? 0) }}</span>
                  </div>
                  <div class="mt-1">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                      :class="t.requiresBalance ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.requiresBalance ? 'Requires Balance' : 'No Balance Check' }}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <!-- DESKTOP: table -->
          <div v-else class="overflow-x-auto">
            <table class="min-w-[980px] w-full table-fixed border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
              <colgroup>
                <col style="width: 90px" />
                <col style="width: 520px" />
                <col style="width: 200px" />
                <col style="width: 190px" />
                <col style="width: 110px" />
                <col style="width: 110px" />
              </colgroup>

              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th border-l border-slate-200 first:border-l-0 dark:border-slate-700">Code</th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">Name</th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">Requires Balance</th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700 !text-right">Yearly Entitlement</th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700 !text-center">Active</th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700 !text-right">Order</th>
                </tr>
              </thead>

              <tbody>
                <tr
                  v-for="t in pagedTypes"
                  :key="t._id || t.code"
                  class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td">
                    <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      {{ t.code }}
                    </span>
                  </td>

                  <td class="table-td">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">{{ t.name || '—' }}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ t.description || '—' }}</div>
                  </td>

                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
                      :class="t.requiresBalance ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.requiresBalance ? 'Yes' : 'No' }}
                    </span>
                  </td>

                  <td class="table-td !text-right tabular-nums">
                    {{ Number(t.yearlyEntitlement || 0).toLocaleString() }}
                  </td>

                  <td class="table-td !text-center">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
                      :class="(t.isActive ?? true) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ (t.isActive ?? true) ? 'Yes' : 'No' }}
                    </span>
                  </td>

                  <td class="table-td !text-right tabular-nums">
                    {{ Number(t.order ?? 0) }}
                  </td>
                </tr>

                <tr v-if="!pagedTypes.length">
                  <td colspan="6" class="px-3 py-6 text-center text-[12px] text-slate-500 border-t border-slate-200 dark:border-slate-700 dark:text-slate-400">
                    No leave types found.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select v-model="perPage" class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-900">
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <span class="px-2">Page {{ page }} / {{ pageCount }}</span>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>

          <div class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            Leave types are managed by backend rules. Contact Admin/IT if anything looks incorrect.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-th {
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.table-td {
  padding: 8px 10px;
  vertical-align: middle;
}

/* Pagination */
.pagination-btn {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1.5px solid rgba(100, 116, 139, 0.95);
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination-btn:not(:disabled):hover {
  background: #e5edff;
}
.dark .pagination-btn {
  background: #020617;
  border-color: rgba(148, 163, 184, 0.9);
  color: #e5e7eb;
}
.dark .pagination-btn:not(:disabled):hover {
  background: #1e293b;
}
</style>

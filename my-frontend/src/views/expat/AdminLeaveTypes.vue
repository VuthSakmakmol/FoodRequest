<!-- src/views/expat/AdminLeaveTypes.vue -->
<script setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
} from 'vue'
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

// dialog for create / edit
const typeDialog = ref(false)
const editingTypeId = ref(null)
const typeSaving = ref(false)
const typeError = ref('')

const typeForm = ref({
  code: '',
  name: '',
  description: '',
  yearlyEntitlement: 0,
  requiresBalance: true,
  isActive: true,
  order: 0,
})

// delete confirmation
const confirmDeleteOpen = ref(false)
const typeToDelete = ref(null)

/* ───────── HELPERS / COMPUTED ───────── */

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
    result = result.filter(t => !!t.isActive)
  } else if (activeFilter.value === 'INACTIVE') {
    result = result.filter(t => !t.isActive)
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

watch([search, activeFilter], () => {
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
    loadError.value =
      e?.response?.data?.message || 'Unable to load leave types.'
    showToast({
      type: 'error',
      title: 'Failed to load leave types',
      message: loadError.value
    })
  } finally {
    loadingTypes.value = false
  }
}

/* ───────── DIALOG / CRUD ───────── */

function resetForm() {
  typeForm.value = {
    code: '',
    name: '',
    description: '',
    yearlyEntitlement: 0,
    requiresBalance: true,
    isActive: true,
    order: 0,
  }
}

function openCreateType() {
  editingTypeId.value = null
  typeError.value = ''
  resetForm()
  typeDialog.value = true
}

function openEditType(item) {
  editingTypeId.value = item._id
  typeError.value = ''
  typeForm.value = {
    code: item.code || '',
    name: item.name || '',
    description: item.description || '',
    yearlyEntitlement: item.yearlyEntitlement ?? 0,
    requiresBalance: item.requiresBalance ?? true,
    isActive: item.isActive ?? true,
    order: item.order ?? 0,
  }
  typeDialog.value = true
}

async function saveType() {
  let { code, name } = typeForm.value
  code = String(code || '').trim().toUpperCase()
  name = String(name || '').trim()

  if (!code || !name) {
    typeError.value = 'Code and Name are required.'
    return
  }

  typeSaving.value = true
  typeError.value = ''

  try {
    const payload = {
      ...typeForm.value,
      code,
      name,
      yearlyEntitlement: Number(typeForm.value.yearlyEntitlement || 0),
      requiresBalance: !!typeForm.value.requiresBalance,
      isActive: !!typeForm.value.isActive,
      order: Number(typeForm.value.order || 0),
    }

    if (editingTypeId.value) {
      await api.put(`/admin/leave/types/${editingTypeId.value}`, payload)
    } else {
      await api.post('/admin/leave/types', payload)
    }

    typeDialog.value = false
    showToast({
      type: 'success',
      title: 'Leave type saved',
      message: `Leave type ${code} has been saved.`
    })
    await fetchLeaveTypes()
  } catch (e) {
    console.error('saveType error', e)
    typeError.value = e?.response?.data?.message || 'Failed to save leave type.'
    showToast({
      type: 'error',
      title: 'Save failed',
      message: typeError.value
    })
  } finally {
    typeSaving.value = false
  }
}

/* ───────── Delete (with custom confirm modal) ───────── */

function openConfirmDelete(item) {
  typeToDelete.value = item
  confirmDeleteOpen.value = true
}

function cancelDelete() {
  confirmDeleteOpen.value = false
  typeToDelete.value = null
}

async function confirmDelete() {
  if (!typeToDelete.value) return

  try {
    const item = typeToDelete.value
    await api.delete(`/admin/leave/types/${item._id}`)

    showToast({
      type: 'success',
      title: 'Leave type deleted',
      message: `${item.code} — ${item.name} has been removed.`
    })
    await fetchLeaveTypes()
  } catch (e) {
    console.error('deleteType error', e)
    const msg =
      e?.response?.data?.message || 'Failed to delete leave type.'
    showToast({
      type: 'error',
      title: 'Delete failed',
      message: msg
    })
  } finally {
    cancelDelete()
  }
}

/* ───────── lifecycle ───────── */

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
  }
  await fetchLeaveTypes()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
  }
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-800 dark:bg-slate-900"
    >
      <!-- Gradient header / filters -->
      <div
        class="rounded-t-2xl bg-gradient-to-r from-indigo-600 via-violet-500 to-sky-500
               px-4 py-3 text-white"
      >
        <!-- Desktop -->
        <div
          v-if="!isMobile"
          class="flex flex-wrap items-end justify-between gap-4"
        >
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-indigo-100/80">
              Expat Holiday
            </p>
            <p class="text-sm font-semibold">
              Leave Types
            </p>
            <p class="text-[11px] text-indigo-50/90">
              Master data for foreigner holiday leave options and yearly entitlements.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-indigo-50">
                Search
              </label>
              <div
                class="flex items-center rounded-xl border border-indigo-200/80 bg-indigo-900/25
                       px-2.5 py-1.5 text-xs"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-indigo-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Code or name..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-indigo-100/80"
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
                  :class="activeFilter === 'ALL'
                    ? 'bg-white/95 text-indigo-700 shadow-sm'
                    : 'text-indigo-100 hover:bg-indigo-900/40'"
                  @click="activeFilter = 'ALL'"
                >
                  All
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="activeFilter === 'ACTIVE'
                    ? 'bg-white/95 text-indigo-700 shadow-sm'
                    : 'text-indigo-100 hover:bg-indigo-900/40'"
                  @click="activeFilter = 'ACTIVE'"
                >
                  Active
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="activeFilter === 'INACTIVE'
                    ? 'bg-white/95 text-indigo-700 shadow-sm'
                    : 'text-indigo-100 hover:bg-indigo-900/40'"
                  @click="activeFilter = 'INACTIVE'"
                >
                  Inactive
                </button>
              </div>
            </div>

            <!-- New type -->
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5
                     text-[11px] font-semibold text-indigo-700 shadow-sm
                     hover:bg-slate-50"
              @click="openCreateType"
            >
              <i class="fa-solid fa-plus text-[11px]" />
              <span>New Type</span>
            </button>
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-indigo-100/80">
              Expat Holiday
            </p>
            <p class="text-sm font-semibold">
              Leave Types
            </p>
            <p class="text-[11px] text-indigo-50/90">
              Master data for expat holiday leave entitlements.
            </p>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-indigo-50">
                Search
              </label>
              <div
                class="flex items-center rounded-xl border border-indigo-200/80 bg-indigo-900/25
                       px-2.5 py-1.5 text-[11px]"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-indigo-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Code or name..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-indigo-100/80"
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
                    :class="activeFilter === 'ALL'
                      ? 'bg-white/95 text-indigo-700 shadow-sm'
                      : 'text-indigo-100 hover:bg-indigo-900/40'"
                    @click="activeFilter = 'ALL'"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="activeFilter === 'ACTIVE'
                      ? 'bg-white/95 text-indigo-700 shadow-sm'
                      : 'text-indigo-100 hover:bg-indigo-900/40'"
                    @click="activeFilter = 'ACTIVE'"
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="activeFilter === 'INACTIVE'
                      ? 'bg-white/95 text-indigo-700 shadow-sm'
                      : 'text-indigo-100 hover:bg-indigo-900/40'"
                    @click="activeFilter = 'INACTIVE'"
                  >
                    Inactive
                  </button>
                </div>
              </div>

              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5
                       text-[11px] font-semibold text-indigo-700 shadow-sm
                       hover:bg-slate-50"
                @click="openCreateType"
              >
                <i class="fa-solid fa-plus text-[11px]" />
                <span>New Type</span>
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
          <div
            class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70"
          ></div>
          <div
            v-for="i in 4"
            :key="'sk-' + i"
            class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60"
          ></div>
        </div>

        <!-- Content -->
        <div v-else>
          <!-- MOBILE: cards -->
          <div v-if="isMobile" class="space-y-2">
            <p
              v-if="!pagedTypes.length"
              class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400"
            >
              No leave types yet. Tap <span class="font-semibold">New Type</span> to create one.
            </p>

            <article
              v-for="t in pagedTypes"
              :key="t._id"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5
                             text-[11px] font-semibold text-slate-700
                             dark:bg-slate-800 dark:text-slate-100"
                    >
                      {{ t.code }}
                    </span>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                      :class="t.isActive
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.isActive ? 'Active' : 'Inactive' }}
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
                    <span class="font-semibold text-slate-800 dark:text-slate-100">
                      {{ Number(t.order ?? 0) }}
                    </span>
                  </div>
                  <div class="mt-1">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
                      :class="t.requiresBalance
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.requiresBalance ? 'Requires Balance' : 'No Balance Check' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1
                         text-[11px] font-medium text-slate-700 hover:bg-slate-50
                         dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  @click="openEditType(t)"
                >
                  <i class="fa-solid fa-pen text-[11px]" />
                  Edit
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-3 py-1
                         text-[11px] font-medium text-rose-700 hover:bg-rose-50
                         dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/60"
                  @click="openConfirmDelete(t)"
                >
                  <i class="fa-regular fa-trash-can text-[11px]" />
                  Delete
                </button>
              </div>
            </article>
          </div>

          <!-- DESKTOP: table -->
          <div v-else class="overflow-x-auto">
            <table
              class="min-w-full border-collapse text-xs sm:text-[13px]
                     text-slate-700 dark:text-slate-100"
            >
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th border-l border-slate-200 first:border-l-0 dark:border-slate-700">
                    Code
                  </th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">
                    Name
                  </th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">
                    Requires Balance
                  </th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">
                    Yearly Entitlement
                  </th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">
                    Active
                  </th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">
                    Order
                  </th>
                  <th class="table-th border-l border-slate-200 dark:border-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="t in pagedTypes"
                  :key="t._id"
                  class="border-b border-slate-200 text-[12px]
                         hover:bg-slate-50/80
                         dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <!-- Code -->
                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5
                             text-[11px] font-semibold text-slate-700
                             dark:bg-slate-800 dark:text-slate-100"
                    >
                      {{ t.code }}
                    </span>
                  </td>

                  <!-- Name -->
                  <td class="table-td">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ t.name || '—' }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ t.description || '—' }}
                    </div>
                  </td>

                  <!-- Requires Balance -->
                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
                      :class="t.requiresBalance
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.requiresBalance ? 'Yes' : 'No' }}
                    </span>
                  </td>

                  <!-- Yearly Entitlement -->
                  <td class="table-td text-right">
                    {{ Number(t.yearlyEntitlement || 0).toLocaleString() }}
                  </td>

                  <!-- Active -->
                  <td class="table-td text-center">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
                      :class="t.isActive
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    >
                      {{ t.isActive ? 'Yes' : 'No' }}
                    </span>
                  </td>

                  <!-- Order -->
                  <td class="table-td text-right">
                    {{ Number(t.order ?? 0) }}
                  </td>

                  <!-- Actions -->
                  <td class="table-td">
                    <div class="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1
                               text-[11px] font-medium text-slate-700 hover:bg-slate-50
                               dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        @click="openEditType(t)"
                      >
                        <i class="fa-solid fa-pen text-[11px]" />
                        Edit
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-2.5 py-1
                               text-[11px] font-medium text-rose-700 hover:bg-rose-50
                               dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/60"
                        @click="openConfirmDelete(t)"
                      >
                        <i class="fa-regular fa-trash-can text-[11px]" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>

                <tr v-if="!pagedTypes.length">
                  <td
                    colspan="7"
                    class="px-3 py-6 text-center text-[12px] text-slate-500
                           border-t border-slate-200
                           dark:border-slate-700 dark:text-slate-400"
                  >
                    No leave types yet. Click <strong>New Type</strong> to create one.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2
                   text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300
                   sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                v-model="perPage"
                class="rounded-lg border border-slate-300 bg-white px-2 py-1
                       text-[11px] dark:border-slate-600 dark:bg-slate-900"
              >
                <option
                  v-for="opt in perPageOptions"
                  :key="'per-' + opt"
                  :value="opt"
                >
                  {{ opt }}
                </option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = 1"
              >
                «
              </button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = Math.max(1, page - 1)"
              >
                Prev
              </button>
              <span class="px-2">
                Page {{ page }} / {{ pageCount }}
              </span>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = Math.min(pageCount, page + 1)"
              >
                Next
              </button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = pageCount"
              >
                »
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MODAL: Create / Edit Leave Type -->
    <transition name="modal-fade">
      <div
        v-if="typeDialog"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2"
      >
        <div
          class="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200
                 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950"
        >
          <!-- Header -->
          <div
            class="border-b border-slate-200 bg-slate-50/80 px-4 py-3
                   dark:border-slate-700 dark:bg-slate-900/80"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ editingTypeId ? 'Edit Leave Type' : 'New Leave Type' }}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  Define how this holiday leave type behaves for expatriates.
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full
                       text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="typeDialog = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="px-4 py-3">
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="space-y-1 sm:col-span-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Code
                </label>
                <input
                  v-model="typeForm.code"
                  type="text"
                  placeholder="AL, SL, UPL..."
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                         text-[12px] text-slate-800 outline-none
                         focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  Short code will be used in balances & reports.
                </p>
              </div>

              <div class="space-y-1 sm:col-span-2">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Name
                </label>
                <input
                  v-model="typeForm.name"
                  type="text"
                  placeholder="Annual Leave, Sick Leave..."
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                         text-[12px] text-slate-800 outline-none
                         focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div class="mt-3 space-y-1">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Description
              </label>
              <textarea
                v-model="typeForm.description"
                rows="2"
                placeholder="Optional: explain usage or conditions for this holiday leave."
                class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                       text-[12px] text-slate-800 outline-none
                       focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              ></textarea>
            </div>

            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Yearly Entitlement (days)
                </label>
                <input
                  v-model.number="typeForm.yearlyEntitlement"
                  type="number"
                  min="0"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                         text-[12px] text-slate-800 outline-none
                         focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  Default days per year. You can still adjust per employee profile.
                </p>
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Display Order
                </label>
                <input
                  v-model.number="typeForm.order"
                  type="number"
                  min="0"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                         text-[12px] text-slate-800 outline-none
                         focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  Smaller number = higher in the dropdown list.
                </p>
              </div>
            </div>

            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2
                          dark:bg-slate-900">
                <div>
                  <div class="text-[12px] font-medium text-slate-700 dark:text-slate-100">
                    Requires Balance
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    If off, system won’t check remaining holiday balance.
                  </div>
                </div>
                <button
                  type="button"
                  class="relative inline-flex h-6 w-11 items-center rounded-full border
                         transition-colors"
                  :class="typeForm.requiresBalance
                    ? 'border-sky-500 bg-sky-500'
                    : 'border-slate-400 bg-slate-300 dark:border-slate-500 dark:bg-slate-600'"
                  @click="typeForm.requiresBalance = !typeForm.requiresBalance"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-white shadow
                           transition-transform"
                    :class="typeForm.requiresBalance ? 'translate-x-5' : 'translate-x-1'"
                  ></span>
                </button>
              </div>

              <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2
                          dark:bg-slate-900">
                <div>
                  <div class="text-[12px] font-medium text-slate-700 dark:text-slate-100">
                    Active
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Inactive types are hidden from new holiday requests.
                  </div>
                </div>
                <button
                  type="button"
                  class="relative inline-flex h-6 w-11 items-center rounded-full border
                         transition-colors"
                  :class="typeForm.isActive
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-slate-400 bg-slate-300 dark:border-slate-500 dark:bg-slate-600'"
                  @click="typeForm.isActive = !typeForm.isActive"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-white shadow
                           transition-transform"
                    :class="typeForm.isActive ? 'translate-x-5' : 'translate-x-1'"
                  ></span>
                </button>
              </div>
            </div>

            <div
              v-if="typeError"
              class="mt-2 text-[11px] text-rose-600 dark:text-rose-400"
            >
              {{ typeError }}
            </div>
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5
                   dark:border-slate-700 dark:bg-slate-900/80"
          >
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium
                     text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800"
              @click="typeDialog = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5
                     text-[11px] font-semibold text-white shadow-sm
                     hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="typeSaving"
              @click="saveType"
            >
              <i class="fa-solid fa-floppy-disk text-[11px]" />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- MODAL: Confirm Delete -->
    <transition name="modal-fade">
      <div
        v-if="confirmDeleteOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2"
      >
        <div
          class="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200
                 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950"
        >
          <div
            class="border-b border-slate-200 bg-rose-50/80 px-4 py-3
                   dark:border-slate-700 dark:bg-rose-950/60"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-rose-700 dark:text-rose-200">
                  Delete leave type?
                </div>
                <div class="text-[11px] text-rose-700/80 dark:text-rose-200/80">
                  This action cannot be undone.
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full
                       text-rose-700 hover:bg-rose-100/70
                       dark:text-rose-200 dark:hover:bg-rose-900/70"
                @click="cancelDelete"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 text-[12px] text-slate-700 dark:text-slate-100">
            Are you sure you want to delete
            <span class="font-semibold">
              {{ typeToDelete?.code }} — {{ typeToDelete?.name }}
            </span>
            ?
          </div>

          <div
            class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5
                   dark:border-slate-700 dark:bg-slate-900/80"
          >
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium
                     text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800"
              @click="cancelDelete"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5
                     text-[11px] font-semibold text-white shadow-sm
                     hover:bg-rose-700"
              @click="confirmDelete"
            >
              <i class="fa-regular fa-trash-can text-[11px]" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.table-th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
}
.table-td {
  padding: 8px 10px;
  vertical-align: top;
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

/* Modal transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>

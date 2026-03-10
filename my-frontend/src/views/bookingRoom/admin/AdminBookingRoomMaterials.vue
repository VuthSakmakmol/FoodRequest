<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminBookingRoomMaterial' })

const { showToast } = useToast()

/* ───────────────── Helpers ───────────────── */
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
function arr(v) {
  return Array.isArray(v) ? v : []
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

/* ───────────────── State ───────────────── */
const loading = ref(false)
const saving = ref(false)

const rows = ref([])

const q = ref('')
const activeFilter = ref('ACTIVE') // ALL | ACTIVE | INACTIVE

const showModal = ref(false)
const modalMode = ref('create') // create | edit
const editingId = ref('')

const form = ref({
  code: '',
  name: '',
  totalQty: 0,
  isActive: true,
})

const formErrors = ref([])

const confirmOpen = ref(false)
const confirmLoading = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
const confirmAction = ref(null)

let masterRefreshTimer = null

/* ───────────────── Computed ───────────────── */
const filteredRows = computed(() => {
  let list = arr(rows.value)

  const term = s(q.value).toLowerCase()
  if (term) {
    list = list.filter((x) => {
      return [
        s(x.code),
        s(x.name),
        String(num(x.totalQty)),
        x.isActive ? 'active' : 'inactive',
      ].some((v) => v.toLowerCase().includes(term))
    })
  }

  if (activeFilter.value === 'ACTIVE') {
    list = list.filter((x) => !!x.isActive)
  } else if (activeFilter.value === 'INACTIVE') {
    list = list.filter((x) => !x.isActive)
  }

  return list
})

const totalCount = computed(() => arr(rows.value).length)
const activeCount = computed(() => arr(rows.value).filter((x) => x.isActive).length)
const inactiveCount = computed(() => arr(rows.value).filter((x) => !x.isActive).length)

/* ───────────────── API ───────────────── */
async function loadRows({ silent = false } = {}) {
  try {
    if (!silent) loading.value = true

    const { data } = await api.get('/booking-room/admin/materials', {
      params: {
        active: 'ALL',
        q: '',
      },
    })

    rows.value = arr(data).map((x) => ({
      _id: x?._id || '',
      code: up(x?.code),
      name: s(x?.name),
      totalQty: Math.max(0, num(x?.totalQty)),
      isActive: !!x?.isActive,
      createdAt: x?.createdAt || '',
      updatedAt: x?.updatedAt || '',
    }))
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Load failed',
      message: e?.response?.data?.message || 'Failed to load material list.',
    })
  } finally {
    if (!silent) loading.value = false
  }
}

async function createRow(payload) {
  await api.post('/booking-room/admin/materials', payload)
}

async function updateRow(id, payload) {
  await api.patch(`/booking-room/admin/materials/${id}`, payload)
}

async function deleteRow(id) {
  await api.delete(`/booking-room/admin/materials/${id}`)
}

/* ───────────────── Form ───────────────── */
function resetForm() {
  form.value = {
    code: '',
    name: '',
    totalQty: 0,
    isActive: true,
  }
  formErrors.value = []
  editingId.value = ''
  modalMode.value = 'create'
}

function openCreate() {
  resetForm()
  modalMode.value = 'create'
  showModal.value = true
}

function openEdit(row) {
  modalMode.value = 'edit'
  editingId.value = row?._id || ''
  form.value = {
    code: s(row?.code),
    name: s(row?.name),
    totalQty: Math.max(0, num(row?.totalQty)),
    isActive: !!row?.isActive,
  }
  formErrors.value = []
  showModal.value = true
}

function closeModal() {
  if (saving.value) return
  showModal.value = false
}

function validateForm() {
  const e = []
  const f = form.value

  if (!s(f.code)) e.push('Code is required.')
  if (!s(f.name)) e.push('Name is required.')

  if (!Number.isFinite(Number(f.totalQty)) || Number(f.totalQty) < 0) {
    e.push('Total quantity must be 0 or greater.')
  }

  formErrors.value = e
  return e.length === 0
}

async function submitForm() {
  if (!validateForm()) {
    showToast({
      type: 'warning',
      title: 'Please check the form',
      message: 'Some required fields are missing or invalid.',
    })
    return
  }

  try {
    saving.value = true

    const payload = {
      code: up(form.value.code).replace(/\s+/g, '_'),
      name: s(form.value.name),
      totalQty: Math.max(0, num(form.value.totalQty)),
      isActive: !!form.value.isActive,
    }

    if (modalMode.value === 'create') {
      await createRow(payload)
      showToast({
        type: 'success',
        title: 'Created',
        message: 'Material has been created successfully.',
      })
    } else {
      await updateRow(editingId.value, payload)
      showToast({
        type: 'success',
        title: 'Updated',
        message: 'Material has been updated successfully.',
      })
    }

    showModal.value = false
    await loadRows()
  } catch (e) {
    showToast({
      type: 'error',
      title: modalMode.value === 'create' ? 'Create failed' : 'Update failed',
      message: e?.response?.data?.message || 'Unable to save material.',
    })
  } finally {
    saving.value = false
  }
}

/* ───────────────── Confirm ───────────────── */
function askDeactivate(row) {
  confirmTitle.value = 'Deactivate material'
  confirmMessage.value = `Are you sure you want to deactivate "${s(row?.name) || s(row?.code)}"?`
  confirmAction.value = async () => {
    try {
      confirmLoading.value = true
      await deleteRow(row?._id)
      showToast({
        type: 'success',
        title: 'Deactivated',
        message: 'Material has been deactivated.',
      })
      confirmOpen.value = false
      await loadRows()
    } catch (e) {
      showToast({
        type: 'error',
        title: 'Deactivate failed',
        message: e?.response?.data?.message || 'Unable to deactivate material.',
      })
    } finally {
      confirmLoading.value = false
    }
  }
  confirmOpen.value = true
}

async function runConfirm() {
  if (typeof confirmAction.value === 'function') {
    await confirmAction.value()
  }
}

function closeConfirm() {
  if (confirmLoading.value) return
  confirmOpen.value = false
}

/* ───────────────── Realtime ───────────────── */
function queueMasterRefresh() {
  if (masterRefreshTimer) clearTimeout(masterRefreshTimer)
  masterRefreshTimer = setTimeout(() => {
    loadRows({ silent: true })
  }, 250)
}

function onMaterialMasterChanged() {
  queueMasterRefresh()
}

function onMastersChanged(payload) {
  if (up(payload?.type) && up(payload?.type) !== 'MATERIAL') return
  queueMasterRefresh()
}

/* ───────────────── Lifecycle ───────────────── */
onMounted(async () => {
  try {
    await subscribeRoleIfNeeded('MATERIAL_ADMIN')
  } catch {}

  await loadRows()

  socket.on('bookingroom:material-master:created', onMaterialMasterChanged)
  socket.on('bookingroom:material-master:updated', onMaterialMasterChanged)
  socket.on('bookingroom:material-master:deleted', onMaterialMasterChanged)
  socket.on('bookingroom:masters:changed', onMastersChanged)
})

onBeforeUnmount(() => {
  if (masterRefreshTimer) {
    clearTimeout(masterRefreshTimer)
    masterRefreshTimer = null
  }

  socket.off('bookingroom:material-master:created', onMaterialMasterChanged)
  socket.off('bookingroom:material-master:updated', onMaterialMasterChanged)
  socket.off('bookingroom:material-master:deleted', onMaterialMasterChanged)
  socket.off('bookingroom:masters:changed', onMastersChanged)
})
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
                Material Master Management
              </div>
              <div class="mt-1 text-[12px] text-white/80">
                Manage booking-room materials, stock quantity, and active status.
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

              <button
                class="ui-btn ui-btn-primary"
                type="button"
                @click="openCreate"
              >
                <i class="fa-solid fa-plus text-[11px]" />
                Add Material
              </button>
            </div>
          </div>
        </div>

        <div class="space-y-3 p-3">
          <!-- Summary -->
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Total
              </div>
              <div class="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {{ totalCount }}
              </div>
            </div>

            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/20">
              <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                Active
              </div>
              <div class="mt-2 text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
                {{ activeCount }}
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
              <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Inactive
              </div>
              <div class="mt-2 text-2xl font-extrabold text-slate-700 dark:text-slate-200">
                {{ inactiveCount }}
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
                    v-model="q"
                    type="text"
                    placeholder="Search code, name, qty, status..."
                    class="block w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-[13px]
                           text-slate-900 shadow-sm outline-none transition
                           focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                           dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                  />
                </div>
              </div>

              <div class="lg:col-span-4">
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Status
                </label>
                <select
                  v-model="activeFilter"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                         text-slate-900 shadow-sm outline-none transition
                         focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                         dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                >
                  <option value="ALL">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Mobile cards -->
          <div class="grid gap-3 xl:hidden">
            <div
              v-if="loading"
              class="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            >
              <i class="fa-solid fa-spinner animate-spin mr-2" />
              Loading materials...
            </div>

            <div
              v-else-if="!filteredRows.length"
              class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            >
              No materials found.
            </div>

            <div
              v-for="row in filteredRows"
              :key="row._id"
              class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <div class="truncate text-sm font-extrabold text-slate-900 dark:text-slate-100">
                      {{ row.name }}
                    </div>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                      :class="row.isActive
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'"
                    >
                      {{ row.isActive ? 'ACTIVE' : 'INACTIVE' }}
                    </span>
                  </div>

                  <div class="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                    {{ row.code }}
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 transition hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300"
                    @click="openEdit(row)"
                  >
                    <i class="fa-solid fa-pen text-[12px]" />
                  </button>

                  <button
                    type="button"
                    class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-300"
                    :disabled="!row.isActive"
                    @click="askDeactivate(row)"
                  >
                    <i class="fa-solid fa-trash text-[12px]" />
                  </button>
                </div>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <div class="font-bold text-slate-500 dark:text-slate-400">Qty</div>
                  <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {{ row.totalQty }}
                  </div>
                </div>

                <div>
                  <div class="font-bold text-slate-500 dark:text-slate-400">Updated</div>
                  <div class="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {{ fmtDateTime(row.updatedAt) }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Desktop table -->
          <div class="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:block">
            <div v-if="loading" class="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <i class="fa-solid fa-spinner animate-spin mr-2" />
              Loading materials...
            </div>

            <template v-else>
              <div v-if="!filteredRows.length" class="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No materials found.
              </div>

              <div v-else class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-slate-50 dark:bg-slate-800/70">
                    <tr class="text-left text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      <th class="px-4 py-3">No</th>
                      <th class="px-4 py-3">Code</th>
                      <th class="px-4 py-3">Name</th>
                      <th class="px-4 py-3">Total Qty</th>
                      <th class="px-4 py-3">Status</th>
                      <th class="px-4 py-3">Updated At</th>
                      <th class="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr
                      v-for="(row, idx) in filteredRows"
                      :key="row._id"
                      class="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        {{ idx + 1 }}
                      </td>

                      <td class="px-4 py-3">
                        <span class="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[12px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {{ row.code }}
                        </span>
                      </td>

                      <td class="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                        {{ row.name }}
                      </td>

                      <td class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        {{ row.totalQty }}
                      </td>

                      <td class="px-4 py-3">
                        <span
                          class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold"
                          :class="row.isActive
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'"
                        >
                          {{ row.isActive ? 'ACTIVE' : 'INACTIVE' }}
                        </span>
                      </td>

                      <td class="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {{ fmtDateTime(row.updatedAt) }}
                      </td>

                      <td class="px-4 py-3">
                        <div class="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300"
                            @click="openEdit(row)"
                          >
                            <i class="fa-solid fa-pen" />
                            Edit
                          </button>

                          <button
                            type="button"
                            class="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-300"
                            :disabled="!row.isActive"
                            @click="askDeactivate(row)"
                          >
                            <i class="fa-solid fa-trash" />
                            Deactivate
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

    <!-- Form modal -->
    <teleport to="body">
      <div
        v-if="showModal"
        class="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 p-4"
        @click.self="closeModal"
      >
        <div class="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div class="bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-5 py-4 text-white">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Booking Room Material
                </div>
                <div class="mt-1 text-base font-extrabold">
                  {{ modalMode === 'create' ? 'Create Material' : 'Edit Material' }}
                </div>
              </div>

              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
                :disabled="saving"
                @click="closeModal"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>
          </div>

          <div class="space-y-4 p-5">
            <div
              v-if="formErrors.length"
              class="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/30 dark:text-rose-200"
            >
              <div class="mb-1 font-extrabold">Please check the following:</div>
              <ul class="list-disc space-y-0.5 pl-4">
                <li v-for="(e, idx) in formErrors" :key="idx">{{ e }}</li>
              </ul>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Code
                </label>
                <input
                  v-model="form.code"
                  type="text"
                  placeholder="PROJECTOR"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px]
                         text-slate-900 shadow-sm outline-none transition
                         focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                         dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                />
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Name
                </label>
                <input
                  v-model="form.name"
                  type="text"
                  placeholder="Projector"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px]
                         text-slate-900 shadow-sm outline-none transition
                         focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                         dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                />
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Total Quantity
                </label>
                <input
                  v-model.number="form.totalQty"
                  type="number"
                  min="0"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px]
                         text-slate-900 shadow-sm outline-none transition
                         focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                         dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                />
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Status
                </label>
                <select
                  v-model="form.isActive"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px]
                         text-slate-900 shadow-sm outline-none transition
                         focus:border-sky-500 focus:ring-2 focus:ring-sky-200
                         dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-900/40"
                >
                  <option :value="true">Active</option>
                  <option :value="false">Inactive</option>
                </select>
              </div>
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                class="ui-btn ui-btn-soft"
                :disabled="saving"
                @click="closeModal"
              >
                Cancel
              </button>

              <button
                type="button"
                class="ui-btn ui-btn-primary"
                :disabled="saving"
                @click="submitForm"
              >
                <i v-if="saving" class="fa-solid fa-spinner animate-spin text-[11px]" />
                {{ saving ? 'Saving...' : modalMode === 'create' ? 'Create Material' : 'Save Changes' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </teleport>

    <!-- Confirm modal -->
    <teleport to="body">
      <div
        v-if="confirmOpen"
        class="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/50 p-4"
        @click.self="closeConfirm"
      >
        <div class="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div class="flex items-start gap-3">
            <div class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              <i class="fa-solid fa-triangle-exclamation" />
            </div>

            <div class="min-w-0 flex-1">
              <div class="text-base font-extrabold text-slate-900 dark:text-slate-100">
                {{ confirmTitle }}
              </div>
              <div class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {{ confirmMessage }}
              </div>
            </div>
          </div>

          <div class="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              class="ui-btn ui-btn-soft"
              :disabled="confirmLoading"
              @click="closeConfirm"
            >
              Cancel
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-2xl border border-rose-500 bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="confirmLoading"
              @click="runConfirm"
            >
              <i v-if="confirmLoading" class="fa-solid fa-spinner animate-spin text-[11px]" />
              Confirm
            </button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>
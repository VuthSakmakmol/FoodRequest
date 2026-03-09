<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminBookingRoomMaterials' })

const { showToast } = useToast()

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const saving = ref(false)
const rows = ref([])

const q = ref('')
const activeFilter = ref('ALL')

const showModal = ref(false)
const mode = ref('create')
const editingId = ref('')

const form = ref({
  code: '',
  name: '',
  totalQty: 0,
  sortOrder: 0,
  note: '',
  isActive: true,
})

const errors = ref([])

/* ───────────────── HELPERS ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function resetForm() {
  form.value = {
    code: '',
    name: '',
    totalQty: 0,
    sortOrder: 0,
    note: '',
    isActive: true,
  }
  errors.value = []
  editingId.value = ''
  mode.value = 'create'
}

function normalizeCode(v) {
  return up(v).replace(/\s+/g, '_')
}

function activeBadgeClass(v) {
  return v
    ? 'ui-badge ui-badge-success'
    : 'ui-badge ui-badge-danger'
}

function closeModal() {
  showModal.value = false
  resetForm()
}

function openCreate() {
  resetForm()
  mode.value = 'create'
  showModal.value = true
}

function openEdit(row) {
  mode.value = 'edit'
  editingId.value = s(row?._id)
  form.value = {
    code: s(row?.code),
    name: s(row?.name),
    totalQty: Number(row?.totalQty || 0),
    sortOrder: Number(row?.sortOrder || 0),
    note: s(row?.note),
    isActive: !!row?.isActive,
  }
  errors.value = []
  showModal.value = true
}

function validateForm() {
  const e = []
  const f = form.value

  if (!s(f.code)) e.push('Code is required.')
  if (!s(f.name)) e.push('Material name is required.')

  if (Number.isNaN(Number(f.totalQty)) || Number(f.totalQty) < 0) {
    e.push('Total quantity must be 0 or greater.')
  }

  if (Number.isNaN(Number(f.sortOrder))) {
    e.push('Sort order must be a valid number.')
  }

  errors.value = e
  return !e.length
}

/* ───────────────── API ───────────────── */
async function loadRows() {
  try {
    loading.value = true
    const { data } = await api.get('/booking-room/admin/materials', {
      params: {
        active: activeFilter.value,
        q: s(q.value),
      },
    })
    rows.value = Array.isArray(data) ? data : []
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Load failed',
      message: e?.response?.data?.message || 'Unable to load material master list.',
    })
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!validateForm()) {
    showToast({
      type: 'warning',
      title: 'Please check the form',
      message: 'Some fields are missing or invalid.',
    })
    return
  }

  try {
    saving.value = true

    const payload = {
      code: normalizeCode(form.value.code),
      name: s(form.value.name),
      totalQty: Number(form.value.totalQty || 0),
      sortOrder: Number(form.value.sortOrder || 0),
      note: s(form.value.note),
      isActive: !!form.value.isActive,
    }

    if (mode.value === 'create') {
      await api.post('/booking-room/admin/materials', payload)
      showToast({
        type: 'success',
        title: 'Created',
        message: 'Material has been created successfully.',
      })
    } else {
      await api.patch(`/booking-room/admin/materials/${editingId.value}`, payload)
      showToast({
        type: 'success',
        title: 'Updated',
        message: 'Material has been updated successfully.',
      })
    }

    closeModal()
    await loadRows()
  } catch (e) {
    showToast({
      type: 'error',
      title: mode.value === 'create' ? 'Create failed' : 'Update failed',
      message: e?.response?.data?.message || 'Unable to save material.',
    })
  } finally {
    saving.value = false
  }
}

async function softDelete(row) {
  const id = s(row?._id)
  if (!id) return

  const ok = window.confirm(`Deactivate material "${s(row?.name)}"?`)
  if (!ok) return

  try {
    await api.delete(`/booking-room/admin/materials/${id}`)
    showToast({
      type: 'success',
      title: 'Deactivated',
      message: 'Material has been deactivated.',
    })
    await loadRows()
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Delete failed',
      message: e?.response?.data?.message || 'Unable to deactivate material.',
    })
  }
}

async function quickToggleActive(row) {
  try {
    await api.patch(`/booking-room/admin/materials/${row._id}`, {
      isActive: !row.isActive,
    })

    showToast({
      type: 'success',
      title: 'Updated',
      message: `Material is now ${!row.isActive ? 'active' : 'inactive'}.`,
    })

    await loadRows()
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Update failed',
      message: e?.response?.data?.message || 'Unable to update material status.',
    })
  }
}

/* ───────────────── COMPUTED ───────────────── */
const filteredCountText = computed(() => {
  return `${rows.value.length} material${rows.value.length === 1 ? '' : 's'}`
})

/* ───────────────── INIT ───────────────── */
onMounted(loadRows)
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-3">
      <div class="ui-card overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div class="text-sm font-extrabold">Meeting Room Materials</div>
              <div class="mt-1 text-xs text-white/90">
                Manage material stock, display order, and active status for room booking requests.
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button class="ui-btn ui-btn-soft border-white/25 bg-white/10 text-white" type="button" @click="loadRows">
                <i class="fa-solid fa-rotate-right text-[11px]" />
                Refresh
              </button>
              <button class="ui-btn ui-btn-primary" type="button" @click="openCreate">
                <i class="fa-solid fa-plus text-[11px]" />
                Add Material
              </button>
            </div>
          </div>
        </div>

        <!-- FILTER BAR -->
        <div class="border-b border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div class="grid gap-2 md:grid-cols-12">
            <div class="md:col-span-6">
              <label class="ui-label">Search</label>
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" />
                <input
                  v-model="q"
                  class="ui-input pl-9"
                  type="text"
                  placeholder="Search code, material name..."
                  @keyup.enter="loadRows"
                />
              </div>
            </div>

            <div class="md:col-span-3">
              <label class="ui-label">Status</label>
              <select v-model="activeFilter" class="ui-select" @change="loadRows">
                <option value="ALL">All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>

            <div class="md:col-span-3 flex items-end gap-2">
              <button class="ui-btn ui-btn-soft w-full" type="button" @click="loadRows">
                <i class="fa-solid fa-filter text-[11px]" />
                Apply
              </button>
            </div>
          </div>

          <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {{ filteredCountText }}
          </div>
        </div>

        <!-- BODY -->
        <div class="p-3">
          <!-- DESKTOP -->
          <div class="hidden overflow-x-auto xl:block">
            <table class="ui-table min-w-full">
              <thead>
                <tr>
                  <th class="text-left">Code</th>
                  <th class="text-left">Material Name</th>
                  <th class="text-center">Total Qty</th>
                  <th class="text-center">Sort</th>
                  <th class="text-center">Status</th>
                  <th class="text-left">Note</th>
                  <th class="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading">
                  <td colspan="7" class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    <i class="fa-solid fa-spinner animate-spin mr-2" />
                    Loading materials...
                  </td>
                </tr>

                <tr v-else-if="!rows.length">
                  <td colspan="7" class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No material master data found.
                  </td>
                </tr>

                <tr v-for="row in rows" :key="row._id">
                  <td class="font-semibold">{{ row.code }}</td>
                  <td>{{ row.name || '—' }}</td>
                  <td class="text-center">{{ Number(row.totalQty || 0) }}</td>
                  <td class="text-center">{{ Number(row.sortOrder || 0) }}</td>
                  <td class="text-center">
                    <span :class="activeBadgeClass(row.isActive)">
                      {{ row.isActive ? 'ACTIVE' : 'INACTIVE' }}
                    </span>
                  </td>
                  <td>{{ row.note || '—' }}</td>
                  <td>
                    <div class="flex items-center justify-center gap-2">
                      <button class="ui-btn ui-btn-soft" type="button" @click="openEdit(row)">
                        <i class="fa-solid fa-pen-to-square text-[11px]" />
                        Edit
                      </button>
                      <button class="ui-btn ui-btn-soft" type="button" @click="quickToggleActive(row)">
                        <i class="fa-solid fa-power-off text-[11px]" />
                        {{ row.isActive ? 'Disable' : 'Enable' }}
                      </button>
                      <button
                        class="ui-btn border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200"
                        type="button"
                        @click="softDelete(row)"
                      >
                        <i class="fa-solid fa-trash-can text-[11px]" />
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- MOBILE / TABLET CARDS -->
          <div class="grid gap-3 xl:hidden">
            <div
              v-if="loading"
              class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
            >
              <i class="fa-solid fa-spinner animate-spin mr-2" />
              Loading materials...
            </div>

            <div
              v-else-if="!rows.length"
              class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
            >
              No material master data found.
            </div>

            <div
              v-for="row in rows"
              :key="row._id"
              class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                    {{ row.name || '—' }}
                  </div>
                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {{ row.code || '—' }}
                  </div>
                </div>

                <span :class="activeBadgeClass(row.isActive)">
                  {{ row.isActive ? 'ACTIVE' : 'INACTIVE' }}
                </span>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div class="text-slate-400">Total Qty</div>
                  <div class="font-medium text-slate-700 dark:text-slate-200">{{ Number(row.totalQty || 0) }}</div>
                </div>
                <div>
                  <div class="text-slate-400">Sort Order</div>
                  <div class="font-medium text-slate-700 dark:text-slate-200">{{ Number(row.sortOrder || 0) }}</div>
                </div>
                <div class="col-span-2">
                  <div class="text-slate-400">Note</div>
                  <div class="font-medium text-slate-700 dark:text-slate-200">{{ row.note || '—' }}</div>
                </div>
              </div>

              <div class="mt-3 flex flex-wrap gap-2">
                <button class="ui-btn ui-btn-soft" type="button" @click="openEdit(row)">
                  <i class="fa-solid fa-pen-to-square text-[11px]" />
                  Edit
                </button>
                <button class="ui-btn ui-btn-soft" type="button" @click="quickToggleActive(row)">
                  <i class="fa-solid fa-power-off text-[11px]" />
                  {{ row.isActive ? 'Disable' : 'Enable' }}
                </button>
                <button
                  class="ui-btn border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200"
                  type="button"
                  @click="softDelete(row)"
                >
                  <i class="fa-solid fa-trash-can text-[11px]" />
                  Deactivate
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MODAL -->
    <transition name="fade">
      <div
        v-if="showModal"
        class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4"
        @click.self="closeModal"
      >
        <div class="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {{ mode === 'create' ? 'Create Material' : 'Edit Material' }}
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                Manage stock quantity for bookable meeting room materials.
              </div>
            </div>

            <button
              class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              type="button"
              @click="closeModal"
            >
              <i class="fa-solid fa-xmark" />
            </button>
          </div>

          <div class="space-y-4 px-5 py-5">
            <div
              v-if="errors.length"
              class="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-[11px] text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/30 dark:text-rose-200"
            >
              <div class="mb-1 font-extrabold">Please check the following:</div>
              <ul class="list-disc space-y-0.5 pl-4">
                <li v-for="(e, idx) in errors" :key="idx">{{ e }}</li>
              </ul>
            </div>

            <div class="grid gap-4 md:grid-cols-12">
              <div class="md:col-span-4">
                <label class="ui-label">Code</label>
                <input
                  v-model="form.code"
                  class="ui-input"
                  type="text"
                  placeholder="PROJECTOR"
                />
              </div>

              <div class="md:col-span-8">
                <label class="ui-label">Material Name</label>
                <input
                  v-model="form.name"
                  class="ui-input"
                  type="text"
                  placeholder="Projector"
                />
              </div>

              <div class="md:col-span-4">
                <label class="ui-label">Total Quantity</label>
                <input
                  v-model.number="form.totalQty"
                  class="ui-input"
                  type="number"
                  min="0"
                  placeholder="0"
                />
              </div>

              <div class="md:col-span-4">
                <label class="ui-label">Sort Order</label>
                <input
                  v-model.number="form.sortOrder"
                  class="ui-input"
                  type="number"
                  placeholder="0"
                />
              </div>

              <div class="md:col-span-4 flex items-end">
                <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
                  Active
                </label>
              </div>

              <div class="md:col-span-12">
                <label class="ui-label">Note</label>
                <textarea
                  v-model="form.note"
                  class="ui-textarea min-h-[96px]"
                  placeholder="Optional note..."
                />
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
            <button class="ui-btn ui-btn-soft" type="button" :disabled="saving" @click="closeModal">
              Cancel
            </button>
            <button class="ui-btn ui-btn-primary" type="button" :disabled="saving" @click="save">
              <i v-if="saving" class="fa-solid fa-spinner animate-spin text-[11px]" />
              {{ mode === 'create' ? 'Create Material' : 'Save Changes' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>
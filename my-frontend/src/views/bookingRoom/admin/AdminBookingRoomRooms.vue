<!-- src/views/bookingRoom/admin/AdminBookingRoomRoom.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminBookingRoomRoom' })

const { showToast } = useToast()

/* ───────── Formatters ───────── */
function s(v) { return String(v ?? '').trim() }
function up(v) { return s(v).toUpperCase() }
function normCode(v) { return up(v).replace(/\s+/g, '_') }
function cleanText(v) { return s(v) || '—' }

/* ───────── Responsive State ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 1024 // lg breakpoint
}

/* ───────── State ───────── */
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)

const rows = ref([])
const q = ref('')
const active = ref('ALL')

const form = ref({
  code: '',
  name: '',
})

const editingId = ref('')
const showModal = ref(false)

const showDeleteModal = ref(false)
const targetDelete = ref(null)

/* ───────── Computed ───────── */
const modalTitle = computed(() => (editingId.value ? 'Edit Room' : 'Create Room'))
const submitLabel = computed(() => (saving.value ? 'Saving...' : editingId.value ? 'Update' : 'Create'))

const canSubmit = computed(() => {
  return !saving.value && !!normCode(form.value.code) && !!s(form.value.name)
})


const filteredRows = computed(() => {
  // Client-side filtering fallback if backend doesn't handle 'q' perfectly, 
  // but usually we just rely on API. Since the original relied on API mostly,
  // we'll just return rows.
  return rows.value
})

/* ───────── API ───────── */
async function fetchRows() {
  try {
    loading.value = true
    const { data } = await api.get('/booking-room/admin/rooms', {
      params: {
        active: active.value,
        q: q.value,
      },
    })
    rows.value = Array.isArray(data) ? data : []
  } catch (e) {
    console.error('fetchRows error', e)
    rows.value = []
    showToast({
      type: 'error',
      title: 'Load failed',
      message: e?.response?.data?.message || 'Unable to load room list.',
    })
  } finally {
    loading.value = false
  }
}

async function submitForm() {
  if (!canSubmit.value) return

  try {
    saving.value = true

    const payload = {
      code: normCode(form.value.code),
      name: s(form.value.name),
    }

    if (editingId.value) {
      await api.patch(`/booking-room/admin/rooms/${editingId.value}`, payload)
      showToast({ type: 'success', message: 'Room updated successfully.' })
    } else {
      await api.post('/booking-room/admin/rooms', payload)
      showToast({ type: 'success', message: 'Room created successfully.' })
    }

    closeModal()
    await fetchRows()
  } catch (e) {
    console.error('submitForm error', e)
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to save room.' })
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!targetDelete.value?._id) return

  try {
    deleting.value = true
    await api.delete(`/booking-room/admin/rooms/${targetDelete.value._id}`)
    showToast({ type: 'success', message: 'Room moved to inactive.' })
    closeDeleteModal()
    await fetchRows()
  } catch (e) {
    console.error('confirmDelete error', e)
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to delete room.' })
  } finally {
    deleting.value = false
  }
}

/* ───────── Actions ───────── */
function resetFilters() {
  q.value = ''
  active.value = 'ALL'
  fetchRows()
}

function resetForm() {
  form.value = { code: '', name: '' }
}

function openCreate() {
  editingId.value = ''
  resetForm()
  showModal.value = true
}

function openEdit(row) {
  editingId.value = String(row?._id || '')
  form.value = {
    code: s(row?.code),
    name: s(row?.name),
  }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingId.value = ''
  resetForm()
}

function askDelete(row) {
  targetDelete.value = row || null
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
  targetDelete.value = null
}

/* ───────── Modal UX: Body Lock & ESC ───────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  if (on) document.body.classList.add('overflow-hidden')
  else document.body.classList.remove('overflow-hidden')
}

watch([showModal, showDeleteModal], ([mod, del]) => {
  lockBodyScroll(mod || del)
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (showDeleteModal.value) return closeDeleteModal()
  if (showModal.value) return closeModal()
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
    
    <!-- ✅ Max Width Container -->
    <div class="mx-auto w-full max-w-7xl space-y-4">
      
      <!-- Top Card (Hero + Filters) -->
      <div class="ui-card overflow-hidden">
        
        <!-- Hero & Inline Stats -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">

            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <button type="button" class="ui-hero-btn" @click="fetchRows" :disabled="loading">
                <i :class="loading ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-rotate-right'" class="text-[11px]" />
                Refresh
              </button>
              <button type="button" class="ui-hero-btn ui-hero-btn-primary" @click="openCreate">
                <i class="fa-solid fa-plus text-[11px]" />
                New Room
              </button>
            </div>
          </div>
        </div>

        <!-- Compact Filters using .ui-field -->
        <div class="p-4 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="grid gap-3 grid-cols-1 md:grid-cols-3 lg:grid-cols-4">
            <div class="ui-field">
              <label class="ui-label">Status</label>
              <select v-model="active" class="ui-select" @change="fetchRows">
                <option value="ALL">All Rooms</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            
            <div class="ui-field lg:col-span-2">
              <label class="ui-label">Search Keyword</label>
              <div class="relative">
                <input v-model="q" type="text" class="ui-input pl-9" placeholder="Search room code or name..." @keyup.enter="fetchRows" />
                <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400" />
              </div>
            </div>

            <div class="flex items-end gap-2 h-full pt-1">
              <button type="button" class="ui-btn ui-btn-soft w-full" @click="resetFilters">Clear</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Body / Table Area -->
      <div>
        <div v-if="loading && !rows.length" class="space-y-3">
          <div class="ui-skeleton h-12 w-full" />
          <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-16 w-full" />
        </div>

        <div v-else>
          <!-- ✅ Mobile Cards -->
          <div v-if="isMobile" class="space-y-3">
            <div v-if="!filteredRows.length" class="ui-frame p-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
              No rooms found.
            </div>

            <div v-for="row in filteredRows" :key="row._id" class="ui-card p-4 border-l-4" :class="row.isActive !== false ? 'border-l-emerald-500' : 'border-l-rose-500'">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[15px] font-black text-slate-900 dark:text-slate-50 break-words">
                    {{ cleanText(row.name) }}
                  </div>
                  <div class="mt-1">
                    <span class="ui-badge ui-badge-info text-[10px]">{{ cleanText(row.code) }}</span>
                  </div>
                </div>
                <span class="ui-badge shrink-0" :class="row.isActive !== false ? 'ui-badge-success' : 'ui-badge-danger'">
                  {{ row.isActive !== false ? 'ACTIVE' : 'INACTIVE' }}
                </span>
              </div>

              <div class="my-3 ui-divider" />

              <div class="flex items-center justify-end gap-2">
                <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="openEdit(row)">
                  <i class="fa-solid fa-pen" /> Edit
                </button>
                <button type="button" class="ui-btn ui-btn-rose ui-btn-sm" @click="askDelete(row)" :disabled="row.isActive === false">
                  <i class="fa-solid fa-trash" /> Delete
                </button>
              </div>
            </div>
          </div>

          <!-- ✅ Desktop Table w/ Horizontal Scrolling -->
          <div v-else class="ui-table-wrap ui-scrollbar w-full overflow-x-auto block border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm bg-white dark:bg-slate-900">
            <table class="ui-table min-w-[760px] w-full text-left">
              <thead>
                <tr>
                  <th class="ui-th w-[70px] pl-4 text-center">No</th>
                  <th class="ui-th w-[220px] text-left">Room Code</th>
                  <th class="ui-th text-left">Room Name</th>
                  <th class="ui-th w-[140px] text-center">Status</th>
                  <th class="ui-th w-[180px] text-right pr-4">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!filteredRows.length">
                  <td colspan="5" class="ui-td py-10 text-slate-500 dark:text-slate-400 text-center">
                    No rooms found.
                  </td>
                </tr>

                <tr v-for="(row, idx) in filteredRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td font-bold text-center pl-4">{{ idx + 1 }}</td>
                  <td class="ui-td text-left">
                    <span class="ui-badge ui-badge-info">{{ cleanText(row.code) }}</span>
                  </td>
                  <td class="ui-td text-left">
                    <div class="font-extrabold text-slate-900 dark:text-slate-50">{{ cleanText(row.name) }}</div>
                  </td>
                  <td class="ui-td text-center">
                    <span class="ui-badge" :class="row.isActive !== false ? 'ui-badge-success' : 'ui-badge-danger'">
                      {{ row.isActive !== false ? 'ACTIVE' : 'INACTIVE' }}
                    </span>
                  </td>
                  <td class="ui-td text-right pr-4">
                    <div class="flex items-center justify-end gap-2">
                      <button type="button" class="ui-btn ui-btn-soft ui-btn-xs" @click="openEdit(row)" title="Edit">
                        <i class="fa-solid fa-pen" />
                      </button>
                      <button
                        type="button"
                        class="ui-btn ui-btn-rose ui-btn-xs"
                        @click="askDelete(row)"
                        :disabled="row.isActive === false"
                        title="Delete/Deactivate"
                      >
                        <i class="fa-solid fa-trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>

    <!-- ✅ Create / Edit Modal -->
    <div v-if="showModal" class="ui-modal-backdrop" @click.self="closeModal">
      <div class="ui-modal !max-w-lg p-0 overflow-hidden">
        
        <!-- Modal Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sky-500 text-white shadow-sky-500/30">
              <i :class="editingId ? 'fa-solid fa-pen-to-square' : 'fa-solid fa-plus'" class="text-lg" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                {{ modalTitle }}
              </div>
              <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Manage room code and name
              </div>
            </div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-sm shrink-0" type="button" @click="closeModal">
            <i class="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-5">
          <form id="roomForm" class="space-y-4" @submit.prevent="submitForm">
            <div class="ui-field">
              <label class="ui-label">Room Code</label>
              <input
                v-model="form.code"
                type="text"
                class="ui-input"
                placeholder="e.g., DARK_ROOM"
              />
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Automatically formats to UPPERCASE with underscores.
              </div>
            </div>

            <div class="ui-field">
              <label class="ui-label">Room Name</label>
              <input
                v-model="form.name"
                type="text"
                class="ui-input"
                placeholder="e.g., Dark Room / Photo Room"
              />
            </div>
          </form>
        </div>

        <!-- Footer -->
        <div class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex items-center justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-soft" @click="closeModal" :disabled="saving">
            Cancel
          </button>
          <button
            type="submit"
            form="roomForm"
            class="ui-btn ui-btn-primary"
            :disabled="!canSubmit"
          >
            <i :class="saving ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-floppy-disk'" />
            {{ submitLabel }}
          </button>
        </div>
      </div>
    </div>

    <!-- ✅ Delete Modal -->
    <div v-if="showDeleteModal" class="ui-modal-backdrop" @click.self="closeDeleteModal">
      <div class="ui-modal !max-w-md p-0 overflow-hidden">
        
        <!-- Modal Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white shadow-rose-500/30">
              <i class="fa-solid fa-triangle-exclamation text-lg" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                Delete Room
              </div>
              <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Marking room as inactive
              </div>
            </div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-sm shrink-0" type="button" @click="closeDeleteModal">
            <i class="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-5 space-y-4">
          <div class="text-[13px] font-medium text-slate-700 dark:text-slate-200">
            Are you sure you want to delete this room? It will be marked as <span class="font-bold text-rose-500">INACTIVE</span>.
          </div>

          <div class="ui-frame p-4 bg-rose-50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/50">
            <div class="grid gap-3">
              <div class="ui-field">
                <div class="ui-label">Room Code</div>
                <div class="text-[14px] font-black text-slate-900 dark:text-slate-50">{{ targetDelete?.code || '—' }}</div>
              </div>
              <div class="ui-field">
                <div class="ui-label">Room Name</div>
                <div class="text-[14px] font-black text-slate-900 dark:text-slate-50">{{ targetDelete?.name || '—' }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex items-center justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-soft" @click="closeDeleteModal" :disabled="deleting">
            Cancel
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-rose"
            @click="confirmDelete"
            :disabled="deleting"
          >
            <i :class="deleting ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-trash'" />
            Confirm Delete
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
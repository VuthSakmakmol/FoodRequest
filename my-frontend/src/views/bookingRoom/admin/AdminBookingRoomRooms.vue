<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminBookingRoomRoom' })

const { showToast } = useToast()

/* ───────── Helpers ───────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function cleanText(v) {
  return s(v) || '—'
}
function asCapacity(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.floor(n))
}

/* ───────── Responsive State ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 1024
}

/* ───────── State ───────── */
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)

const rows = ref([])
const q = ref('')
const active = ref('ALL')

const form = ref({
  name: '',
  capacity: 1,
  imageUrl: '',
})

const editingId = ref('')
const showModal = ref(false)

const showDeleteModal = ref(false)
const targetDelete = ref(null)

let masterRefreshTimer = null

/* ───────── Computed ───────── */
const modalTitle = computed(() => (editingId.value ? 'Edit Room' : 'Create Room'))
const submitLabel = computed(() =>
  saving.value ? 'Saving...' : editingId.value ? 'Update' : 'Create'
)

const canSubmit = computed(() => {
  return (
    !saving.value &&
    !!s(form.value.name) &&
    asCapacity(form.value.capacity) >= 1
  )
})

const filteredRows = computed(() => rows.value)

/* ───────── API ───────── */
async function fetchRows({ silent = false } = {}) {
  try {
    if (!silent) loading.value = true

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
    if (!silent) loading.value = false
  }
}

async function submitForm() {
  if (!canSubmit.value) return

  try {
    saving.value = true

    const payload = {
      name: s(form.value.name),
      capacity: asCapacity(form.value.capacity),
      imageUrl: s(form.value.imageUrl),
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
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Unable to save room.',
    })
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
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Unable to delete room.',
    })
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
  form.value = {
    name: '',
    capacity: 1,
    imageUrl: '',
  }
}

function openCreate() {
  editingId.value = ''
  resetForm()
  showModal.value = true
}

function openEdit(row) {
  editingId.value = String(row?._id || '')
  form.value = {
    name: s(row?.name),
    capacity: asCapacity(row?.capacity),
    imageUrl: s(row?.imageUrl),
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

/* ───────── Realtime ───────── */
function queueMasterRefresh() {
  if (masterRefreshTimer) clearTimeout(masterRefreshTimer)
  masterRefreshTimer = setTimeout(() => {
    fetchRows({ silent: true })
  }, 250)
}

function onRoomMasterChanged(payload) {
  if (up(payload?.type) && up(payload?.type) !== 'ROOM') return
  queueMasterRefresh()
}

function onMastersChanged(payload) {
  if (up(payload?.type) && up(payload?.type) !== 'ROOM') return
  queueMasterRefresh()
}

/* ───────── Modal UX ───────── */
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
onMounted(async () => {
  updateIsMobile()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  try {
    await subscribeRoleIfNeeded('ROOM_ADMIN')
  } catch {}

  await fetchRows()

  socket.on('bookingroom:room-master:created', onRoomMasterChanged)
  socket.on('bookingroom:room-master:updated', onRoomMasterChanged)
  socket.on('bookingroom:room-master:deleted', onRoomMasterChanged)
  socket.on('bookingroom:masters:changed', onMastersChanged)
})

onBeforeUnmount(() => {
  lockBodyScroll(false)

  if (masterRefreshTimer) {
    clearTimeout(masterRefreshTimer)
    masterRefreshTimer = null
  }

  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }

  socket.off('bookingroom:room-master:created', onRoomMasterChanged)
  socket.off('bookingroom:room-master:updated', onRoomMasterChanged)
  socket.off('bookingroom:room-master:deleted', onRoomMasterChanged)
  socket.off('bookingroom:masters:changed', onMastersChanged)
})
</script>

<template>
  <div class="ui-page min-h-[calc(100vh-48px)] p-2 sm:p-4">
    <div class="mx-auto w-full max-w-7xl space-y-4">
      <div class="ui-card overflow-hidden">
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <button type="button" class="ui-hero-btn" @click="fetchRows" :disabled="loading">
                <i
                  :class="loading ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-rotate-right'"
                  class="text-[11px]"
                />
                Refresh
              </button>

              <button type="button" class="ui-hero-btn ui-hero-btn-primary" @click="openCreate">
                <i class="fa-solid fa-plus text-[11px]" />
                New Room
              </button>
            </div>
          </div>
        </div>

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
                <input
                  v-model="q"
                  type="text"
                  class="ui-input pl-9"
                  placeholder="Search room name..."
                  @keyup.enter="fetchRows"
                />
                <i
                  class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[12px]"
                />
              </div>
            </div>

            <div class="ui-field">
              <label class="ui-label opacity-0">Actions</label>
              <button type="button" class="ui-btn ui-btn-soft w-full" @click="resetFilters">
                <i class="fa-solid fa-filter-circle-xmark" />
                Clear
              </button>
            </div>
          </div>
        </div>

        <div class="p-4">
          <div v-if="!isMobile" class="overflow-x-auto">
            <table class="ui-table min-w-full">
              <thead>
                <tr>
                  <th class="ui-th w-[70px] text-center">No</th>
                  <th class="ui-th min-w-[240px]">Room Name</th>
                  <th class="ui-th w-[110px] text-center">Capacity</th>
                  <th class="ui-th w-[150px] text-center">Image</th>
                  <th class="ui-th w-[120px] text-center">Status</th>
                  <th class="ui-th w-[160px] text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="loading">
                  <td colspan="6" class="ui-td text-center py-10 text-slate-500">
                    <i class="fa-solid fa-spinner animate-spin mr-2" />
                    Loading...
                  </td>
                </tr>

                <tr v-else-if="!filteredRows.length">
                  <td colspan="6" class="ui-td text-center py-10 text-slate-500">
                    No room data found.
                  </td>
                </tr>

                <tr v-for="(row, idx) in filteredRows" :key="row._id">
                  <td class="ui-td text-center">{{ idx + 1 }}</td>

                  <td class="ui-td">
                    <div class="font-medium text-slate-800 dark:text-slate-100">
                      {{ cleanText(row.name) }}
                    </div>
                  </td>

                  <td class="ui-td text-center">
                    <span class="ui-badge ui-badge-warning">
                      {{ asCapacity(row.capacity) }} pax
                    </span>
                  </td>

                  <td class="ui-td text-center">
                    <div v-if="row.imageUrl" class="flex justify-center">
                      <img
                        :src="row.imageUrl"
                        alt="Room"
                        class="h-12 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                      />
                    </div>
                    <span v-else class="text-xs text-slate-400">No image</span>
                  </td>

                  <td class="ui-td text-center">
                    <span
                      :class="row.isActive ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-muted'"
                    >
                      {{ row.isActive ? 'ACTIVE' : 'INACTIVE' }}
                    </span>
                  </td>

                  <td class="ui-td text-center">
                    <div class="flex items-center justify-center gap-2">
                      <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="openEdit(row)">
                        <i class="fa-solid fa-pen-to-square" />
                        Edit
                      </button>

                      <button
                        v-if="row.isActive"
                        type="button"
                        class="ui-btn ui-btn-danger ui-btn-sm"
                        @click="askDelete(row)"
                      >
                        <i class="fa-solid fa-trash" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="(row, idx) in filteredRows"
              :key="row._id"
              class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs text-slate-400">#{{ idx + 1 }}</div>
                  <div class="truncate text-sm font-extrabold text-slate-900 dark:text-slate-50">
                    {{ cleanText(row.name) }}
                  </div>
                </div>

                <span
                  :class="row.isActive ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-muted'"
                >
                  {{ row.isActive ? 'ACTIVE' : 'INACTIVE' }}
                </span>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-3">
                <div class="ui-field">
                  <div class="ui-label">Capacity</div>
                  <div class="text-[13px] font-bold text-slate-900 dark:text-slate-50">
                    {{ asCapacity(row.capacity) }} pax
                  </div>
                </div>

                <div class="ui-field">
                  <div class="ui-label">Image</div>
                  <div v-if="row.imageUrl">
                    <img
                      :src="row.imageUrl"
                      alt="Room"
                      class="h-16 w-full rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                    />
                  </div>
                  <div v-else class="text-[12px] text-slate-400">No image</div>
                </div>
              </div>

              <div class="mt-4 flex items-center gap-2">
                <button type="button" class="ui-btn ui-btn-soft ui-btn-sm flex-1" @click="openEdit(row)">
                  <i class="fa-solid fa-pen-to-square" />
                  Edit
                </button>

                <button
                  v-if="row.isActive"
                  type="button"
                  class="ui-btn ui-btn-danger ui-btn-sm flex-1"
                  @click="askDelete(row)"
                >
                  <i class="fa-solid fa-trash" />
                  Delete
                </button>
              </div>
            </div>

            <div v-if="loading" class="text-center py-8 text-slate-500">
              <i class="fa-solid fa-spinner animate-spin mr-2" />
              Loading...
            </div>

            <div v-else-if="!filteredRows.length" class="text-center py-8 text-slate-500">
              No room data found.
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="ui-modal-backdrop" @click.self="closeModal">
      <div class="ui-modal !max-w-2xl p-0 overflow-hidden">
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20"
        >
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
              {{ modalTitle }}
            </div>
            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Manage meeting room
            </div>
          </div>

          <button class="ui-btn ui-btn-ghost ui-btn-sm shrink-0" type="button" @click="closeModal">
            <i class="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>

        <div class="p-5">
          <form id="roomForm" class="space-y-4" @submit.prevent="submitForm">
            <div class="ui-field">
              <label class="ui-label">Room Name</label>
              <input
                v-model="form.name"
                type="text"
                class="ui-input"
                placeholder="e.g., Training Room / CEO Room / Meeting Room A"
              />
            </div>

            <div class="ui-field">
              <label class="ui-label">Capacity</label>
              <input
                v-model.number="form.capacity"
                type="number"
                min="1"
                class="ui-input"
                placeholder="e.g., 12"
              />
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Maximum number of participants this room can support.
              </div>
            </div>

            <div class="ui-field">
              <label class="ui-label">Image URL</label>
              <input
                v-model="form.imageUrl"
                type="text"
                class="ui-input"
                placeholder="https://example.com/room.jpg"
              />
            </div>

            <div v-if="form.imageUrl" class="ui-field">
              <label class="ui-label">Preview</label>
              <img
                :src="form.imageUrl"
                alt="Preview"
                class="h-44 w-full rounded-xl border border-slate-200 object-cover dark:border-slate-700"
              />
            </div>
          </form>
        </div>

        <div
          class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex items-center justify-end gap-2"
        >
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

    <div v-if="showDeleteModal" class="ui-modal-backdrop" @click.self="closeDeleteModal">
      <div class="ui-modal !max-w-md p-0 overflow-hidden">
        <div
          class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20"
        >
          <div class="flex items-center gap-3">
            <div
              class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white shadow-rose-500/30"
            >
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

        <div class="p-5 space-y-4">
          <div class="text-[13px] font-medium text-slate-700 dark:text-slate-200">
            Are you sure you want to delete this room? It will be marked as
            <span class="font-bold text-rose-500">INACTIVE</span>.
          </div>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div class="text-xs text-slate-500">Room Name</div>
            <div class="font-bold text-slate-900 dark:text-slate-50">
              {{ cleanText(targetDelete?.name) }}
            </div>
          </div>
        </div>

        <div
          class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex items-center justify-end gap-2"
        >
          <button type="button" class="ui-btn ui-btn-soft" @click="closeDeleteModal" :disabled="deleting">
            Cancel
          </button>

          <button
            type="button"
            class="ui-btn ui-btn-danger"
            @click="confirmDelete"
            :disabled="deleting"
          >
            <i :class="deleting ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-trash'" />
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
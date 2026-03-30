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
function isImageFile(file) {
  if (!file) return false
  return ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.type)
}
function normalizeWeeklyAvailability(wa) {
  return {
    mon: wa?.mon ?? true,
    tue: wa?.tue ?? true,
    wed: wa?.wed ?? true,
    thu: wa?.thu ?? true,
    fri: wa?.fri ?? true,
    sat: wa?.sat ?? true,
    sun: wa?.sun ?? true,
  }
}
function emptyWeeklyAvailability() {
  return {
    mon: true,
    tue: true,
    wed: true,
    thu: true,
    fri: true,
    sat: true,
    sun: true,
  }
}

/**
 * IMPORTANT:
 * backend returns imageUrl like /api/booking-room/admin/rooms/:id/image
 * but axios api instance already usually has baseURL ending in /api
 * so for api.get() we must convert:
 *   /api/booking-room/...  -> /booking-room/...
 * otherwise it becomes /api/api/booking-room/...
 */
function normalizeApiPathForAxios(rawUrl) {
  const raw = s(rawUrl)
  if (!raw) return ''

  if (/^https?:\/\//i.test(raw)) return raw

  let path = raw.startsWith('/') ? raw : `/${raw}`

  if (path.startsWith('/api/')) {
    path = path.slice(4)
  } else if (path === '/api') {
    path = '/'
  }

  return path || '/'
}

function buildRoomImageApiPath(row) {
  const explicit = s(row?.imageUrl)
  if (explicit) return normalizeApiPathForAxios(explicit)

  if (row?._id) {
    return `/booking-room/admin/rooms/${row._id}/image`
  }

  return ''
}

function safeErrorMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback
}

const dayOptions = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
]

function weeklySummary(wa) {
  const value = normalizeWeeklyAvailability(wa)
  const enabled = dayOptions.filter((d) => value[d.key]).map((d) => d.short)
  const disabled = dayOptions.filter((d) => !value[d.key]).map((d) => d.short)

  if (enabled.length === 7) return 'Open every day'
  if (enabled.length === 0) return 'Closed every day'
  if (disabled.length === 1) return `Closed on ${disabled[0]}`
  return `Open: ${enabled.join(', ')}`
}

function weekdayNote(wa) {
  const value = normalizeWeeklyAvailability(wa)
  const disabled = dayOptions.filter((d) => !value[d.key]).map((d) => d.label)

  if (!disabled.length) return 'This room is available every day of the week.'
  if (disabled.length === 7) return 'This room is not available on any weekday.'
  return `This room is closed on ${disabled.join(', ')} every week.`
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
  mon: true,
  tue: true,
  wed: true,
  thu: true,
  fri: true,
  sat: true,
  sun: true,
  imageFile: null,
  imageUrl: '',
  previewUrl: '',
  removeImage: false,
})

const editingId = ref('')
const showModal = ref(false)

const showDeleteModal = ref(false)
const targetDelete = ref(null)

let masterRefreshTimer = null
const rowImageObjectUrls = new Map()

/* ───────── Computed ───────── */
const modalTitle = computed(() => (editingId.value ? 'Edit Room' : 'Create Room'))
const submitLabel = computed(() =>
  saving.value ? 'Saving...' : editingId.value ? 'Update' : 'Create'
)

const canSubmit = computed(() => {
  return !saving.value && !!s(form.value.name) && asCapacity(form.value.capacity) >= 1
})

const filteredRows = computed(() => rows.value)

const currentPreview = computed(() => {
  if (form.value.removeImage) return ''
  return form.value.previewUrl || s(form.value.imageUrl)
})

/* ───────── Blob image handling ───────── */
function revokeRowImage(row) {
  if (!row?._id) return
  const oldUrl = rowImageObjectUrls.get(String(row._id))
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl)
    rowImageObjectUrls.delete(String(row._id))
  }
}

function revokeAllRowImages() {
  for (const objectUrl of rowImageObjectUrls.values()) {
    URL.revokeObjectURL(objectUrl)
  }
  rowImageObjectUrls.clear()
}

async function loadRowImage(row) {
  if (!row) return

  if (!row?._id && !row?.imageUrl) {
    row._imageSrc = ''
    row.__imageLoading = false
    row.__imageBroken = false
    return
  }

  const path = buildRoomImageApiPath(row)
  if (!path) {
    row._imageSrc = ''
    row.__imageLoading = false
    row.__imageBroken = true
    return
  }

  row.__imageLoading = true
  row.__imageBroken = false

  try {
    const res = await api.get(path, { responseType: 'blob' })
    const blob = res?.data

    if (!(blob instanceof Blob) || !blob.size) {
      throw new Error('Empty image blob')
    }

    revokeRowImage(row)
    const objectUrl = URL.createObjectURL(blob)
    rowImageObjectUrls.set(String(row._id), objectUrl)
    row._imageSrc = objectUrl
  } catch (err) {
    row._imageSrc = ''
    row.__imageBroken = true
    console.warn('room image load failed:', row?._id, path, err?.message)
  } finally {
    row.__imageLoading = false
  }
}

async function loadAllRowImages(targetRows = []) {
  await Promise.all((Array.isArray(targetRows) ? targetRows : []).map((row) => loadRowImage(row)))
}

function onRowImageError(row) {
  if (!row) return
  row.__imageBroken = true
  row._imageSrc = ''
}

/* ───────── File handlers ───────── */
function revokePreviewUrl() {
  if (form.value.previewUrl && form.value.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(form.value.previewUrl)
  }
  form.value.previewUrl = ''
}

function onPickImage(event) {
  const file = event?.target?.files?.[0] || null
  if (!file) return

  if (!isImageFile(file)) {
    showToast({
      type: 'error',
      title: 'Invalid file',
      message: 'Only JPG, JPEG, PNG, and WEBP files are allowed.',
    })
    event.target.value = ''
    return
  }

  revokePreviewUrl()
  form.value.imageFile = file
  form.value.removeImage = false
  form.value.previewUrl = URL.createObjectURL(file)
}

function removeSelectedImage() {
  revokePreviewUrl()
  form.value.imageFile = null

  if (editingId.value && form.value.imageUrl) {
    form.value.removeImage = true
  } else {
    form.value.imageUrl = ''
    form.value.removeImage = false
  }
}

function setAllDays(enabled) {
  form.value.mon = enabled
  form.value.tue = enabled
  form.value.wed = enabled
  form.value.thu = enabled
  form.value.fri = enabled
  form.value.sat = enabled
  form.value.sun = enabled
}

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

    revokeAllRowImages()

    rows.value = (Array.isArray(data) ? data : []).map((row) => ({
      ...row,
      __imageBroken: false,
      __imageLoading: false,
      _imageSrc: '',
    }))

    await loadAllRowImages(rows.value)
  } catch (e) {
    console.error('fetchRows error', e)
    revokeAllRowImages()
    rows.value = []
    showToast({
      type: 'error',
      title: 'Load failed',
      message: safeErrorMessage(e, 'Unable to load room list.'),
    })
  } finally {
    if (!silent) loading.value = false
  }
}

async function submitForm() {
  if (!canSubmit.value) return

  try {
    saving.value = true

    const fd = new FormData()
    fd.append('name', s(form.value.name))
    fd.append('capacity', String(asCapacity(form.value.capacity)))

    fd.append('mon', String(!!form.value.mon))
    fd.append('tue', String(!!form.value.tue))
    fd.append('wed', String(!!form.value.wed))
    fd.append('thu', String(!!form.value.thu))
    fd.append('fri', String(!!form.value.fri))
    fd.append('sat', String(!!form.value.sat))
    fd.append('sun', String(!!form.value.sun))

    if (form.value.imageFile) {
      fd.append('image', form.value.imageFile)
    }

    if (form.value.removeImage) {
      fd.append('removeImage', 'true')
    }

    if (editingId.value) {
      await api.patch(`/booking-room/admin/rooms/${editingId.value}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      showToast({ type: 'success', message: 'Room updated successfully.' })
    } else {
      await api.post('/booking-room/admin/rooms', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      showToast({ type: 'success', message: 'Room created successfully.' })
    }

    closeModal()
    await fetchRows()
  } catch (e) {
    console.error('submitForm error', e)
    showToast({
      type: 'error',
      message: safeErrorMessage(e, 'Unable to save room.'),
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
      message: safeErrorMessage(e, 'Unable to delete room.'),
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
  revokePreviewUrl()
  form.value = {
    name: '',
    capacity: 1,
    ...emptyWeeklyAvailability(),
    imageFile: null,
    imageUrl: '',
    previewUrl: '',
    removeImage: false,
  }
}

function openCreate() {
  editingId.value = ''
  resetForm()
  showModal.value = true
}

function openEdit(row) {
  editingId.value = String(row?._id || '')
  revokePreviewUrl()

  const wa = normalizeWeeklyAvailability(row?.weeklyAvailability)

  form.value = {
    name: s(row?.name),
    capacity: asCapacity(row?.capacity),
    mon: wa.mon,
    tue: wa.tue,
    wed: wa.wed,
    thu: wa.thu,
    fri: wa.fri,
    sat: wa.sat,
    sun: wa.sun,
    imageFile: null,
    imageUrl: row?._imageSrc || '',
    previewUrl: '',
    removeImage: false,
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
  revokePreviewUrl()
  revokeAllRowImages()

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
                  <th class="ui-th min-w-[220px]">Room Name</th>
                  <th class="ui-th w-[110px] text-center">Capacity</th>
                  <th class="ui-th min-w-[230px] text-center">Availability</th>
                  <th class="ui-th w-[150px] text-center">Image</th>
                  <th class="ui-th w-[120px] text-center">Status</th>
                  <th class="ui-th w-[160px] text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="loading">
                  <td colspan="7" class="ui-td text-center py-10 text-slate-500">
                    <i class="fa-solid fa-spinner animate-spin mr-2" />
                    Loading...
                  </td>
                </tr>

                <tr v-else-if="!filteredRows.length">
                  <td colspan="7" class="ui-td text-center py-10 text-slate-500">
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
                    <div class="flex flex-wrap items-center justify-center gap-1.5">
                      <span
                        v-for="day in dayOptions"
                        :key="day.key"
                        class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset"
                        :class="row?.weeklyAvailability?.[day.key] !== false
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
                          : 'bg-slate-100 text-slate-400 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700'"
                      >
                        {{ day.short }}
                      </span>
                    </div>
                    <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {{ weeklySummary(row.weeklyAvailability) }}
                    </div>
                  </td>

                  <td class="ui-td text-center">
                    <div
                      v-if="row.__imageLoading"
                      class="mx-auto flex h-12 w-20 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <i class="fa-solid fa-spinner animate-spin text-[12px]" />
                    </div>

                    <img
                      v-else-if="row._imageSrc"
                      :src="row._imageSrc"
                      alt="Room"
                      class="mx-auto h-12 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                      @error="onRowImageError(row)"
                    />

                    <span v-else class="text-xs text-slate-400">No image</span>
                  </td>

                  <td class="ui-td text-center">
                    <span :class="row.isActive ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-muted'">
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

                <span :class="row.isActive ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-muted'">
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

                  <div
                    v-if="row.__imageLoading"
                    class="flex h-16 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <i class="fa-solid fa-spinner animate-spin text-[12px]" />
                  </div>

                  <img
                    v-else-if="row._imageSrc"
                    :src="row._imageSrc"
                    alt="Room"
                    class="h-16 w-full rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                    @error="onRowImageError(row)"
                  />

                  <div v-else class="text-[12px] text-slate-400">No image</div>
                </div>
              </div>

              <div class="mt-3 ui-field">
                <div class="ui-label">Availability</div>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="day in dayOptions"
                    :key="day.key"
                    class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset"
                    :class="row?.weeklyAvailability?.[day.key] !== false
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
                      : 'bg-slate-100 text-slate-400 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700'"
                  >
                    {{ day.short }}
                  </span>
                </div>
                <div class="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  {{ weeklySummary(row.weeklyAvailability) }}
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

    <div v-if="showModal" class="ui-modal-backdrop p-2 sm:p-4" @click.self="closeModal">
      <div class="ui-modal w-full !max-w-3xl p-0 overflow-hidden max-h-[95vh] sm:max-h-[92vh] flex flex-col">
        <div
          class="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20"
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

        <div class="flex-1 overflow-y-auto p-4 sm:p-5">
          <form id="roomForm" class="space-y-4" @submit.prevent="submitForm">
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            </div>

            <div class="ui-field">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label class="ui-label !mb-0">Availability Days</label>

                <div class="flex flex-wrap gap-2">
                  <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="setAllDays(true)">
                    <i class="fa-solid fa-check-double" />
                    All On
                  </button>

                  <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="setAllDays(false)">
                    <i class="fa-solid fa-ban" />
                    All Off
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <label
                  v-for="day in dayOptions"
                  :key="day.key"
                  class="flex cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2.5 transition"
                  :class="form[day.key]
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'"
                >
                  <input
                    v-model="form[day.key]"
                    type="checkbox"
                    class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span class="text-sm font-semibold">{{ day.label }}</span>
                </label>
              </div>

              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Unchecked day means this room cannot be booked on that weekday every week.
              </div>
            </div>

            <div class="ui-field">
              <label class="ui-label">Short Note</label>
              <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                {{ weekdayNote(form) }}
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div class="ui-field">
                <label class="ui-label">Room Image</label>

                <label
                  class="flex min-h-[132px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:bg-slate-800"
                >
                  <i class="fa-solid fa-image text-slate-400" />
                  <span class="break-all text-center">
                    {{ form.imageFile ? form.imageFile.name : 'Choose image file' }}
                  </span>
                  <input
                    type="file"
                    class="hidden"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    @change="onPickImage"
                  />
                </label>

                <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Allowed: JPG, JPEG, PNG, WEBP. Recommended image for room preview.
                </div>
              </div>

              <div v-if="currentPreview" class="ui-field">
                <div class="flex items-center justify-between gap-2">
                  <label class="ui-label">Preview</label>

                  <button
                    type="button"
                    class="ui-btn ui-btn-soft ui-btn-sm"
                    @click="removeSelectedImage"
                  >
                    <i class="fa-solid fa-trash-can" />
                    Remove Image
                  </button>
                </div>

                <img
                  :src="currentPreview"
                  alt="Preview"
                  class="h-44 sm:h-56 w-full rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                />
              </div>
            </div>
          </form>
        </div>

        <div
          class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end"
        >
          <button type="button" class="ui-btn ui-btn-soft w-full sm:w-auto" @click="closeModal" :disabled="saving">
            Cancel
          </button>

          <button
            type="submit"
            form="roomForm"
            class="ui-btn ui-btn-primary w-full sm:w-auto"
            :disabled="!canSubmit"
          >
            <i :class="saving ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-floppy-disk'" />
            {{ submitLabel }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDeleteModal" class="ui-modal-backdrop p-2 sm:p-4" @click.self="closeDeleteModal">
      <div class="ui-modal w-full !max-w-md p-0 overflow-hidden max-h-[95vh] sm:max-h-[92vh] flex flex-col">
        <div
          class="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20"
        >
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

        <div class="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
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
          class="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end"
        >
          <button type="button" class="ui-btn ui-btn-soft w-full sm:w-auto" @click="closeDeleteModal" :disabled="deleting">
            Cancel
          </button>

          <button
            type="button"
            class="ui-btn ui-btn-danger w-full sm:w-auto"
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
<!-- src/views/expat/admin/AdminAddSignature.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'
import api from '@/utils/api' // still use for normal GET (search + preview meta)
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminAddSignature' })

const { showToast } = useToast()

/* -----------------------------
  Config
----------------------------- */
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '') // e.g. http://localhost:4333/api

const ROLES = [
  { label: 'Leave Admin', id: 'leave_admin' },
  { label: 'Leave GM', id: 'leave_gm' },
  { label: 'Leave COO', id: 'leave_coo' },
]

/* -----------------------------
  State
----------------------------- */
const roleId = ref('leave_admin')

const empQuery = ref('')
const empResults = ref([])
const empSelected = ref(null)

const approverFile = ref(null)
const approverLocalUrl = ref('')
const approverServer = ref({ exists: false, url: '', loading: false })
const approverUploading = ref(false)

const empFile = ref(null)
const empLocalUrl = ref('')
const empServer = ref({ exists: false, url: '', loading: false })
const empUploading = ref(false)

const searchLoading = ref(false)
const searchError = ref('')

/* -----------------------------
  Helpers
----------------------------- */
function token() {
  return localStorage.getItem('token') || ''
}
function isAllowedImage(file) {
  const t = String(file?.type || '').toLowerCase()
  return ['image/png', 'image/jpeg', 'image/webp'].includes(t)
}
function pickFile(ev) {
  return ev?.target?.files?.[0] || null
}
function revoke(url) {
  try { if (url) URL.revokeObjectURL(url) } catch {}
}
function absUrl(urlOrPath) {
  if (!urlOrPath) return ''
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath
  // backend returns "/api/...." or "/uploads/...."
  const origin = API_BASE.replace(/\/api$/, '')
  return `${origin}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`
}
function errMsg(e, fallback = 'Request failed') {
  return e?.response?.data?.message || e?.message || fallback
}

/* -----------------------------
  Debounced search
----------------------------- */
let searchTimer = null
watch(empQuery, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})

async function runSearch() {
  const q = String(empQuery.value || '').trim()
  empResults.value = []
  searchError.value = ''
  if (!q) return

  searchLoading.value = true
  try {
    const { data } = await api.get('/public/employees', { params: { q } })
    const rows = Array.isArray(data) ? data : (data?.items || data?.rows || [])
    empResults.value = rows.slice(0, 8).map(normalizeEmployee)
  } catch (e) {
    searchError.value = errMsg(e, 'Search failed')
  } finally {
    searchLoading.value = false
  }
}

function normalizeEmployee(r) {
  if (!r) return null
  const id = r.employeeId || r.empId || r.id || r.employee_code || r.code || ''
  const name =
    r.name ||
    r.fullName ||
    r.employeeName ||
    `${r.firstName || ''} ${r.lastName || ''}`.trim()

  return {
    employeeId: String(id).trim(),
    name: String(name || '').trim(),
    dept: r.department || r.dept || r.departmentName || '',
    raw: r,
  }
}

function selectEmployee(row) {
  empSelected.value = row
  empResults.value = []
  empQuery.value = ''
}

/* -----------------------------
  Preview fetch (meta)
----------------------------- */
async function refreshApproverPreview() {
  const loginId = String(roleId.value || '').trim()
  if (!loginId) return

  approverServer.value = { exists: false, url: '', loading: true }
  try {
    const { data } = await api.get(`/admin/signatures/users/${encodeURIComponent(loginId)}`)
    approverServer.value = {
      loading: false,
      exists: !!data?.exists,
      url: absUrl(data?.url || ''),
    }
  } catch {
    approverServer.value = { exists: false, url: '', loading: false }
  }
}

async function refreshEmployeePreview() {
  const empId = String(empSelected.value?.employeeId || '').trim()
  if (!empId) {
    empServer.value = { exists: false, url: '', loading: false }
    return
  }

  empServer.value = { exists: false, url: '', loading: true }
  try {
    const { data } = await api.get(`/admin/signatures/employees/${encodeURIComponent(empId)}`)
    empServer.value = {
      loading: false,
      exists: !!data?.exists,
      url: absUrl(data?.url || ''),
    }
  } catch {
    empServer.value = { exists: false, url: '', loading: false }
  }
}

watch(roleId, async () => {
  clearApproverFile()
  await refreshApproverPreview()
})

watch(() => empSelected.value?.employeeId, async () => {
  clearEmpFile()
  await refreshEmployeePreview()
})

onMounted(async () => {
  await refreshApproverPreview()
})

onBeforeUnmount(() => {
  revoke(approverLocalUrl.value)
  revoke(empLocalUrl.value)
})

/* -----------------------------
  File pick
----------------------------- */
function onPickApprover(ev) {
  const f = pickFile(ev)
  clearApproverFile()
  if (!f) return

  if (!isAllowedImage(f)) {
    showToast({ type: 'error', title: 'Invalid file', message: 'Only PNG/JPG/WEBP allowed.' })
    return
  }
  if (f.size > 2 * 1024 * 1024) {
    showToast({ type: 'error', title: 'Too large', message: 'Max size is 2MB.' })
    return
  }

  approverFile.value = f
  approverLocalUrl.value = URL.createObjectURL(f)
}

function onPickEmp(ev) {
  const f = pickFile(ev)
  clearEmpFile()
  if (!f) return

  if (!isAllowedImage(f)) {
    showToast({ type: 'error', title: 'Invalid file', message: 'Only PNG/JPG/WEBP allowed.' })
    return
  }
  if (f.size > 2 * 1024 * 1024) {
    showToast({ type: 'error', title: 'Too large', message: 'Max size is 2MB.' })
    return
  }

  empFile.value = f
  empLocalUrl.value = URL.createObjectURL(f)
}

function clearApproverFile() {
  approverFile.value = null
  revoke(approverLocalUrl.value)
  approverLocalUrl.value = ''
}
function clearEmpFile() {
  empFile.value = null
  revoke(empLocalUrl.value)
  empLocalUrl.value = ''
}

/* -----------------------------
  Upload (IMPORTANT)
  Use plain axios to avoid any api interceptor issues.
  Do NOT set Content-Type manually.
----------------------------- */
async function uploadApprover() {
  const loginId = String(roleId.value || '').trim()
  if (!loginId) return
  if (!approverFile.value) {
    showToast({ type: 'warning', title: 'No file', message: 'Choose a file first.' })
    return
  }

  approverUploading.value = true
  try {
    const fd = new FormData()
    fd.append('signature', approverFile.value)

    await axios.post(
      `${API_BASE}/admin/signatures/users/${encodeURIComponent(loginId)}`,
      fd,
      {
        headers: {
          Authorization: token() ? `Bearer ${token()}` : undefined,
          // ✅ don't set Content-Type (let browser add boundary)
        },
      }
    )

    showToast({ type: 'success', title: 'Uploaded', message: `Saved signature for ${loginId}.` })
    clearApproverFile()
    await refreshApproverPreview()
  } catch (e) {
    showToast({ type: 'error', title: 'Upload failed', message: errMsg(e) })
  } finally {
    approverUploading.value = false
  }
}

async function uploadEmployee() {
  const empId = String(empSelected.value?.employeeId || '').trim()
  if (!empId) {
    showToast({ type: 'warning', title: 'No employee', message: 'Select an employee first.' })
    return
  }
  if (!empFile.value) {
    showToast({ type: 'warning', title: 'No file', message: 'Choose a file first.' })
    return
  }

  empUploading.value = true
  try {
    const fd = new FormData()
    fd.append('signature', empFile.value)

    await axios.post(
      `${API_BASE}/admin/signatures/employees/${encodeURIComponent(empId)}`,
      fd,
      {
        headers: {
          Authorization: token() ? `Bearer ${token()}` : undefined,
        },
      }
    )

    showToast({ type: 'success', title: 'Uploaded', message: `Saved signature for employee ${empId}.` })
    clearEmpFile()
    await refreshEmployeePreview()
  } catch (e) {
    showToast({ type: 'error', title: 'Upload failed', message: errMsg(e) })
  } finally {
    empUploading.value = false
  }
}

const selectedLabel = computed(() => {
  if (!empSelected.value) return 'No employee selected'
  const e = empSelected.value
  return `${e.name || 'Employee'} • ${e.employeeId}${e.dept ? ' • ' + e.dept : ''}`
})
</script>

<template>
  <div class="w-full font-brand text-slate-900 dark:text-white">
    <!-- Header -->
    <div
      class="relative overflow-hidden rounded-2xl border border-white/60 bg-gradient-to-r from-amber-50 via-white to-emerald-50 p-6 shadow-sm
             dark:border-white/10 dark:from-amber-900/25 dark:via-slate-900/30 dark:to-emerald-900/20"
    >
      <div class="absolute -right-20 -top-16 h-56 w-56 rounded-full bg-amber-400/15 blur-3xl" />
      <div class="absolute -left-24 -bottom-20 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
      <div class="relative">
        <h1 class="text-2xl font-extrabold tracking-tight">Signatures</h1>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Upload and preview approver & employee signatures.
        </p>
      </div>
    </div>

    <div class="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-12">
      <!-- Left: actions -->
      <div class="lg:col-span-5 space-y-5">
        <!-- Approver upload -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-bold">Approver</h2>
            <button class="btn-lite" type="button" @click="refreshApproverPreview">Refresh</button>
          </div>

          <div class="mt-4">
            <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Role</label>
            <select v-model="roleId" class="input mt-1">
              <option v-for="r in ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
            </select>
          </div>

          <div class="mt-4">
            <input type="file" accept="image/png,image/jpeg,image/webp" class="file" @change="onPickApprover" />
          </div>

          <div class="mt-4 flex gap-2">
            <button class="btn-primary" :disabled="approverUploading || !approverFile" @click="uploadApprover">
              {{ approverUploading ? 'Uploading…' : 'Upload' }}
            </button>
            <button class="btn-lite" type="button" :disabled="approverUploading" @click="clearApproverFile">Clear</button>
          </div>
        </div>

        <!-- Employee search + upload -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-bold">Employee</h2>
            <button class="btn-lite" type="button" :disabled="!empSelected" @click="refreshEmployeePreview">Refresh</button>
          </div>

          <div class="mt-4">
            <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Search</label>
            <input v-model="empQuery" class="input mt-1" placeholder="Type employee ID or name…" />
            <div v-if="searchLoading" class="mt-2 text-xs text-slate-500">Searching…</div>
            <div v-if="searchError" class="mt-2 text-xs text-rose-600">{{ searchError }}</div>
          </div>

          <div v-if="empResults.length" class="mt-3 space-y-2">
            <button
              v-for="e in empResults"
              :key="e.employeeId"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm hover:bg-slate-100
                     dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              @click="selectEmployee(e)"
              type="button"
            >
              <div class="font-semibold">{{ e.name || 'Unknown' }}</div>
              <div class="mt-0.5 text-xs text-slate-600 dark:text-slate-300">ID: {{ e.employeeId }}</div>
            </button>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
            <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">Selected</div>
            <div class="mt-1 font-semibold">{{ selectedLabel }}</div>
          </div>

          <div class="mt-4">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="file"
              :disabled="!empSelected"
              @change="onPickEmp"
            />
          </div>

          <div class="mt-4 flex gap-2">
            <button class="btn-primary" :disabled="empUploading || !empFile || !empSelected" @click="uploadEmployee">
              {{ empUploading ? 'Uploading…' : 'Upload' }}
            </button>
            <button class="btn-lite" type="button" :disabled="empUploading" @click="clearEmpFile">Clear</button>
          </div>
        </div>
      </div>

      <!-- Right: previews -->
      <div class="lg:col-span-7 space-y-5">
        <!-- Approver preview -->
        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
            <div>
              <div class="text-base font-bold">Approver Preview</div>
              <div class="text-xs text-slate-500 dark:text-slate-300">{{ roleId }}</div>
            </div>
            <div class="text-xs" :class="approverServer.exists ? 'text-emerald-600' : 'text-slate-500'">
              {{ approverServer.loading ? 'Loading…' : (approverServer.exists ? 'Saved' : 'Not set') }}
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <div class="box">
              <div class="title">Local</div>
              <div class="frame">
                <img v-if="approverLocalUrl" :src="approverLocalUrl" class="img" />
                <div v-else class="empty">Choose a file</div>
              </div>
            </div>

            <div class="box">
              <div class="title">Server</div>
              <div class="frame">
                <img v-if="approverServer.exists && approverServer.url" :src="approverServer.url" class="img" />
                <div v-else class="empty">Upload to see</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Employee preview -->
        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
            <div>
              <div class="text-base font-bold">Employee Preview</div>
              <div class="text-xs text-slate-500 dark:text-slate-300">{{ empSelected?.employeeId || '—' }}</div>
            </div>
            <div class="text-xs" :class="empServer.exists ? 'text-emerald-600' : 'text-slate-500'">
              {{ empServer.loading ? 'Loading…' : (empServer.exists ? 'Saved' : 'Not set') }}
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <div class="box">
              <div class="title">Local</div>
              <div class="frame">
                <img v-if="empLocalUrl" :src="empLocalUrl" class="img" />
                <div v-else class="empty">Choose a file</div>
              </div>
            </div>

            <div class="box">
              <div class="title">Server</div>
              <div class="frame">
                <img v-if="empServer.exists && empServer.url" :src="empServer.url" class="img" />
                <div v-else class="empty">Upload to see</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.input {
  @apply w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none
  focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200
  dark:border-white/10 dark:bg-white/5 dark:focus:ring-emerald-500/20;
}
.file {
  @apply block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2
  file:text-sm file:font-semibold file:text-slate-800 hover:file:bg-slate-200
  dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15;
}
.btn-primary {
  @apply inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white
  shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60;
}
.btn-lite {
  @apply rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50
  dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10;
}
.box { @apply rounded-2xl border border-slate-200 p-4 dark:border-white/10; }
.title { @apply text-sm font-bold; }
.frame { @apply mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5; }
.img { @apply h-44 w-full object-contain; }
.empty { @apply flex h-44 items-center justify-center text-sm text-slate-400; }
</style>

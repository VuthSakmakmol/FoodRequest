<!-- src/views/expat/admin/AdminAddSignature.vue
  ✅ Employee-first (default)
  ✅ Approver section behind a toggle
  ✅ Soft SKY borders everywhere (no bold black lines)
  ✅ Reduced font weight (no “extra bold”)
  ✅ Uses your existing api + axios upload (no manual Content-Type)
  ✅ Uses your standard ui-* classes + only light extra sky accents
-->
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import axios from 'axios'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminAddSignature' })

const { showToast } = useToast()

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

const ROLES = [
  { label: 'Leave Admin', id: 'leave_admin' },
  { label: 'Leave GM', id: 'leave_gm' },
  { label: 'Leave COO', id: 'leave_coo' },
]

// toggle approver section
const showApprover = ref(false)

// approver role
const roleId = ref('leave_admin')

// employee search
const empQuery = ref('')
const empResults = ref([])
const empSelected = ref(null)

// approver file + preview
const approverFile = ref(null)
const approverLocalUrl = ref('')
const approverServer = ref({ exists: false, url: '', loading: false })
const approverUploading = ref(false)

// employee file + preview
const empFile = ref(null)
const empLocalUrl = ref('')
const empServer = ref({ exists: false, url: '', loading: false })
const empUploading = ref(false)

// search ui
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
  try {
    if (url) URL.revokeObjectURL(url)
  } catch {}
}
function absUrl(urlOrPath) {
  if (!urlOrPath) return ''
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath
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
    const rows = Array.isArray(data) ? data : data?.items || data?.rows || []
    empResults.value = rows
      .slice(0, 8)
      .map(normalizeEmployee)
      .filter(Boolean)
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
  Preview fetch
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
  if (showApprover.value) await refreshApproverPreview()
})

watch(
  () => empSelected.value?.employeeId,
  async () => {
    clearEmpFile()
    await refreshEmployeePreview()
  }
)

watch(showApprover, async (on) => {
  if (on) await refreshApproverPreview()
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

function clearEmployeeSelection() {
  empSelected.value = null
  empResults.value = []
  empQuery.value = ''
  clearEmpFile()
  empServer.value = { exists: false, url: '', loading: false }
}

/* -----------------------------
  Upload
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

    await axios.post(`${API_BASE}/admin/signatures/users/${encodeURIComponent(loginId)}`, fd, {
      headers: { Authorization: token() ? `Bearer ${token()}` : undefined },
    })

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

    await axios.post(`${API_BASE}/admin/signatures/employees/${encodeURIComponent(empId)}`, fd, {
      headers: { Authorization: token() ? `Bearer ${token()}` : undefined },
    })

    showToast({ type: 'success', title: 'Uploaded', message: `Saved signature for employee ${empId}.` })
    clearEmpFile()
    await refreshEmployeePreview()
  } catch (e) {
    showToast({ type: 'error', title: 'Upload failed', message: errMsg(e) })
  } finally {
    empUploading.value = false
  }
}

/* -----------------------------
  Computed
----------------------------- */
const selectedLabel = computed(() => {
  if (!empSelected.value) return 'No employee selected'
  const e = empSelected.value
  return `${e.name || 'Employee'} • ${e.employeeId}${e.dept ? ' • ' + e.dept : ''}`
})

const empHasServer = computed(() => !!(empServer.value.exists && empServer.value.url))
const apprHasServer = computed(() => !!(approverServer.value.exists && approverServer.value.url))
</script>

<template>
  <div class="ui-page w-full px-3 py-3">
    <!-- Hero -->
    <div class="ui-hero p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="ui-hero-kicker">Expat Leave · Admin</div>
          <div class="ui-hero-title mt-1">Signature Manager</div>
          <div class="ui-hero-subtitle">Upload and preview employee & approver signatures in one place.</div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="ui-badge ui-badge-info">
            <i class="fa-solid fa-user-check text-[10px]" />
            Employee first
          </span>

          <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="showApprover = !showApprover">
            <i class="fa-solid" :class="showApprover ? 'fa-toggle-on' : 'fa-toggle-off'" />
            {{ showApprover ? 'Approver ON' : 'Approver OFF' }}
          </button>
        </div>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <!-- Employee -->
      <section class="ui-card p-4 lg:col-span-5">
        <div class="flex items-start justify-between gap-2 pl-6">
          <div>
            <div class="ui-section-title">Employee</div>
            <div class="ui-section-desc">Search → select employee → upload signature.</div>
          </div>

          <button
            type="button"
            class="ui-btn ui-btn-ghost ui-btn-sm"
            :disabled="!empSelected"
            @click="refreshEmployeePreview"
            :title="empSelected ? 'Refresh employee preview' : 'Select employee first'"
          >
            <i class="fa-solid fa-rotate" />
            Refresh
          </button>
        </div>

        <div class="mt-4 ui-field pl-6">
          <label class="ui-label">Search employee</label>
          <input v-model="empQuery" class="ui-input" placeholder="Type employee ID or name…" />
          <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Tip: type at least 2–3 characters.
          </div>

          <div v-if="searchLoading" class="mt-2 text-[12px] text-slate-500">Searching…</div>
          <div v-if="searchError" class="mt-2 text-[12px] text-rose-600">{{ searchError }}</div>
        </div>

        <!-- Results -->
        <div v-if="empResults.length" class="mt-3 space-y-2 pl-6">
          <button
            v-for="e in empResults"
            :key="e.employeeId"
            type="button"
            class="w-full rounded-2xl border px-4 py-3 text-left transition
                   border-sky-200/50 bg-white/70 hover:bg-sky-50
                   dark:border-slate-800/70 dark:bg-slate-950/40 dark:hover:bg-slate-900/35"
            @click="selectEmployee(e)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                  {{ e.name || 'Unknown' }}
                </div>
                <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                  ID: <span class="font-mono font-semibold">{{ e.employeeId }}</span>
                  <span v-if="e.dept" class="mx-2 text-slate-300">•</span>
                  <span v-if="e.dept" class="truncate">{{ e.dept }}</span>
                </div>
              </div>

              <span class="ui-badge ui-badge-success">
                <i class="fa-solid fa-check text-[10px]" />
                Select
              </span>
            </div>
          </button>
        </div>

        <!-- Selected -->
        <div
          class="mt-4 rounded-2xl border p-3 pl-6
                 border-sky-200/50 bg-white/70
                 dark:border-slate-800/70 dark:bg-slate-950/35"
        >
          <div class="text-[10px] uppercase tracking-[0.28em] font-semibold text-slate-500 dark:text-slate-400">
            Selected
          </div>
          <div class="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
            {{ selectedLabel }}
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <span class="ui-badge" :class="empHasServer ? 'ui-badge-success' : 'ui-badge-warning'">
              <i class="fa-solid" :class="empHasServer ? 'fa-shield-check' : 'fa-circle-exclamation'" />
              {{ empServer.loading ? 'Loading…' : (empHasServer ? 'Saved on server' : 'Not set') }}
            </span>

            <button v-if="empSelected" type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="clearEmployeeSelection">
              <i class="fa-solid fa-xmark" />
              Clear selection
            </button>
          </div>
        </div>

        <!-- File + actions -->
        <div class="mt-4 pl-6">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="block w-full text-[12px]
                   file:mr-3 file:rounded-xl file:border-0 file:bg-sky-50 file:px-4 file:py-2
                   file:text-[12px] file:font-semibold file:text-slate-800 hover:file:bg-sky-100
                   dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15"
            :disabled="!empSelected"
            @change="onPickEmp"
          />

          <div class="mt-3 flex flex-wrap gap-2">
            <button class="ui-btn ui-btn-primary" :disabled="empUploading || !empFile || !empSelected" @click="uploadEmployee">
              <i class="fa-solid" :class="empUploading ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-up'" />
              {{ empUploading ? 'Uploading…' : 'Upload' }}
            </button>

            <button class="ui-btn ui-btn-soft" type="button" :disabled="empUploading" @click="clearEmpFile">
              <i class="fa-solid fa-eraser" />
              Clear file
            </button>
          </div>
        </div>
      </section>

      <!-- Employee Preview -->
      <section class="ui-card p-4 lg:col-span-7">
        <div class="flex items-start justify-between gap-2 pl-6">
          <div>
            <div class="ui-section-title">Employee Preview</div>
            <div class="ui-section-desc">Local preview vs server preview.</div>
          </div>

          <span class="ui-badge" :class="empHasServer ? 'ui-badge-info' : 'ui-badge-warning'">
            <i class="fa-solid" :class="empHasServer ? 'fa-server' : 'fa-inbox'" />
            {{ empServer.loading ? 'Loading…' : (empHasServer ? 'Server OK' : 'Server empty') }}
          </span>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 pl-6">
          <div class="rounded-2xl border p-3 border-sky-200/50 bg-white/60 dark:border-slate-800/70 dark:bg-slate-950/35">
            <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Local</div>
            <div class="mt-2 ui-frame">
              <img v-if="empLocalUrl" :src="empLocalUrl" class="h-48 w-full object-contain" />
              <div v-else class="flex h-48 items-center justify-center text-[12px] text-slate-400">Choose a file</div>
            </div>
          </div>

          <div class="rounded-2xl border p-3 border-sky-200/50 bg-white/60 dark:border-slate-800/70 dark:bg-slate-950/35">
            <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Server</div>
            <div class="mt-2 ui-frame">
              <img v-if="empHasServer" :src="empServer.url" class="h-48 w-full object-contain" />
              <div v-else class="flex h-48 items-center justify-center text-[12px] text-slate-400">Upload to see</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Approver (toggle) -->
      <section v-if="showApprover" class="ui-card p-4 lg:col-span-12">
        <div class="flex flex-wrap items-start justify-between gap-3 pl-6">
          <div>
            <div class="ui-section-title">Approver</div>
            <div class="ui-section-desc">Choose role → upload signature → preview.</div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class="ui-btn ui-btn-ghost ui-btn-sm" type="button" @click="refreshApproverPreview">
              <i class="fa-solid fa-rotate" />
              Refresh
            </button>

            <span class="ui-badge" :class="apprHasServer ? 'ui-badge-info' : 'ui-badge-warning'">
              <i class="fa-solid" :class="apprHasServer ? 'fa-shield-check' : 'fa-circle-exclamation'" />
              {{ approverServer.loading ? 'Loading…' : (apprHasServer ? 'Saved on server' : 'Not set') }}
            </span>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-12 pl-6">
          <div class="lg:col-span-5 space-y-3">
            <div class="ui-field">
              <label class="ui-label">Role</label>
              <select v-model="roleId" class="ui-select">
                <option v-for="r in ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
              </select>
            </div>

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="block w-full text-[12px]
                     file:mr-3 file:rounded-xl file:border-0 file:bg-sky-50 file:px-4 file:py-2
                     file:text-[12px] file:font-semibold file:text-slate-800 hover:file:bg-sky-100
                     dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15"
              @change="onPickApprover"
            />

            <div class="flex flex-wrap gap-2">
              <button class="ui-btn ui-btn-primary" :disabled="approverUploading || !approverFile" @click="uploadApprover">
                <i class="fa-solid" :class="approverUploading ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-up'" />
                {{ approverUploading ? 'Uploading…' : 'Upload' }}
              </button>

              <button class="ui-btn ui-btn-soft" type="button" :disabled="approverUploading" @click="clearApproverFile">
                <i class="fa-solid fa-eraser" />
                Clear file
              </button>
            </div>
          </div>

          <div class="lg:col-span-7 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div class="rounded-2xl border p-3 border-sky-200/50 bg-white/60 dark:border-slate-800/70 dark:bg-slate-950/35">
              <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Local</div>
              <div class="mt-2 ui-frame">
                <img v-if="approverLocalUrl" :src="approverLocalUrl" class="h-48 w-full object-contain" />
                <div v-else class="flex h-48 items-center justify-center text-[12px] text-slate-400">Choose a file</div>
              </div>
            </div>

            <div class="rounded-2xl border p-3 border-sky-200/50 bg-white/60 dark:border-slate-800/70 dark:bg-slate-950/35">
              <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Server</div>
              <div class="mt-2 ui-frame">
                <img v-if="apprHasServer" :src="approverServer.url" class="h-48 w-full object-contain" />
                <div v-else class="flex h-48 items-center justify-center text-[12px] text-slate-400">Upload to see</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

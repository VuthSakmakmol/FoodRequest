<!-- src/views/expat/admin/AdminAddSignature.vue
  ✅ Tidy layout (2 columns desktop, stacked mobile)
  ✅ EmployeeDirectory search (debounced)
  ✅ Upload signatures:
      - Users: leave_admin / leave_gm / leave_coo
      - Employees: <employeeId>
  ✅ Preview:
      - Local file preview
      - Server preview (GET /api/admin/signatures/* to avoid 404 spam)
  ✅ Uses api util + useToast (no alerts)
-->
<script setup>
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminAddSignature' })

const { showToast } = useToast()

/* ───────────────── helpers ───────────────── */
function debounce(fn, ms = 250) {
  let t = null
  return (...args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
function safeStr(v) {
  return String(v ?? '').trim()
}
function buildAbsUrl(urlOrPath) {
  if (!urlOrPath) return ''
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath

  // api base: e.g. VITE_API_URL = https://domain.com/api
  const base = (import.meta.env.VITE_API_URL || '')
    .replace(/\/api\/?$/, '')
    .replace(/\/$/, '')

  return base ? `${base}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}` : urlOrPath
}
function fmtBytes(n) {
  const num = Number(n || 0)
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(2)} MB`
}
function isImg(file) {
  const t = String(file?.type || '').toLowerCase()
  return t === 'image/png' || t === 'image/jpeg'
}
function errMsg(e, fallback = 'Request failed') {
  return e?.response?.data?.message || e?.message || fallback
}

/* ───────────────── layout: mobile check ───────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 1024
}
onMounted(() => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
})

/* ───────────────── role/user signature ───────────────── */
const ROLE_OPTIONS = [
  { label: 'Leave Admin', loginId: 'leave_admin' },
  { label: 'Leave GM', loginId: 'leave_gm' },
  { label: 'Leave COO', loginId: 'leave_coo' },
]
const roleKey = ref('leave_admin')
const userLoginId = computed(() => roleKey.value)

/* user signature state */
const userFile = ref(null)
const userLocalUrl = ref('')
const userServer = ref({ loading: false, exists: false, url: '' })
const userUploading = ref(false)

/* ───────────────── employee signature ───────────────── */
const q = ref('')
const searching = ref(false)
const searchErr = ref('')
const results = ref([])
const selected = ref(null)

const empFile = ref(null)
const empLocalUrl = ref('')
const empServer = ref({ loading: false, exists: false, url: '' })
const empUploading = ref(false)

/* ───────────────── search EmployeeDirectory ─────────────────
   Uses: GET /api/public/employees?q=
*/
const runSearch = debounce(async () => {
  const query = safeStr(q.value)
  results.value = []
  searchErr.value = ''
  if (!query) return

  searching.value = true
  try {
    const { data } = await api.get('/public/employees', { params: { q: query } })
    const items = Array.isArray(data) ? data : (data?.items || data?.rows || [])
    results.value = items.slice(0, 10)
  } catch (e) {
    searchErr.value = errMsg(e, 'Search failed')
  } finally {
    searching.value = false
  }
}, 250)

watch(q, () => runSearch())

/* ───────────────── preview fetchers (NO 404 spam) ───────────────── */
async function fetchUserServerPreview() {
  const loginId = safeStr(userLoginId.value)
  if (!loginId) return
  userServer.value = { loading: true, exists: false, url: '' }
  try {
    const { data } = await api.get(`/admin/signatures/users/${encodeURIComponent(loginId)}`)
    const url = data?.url ? buildAbsUrl(data.url) : ''
    userServer.value = { loading: false, exists: !!data?.exists, url }
  } catch {
    userServer.value = { loading: false, exists: false, url: '' }
  }
}

async function fetchEmpServerPreview() {
  const empId = safeStr(selected.value?.employeeId || selected.value?.empId || selected.value?.id)
  if (!empId) {
    empServer.value = { loading: false, exists: false, url: '' }
    return
  }
  empServer.value = { loading: true, exists: false, url: '' }
  try {
    const { data } = await api.get(`/admin/signatures/employees/${encodeURIComponent(empId)}`)
    const url = data?.url ? buildAbsUrl(data.url) : ''
    empServer.value = { loading: false, exists: !!data?.exists, url }
  } catch {
    empServer.value = { loading: false, exists: false, url: '' }
  }
}

watch(roleKey, async () => {
  userFile.value = null
  if (userLocalUrl.value) URL.revokeObjectURL(userLocalUrl.value)
  userLocalUrl.value = ''
  await fetchUserServerPreview()
})

watch(
  () => selected.value?.employeeId || selected.value?.empId || selected.value?.id,
  async () => {
    empFile.value = null
    if (empLocalUrl.value) URL.revokeObjectURL(empLocalUrl.value)
    empLocalUrl.value = ''
    await fetchEmpServerPreview()
  }
)

onMounted(async () => {
  await fetchUserServerPreview()
})

/* ───────────────── file handlers ───────────────── */
function onUserPick(ev) {
  const f = ev?.target?.files?.[0] || null
  userFile.value = null
  if (userLocalUrl.value) URL.revokeObjectURL(userLocalUrl.value)
  userLocalUrl.value = ''

  if (!f) return
  if (!isImg(f)) return showToast({ type: 'error', title: 'Invalid file', message: 'Only PNG/JPG allowed.' })
  if (f.size > 2 * 1024 * 1024) return showToast({ type: 'error', title: 'Too large', message: 'Max size is 2MB.' })

  userFile.value = f
  userLocalUrl.value = URL.createObjectURL(f)
}

function onEmpPick(ev) {
  const f = ev?.target?.files?.[0] || null
  empFile.value = null
  if (empLocalUrl.value) URL.revokeObjectURL(empLocalUrl.value)
  empLocalUrl.value = ''

  if (!f) return
  if (!isImg(f)) return showToast({ type: 'error', title: 'Invalid file', message: 'Only PNG/JPG allowed.' })
  if (f.size > 2 * 1024 * 1024) return showToast({ type: 'error', title: 'Too large', message: 'Max size is 2MB.' })

  empFile.value = f
  empLocalUrl.value = URL.createObjectURL(f)
}

/* ───────────────── uploads ───────────────── */
async function uploadUserSignature() {
  const loginId = safeStr(userLoginId.value)
  if (!loginId) return
  if (!userFile.value) return showToast({ type: 'warning', title: 'No file', message: 'Choose an image first.' })

  userUploading.value = true
  try {
    const fd = new FormData()
    fd.append('signature', userFile.value)

    await api.post(`/admin/signatures/users/${encodeURIComponent(loginId)}`, fd)

    showToast({ type: 'success', title: 'Uploaded', message: `${loginId} signature saved.` })
    await fetchUserServerPreview()

    userFile.value = null
    if (userLocalUrl.value) URL.revokeObjectURL(userLocalUrl.value)
    userLocalUrl.value = ''
  } catch (e) {
    showToast({ type: 'error', title: 'Upload failed', message: errMsg(e) })
  } finally {
    userUploading.value = false
  }
}

async function uploadEmployeeSignature() {
  const empId = safeStr(selected.value?.employeeId || selected.value?.empId || selected.value?.id)
  if (!empId) return showToast({ type: 'warning', title: 'No employee', message: 'Select an employee first.' })
  if (!empFile.value) return showToast({ type: 'warning', title: 'No file', message: 'Choose an image first.' })

  empUploading.value = true
  try {
    const fd = new FormData()
    fd.append('signature', empFile.value)

    await api.post(`/admin/signatures/employees/${encodeURIComponent(empId)}`, fd)

    showToast({ type: 'success', title: 'Uploaded', message: `Employee ${empId} signature saved.` })
    await fetchEmpServerPreview()

    empFile.value = null
    if (empLocalUrl.value) URL.revokeObjectURL(empLocalUrl.value)
    empLocalUrl.value = ''
  } catch (e) {
    showToast({ type: 'error', title: 'Upload failed', message: errMsg(e) })
  } finally {
    empUploading.value = false
  }
}

/* ───────────────── selection UI helpers ───────────────── */
function normalizeEmployee(row) {
  if (!row) return null
  return {
    employeeId: row.employeeId || row.empId || row.id || row.employee_code || row.code,
    name:
      row.name ||
      row.fullName ||
      row.employeeName ||
      `${row.firstName || ''} ${row.lastName || ''}`.trim(),
    dept: row.department || row.dept || row.departmentName || '',
    position: row.position || row.title || row.positionName || '',
    raw: row,
  }
}
function pickEmployee(row) {
  selected.value = normalizeEmployee(row)
  results.value = []
}

const selectedLabel = computed(() => {
  if (!selected.value) return 'No employee selected'
  const a = []
  if (selected.value.name) a.push(selected.value.name)
  if (selected.value.employeeId) a.push(`ID: ${selected.value.employeeId}`)
  if (selected.value.dept) a.push(selected.value.dept)
  return a.join(' • ')
})

function resetAll() {
  q.value = ''
  results.value = []
  selected.value = null

  userFile.value = null
  if (userLocalUrl.value) URL.revokeObjectURL(userLocalUrl.value)
  userLocalUrl.value = ''

  empFile.value = null
  if (empLocalUrl.value) URL.revokeObjectURL(empLocalUrl.value)
  empLocalUrl.value = ''

  fetchUserServerPreview()
  empServer.value = { loading: false, exists: false, url: '' }

  showToast({ type: 'success', title: 'Reset', message: 'Cleared current inputs.' })
}

onBeforeUnmount(() => {
  if (userLocalUrl.value) URL.revokeObjectURL(userLocalUrl.value)
  if (empLocalUrl.value) URL.revokeObjectURL(empLocalUrl.value)
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

      <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight">Add Signature</h1>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Manage approval signatures (Admin/GM/COO) and requester signatures (Employees).
          </p>
        </div>

        <button
          class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50
                 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          @click="resetAll"
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Main grid -->
    <div class="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-12">
      <!-- LEFT -->
      <div class="lg:col-span-5 space-y-5">
        <!-- Employee search -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-base font-bold">Employee Search</div>
              <div class="text-xs text-slate-500 dark:text-slate-300">EmployeeDirectory</div>
            </div>
            <div v-if="searching" class="text-xs text-slate-500 dark:text-slate-300">Searching…</div>
          </div>

          <div class="mt-4">
            <input
              v-model="q"
              type="text"
              placeholder="Search by ID or name…"
              class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 placeholder:text-slate-400
                     focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200
                     dark:border-white/10 dark:bg-white/5 dark:placeholder:text-slate-400 dark:focus:border-emerald-400 dark:focus:ring-emerald-500/20"
            />
            <div v-if="searchErr" class="mt-2 text-xs text-rose-600">{{ searchErr }}</div>
          </div>

          <div v-if="results.length" class="mt-3 space-y-2">
            <button
              v-for="(r, idx) in results"
              :key="idx"
              type="button"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm hover:bg-slate-100
                     dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              @click="pickEmployee(r)"
            >
              <div class="font-semibold">{{ normalizeEmployee(r)?.name || 'Unknown' }}</div>
              <div class="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                ID: {{ normalizeEmployee(r)?.employeeId || '-' }}
                <span v-if="normalizeEmployee(r)?.dept"> • Dept: {{ normalizeEmployee(r)?.dept }}</span>
              </div>
            </button>
          </div>

          <div
            v-if="selected"
            class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm
                   dark:border-emerald-400/20 dark:bg-emerald-400/10"
          >
            <div class="font-semibold">{{ selected.name || 'Selected Employee' }}</div>
            <div class="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
              ID: {{ selected.employeeId || '-' }}
              <span v-if="selected.dept"> • Dept: {{ selected.dept }}</span>
            </div>
          </div>
        </div>

        <!-- Upload: Approver -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-base font-bold">Upload Signature (Approver)</div>
            <button
              class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50
                     dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              type="button"
              @click="fetchUserServerPreview"
            >
              Refresh
            </button>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Role</label>
              <select
                v-model="roleKey"
                class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none
                       focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200
                       dark:border-white/10 dark:bg-white/5 dark:focus:border-emerald-400 dark:focus:ring-emerald-500/20"
              >
                <option v-for="r in ROLE_OPTIONS" :key="r.loginId" :value="r.loginId">
                  {{ r.label }}
                </option>
              </select>
            </div>

            <div>
              <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Using</label>
              <div class="mt-1 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-white/10 dark:bg-white/5">
                <span class="font-semibold">{{ userLoginId }}</span>
                <span v-if="userServer.loading" class="text-xs text-slate-500 dark:text-slate-300">…</span>
                <span v-else class="text-xs" :class="userServer.exists ? 'text-emerald-600' : 'text-slate-500 dark:text-slate-300'">
                  {{ userServer.exists ? 'Saved' : 'Not set' }}
                </span>
              </div>
            </div>
          </div>

          <div class="mt-4">
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Signature image</label>
              <div v-if="userFile" class="text-xs text-slate-500 dark:text-slate-300">
                {{ fmtBytes(userFile.size) }}
              </div>
            </div>

            <input
              type="file"
              accept="image/png,image/jpeg"
              class="mt-2 block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-800
                     hover:file:bg-slate-200 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15"
              @change="onUserPick"
            />
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              class="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="userUploading || !userFile"
              @click="uploadUserSignature"
            >
              {{ userUploading ? 'Uploading…' : 'Upload' }}
            </button>

            <button
              class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50
                     dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              type="button"
              :disabled="userUploading"
              @click="() => { userFile=null; if(userLocalUrl) URL.revokeObjectURL(userLocalUrl); userLocalUrl=''; }"
            >
              Clear
            </button>
          </div>
        </div>

        <!-- Upload: Employee -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between">
            <div class="text-base font-bold">Upload Signature (Employee)</div>
            <button
              class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50
                     dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              type="button"
              @click="fetchEmpServerPreview"
              :disabled="!selected"
            >
              Refresh
            </button>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
            <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">Selected</div>
            <div class="mt-1 font-semibold">{{ selected ? selectedLabel : '—' }}</div>
          </div>

          <div class="mt-4">
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold text-slate-600 dark:text-slate-300">Signature image</label>
              <div v-if="empFile" class="text-xs text-slate-500 dark:text-slate-300">
                {{ fmtBytes(empFile.size) }}
              </div>
            </div>

            <input
              type="file"
              accept="image/png,image/jpeg"
              class="mt-2 block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-800
                     hover:file:bg-slate-200 dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15"
              @change="onEmpPick"
              :disabled="!selected"
            />
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              class="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="empUploading || !empFile || !selected"
              @click="uploadEmployeeSignature"
            >
              {{ empUploading ? 'Uploading…' : 'Upload' }}
            </button>

            <button
              class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50
                     dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              type="button"
              :disabled="empUploading"
              @click="() => { empFile=null; if(empLocalUrl) URL.revokeObjectURL(empLocalUrl); empLocalUrl=''; }"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <!-- RIGHT: previews -->
      <div class="lg:col-span-7 space-y-5">
        <!-- Approver preview -->
        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
            <div>
              <div class="text-base font-bold">Approver Preview</div>
              <div class="text-xs text-slate-500 dark:text-slate-300">{{ userLoginId }}</div>
            </div>
            <button
              class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50
                     dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              type="button"
              @click="fetchUserServerPreview"
            >
              Refresh
            </button>
          </div>

          <div class="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <!-- local -->
            <div class="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <div class="text-sm font-bold">Local file</div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-300">
                {{ userFile ? userFile.name : 'No file selected' }}
              </div>
              <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">
                <div class="aspect-[16/9] w-full">
                  <img v-if="userLocalUrl" :src="userLocalUrl" class="h-full w-full object-contain" />
                  <div v-else class="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    Choose a file to preview
                  </div>
                </div>
              </div>
            </div>

            <!-- server -->
            <div class="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <div class="text-sm font-bold">Server file</div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-300">
                {{ userServer.loading ? 'Loading…' : (userServer.exists ? 'Saved' : 'Not set') }}
              </div>

              <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">
                <div class="aspect-[16/9] w-full">
                  <img v-if="userServer.exists && userServer.url" :src="userServer.url" class="h-full w-full object-contain" />
                  <div v-else class="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    Upload to see server image
                  </div>
                </div>
              </div>

              <div v-if="userServer.exists && userServer.url" class="mt-2 text-xs text-slate-500 dark:text-slate-300">
                <span class="truncate">{{ userServer.url }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Employee preview -->
        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
            <div>
              <div class="text-base font-bold">Employee Preview</div>
              <div class="text-xs text-slate-500 dark:text-slate-300">
                {{ selected ? `${selected.name || 'Employee'} • ${selected.employeeId}` : 'Select an employee' }}
              </div>
            </div>
            <button
              class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50
                     dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              type="button"
              @click="fetchEmpServerPreview"
              :disabled="!selected"
            >
              Refresh
            </button>
          </div>

          <div class="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <!-- local -->
            <div class="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <div class="text-sm font-bold">Local file</div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-300">
                {{ empFile ? empFile.name : 'No file selected' }}
              </div>
              <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">
                <div class="aspect-[16/9] w-full">
                  <img v-if="empLocalUrl" :src="empLocalUrl" class="h-full w-full object-contain" />
                  <div v-else class="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    Choose a file to preview
                  </div>
                </div>
              </div>
            </div>

            <!-- server -->
            <div class="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <div class="text-sm font-bold">Server file</div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-300">
                {{ empServer.loading ? 'Loading…' : (empServer.exists ? 'Saved' : 'Not set') }}
              </div>

              <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5">
                <div class="aspect-[16/9] w-full">
                  <img v-if="empServer.exists && empServer.url" :src="empServer.url" class="h-full w-full object-contain" />
                  <div v-else class="flex h-full w-full items-center justify-center text-sm text-slate-400">
                    Upload to see server image
                  </div>
                </div>
              </div>

              <div v-if="empServer.exists && empServer.url" class="mt-2 text-xs text-slate-500 dark:text-slate-300">
                <span class="truncate">{{ empServer.url }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- status -->
        <div class="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1">
            <div>
              <span class="font-semibold">Approver:</span>
              <span class="ml-1">{{ userLoginId }}</span>
              <span class="ml-2" :class="userServer.exists ? 'text-emerald-600' : ''">
                {{ userServer.exists ? '• saved' : '• not set' }}
              </span>
            </div>
            <div>
              <span class="font-semibold">Employee:</span>
              <span class="ml-1">{{ selected ? selected.employeeId : '—' }}</span>
              <span class="ml-2" :class="empServer.exists ? 'text-emerald-600' : ''">
                {{ selected ? (empServer.exists ? '• saved' : '• not set') : '' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

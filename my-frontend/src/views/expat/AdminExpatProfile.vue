<!-- src/views/expat/admin/AdminExpatProfile.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import EmployeeSearch from '../expat/admin/components/EmployeeSearch.vue'

defineOptions({ name: 'AdminExpatProfile' })

const router = useRouter()
const { showToast } = useToast()

/* ───────── responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── main state ───────── */
const loading = ref(false)
const error = ref('')
const includeInactive = ref(false)
const q = ref('')
const groups = ref([])

/* ───────── helpers ───────── */
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function safeTxt(v) {
  const s = String(v ?? '').trim()
  return s ? s : 'None'
}
function up(v) {
  return String(v ?? '').trim().toUpperCase()
}

function pickLoginId(emp) {
  const e = emp || {}
  return String(e.loginId || e.loginID || e.userLoginId || e.username || '').trim()
}
function pickEmployeeId(emp) {
  const e = emp || {}
  return String(e.employeeId || e.empId || e.id || '').trim()
}

/* used/remaining chips (example: 1/17) */
function compactBalances(balances) {
  const arr = Array.isArray(balances) ? balances : []
  const order = ['AL', 'SP', 'MC', 'MA', 'UL']
  const m = new Map(arr.map((x) => [String(x.leaveTypeCode || '').toUpperCase(), x]))
  const out = []
  for (const k of order) {
    const b = m.get(k)
    if (!b) continue
    const used = num(b.used)
    const remaining = num(b.remaining) // backend truth (can be negative)
    out.push({ k, used, remaining, pair: `${used}/${remaining}` })
  }
  return out
}

function statusChipClasses(active) {
  return active ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-danger'
}

/**
 * ✅ approvalMode (2 modes only)
 * - MANAGER_AND_GM
 * - GM_AND_COO
 */
function modeChipClasses(mode) {
  const m = up(mode)
  return m === 'GM_AND_COO' ? 'ui-badge ui-badge-indigo' : 'ui-badge ui-badge-info'
}
function modeLabel(mode) {
  const m = up(mode)
  return m === 'GM_AND_COO' ? 'GM + COO' : 'Manager + GM'
}

function pairChipClasses(remaining) {
  return remaining >= 0 ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-danger'
}

/* ───────── navigation ───────── */
function goProfile(employeeId) {
  const id = String(employeeId || '').trim()
  if (!id) return
  router.push({ name: 'leave-admin-profile', params: { employeeId: id } })
}
function goEdit(employeeId) {
  const id = String(employeeId || '').trim()
  if (!id) return
  router.push({ name: 'leave-admin-profile-edit', params: { employeeId: id } })
}

/* ───────── API ───────── */
async function fetchGroups() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/admin/leave/profiles/grouped', {
      params: { includeInactive: includeInactive.value ? '1' : '0' },
    })
    groups.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchGroups error', e)
    error.value = e?.response?.data?.message || e.message || 'Failed to load profiles.'
    showToast({ type: 'error', title: 'Failed to load', message: error.value })
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  q.value = ''
  includeInactive.value = false
}

/* ───────── filtering ───────── */
const filteredManagers = computed(() => {
  const term = String(q.value || '').trim().toLowerCase()
  const base = Array.isArray(groups.value) ? groups.value : []

  return base
    .map((g) => {
      const emps = (g.employees || []).filter((e) => {
        const hay = [
          e.employeeId,
          e.name,
          e.department,
          e.managerLoginId,
          e.gmLoginId,
          e.cooLoginId,
          e.approvalMode,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return term ? hay.includes(term) : true
      })
      return { ...g, employees: emps }
    })
    .filter((g) => (g.employees || []).length > 0)
})

const filteredCount = computed(() =>
  filteredManagers.value.reduce((sum, g) => sum + (g.employees?.length || 0), 0)
)
const managerCount = computed(() => filteredManagers.value.length)

/* ───────── pagination (flatten -> slice -> regroup) ───────── */
const page = ref(1)
const pageSize = ref(12)
const PAGE_SIZES = [8, 12, 20, 50]

const flatEmployees = computed(() => {
  const out = []
  for (const g of filteredManagers.value) {
    for (const e of g.employees || []) out.push(e)
  }
  return out
})

const totalRows = computed(() => flatEmployees.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize.value)))

watch([totalRows, pageSize], () => {
  page.value = 1
})

watch(page, () => {
  if (page.value > totalPages.value) page.value = totalPages.value
  if (page.value < 1) page.value = 1
})

const pageFrom = computed(() => {
  if (!totalRows.value) return 0
  return (page.value - 1) * pageSize.value + 1
})
const pageTo = computed(() => Math.min(totalRows.value, page.value * pageSize.value))

const pagedEmployees = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return flatEmployees.value.slice(start, start + pageSize.value)
})

const pagedIdSet = computed(() => new Set(pagedEmployees.value.map((e) => String(e.employeeId || '').trim())))

/* regroup managers but keep original order */
const pagedManagers = computed(() => {
  const set = pagedIdSet.value
  return filteredManagers.value
    .map((g) => ({
      ...g,
      employees: (g.employees || []).filter((e) => set.has(String(e.employeeId || '').trim())),
    }))
    .filter((g) => (g.employees || []).length > 0)
})

function prevPage() {
  page.value = Math.max(1, page.value - 1)
}
function nextPage() {
  page.value = Math.min(totalPages.value, page.value + 1)
}

/* reset page when filters change */
watch([q, includeInactive], () => {
  page.value = 1
})
watch(includeInactive, () => fetchGroups())

/* ───────── default approvers (AUTO from seed) ───────── */
const approversLoading = ref(false)
const approversError = ref('')

const defaultGm = ref({ loginId: 'leave_gm', name: 'Expat GM', role: 'LEAVE_GM' })
const defaultCoo = ref({ loginId: 'leave_coo', name: 'COO', role: 'LEAVE_COO' })

function normRole(x) {
  return up(x?.role || x?.code || x?.type || x?.key || '')
}
function normLoginId(x) {
  return String(x?.loginId || x?.loginID || x?.userLoginId || x?.username || x?._id || '').trim()
}
function normName(x) {
  return String(x?.name || x?.displayName || x?.fullName || '').trim()
}

async function fetchDefaultApprovers() {
  approversLoading.value = true
  approversError.value = ''
  try {
    const res = await api.get('/admin/leave/approvers')
    const arr = Array.isArray(res.data) ? res.data : []

    const gm = arr.find((a) => normRole(a) === 'LEAVE_GM')
    const coo = arr.find((a) => normRole(a) === 'LEAVE_COO')

    if (gm) {
      defaultGm.value = {
        loginId: normLoginId(gm) || defaultGm.value.loginId,
        name: normName(gm) || defaultGm.value.name,
        role: 'LEAVE_GM',
      }
    }

    if (coo) {
      defaultCoo.value = {
        loginId: normLoginId(coo) || defaultCoo.value.loginId,
        name: normName(coo) || defaultCoo.value.name,
        role: 'LEAVE_COO',
      }
    }
  } catch (e) {
    console.warn('fetchDefaultApprovers failed; using seed fallbacks', e)
    approversError.value =
      e?.response?.data?.message || e?.message || 'Failed to load approvers (using seed defaults).'
  } finally {
    approversLoading.value = false
  }
}

/* ───────── create modal ───────── */
const createOpen = ref(false)
const createTab = ref('bulk') // bulk | single
const createError = ref('')
const saving = ref(false)

function newRow() {
  return {
    key: Math.random().toString(16).slice(2),
    employee: null,
    joinDate: '',
    contractDate: '',
    alCarry: 0,
    isActive: true,
  }
}

const form = ref({
  approvalMode: 'MANAGER_AND_GM',
  manager: null,
  rows: [newRow()],

  singleEmployee: null,
  singleJoinDate: '',
  singleContractDate: '',
  singleAlCarry: 0,
  singleActive: true,
  singleManager: null,
})

function openCreate() {
  createError.value = ''
  createTab.value = 'bulk'
  form.value = {
    approvalMode: 'MANAGER_AND_GM',
    manager: null,
    rows: [newRow()],

    singleEmployee: null,
    singleJoinDate: '',
    singleContractDate: '',
    singleAlCarry: 0,
    singleActive: true,
    singleManager: null,
  }
  createOpen.value = true
  fetchDefaultApprovers()
}
function closeCreate() {
  if (saving.value) return
  createOpen.value = false
}

function addRow() {
  form.value.rows.push(newRow())
}
function removeRow(idx) {
  if (form.value.rows.length === 1) return
  form.value.rows.splice(idx, 1)
}

function syncContractFromJoin(row) {
  if (!row.contractDate && row.joinDate) row.contractDate = row.joinDate
}
function syncSingleContract() {
  if (!form.value.singleContractDate && form.value.singleJoinDate) {
    form.value.singleContractDate = form.value.singleJoinDate
  }
}

function mustYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim())
}

const needsCoo = computed(() => up(form.value.approvalMode) === 'GM_AND_COO')
const requiresManager = computed(() => up(form.value.approvalMode) === 'MANAGER_AND_GM')

watch(
  () => form.value.approvalMode,
  (v) => {
    const mode = up(v)
    if (mode === 'GM_AND_COO') {
      form.value.manager = null
      form.value.singleManager = null
    }
  }
)

const approverReady = computed(() => {
  const gmOk = !!String(defaultGm.value?.loginId || '').trim()
  const cooOk = !!String(defaultCoo.value?.loginId || '').trim()
  return needsCoo.value ? gmOk && cooOk : gmOk
})

async function submitCreate() {
  createError.value = ''
  try {
    saving.value = true

    const mode = up(form.value.approvalMode || '')
    if (!['MANAGER_AND_GM', 'GM_AND_COO'].includes(mode)) {
      throw new Error('Invalid approval mode.')
    }

    const gmLoginId = String(defaultGm.value?.loginId || '').trim()
    const cooLoginId = String(defaultCoo.value?.loginId || '').trim()

    if (!gmLoginId) throw new Error('GM approver is missing (seed or /admin/leave/approvers).')
    if (mode === 'GM_AND_COO' && !cooLoginId)
      throw new Error('COO approver is missing (seed or /admin/leave/approvers).')

    if (mode === 'MANAGER_AND_GM') {
      const chosen =
        createTab.value === 'bulk'
          ? form.value.manager
          : (form.value.singleManager || form.value.manager)
      const managerEmpId = pickEmployeeId(chosen)
      if (!managerEmpId) throw new Error('Manager is required for Manager + GM mode.')
    }

    if (createTab.value === 'bulk') {
      const rows = form.value.rows || []
      if (!rows.length) throw new Error('Please add at least 1 employee.')

      const employees = rows.map((r, i) => {
        const employeeId = pickEmployeeId(r.employee)
        if (!employeeId) throw new Error(`Employee #${i + 1} is required.`)
        if (!mustYmd(r.joinDate))
          throw new Error(`Join date (Employee #${i + 1}) must be YYYY-MM-DD.`)

        const contractDate = r.contractDate || r.joinDate
        if (!mustYmd(contractDate))
          throw new Error(`Contract date (Employee #${i + 1}) must be YYYY-MM-DD.`)

        return {
          employeeId,
          joinDate: r.joinDate,
          contractDate,
          alCarry: Number(r.alCarry || 0),
          isActive: r.isActive !== false,
        }
      })

      const managerEmpId = mode === 'MANAGER_AND_GM' ? pickEmployeeId(form.value.manager) : ''
      const managerLoginId = mode === 'MANAGER_AND_GM' ? pickLoginId(form.value.manager) : ''

      const payload = {
        approvalMode: mode,
        managerEmployeeId: managerEmpId,
        managerLoginId,
        gmLoginId,
        cooLoginId: mode === 'GM_AND_COO' ? cooLoginId : '',
        employees,
      }

      const res = await api.post('/admin/leave/managers', payload)

      showToast({
        type: 'success',
        title: 'Created',
        message: `Created ${res.data?.createdCount ?? 0}, updated ${res.data?.updatedCount ?? 0}.`,
      })

      createOpen.value = false
      await fetchGroups()
      return
    }

    const employeeId = pickEmployeeId(form.value.singleEmployee)
    if (!employeeId) throw new Error('Employee is required.')
    if (!mustYmd(form.value.singleJoinDate)) throw new Error('Join date must be YYYY-MM-DD.')

    const contractDate = form.value.singleContractDate || form.value.singleJoinDate
    if (!mustYmd(contractDate)) throw new Error('Contract date must be YYYY-MM-DD.')

    const chosenManager = form.value.singleManager || form.value.manager
    const singleManagerEmpId = mode === 'MANAGER_AND_GM' ? pickEmployeeId(chosenManager) : ''
    const singleManagerLoginId = mode === 'MANAGER_AND_GM' ? pickLoginId(chosenManager) : ''

    const payload = {
      approvalMode: mode,
      employeeId,
      joinDate: form.value.singleJoinDate,
      contractDate,
      alCarry: Number(form.value.singleAlCarry || 0),
      isActive: form.value.singleActive !== false,
      managerEmployeeId: singleManagerEmpId,
      managerLoginId: singleManagerLoginId,
      gmLoginId,
      cooLoginId: mode === 'GM_AND_COO' ? cooLoginId : '',
    }

    await api.post('/admin/leave/profiles', payload)

    showToast({ type: 'success', title: 'Created', message: `Profile created: ${employeeId}` })
    createOpen.value = false
    await fetchGroups()
  } catch (e) {
    console.error('submitCreate error', e)
    createError.value = e?.response?.data?.message || e.message || 'Failed to create.'
    showToast({ type: 'error', title: 'Failed', message: createError.value })
  } finally {
    saving.value = false
  }
}

/* ✅ Lock background scroll when modal open */
watch(createOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!open)
})

/* ───────── lifecycle ───────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  fetchGroups()
  fetchDefaultApprovers()
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (typeof document !== 'undefined') document.body.classList.remove('overflow-hidden')
})
</script>

<template>
  <!-- ✅ Full screen edge-to-edge shell -->
  <div class="ui-page min-h-screen w-full">
    <!-- ✅ Edge container -->
    <div class="w-full min-h-screen flex flex-col">

      <!-- ✅ Header stays top, FULL width, no rounded -->
      <div class="ui-hero rounded-none border-x-0 border-t-0 px-4 py-3">
        <!-- Desktop -->
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-[240px]">
            <div class="ui-hero-kicker">Expat Leave</div>
            <div class="ui-hero-title">Expat Profiles</div>
            <div class="ui-hero-subtitle">Profiles grouped by manager.</div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="ui-badge">Employees: <b>{{ filteredCount }}</b></span>
              <span class="ui-badge ui-badge-indigo">Managers: <b>{{ managerCount }}</b></span>
              <span class="ui-badge">Page: <b>{{ page }}/{{ totalPages }}</b></span>
            </div>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <div class="min-w-[260px] max-w-sm">
              <div class="ui-label">Search</div>
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ui-muted"></i>
                <input
                  v-model="q"
                  type="text"
                  placeholder="Employee / manager / department..."
                  class="ui-input pl-8"
                />
              </div>
            </div>

            <div class="flex items-center gap-2">
              <label class="inline-flex items-center gap-2 ui-badge">
                <input
                  v-model="includeInactive"
                  type="checkbox"
                  class="h-4 w-4 rounded border-ui-border/70 bg-transparent"
                />
                <span>Include inactive</span>
              </label>
            </div>

            <div class="min-w-[140px]">
              <div class="ui-label">Per page</div>
              <select v-model.number="pageSize" class="ui-select">
                <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>

            <div class="flex items-center gap-2">
              <button type="button" class="ui-btn ui-btn-soft" @click="fetchGroups" :disabled="loading" title="Refresh">
                <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                Refresh
              </button>

              <button type="button" class="ui-btn ui-btn-primary" @click="openCreate">
                <i class="fa-solid fa-plus text-[11px]"></i>
                New
              </button>

              <button type="button" class="ui-btn ui-btn-ghost" @click="clearFilters" title="Clear filters">
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <div class="ui-hero-kicker">Expat Leave</div>
            <div class="ui-hero-title">Expat Profiles</div>
            <div class="ui-hero-subtitle">Profiles grouped by manager.</div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="ui-badge">Employees: <b>{{ filteredCount }}</b></span>
              <span class="ui-badge ui-badge-indigo">Managers: <b>{{ managerCount }}</b></span>
              <span class="ui-badge">Page: <b>{{ page }}/{{ totalPages }}</b></span>
            </div>
          </div>

          <div class="space-y-2">
            <div>
              <div class="ui-label">Search</div>
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ui-muted"></i>
                <input v-model="q" type="text" placeholder="Employee / manager / dept..." class="ui-input pl-8" />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="inline-flex items-center gap-2 ui-badge">
                <input v-model="includeInactive" type="checkbox" class="h-4 w-4 rounded border-ui-border/70 bg-transparent" />
                <span>Include inactive</span>
              </label>

              <div class="flex items-center gap-2">
                <select v-model.number="pageSize" class="ui-select !w-auto">
                  <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}/page</option>
                </select>

                <button type="button" class="ui-btn ui-btn-soft" @click="fetchGroups" :disabled="loading">
                  <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                  Refresh
                </button>

                <button type="button" class="ui-btn ui-btn-primary" @click="openCreate">
                  <i class="fa-solid fa-plus text-[11px]"></i>
                  New
                </button>
              </div>
            </div>

            <div class="flex justify-end">
              <button type="button" class="ui-btn ui-btn-ghost" @click="clearFilters">
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ✅ CONTENT AREA: fills remaining screen + scrolls -->
      <div class="flex-1 overflow-y-auto ui-scrollbar px-3 sm:px-4 lg:px-6 py-3">
        <!-- Error -->
        <div v-if="error" class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100">
          <span class="font-semibold">Failed:</span> {{ error }}
        </div>

        <!-- Loading -->
        <div v-if="loading && !pagedManagers.length" class="mt-2 ui-card !rounded-2xl border border-ui-border/70 bg-ui-bg-2/60 px-3 py-2 text-[11px] text-ui-muted">
          Loading profiles...
        </div>

        <!-- Pagination bar -->
        <div v-if="!loading && totalRows" class="mt-3 ui-card !rounded-2xl px-3 py-2 text-[11px] text-ui-muted flex flex-wrap items-center justify-between gap-2">
          <div>
            Showing <span class="font-semibold text-ui-fg">{{ pageFrom }}</span>–
            <span class="font-semibold text-ui-fg">{{ pageTo }}</span>
            of <span class="font-semibold text-ui-fg">{{ totalRows }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="prevPage">
              <i class="fa-solid fa-chevron-left text-[10px]" /> Prev
            </button>
            <div class="ui-badge">Page <b>{{ page }}</b> / <b>{{ totalPages }}</b></div>
            <button type="button" class="ui-pagebtn" :disabled="page >= totalPages" @click="nextPage">
              Next <i class="fa-solid fa-chevron-right text-[10px]" />
            </button>
          </div>
        </div>

        <!-- Empty -->
        <div v-if="!loading && !error && pagedManagers.length === 0" class="py-8 text-center text-[11px] text-ui-muted">
          No profiles found.
        </div>

        <!-- Mobile cards -->
        <div v-if="isMobile && pagedManagers.length" class="mt-3 space-y-3">
          <section v-for="(g, idx) in pagedManagers" :key="idx" class="ui-card overflow-hidden">
            <div class="border-b border-ui-border/60 bg-ui-bg-2/60 px-3 py-2">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate text-[12px] font-extrabold text-ui-fg">
                    <span class="ui-badge ui-badge-indigo mr-2">MANAGER</span>
                    {{ safeTxt(g.manager?.name) }}
                    <span class="ml-1 font-mono text-[11px] text-ui-muted">
                      ({{ safeTxt(g.manager?.employeeId) }})
                    </span>
                  </div>
                  <div class="truncate text-[11px] text-ui-muted">
                    {{ safeTxt(g.manager?.department) }}
                  </div>
                </div>

                <div class="ui-badge">{{ g.employees?.length || 0 }}</div>
              </div>
            </div>

            <div class="p-3 space-y-2">
              <article
                v-for="e in g.employees"
                :key="e.employeeId"
                role="button"
                tabindex="0"
                class="ui-card !rounded-2xl p-3 cursor-pointer"
                @click="goProfile(e.employeeId)"
                @keydown.enter.prevent="goProfile(e.employeeId)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="font-mono text-[11px] text-ui-fg">{{ safeTxt(e.employeeId) }}</div>
                    <div class="truncate text-[12px] font-extrabold text-ui-fg">{{ safeTxt(e.name) }}</div>
                    <div class="truncate text-[11px] text-ui-muted">{{ safeTxt(e.department) }}</div>
                  </div>

                  <div class="text-right space-y-1 text-[11px]">
                    <span :class="statusChipClasses(!!e.isActive)">{{ e.isActive ? 'Active' : 'Inactive' }}</span>
                    <div>
                      <span :class="modeChipClasses(e.approvalMode)">{{ modeLabel(e.approvalMode) }}</span>
                    </div>
                  </div>
                </div>

                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="ui-card !rounded-2xl px-2 py-1">
                    <div class="text-ui-muted">Join</div>
                    <div class="font-extrabold text-ui-fg">{{ safeTxt(e.joinDate) }}</div>
                  </div>
                  <div class="ui-card !rounded-2xl px-2 py-1">
                    <div class="text-ui-muted">Contract</div>
                    <div class="font-extrabold text-ui-fg">{{ safeTxt(e.contractDate) }}</div>
                    <div class="text-[10px] text-ui-muted">end: {{ safeTxt(e.contractEndDate) }}</div>
                  </div>
                </div>

                <div class="mt-2 flex flex-wrap gap-2">
                  <span
                    v-for="b in compactBalances(e.balances)"
                    :key="b.k"
                    class="ui-badge"
                    :class="pairChipClasses(b.remaining)"
                  >
                    {{ b.k }}: {{ b.pair }}
                  </span>
                  <span v-if="!e.balances?.length" class="text-[11px] text-ui-muted">None</span>
                </div>

                <div class="mt-2 text-[11px] text-ui-muted">
                  Manager login: {{ safeTxt(e.managerLoginId) }}
                </div>

                <div class="mt-2 flex flex-wrap justify-end gap-2" @click.stop>
                  <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click.stop="goEdit(e.employeeId)">
                    <i class="fa-solid fa-pen-to-square text-[10px]" />
                    Edit
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <!-- Desktop table -->
        <div v-else-if="!isMobile && pagedManagers.length" class="mt-3 space-y-3">
          <section v-for="(g, idx) in pagedManagers" :key="idx" class="ui-card overflow-hidden">
            <div class="border-b border-ui-border/60 bg-ui-bg-2/60 px-3 py-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-[12px] font-extrabold text-ui-fg">
                    <span class="ui-badge ui-badge-indigo mr-2">MANAGER</span>
                    {{ safeTxt(g.manager?.name) }}
                    <span class="ml-1 font-mono text-[11px] text-ui-muted">
                      ({{ safeTxt(g.manager?.employeeId) }})
                    </span>
                  </div>
                  <div class="truncate text-[11px] text-ui-muted">
                    {{ safeTxt(g.manager?.department) }}
                  </div>
                </div>

                <div class="text-[11px] font-extrabold text-ui-muted">
                  {{ g.employees?.length || 0 }} employees
                </div>
              </div>
            </div>

            <div class="ui-table-wrap ui-scrollbar">
              <table class="ui-table">
                <!-- ✅ Control widths: bigger balances, smaller status/actions -->
                <colgroup>
                  <col style="width: 20%" /> <!-- Employee -->
                  <col style="width: 10%" /> <!-- Department -->
                  <col style="width: 10%" /> <!-- Join -->
                  <col style="width: 10%" /> <!-- Contract -->
                  <col style="width: 10%" /> <!-- Mode -->
                  <col style="width: 32%" /> <!-- ✅ Balances bigger -->
                  <col style="width: 7%" />  <!-- ✅ Status smaller -->
                  <col style="width: 7%" />  <!-- ✅ Actions smaller -->
                </colgroup>

                <thead>
                  <tr>
                    <th class="ui-th text-center">Employee</th>
                    <th class="ui-th text-center">Department</th>
                    <th class="ui-th text-center">Join</th>
                    <th class="ui-th text-center">Contract</th>
                    <th class="ui-th text-center">Mode</th>
                    <th class="ui-th text-center">Balances (U/R)</th>
                    <th class="ui-th text-center">Status</th>
                    <th class="ui-th text-center">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr
                    v-for="e in g.employees"
                    :key="e.employeeId"
                    class="ui-tr-hover cursor-pointer"
                    @click="goProfile(e.employeeId)"
                  >
                    <!-- Employee -->
                    <td class="ui-td">
                      <div class="flex flex-col items-center text-center gap-0.5">
                        <div class="font-mono text-[11px] text-ui-fg">{{ safeTxt(e.employeeId) }}</div>
                        <div class="text-[12px] font-extrabold text-ui-fg">{{ safeTxt(e.name) }}</div>
                        <div class="text-[11px] text-ui-muted">Manager: {{ safeTxt(e.managerLoginId) }}</div>
                      </div>
                    </td>

                    <!-- Department -->
                    <td class="ui-td">
                      <div class="flex items-center justify-center text-center">
                        {{ safeTxt(e.department) }}
                      </div>
                    </td>

                    <!-- Join -->
                    <td class="ui-td whitespace-nowrap">
                      <div class="flex items-center justify-center">
                        {{ safeTxt(e.joinDate) }}
                      </div>
                    </td>

                    <!-- Contract -->
                    <td class="ui-td whitespace-nowrap">
                      <div class="flex flex-col items-center text-center">
                        <div class="font-extrabold">{{ safeTxt(e.contractDate) }}</div>
                        <div class="text-[11px] text-ui-muted">end: {{ safeTxt(e.contractEndDate) }}</div>
                      </div>
                    </td>

                    <!-- Mode -->
                    <td class="ui-td">
                      <div class="flex items-center justify-center">
                        <span :class="modeChipClasses(e.approvalMode)">{{ modeLabel(e.approvalMode) }}</span>
                      </div>
                    </td>

                    <!-- ✅ Balances: force 2 rows (3 chips per row) -->
                    <td class="ui-td">
                      <div class="grid grid-cols-5 gap-2 justify-items-center">
                        <span
                          v-for="b in compactBalances(e.balances)"
                          :key="b.k"
                          class="ui-badge whitespace-nowrap"
                          :class="pairChipClasses(b.remaining)"
                        >
                          {{ b.k }}: {{ b.pair }}
                        </span>

                        <span
                          v-if="!e.balances?.length"
                          class="text-[11px] text-ui-muted col-span-3 text-center"
                        >
                          None
                        </span>
                      </div>
                    </td>

                    <!-- ✅ Status smaller -->
                    <td class="ui-td !px-2">
                      <div class="flex items-center justify-center">
                        <span :class="statusChipClasses(!!e.isActive)">
                          {{ e.isActive ? 'Active' : 'Inactive' }}
                        </span>
                      </div>
                    </td>

                    <!-- ✅ Actions smaller -->
                    <td class="ui-td !px-2" @click.stop>
                      <div class="flex items-center justify-center">
                        <button type="button" class="ui-btn ui-btn-primary ui-btn-xs" @click="goEdit(e.employeeId)">
                          <i class="fa-solid fa-pen-to-square text-[10px]" />
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <!-- Bottom pagination repeat -->
        <div v-if="!loading && totalRows" class="mt-3 ui-card !rounded-2xl px-3 py-2 text-[11px] text-ui-muted flex flex-wrap items-center justify-between gap-2">
          <div>
            Showing <span class="font-semibold text-ui-fg">{{ pageFrom }}</span>–
            <span class="font-semibold text-ui-fg">{{ pageTo }}</span>
            of <span class="font-semibold text-ui-fg">{{ totalRows }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="prevPage">
              <i class="fa-solid fa-chevron-left text-[10px]" /> Prev
            </button>
            <div class="ui-badge">Page <b>{{ page }}</b> / <b>{{ totalPages }}</b></div>
            <button type="button" class="ui-pagebtn" :disabled="page >= totalPages" @click="nextPage">
              Next <i class="fa-solid fa-chevron-right text-[10px]" />
            </button>
          </div>
        </div>
      </div>

      <!-- ✅ Standard Create modal (unchanged) -->
      <transition name="modal-fade">
        <div v-if="createOpen" class="ui-modal-backdrop" @click.self="closeCreate">
          <div class="ui-modal max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
            <!-- Header -->
            <div class="ui-hero rounded-b-none px-4 py-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[14px] font-extrabold text-ui-fg">New leave profile</div>
                  <div class="text-[11px] text-ui-muted">
                    Approval chain:
                    <span class="font-semibold" v-if="requiresManager">Manager</span>
                    <span class="font-semibold" v-if="requiresManager"> → </span>
                    <span class="font-semibold">GM</span>
                    <span v-if="needsCoo"> → <span class="font-semibold">COO</span></span>
                  </div>
                </div>

                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="closeCreate">
                  <i class="fa-solid fa-xmark text-xs"></i>
                </button>
              </div>

              <div class="mt-3 inline-flex rounded-full border border-ui-border/60 bg-ui-card/60 p-0.5">
                <button
                  type="button"
                  class="ui-btn ui-btn-xs"
                  :class="createTab === 'bulk' ? 'ui-btn-primary' : 'ui-btn-ghost'"
                  @click="createTab = 'bulk'"
                >
                  Manager + multiple
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn-xs"
                  :class="createTab === 'single' ? 'ui-btn-primary' : 'ui-btn-ghost'"
                  @click="createTab = 'single'"
                >
                  Single
                </button>
              </div>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3 overscroll-contain ui-scrollbar">
              <div>
                <div class="ui-label">Approval mode</div>
                <select v-model="form.approvalMode" class="ui-select">
                  <option value="MANAGER_AND_GM">Manager + GM</option>
                  <option value="GM_AND_COO">GM + COO</option>
                </select>
                <p class="mt-1 text-[11px] text-ui-muted">
                  GM must approve first. If Manager exists, GM cannot see until Manager approves.
                </p>
              </div>

              <div v-if="requiresManager">
                <div class="ui-label">Direct manager <span class="text-rose-600">*</span></div>
                <EmployeeSearch v-if="createTab === 'bulk'" v-model="form.manager" placeholder="Search manager…" />
                <EmployeeSearch v-else v-model="form.singleManager" placeholder="Search manager…" />
                <p class="mt-1 text-[11px] text-ui-muted">
                  Required in <span class="font-semibold">Manager + GM</span> mode.
                </p>
              </div>
              <div v-else class="text-[11px] text-ui-muted">
                Manager is not needed in <span class="font-semibold">GM + COO</span> mode.
              </div>

              <!-- Bulk -->
              <div v-if="createTab === 'bulk'" class="space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="ui-section-title">Employees</div>

                  <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="addRow">
                    <i class="fa-solid fa-plus text-[10px]" />
                    Add row
                  </button>
                </div>

                <div v-for="(r, i) in form.rows" :key="r.key" class="ui-card !rounded-2xl p-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="text-[12px] font-extrabold text-ui-fg">Employee #{{ i + 1 }}</div>
                    <button
                      type="button"
                      class="ui-btn ui-btn-ghost ui-btn-sm"
                      @click="removeRow(i)"
                      :disabled="form.rows.length === 1"
                      title="Remove"
                    >
                      <i class="fa-solid fa-trash text-[11px]"></i>
                    </button>
                  </div>

                  <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div class="sm:col-span-2">
                      <div class="ui-label">Employee *</div>
                      <EmployeeSearch v-model="r.employee" placeholder="Search employee…" />
                    </div>

                    <div class="flex items-center pt-5 sm:pt-6">
                      <label class="inline-flex items-center gap-2 text-[11px] text-ui-fg">
                        <input v-model="r.isActive" type="checkbox" class="h-4 w-4 rounded border-ui-border/70 bg-transparent" />
                        Active
                      </label>
                    </div>

                    <div>
                      <div class="ui-label">Join date *</div>
                      <input v-model="r.joinDate" type="date" class="ui-date" @change="syncContractFromJoin(r)" />
                    </div>

                    <div>
                      <div class="ui-label">Contract date</div>
                      <input v-model="r.contractDate" type="date" class="ui-date" />
                    </div>

                    <div>
                      <div class="ui-label">AL carry</div>
                      <input v-model.number="r.alCarry" type="number" placeholder="0" class="ui-input" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Single -->
              <div v-else class="ui-card !rounded-2xl p-3">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div class="sm:col-span-2">
                    <div class="ui-label">Employee *</div>
                    <EmployeeSearch v-model="form.singleEmployee" placeholder="Search employee…" />
                  </div>

                  <div class="flex items-center pt-5 sm:pt-6">
                    <label class="inline-flex items-center gap-2 text-[11px] text-ui-fg">
                      <input v-model="form.singleActive" type="checkbox" class="h-4 w-4 rounded border-ui-border/70 bg-transparent" />
                      Active
                    </label>
                  </div>

                  <div>
                    <div class="ui-label">Join date *</div>
                    <input v-model="form.singleJoinDate" type="date" class="ui-date" @change="syncSingleContract" />
                  </div>

                  <div>
                    <div class="ui-label">Contract date</div>
                    <input v-model="form.singleContractDate" type="date" class="ui-date" />
                  </div>

                  <div>
                    <div class="ui-label">AL carry</div>
                    <input v-model.number="form.singleAlCarry" type="number" placeholder="0" class="ui-input" />
                  </div>
                </div>
              </div>

              <div v-if="createError" class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100">
                <span class="font-semibold">Failed:</span> {{ createError }}
              </div>

              <div v-if="approversError && !createError" class="ui-card !rounded-2xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-[11px] text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/40 dark:text-indigo-200">
                {{ approversError }}
              </div>
            </div>

            <!-- Footer -->
            <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
              <button type="button" class="ui-btn ui-btn-ghost" @click="closeCreate" :disabled="saving">
                Cancel
              </button>

              <button
                type="button"
                class="ui-btn ui-btn-primary"
                @click="submitCreate"
                :disabled="saving || !approverReady"
                :title="!approverReady ? 'Missing GM/COO approver (seed or /admin/leave/approvers)' : ''"
              >
                <i class="fa-solid fa-check text-[11px]" />
                {{ saving ? 'Creating…' : 'Create' }}
              </button>
            </div>
          </div>
        </div>
      </transition>

    </div>
  </div>
</template>

<style scoped>
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

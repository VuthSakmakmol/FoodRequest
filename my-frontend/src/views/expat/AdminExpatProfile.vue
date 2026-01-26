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
  return active
    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700/80'
    : 'bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700/80'
}

/**
 * ✅ approvalMode (2 modes only)
 * - MANAGER_AND_GM
 * - GM_AND_COO
 */
function modeChipClasses(mode) {
  const m = up(mode)
  return m === 'GM_AND_COO'
    ? 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/80'
    : 'bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80'
}
function modeLabel(mode) {
  const m = up(mode)
  return m === 'GM_AND_COO' ? 'GM + COO' : 'Manager + GM'
}

function pairChipClasses(remaining) {
  return remaining >= 0
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
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

/**
 * Backend should return approvers seeded in DB.
 * We try to fetch /admin/leave/approvers, then pick:
 * - LEAVE_GM
 * - LEAVE_COO
 * If it fails / missing, fallback to loginIds from seed: leave_gm / leave_coo.
 */
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
    approversError.value = e?.response?.data?.message || e?.message || 'Failed to load approvers (using seed defaults).'
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
  approvalMode: 'MANAGER_AND_GM', // ✅ default mode
  manager: null, // optional
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

  // ensure defaults ready (no UI selection needed)
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

    // ✅ auto approvers (seeded)
    const gmLoginId = String(defaultGm.value?.loginId || '').trim()
    const cooLoginId = String(defaultCoo.value?.loginId || '').trim()

    if (!gmLoginId) throw new Error('GM approver is missing (seed or /admin/leave/approvers).')
    if (mode === 'GM_AND_COO' && !cooLoginId) throw new Error('COO approver is missing (seed or /admin/leave/approvers).')

    if (createTab.value === 'bulk') {
      const rows = form.value.rows || []
      if (!rows.length) throw new Error('Please add at least 1 employee.')

      const employees = rows.map((r, i) => {
        const employeeId = pickEmployeeId(r.employee)
        if (!employeeId) throw new Error(`Employee #${i + 1} is required.`)
        if (!mustYmd(r.joinDate)) throw new Error(`Join date (Employee #${i + 1}) must be YYYY-MM-DD.`)

        const contractDate = r.contractDate || r.joinDate
        if (!mustYmd(contractDate)) throw new Error(`Contract date (Employee #${i + 1}) must be YYYY-MM-DD.`)

        return {
          employeeId,
          joinDate: r.joinDate,
          contractDate,
          alCarry: Number(r.alCarry || 0),
          isActive: r.isActive !== false,
        }
      })

      const managerEmpId = pickEmployeeId(form.value.manager)
      const managerLoginId = pickLoginId(form.value.manager)

      const payload = {
        approvalMode: mode,

        // optional manager
        managerEmployeeId: managerEmpId,
        managerLoginId,

        // ✅ auto from seed
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

    // ───────── single ─────────
    const employeeId = pickEmployeeId(form.value.singleEmployee)
    if (!employeeId) throw new Error('Employee is required.')
    if (!mustYmd(form.value.singleJoinDate)) throw new Error('Join date must be YYYY-MM-DD.')

    const contractDate = form.value.singleContractDate || form.value.singleJoinDate
    if (!mustYmd(contractDate)) throw new Error('Contract date must be YYYY-MM-DD.')

    const singleManagerEmpId = pickEmployeeId(form.value.singleManager || form.value.manager)
    const singleManagerLoginId = pickLoginId(form.value.singleManager || form.value.manager)

    const payload = {
      approvalMode: mode,

      employeeId,
      joinDate: form.value.singleJoinDate,
      contractDate,
      alCarry: Number(form.value.singleAlCarry || 0),
      isActive: form.value.singleActive !== false,

      managerEmployeeId: singleManagerEmpId,
      managerLoginId: singleManagerLoginId,

      // ✅ auto from seed
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
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500 px-4 py-3 text-white">
        <!-- Desktop -->
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-[240px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Expat Profiles</p>
            <p class="text-[11px] text-sky-50/90">Profiles grouped by manager.</p>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/95">
                Employees: {{ filteredCount }}
              </span>
              <span class="rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold text-white/95">
                Managers: {{ managerCount }}
              </span>
              <span class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90">
                Page: {{ page }}/{{ totalPages }}
              </span>
            </div>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[260px] max-w-sm">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/30 px-2.5 py-1.5 text-xs">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-100/80" />
                <input
                  v-model="q"
                  type="text"
                  placeholder="Employee / manager / department..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-sky-100/70"
                />
              </div>
            </div>

            <!-- Include inactive -->
            <div class="flex items-center gap-2 text-[11px]">
              <label class="inline-flex items-center gap-2 rounded-full bg-sky-900/30 px-3 py-1.5">
                <input v-model="includeInactive" type="checkbox" class="h-4 w-4 rounded border-sky-100/60 bg-transparent" />
                <span class="text-sky-50/90">Include inactive</span>
              </label>
            </div>

            <!-- Page size -->
            <div class="min-w-[120px]">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Per page</label>
              <select
                v-model.number="pageSize"
                class="w-full rounded-xl border border-sky-100/60 bg-sky-900/30 px-2.5 py-1.5 text-[11px] text-white outline-none"
              >
                <option v-for="n in PAGE_SIZES" :key="n" :value="n" class="text-slate-900">
                  {{ n }}
                </option>
              </select>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
                @click="fetchGroups"
                :disabled="loading"
                title="Refresh"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                Refresh
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-900 shadow hover:bg-white/95 transition"
                @click="openCreate"
              >
                <i class="fa-solid fa-plus text-[11px]"></i>
                New
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white border border-white/25 hover:bg-white/15 transition"
                @click="clearFilters"
                title="Clear filters"
              >
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Expat Profiles</p>
            <p class="text-[11px] text-sky-50/90">Profiles grouped by manager.</p>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/95">
                Employees: {{ filteredCount }}
              </span>
              <span class="rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold text-white/95">
                Managers: {{ managerCount }}
              </span>
              <span class="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90">
                Page: {{ page }}/{{ totalPages }}
              </span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/30 px-2.5 py-1.5 text-[11px]">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-100/80" />
                <input
                  v-model="q"
                  type="text"
                  placeholder="Employee / manager / dept..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-sky-100/70"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <label class="inline-flex items-center gap-2 rounded-full bg-sky-900/30 px-3 py-1.5">
                <input v-model="includeInactive" type="checkbox" class="h-4 w-4 rounded border-sky-100/60 bg-transparent" />
                <span class="text-sky-50/90">Include inactive</span>
              </label>

              <div class="flex items-center gap-2">
                <select
                  v-model.number="pageSize"
                  class="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  <option v-for="n in PAGE_SIZES" :key="n" :value="n" class="text-slate-900">
                    {{ n }}/page
                  </option>
                </select>

                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
                  @click="fetchGroups"
                  :disabled="loading"
                >
                  <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                  Refresh
                </button>

                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-900 shadow hover:bg-white/95 transition"
                  @click="openCreate"
                >
                  <i class="fa-solid fa-plus text-[11px]"></i>
                  New
                </button>
              </div>
            </div>

            <div class="flex justify-end">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white border border-white/25 hover:bg-white/15 transition"
                @click="clearFilters"
              >
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error -->
        <div
          v-if="error"
          class="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span class="font-semibold">Failed:</span> {{ error }}
        </div>

        <!-- Loading -->
        <div
          v-if="loading && !pagedManagers.length"
          class="mb-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px]
                 text-sky-700 dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
        >
          Loading profiles...
        </div>

        <!-- Pagination bar -->
        <div
          v-if="!loading && totalRows"
          class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2
                 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300"
        >
          <div>
            Showing <span class="font-semibold text-slate-900 dark:text-slate-50">{{ pageFrom }}</span>–
            <span class="font-semibold text-slate-900 dark:text-slate-50">{{ pageTo }}</span>
            of <span class="font-semibold text-slate-900 dark:text-slate-50">{{ totalRows }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5
                     text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60
                     dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              :disabled="page <= 1"
              @click="prevPage"
            >
              <i class="fa-solid fa-chevron-left text-[10px]" />
              Prev
            </button>

            <div class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700
                        dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              Page {{ page }} / {{ totalPages }}
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5
                     text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60
                     dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              :disabled="page >= totalPages"
              @click="nextPage"
            >
              Next
              <i class="fa-solid fa-chevron-right text-[10px]" />
            </button>
          </div>
        </div>

        <!-- Empty -->
        <div
          v-if="!loading && !error && pagedManagers.length === 0"
          class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400"
        >
          No profiles found.
        </div>

        <!-- Mobile cards -->
        <div v-if="isMobile && pagedManagers.length" class="space-y-3">
          <section
            v-for="(g, idx) in pagedManagers"
            :key="idx"
            class="rounded-2xl border border-slate-200 bg-white/95
                   shadow-[0_10px_24px_rgba(15,23,42,0.10)]
                   dark:border-slate-700 dark:bg-slate-900/95 overflow-hidden"
          >
            <!-- Manager header -->
            <div class="border-b border-slate-200 bg-indigo-50 px-3 py-2 dark:border-slate-700 dark:bg-indigo-950/30">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50 truncate">
                    <span
                      class="mr-2 inline-flex items-center rounded-full bg-indigo-600/10 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-indigo-700
                             dark:bg-indigo-500/15 dark:text-indigo-200"
                    >
                      MANAGER
                    </span>
                    {{ safeTxt(g.manager?.name) }}
                    <span class="ml-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      ({{ safeTxt(g.manager?.employeeId) }})
                    </span>
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {{ safeTxt(g.manager?.department) }}
                  </div>
                </div>

                <div
                  class="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 border border-slate-200
                         dark:bg-slate-950 dark:text-slate-200 dark:border-slate-800"
                >
                  {{ g.employees?.length || 0 }}
                </div>
              </div>
            </div>

            <div class="p-3 space-y-2">
              <article
                v-for="e in g.employees"
                :key="e.employeeId"
                role="button"
                tabindex="0"
                class="cursor-pointer rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                       shadow-[0_10px_24px_rgba(15,23,42,0.10)]
                       dark:border-slate-700 dark:bg-slate-950/40"
                @click="goProfile(e.employeeId)"
                @keydown.enter.prevent="goProfile(e.employeeId)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="text-xs font-mono text-slate-800 dark:text-slate-100">
                      {{ safeTxt(e.employeeId) }}
                    </div>
                    <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50 truncate">
                      {{ safeTxt(e.name) }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {{ safeTxt(e.department) }}
                    </div>
                  </div>

                  <div class="text-right space-y-1 text-[11px]">
                    <span class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold" :class="statusChipClasses(!!e.isActive)">
                      {{ e.isActive ? 'Active' : 'Inactive' }}
                    </span>
                    <div>
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="modeChipClasses(e.approvalMode)">
                        {{ modeLabel(e.approvalMode) }}
                      </span>
                    </div>
                  </div>
                </div>

                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="rounded-xl border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
                    <div class="text-slate-500 dark:text-slate-400">Join</div>
                    <div class="font-semibold text-slate-900 dark:text-slate-50">{{ safeTxt(e.joinDate) }}</div>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
                    <div class="text-slate-500 dark:text-slate-400">Contract</div>
                    <div class="font-semibold text-slate-900 dark:text-slate-50">{{ safeTxt(e.contractDate) }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">end: {{ safeTxt(e.contractEndDate) }}</div>
                  </div>
                </div>

                <div class="mt-2 flex flex-wrap gap-2">
                  <span
                    v-for="b in compactBalances(e.balances)"
                    :key="b.k"
                    class="rounded-full px-2 py-0.5 text-[11px] font-semibold border"
                    :class="pairChipClasses(b.remaining)"
                  >
                    {{ b.k }}: {{ b.pair }}
                  </span>
                  <span v-if="!e.balances?.length" class="text-[11px] text-slate-500 dark:text-slate-400">None</span>
                </div>

                <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Manager login: {{ safeTxt(e.managerLoginId) }}
                </div>

                <div class="mt-2 flex flex-wrap justify-end gap-2" @click.stop>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700"
                    @click.stop="goEdit(e.employeeId)"
                  >
                    <i class="fa-solid fa-pen-to-square text-[10px]" />
                    Edit
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <!-- Desktop table -->
        <div v-else-if="!isMobile && pagedManagers.length" class="space-y-3">
          <section
            v-for="(g, idx) in pagedManagers"
            :key="idx"
            class="rounded-2xl border border-slate-200 bg-white/95
                   shadow-[0_10px_24px_rgba(15,23,42,0.08)]
                   dark:border-slate-700 dark:bg-slate-900/95 overflow-hidden"
          >
            <div class="border-b border-slate-200 bg-indigo-50 px-3 py-2 dark:border-slate-700 dark:bg-indigo-950/30">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50 truncate">
                    <span
                      class="mr-2 inline-flex items-center rounded-full bg-indigo-600/10 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-indigo-700
                             dark:bg-indigo-500/15 dark:text-indigo-200"
                    >
                      MANAGER
                    </span>
                    {{ safeTxt(g.manager?.name) }}
                    <span class="ml-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      ({{ safeTxt(g.manager?.employeeId) }})
                    </span>
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {{ safeTxt(g.manager?.department) }}
                  </div>
                </div>
                <div class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {{ g.employees?.length || 0 }} employees
                </div>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="min-w-[1100px] w-full border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
                <thead
                  class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                         dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
                >
                  <tr>
                    <th class="table-th">Employee</th>
                    <th class="table-th">Department</th>
                    <th class="table-th">Join</th>
                    <th class="table-th">Contract</th>
                    <th class="table-th">Mode</th>
                    <th class="table-th">Balances (U/R)</th>
                    <th class="table-th text-center">Status</th>
                    <th class="table-th text-right">Actions</th>
                  </tr>
                </thead>

                <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                  <tr
                    v-for="e in g.employees"
                    :key="e.employeeId"
                    class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70 cursor-pointer"
                    @click="goProfile(e.employeeId)"
                  >
                    <td class="table-td align-top">
                      <div class="text-xs font-mono text-slate-900 dark:text-slate-50">{{ safeTxt(e.employeeId) }}</div>
                      <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">{{ safeTxt(e.name) }}</div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">Manager: {{ safeTxt(e.managerLoginId) }}</div>
                    </td>

                    <td class="table-td align-top">{{ safeTxt(e.department) }}</td>
                    <td class="table-td align-top whitespace-nowrap">{{ safeTxt(e.joinDate) }}</td>

                    <td class="table-td align-top whitespace-nowrap">
                      <div class="font-semibold">{{ safeTxt(e.contractDate) }}</div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">end: {{ safeTxt(e.contractEndDate) }}</div>
                    </td>

                    <td class="table-td align-top">
                      <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold" :class="modeChipClasses(e.approvalMode)">
                        {{ modeLabel(e.approvalMode) }}
                      </span>
                    </td>

                    <td class="table-td align-top">
                      <div class="flex flex-wrap gap-2">
                        <span
                          v-for="b in compactBalances(e.balances)"
                          :key="b.k"
                          class="rounded-full px-2 py-0.5 text-[11px] font-semibold border"
                          :class="pairChipClasses(b.remaining)"
                        >
                          {{ b.k }}: {{ b.pair }}
                        </span>
                        <span v-if="!e.balances?.length" class="text-[11px] text-slate-500 dark:text-slate-400">None</span>
                      </div>
                    </td>

                    <td class="table-td align-top text-center">
                      <span class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold" :class="statusChipClasses(!!e.isActive)">
                        {{ e.isActive ? 'Active' : 'Inactive' }}
                      </span>
                    </td>

                    <td class="table-td align-top text-right" @click.stop>
                      <div class="inline-flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-700"
                          @click="goEdit(e.employeeId)"
                        >
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
        <div
          v-if="!loading && totalRows"
          class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2
                 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300"
        >
          <div>
            Showing <span class="font-semibold text-slate-900 dark:text-slate-50">{{ pageFrom }}</span>–
            <span class="font-semibold text-slate-900 dark:text-slate-50">{{ pageTo }}</span>
            of <span class="font-semibold text-slate-900 dark:text-slate-50">{{ totalRows }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5
                     text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60
                     dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              :disabled="page <= 1"
              @click="prevPage"
            >
              <i class="fa-solid fa-chevron-left text-[10px]" />
              Prev
            </button>

            <div
              class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700
                     dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              Page {{ page }} / {{ totalPages }}
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5
                     text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60
                     dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              :disabled="page >= totalPages"
              @click="nextPage"
            >
              Next
              <i class="fa-solid fa-chevron-right text-[10px]" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ✅ Create modal -->
    <transition name="modal-fade">
      <div v-if="createOpen" class="fixed inset-0 z-40 overflow-y-auto bg-slate-900/50 px-2 py-6" @click.self="closeCreate">
        <div
          class="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl
                 dark:border-slate-700 dark:bg-slate-950
                 max-h-[calc(100vh-3rem)] flex flex-col"
        >
          <!-- Header -->
          <div class="shrink-0 rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500 px-4 py-3 text-white">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold">New leave profile</div>
                <div class="text-[11px] text-white/85">
                  Approval chain:
                  <span class="font-semibold">Manager</span> →
                  <span class="font-semibold">GM</span>
                  <span v-if="needsCoo"> → <span class="font-semibold">COO</span></span>
                </div>
              </div>

              <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 hover:bg-white/20" @click="closeCreate">
                <i class="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>

            <!-- Tabs -->
            <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <div class="flex rounded-full bg-sky-900/30 p-0.5">
                <button
                  type="button"
                  class="rounded-full px-3 py-1 font-medium"
                  :class="createTab === 'bulk' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                  @click="createTab = 'bulk'"
                >
                  Manager + multiple
                </button>
                <button
                  type="button"
                  class="rounded-full px-3 py-1 font-medium"
                  :class="createTab === 'single' ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-100 hover:bg-sky-900/50'"
                  @click="createTab = 'single'"
                >
                  Single
                </button>
              </div>
            </div>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3 overscroll-contain">
            <div>
              <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Approval mode</label>
              <select
                v-model="form.approvalMode"
                class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px]
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="MANAGER_AND_GM">Manager + GM</option>
                <option value="GM_AND_COO">GM + COO</option>
              </select>

              <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                GM must approve first. If Manager exists, GM cannot see until Manager approves.
              </p>
            </div>

            <!-- ✅ Auto approvers (readonly, no search) -->
            <div class="rounded-2xl border border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-950/40">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Approvers (auto from seed)</div>

                <div class="flex items-center gap-2 text-[11px]">
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 font-semibold"
                    :class="approverReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'"
                  >
                    {{ approversLoading ? 'Loading…' : approverReady ? 'Ready' : 'Missing approver' }}
                  </span>
                </div>
              </div>

              <div v-if="approversError" class="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                {{ approversError }}
              </div>

              <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div class="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                  <div class="text-slate-500 dark:text-slate-400">GM</div>
                  <div class="mt-0.5 font-semibold text-slate-900 dark:text-slate-50">
                    {{ safeTxt(defaultGm.name) }}
                    <span class="ml-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">({{ safeTxt(defaultGm.loginId) }})</span>
                  </div>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                  <div class="text-slate-500 dark:text-slate-400">
                    COO <span v-if="needsCoo" class="text-rose-600">*</span>
                  </div>
                  <div class="mt-0.5 font-semibold text-slate-900 dark:text-slate-50">
                    {{ needsCoo ? safeTxt(defaultCoo.name) : 'Not required' }}
                    <span v-if="needsCoo" class="ml-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      ({{ safeTxt(defaultCoo.loginId) }})
                    </span>
                  </div>
                </div>
              </div>

              <p class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                No need to select GM/COO — system uses the seeded users.
              </p>
            </div>

            <!-- Manager (optional) -->
            <div>
              <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Direct manager (optional)</label>
              <EmployeeSearch v-if="createTab === 'bulk'" v-model="form.manager" placeholder="Search manager…" />
              <EmployeeSearch v-else v-model="form.singleManager" placeholder="Search manager…" />
              <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                If set, request goes to Manager first, then GM (then COO when GM + COO mode).
              </p>
            </div>

            <!-- Bulk -->
            <div v-if="createTab === 'bulk'" class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Employees</div>
              </div>

              <div
                v-for="(r, i) in form.rows"
                :key="r.key"
                class="rounded-2xl border border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-950/40"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                    Employee #{{ i + 1 }}
                  </div>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-slate-50
                           disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                    @click="removeRow(i)"
                    :disabled="form.rows.length === 1"
                    title="Remove"
                  >
                    <i class="fa-solid fa-trash text-[11px]"></i>
                  </button>
                </div>

                <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div class="sm:col-span-2">
                    <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Employee *</label>
                    <EmployeeSearch v-model="r.employee" placeholder="Search employee…" />
                  </div>

                  <div class="flex items-center">
                    <label class="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                      <input v-model="r.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300 dark:border-slate-700" />
                      Active
                    </label>
                  </div>

                  <div>
                    <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Join date *</label>
                    <input
                      v-model="r.joinDate"
                      type="date"
                      class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      @change="syncContractFromJoin(r)"
                    />
                  </div>

                  <div>
                    <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Contract date</label>
                    <input
                      v-model="r.contractDate"
                      type="date"
                      class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">AL carry</label>
                    <input
                      v-model.number="r.alCarry"
                      type="number"
                      placeholder="0"
                      class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5
                       text-[11px] font-semibold text-slate-700 hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                @click="addRow"
              >
                <i class="fa-solid fa-plus text-[10px]" />
                Add row
              </button>
            </div>

            <!-- Single -->
            <div v-else class="rounded-2xl border border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-950/40">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div class="sm:col-span-2">
                  <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Employee *</label>
                  <EmployeeSearch v-model="form.singleEmployee" placeholder="Search employee…" />
                </div>

                <div class="flex items-center">
                  <label class="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                    <input v-model="form.singleActive" type="checkbox" class="h-4 w-4 rounded border-slate-300 dark:border-slate-700" />
                    Active
                  </label>
                </div>

                <div>
                  <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Join date *</label>
                  <input
                    v-model="form.singleJoinDate"
                    type="date"
                    class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px]
                           dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    @change="syncSingleContract"
                  />
                </div>

                <div>
                  <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Contract date</label>
                  <input
                    v-model="form.singleContractDate"
                    type="date"
                    class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px]
                           dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label class="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">AL carry</label>
                  <input
                    v-model.number="form.singleAlCarry"
                    type="number"
                    placeholder="0"
                    class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px]
                           dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <!-- Error -->
            <div
              v-if="createError"
              class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px]
                     text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
            >
              <span class="font-semibold">Failed:</span> {{ createError }}
            </div>
          </div>

          <!-- Footer -->
          <div class="shrink-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="closeCreate"
              :disabled="saving"
            >
              Cancel
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              @click="submitCreate"
              :disabled="saving || !approverReady"
              :title="!approverReady ? 'Missing GM/COO approver (seed or /admin/leave/approvers)' : ''"
            >
              <i class="fa-solid fa-check text-[10px]" />
              {{ saving ? 'Creating…' : 'Create' }}
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

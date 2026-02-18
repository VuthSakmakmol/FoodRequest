<!-- src/views/expat/admin/profiles/AdminExpatProfile.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import * as XLSX from 'xlsx'

defineOptions({ name: 'AdminExpatProfile' })

const router = useRouter()
const { showToast } = useToast()

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function fmt(v) {
  const s = String(v ?? '').trim()
  return s || ''
}
function up(v) {
  return String(v ?? '').trim().toUpperCase()
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function safeTxt(v) {
  const s = String(v ?? '').trim()
  return s ? s : 'None'
}
function mustYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim())
}

/* password toggle */
const showRowPwd = ref([])
const showSinglePwd = ref(false)
function ensurePwdToggles() {
  const need = form.value.rows.length
  while (showRowPwd.value.length < need) showRowPwd.value.push(false)
  while (showRowPwd.value.length > need) showRowPwd.value.pop()
}

/* Excel sheet names cannot contain: \ / ? * [ ] : and max length 31 */
function safeSheetName(name, fallback = 'Manager') {
  let s = String(name || '').trim() || fallback
  s = s.replace(/[\\\/\?\*\[\]\:]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) s = fallback
  if (s.length > 31) s = s.slice(0, 31)
  return s
}

/* ─────────────────────────────────────────────────────────────
   Responsive
───────────────────────────────────────────────────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ─────────────────────────────────────────────────────────────
   Main state
───────────────────────────────────────────────────────────── */
const loading = ref(false)
const error = ref('')

/* ✅ smooth: checkbox is UI-only, appliedInactive triggers fetch only when clicking Apply */
const includeInactive = ref(false)
const appliedInactive = ref(false)

const q = ref('')
const groups = ref([])

/* ─────────────────────────────────────────────────────────────
   Chips
───────────────────────────────────────────────────────────── */
function statusChipClasses(active) {
  return active ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-danger'
}
function modeChipClasses(mode) {
  const m = up(mode)
  if (m === 'GM_AND_COO' || m === 'MANAGER_AND_COO') return 'ui-badge ui-badge-indigo'
  return 'ui-badge ui-badge-info'
}
function modeLabel(mode) {
  const m = up(mode)
  if (m === 'GM_AND_COO') return 'GM + COO'
  if (m === 'MANAGER_AND_COO') return 'Manager + COO'
  return 'Manager + GM'
}

/* balances compact chips */
function compactBalances(balances) {
  const arr = Array.isArray(balances) ? balances : []
  const order = ['AL', 'SP', 'MC', 'MA', 'UL', 'BL']
  const m = new Map(arr.map((x) => [String(x.leaveTypeCode || '').toUpperCase(), x]))

  const out = []
  for (const k of order) {
    const b = m.get(k)
    if (!b) continue
    const used = num(b.used)
    const remaining = num(b.remaining) // ✅ backend already includes carry
    out.push({ k, used, remaining, pair: `${used}/${remaining}` })
  }
  return out
}

function pairChipClasses(remaining) {
  const r = num(remaining)
  if (r <= 0) return 'ui-badge ui-badge-danger'
  return [
    'ui-badge',
    'border-slate-200 bg-white text-slate-800',
    'dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100',
  ].join(' ')
}

/* ─────────────────────────────────────────────────────────────
   Navigation
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   API: grouped list
───────────────────────────────────────────────────────────── */
async function fetchGroups() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/admin/leave/profiles/grouped', {
      params: { includeInactive: appliedInactive.value ? 'true' : 'false' },
    })

    const data = res.data
    const arr = Array.isArray(data)
      ? data
      : Array.isArray(data?.groups)
        ? data.groups
        : Array.isArray(data?.rows)
          ? data.rows
          : Array.isArray(data?.data)
            ? data.data
            : []

    groups.value = arr
  } catch (e) {
    console.error('fetchGroups error', e)
    error.value = e?.response?.data?.message || e?.message || 'Failed to load profiles.'
    showToast({ type: 'error', title: 'Failed to load', message: error.value })
    groups.value = []
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  q.value = ''
  includeInactive.value = false
}

/* ─────────────────────────────────────────────────────────────
   Filtering (client-side only; smooth typing)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   Pagination (flatten -> slice -> regroup)
───────────────────────────────────────────────────────────── */
const page = ref(1)
const pageSize = ref(10)
const PAGE_SIZES = [10, 20, 50, 100, 500, 1000]

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
watch(q, () => (page.value = 1))

/* ─────────────────────────────────────────────────────────────
   Approvers (backend returns { gm:[...], coo:[...] })
───────────────────────────────────────────────────────────── */
const approversLoading = ref(false)
const approversError = ref('')
const defaultGm = ref({ loginId: 'leave_gm', name: 'Expat GM', role: 'LEAVE_GM' })
const defaultCoo = ref({ loginId: 'leave_coo', name: 'COO', role: 'LEAVE_COO' })

async function fetchDefaultApprovers() {
  approversLoading.value = true
  approversError.value = ''
  try {
    const res = await api.get('/admin/leave/approvers')
    const gmList = Array.isArray(res.data?.gm) ? res.data.gm : []
    const cooList = Array.isArray(res.data?.coo) ? res.data.coo : []

    // pick first if exists (or keep seeded fallback)
    if (gmList.length) {
      const a = gmList[0]
      defaultGm.value = { loginId: String(a.loginId || '').trim() || defaultGm.value.loginId, name: String(a.label || a.name || '').trim() || defaultGm.value.name, role: 'LEAVE_GM' }
    }
    if (cooList.length) {
      const a = cooList[0]
      defaultCoo.value = { loginId: String(a.loginId || '').trim() || defaultCoo.value.loginId, name: String(a.label || a.name || '').trim() || defaultCoo.value.name, role: 'LEAVE_COO' }
    }
  } catch (e) {
    console.warn('fetchDefaultApprovers failed; using seed fallbacks', e)
    approversError.value =
      e?.response?.data?.message || e?.message || 'Failed to load approvers (using seed defaults).'
  } finally {
    approversLoading.value = false
  }
}

/* ─────────────────────────────────────────────────────────────
   Create modal + form
───────────────────────────────────────────────────────────── */
const createOpen = ref(false)
const createTab = ref('bulk') // bulk | single
const createError = ref('')
const saving = ref(false)
const showCarryAdvanced = ref(false)

function emptyCarry() {
  return { AL: 0, SP: 0, MC: 0, MA: 0, UL: 0 }
}
function normalizeCarry(c) {
  const src = c || {}
  return {
    AL: Number(src.AL || 0),
    SP: Number(src.SP || 0),
    MC: Number(src.MC || 0),
    MA: Number(src.MA || 0),
    UL: Number(src.UL || 0),
  }
}

function hasValue(v) {
  return String(v ?? '').trim().length > 0
}

function managerDisplayName(g) {
  // If manager missing => show GM
  // priority: manager.name -> "GM"
  return hasValue(g?.manager?.name) ? String(g.manager.name).trim() : 'GM'
}

function managerBadgeLabel(g) {
  // Badge label: MANAGER or GM
  return hasValue(g?.manager?.name) ? 'MANAGER' : 'GM'
}


/* strong password rule (OPTIONAL input) */
function validateStrongPassword(pwd) {
  const p = String(pwd || '')
  if (!p) return { ok: true } // optional
  if (p.length < 13) return { ok: false, message: 'Password must be at least 13 characters.' }
  const hasUpper = /[A-Z]/.test(p)
  const hasLower = /[a-z]/.test(p)
  const hasNum = /\d/.test(p)
  const hasSym = /[^A-Za-z0-9]/.test(p)
  const score = [hasUpper, hasLower, hasNum, hasSym].filter(Boolean).length
  if (score < 3) return { ok: false, message: 'Password must include at least 3 of: uppercase, lowercase, number, symbol.' }
  return { ok: true }
}

/* ─────────────────────────────────────────────────────────────
   Employee search (SIMPLE + SMOOTH)
───────────────────────────────────────────────────────────── */
function createSearchModel() {
  return { query: '', open: false, loading: false, error: '', results: [], selected: null, activeIndex: 0 }
}

const mgrSearch = ref(createSearchModel())
const singleMgrSearch = ref(createSearchModel())
const singleEmpSearch = ref(createSearchModel())
const rowSearches = ref([])

function pickEmployeeId(emp) {
  const e = emp || {}
  return String(e.employeeId || e.empId || e.id || '').trim()
}
function pickLoginId(emp) {
  const e = emp || {}
  const login = String(e.loginId || e.loginID || e.userLoginId || e.username || '').trim()
  if (login) return login
  return String(e.employeeId || e.empId || e.id || '').trim()
}
function pickName(emp) {
  const e = emp || {}
  return String(e.name || e.fullName || `${e.firstName || ''} ${e.lastName || ''}` || '').trim()
}

function debounce(fn, wait = 300) {
  let t = null
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}
const debouncedRunSearch = debounce((model) => runSearchSimple(model), 300)

async function searchEmployees(qText) {
  const qv = String(qText || '').trim()
  if (!qv) return []

  // ✅ Keep it simple: your api wrapper already uses baseURL; this should be correct
  const res = await api.get('/public/employees', { params: { q: qv } })

  const data = res.data
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.rows) ? data.rows :
    Array.isArray(data?.data) ? data.data :
    []

  return arr
}

function displayOption(e) {
  const id = pickEmployeeId(e)
  const name = pickName(e)
  const dept = String(e?.departmentName || e?.department || e?.dept || '').trim()
  return `${id} — ${name}${dept ? ` • ${dept}` : ''}`
}

function setSelected(model, emp) {
  model.selected = emp
  model.query = emp ? displayOption(emp) : ''
  model.results = []
  model.error = ''
  model.activeIndex = 0
  model.open = false
}
function clearSelected(model) {
  model.selected = null
  model.query = ''
  model.results = []
  model.error = ''
  model.activeIndex = 0
  model.open = false
}

function exportCurrentViewExcel() {
  exportExcelFromGroups(pagedManagers.value, { scope: 'CurrentView' })
}


async function runSearchSimple(model) {
  const qv = String(model.query || '').split('—')[0].trim() || String(model.query || '').trim()
  model.error = ''
  model.results = []
  model.open = false

  if (!qv || qv.length < 2) {
    model.open = true
    model.error = 'Type at least 2 characters.'
    return
  }

  model.loading = true
  try {
    const rows = await searchEmployees(qv)
    model.results = rows
    model.open = true
    model.activeIndex = 0
  } catch (e) {
    model.error = e?.response?.data?.message || e?.message || 'Search failed'
    model.open = true
  } finally {
    model.loading = false
  }
}

/* ✅ IMPORTANT: no capture=true */
function onDocClick() {
  ;[mgrSearch.value, singleMgrSearch.value, singleEmpSearch.value, ...rowSearches.value].forEach((m) => {
    if (m) m.open = false
  })
}

/* rows */
function newRow() {
  return {
    key: Math.random().toString(16).slice(2),
    joinDate: '',
    contractDate: '',
    carry: emptyCarry(),
    isActive: true,
    password: '',
  }
}

const form = ref({
  approvalMode: 'MANAGER_AND_GM',
  rows: [newRow()],
  singleJoinDate: '',
  singleContractDate: '',
  singleCarry: emptyCarry(),
  singleActive: true,
  singlePassword: '',
})

function ensureRowSearchModels() {
  const need = form.value.rows.length
  while (rowSearches.value.length < need) rowSearches.value.push(createSearchModel())
  while (rowSearches.value.length > need) rowSearches.value.pop()
  ensurePwdToggles()
}

const needsCoo = computed(() => {
  const m = up(form.value.approvalMode)
  return m === 'GM_AND_COO' || m === 'MANAGER_AND_COO'
})
const approverReady = computed(() => {
  const gmOk = !!String(defaultGm.value?.loginId || '').trim()
  const cooOk = !!String(defaultCoo.value?.loginId || '').trim()
  return needsCoo.value ? gmOk && cooOk : gmOk
})

function openCreate() {
  createError.value = ''
  createTab.value = 'bulk'
  showCarryAdvanced.value = false

  form.value = {
    approvalMode: 'MANAGER_AND_GM',
    rows: [newRow()],
    singleJoinDate: '',
    singleContractDate: '',
    singleCarry: emptyCarry(),
    singleActive: true,
    singlePassword: '',
  }

  showSinglePwd.value = false
  showRowPwd.value = []

  mgrSearch.value = createSearchModel()
  singleMgrSearch.value = createSearchModel()
  singleEmpSearch.value = createSearchModel()
  rowSearches.value = [createSearchModel()]
  ensureRowSearchModels()

  createOpen.value = true
  fetchDefaultApprovers()
}

function closeCreate() {
  if (saving.value) return
  createOpen.value = false
}

function addRow() {
  form.value.rows.push(newRow())
  ensureRowSearchModels()
}
function removeRow(idx) {
  if (form.value.rows.length === 1) return
  form.value.rows.splice(idx, 1)
  ensureRowSearchModels()
}

function syncContractFromJoinRow(r) {
  if (!r.contractDate && r.joinDate) r.contractDate = r.joinDate
}
function syncSingleContract() {
  if (!form.value.singleContractDate && form.value.singleJoinDate) {
    form.value.singleContractDate = form.value.singleJoinDate
  }
}

/**
 * ✅ YOUR CONCEPT FIX:
 * - When creating profile, create ONLY employee account.
 * - Manager is OPTIONAL (even in manager modes) because manager may be created later.
 * - So we do NOT block submit when manager is missing.
 */

/* ─────────────────────────────────────────────────────────────
   Submit Create
   ✅ Bulk -> POST /admin/leave/profiles/manager
   ✅ Single -> POST /admin/leave/profiles
───────────────────────────────────────────────────────────── */
async function submitCreate() {
  createError.value = ''
  try {
    saving.value = true

    const mode = up(form.value.approvalMode || '')
    if (!['MANAGER_AND_GM', 'MANAGER_AND_COO', 'GM_AND_COO'].includes(mode)) {
      throw new Error('Invalid approval mode.')
    }

    const gmLoginId = String(defaultGm.value?.loginId || '').trim()
    const cooLoginId = String(defaultCoo.value?.loginId || '').trim()

    if (!gmLoginId) throw new Error('GM approver is missing (seed or /admin/leave/approvers).')
    if ((mode === 'GM_AND_COO' || mode === 'MANAGER_AND_COO') && !cooLoginId) {
      throw new Error('COO approver is missing.')
    }

    // ✅ Manager is OPTIONAL now:
    const managerLoginId =
      (mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO')
        ? String(pickLoginId(createTab.value === 'bulk' ? mgrSearch.value.selected : singleMgrSearch.value.selected) || '').trim()
        : ''

    // ─────────────────────────────
    // BULK
    // ─────────────────────────────
    if (createTab.value === 'bulk') {
      const rows = form.value.rows || []
      if (!rows.length) throw new Error('Please add at least 1 employee.')

      const employees = rows.map((r, i) => {
        const emp = rowSearches.value[i]?.selected
        const employeeId = pickEmployeeId(emp)
        if (!employeeId) throw new Error(`Employee #${i + 1} is required.`)

        const employeeLoginId = pickLoginId(emp) || employeeId

        if (!mustYmd(r.joinDate)) throw new Error(`Join date (Employee #${i + 1}) must be YYYY-MM-DD.`)

        const contractDate = r.contractDate || r.joinDate
        if (!mustYmd(contractDate)) throw new Error(`Contract date (Employee #${i + 1}) must be YYYY-MM-DD.`)

        const pwdCheck = validateStrongPassword(r.password)
        if (!pwdCheck.ok) throw new Error(`Employee #${i + 1}: ${pwdCheck.message}`)

        const carry = normalizeCarry(r.carry)

        return {
          employeeId,
          employeeLoginId,
          joinDate: r.joinDate,
          contractDate,
          carry,
          isActive: r.isActive !== false,
          password: String(r.password || '').trim() || undefined, // optional
        }
      })

      const payload = {
        approvalMode: mode,
        managerLoginId: managerLoginId || '', // ✅ optional
        gmLoginId,
        cooLoginId: (mode === 'GM_AND_COO' || mode === 'MANAGER_AND_COO') ? cooLoginId : '',
        employees,
      }

      // ✅ correct endpoint for controller
      const res = await api.post('/admin/leave/profiles/manager', payload)

      showToast({
        type: 'success',
        title: 'Created',
        message: `Created ${res.data?.createdCount ?? res.data?.created?.length ?? 0}.`,
      })

      createOpen.value = false
      await fetchGroups()
      return
    }

    // ─────────────────────────────
    // SINGLE
    // ─────────────────────────────
    const emp = singleEmpSearch.value.selected
    const employeeId = pickEmployeeId(emp)
    if (!employeeId) throw new Error('Employee is required.')

    const employeeLoginId = pickLoginId(emp) || employeeId

    if (!mustYmd(form.value.singleJoinDate)) throw new Error('Join date must be YYYY-MM-DD.')

    const contractDate = form.value.singleContractDate || form.value.singleJoinDate
    if (!mustYmd(contractDate)) throw new Error('Contract date must be YYYY-MM-DD.')

    const pwdCheck = validateStrongPassword(form.value.singlePassword)
    if (!pwdCheck.ok) throw new Error(pwdCheck.message)

    const carry = normalizeCarry(form.value.singleCarry)

    const payload = {
      approvalMode: mode,
      employeeId,
      employeeLoginId,
      joinDate: form.value.singleJoinDate,
      contractDate,
      carry,
      isActive: form.value.singleActive !== false,
      managerLoginId: managerLoginId || '', // ✅ optional
      gmLoginId,
      cooLoginId: (mode === 'GM_AND_COO' || mode === 'MANAGER_AND_COO') ? cooLoginId : '',
      password: String(form.value.singlePassword || '').trim() || undefined, // optional
    }

    await api.post('/admin/leave/profiles', payload)

    showToast({ type: 'success', title: 'Created', message: `Profile created: ${employeeId}` })
    createOpen.value = false
    await fetchGroups()
  } catch (e) {
    console.error('submitCreate error', e)
    createError.value = e?.response?.data?.message || e?.message || 'Failed to create.'
    showToast({ type: 'error', title: 'Failed', message: createError.value })
  } finally {
    saving.value = false
  }
}

/* ─────────────────────────────────────────────────────────────
   Export (Grouped by manager)
───────────────────────────────────────────────────────────── */
function buildBalanceMap(balances) {
  const arr = Array.isArray(balances) ? balances : []
  const m = new Map()
  for (const b of arr) {
    const code = String(b?.leaveTypeCode || '').toUpperCase().trim()
    if (!code) continue
    const ent = num(b.entitlement ?? b.yearlyEntitlement)
    const used = num(b.used)
    const remain = Number.isFinite(b.remaining) ? num(b.remaining) : ent - used
    m.set(code, { ent, used, remain })
  }
  return m
}
function buildRow(e, managerName = '') {
  const bm = buildBalanceMap(e.balances)
  const get = (code) => bm.get(code) || { used: 0, ent: 0, remain: 0 }
  const AL = get('AL')
  const SP = get('SP')
  const MC = get('MC')
  const MA = get('MA')
  const UL = get('UL')
  const BL = get('BL')

  return {
    Manager: fmt(managerName),
    EmployeeID: fmt(e.employeeId),
    Name: fmt(e.name),
    Department: fmt(e.department),
    JoinDate: fmt(e.joinDate),
    ContractDate: fmt(e.contractDate),
    ContractEnd: fmt(e.contractEndDate),
    Mode: modeLabel(e.approvalMode),
    Status: e.isActive ? 'Active' : 'Inactive',

    AL_Used: AL.used,
    AL_Ent: AL.ent,
    AL_Remain: AL.remain,

    SP_Used: SP.used,
    SP_Ent: SP.ent,
    SP_Remain: SP.remain,

    MC_Used: MC.used,
    MA_Used: MA.used,
    UL_Used: UL.used,
    BL_Used: BL.used,
  }
}
function balanceObj(bm, code) {
  const b = bm.get(code) || { ent: 0, used: 0, remain: 0 }
  return { ent: num(b.ent), used: num(b.used), remain: num(b.remain) }
}

function exportExcelFromGroups(groupsToExport, { scope = 'Export' } = {}) {
  const base = Array.isArray(groupsToExport) ? groupsToExport : []
  if (!base.length) {
    showToast({ type: 'info', title: 'Export', message: 'No data to export.' })
    return
  }

  const wb = XLSX.utils.book_new()

  // ✅ Sheet 1: Summary
  const summaryRows = base.map((g) => ({
    GroupLabel: managerBadgeLabel(g),
    ManagerName: managerDisplayName(g),
    ManagerEmployeeId: fmt(g.manager?.employeeId),
    ManagerLoginId: fmt(g.manager?.loginId || g.manager?.managerLoginId),
    ManagerDepartment: fmt(g.manager?.department),
    Employees: (g.employees || []).length,
  }))
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
  wsSummary['!cols'] = [
    { wch: 10 },
    { wch: 26 },
    { wch: 16 },
    { wch: 18 },
    { wch: 22 },
    { wch: 10 },
    { wch: 10 }
  ]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  // ✅ Sheet 2: All employees in ONE sheet (wrapped / unified)
  const allEmployeesRows = []
  for (const g of base) {
    const managerName = managerDisplayName(g)
    const list = Array.isArray(g.employees) ? g.employees : []
    for (const e of list) {
      // uses your helper so output stays consistent
      allEmployeesRows.push(buildRow(e, managerName))
    }
  }

  const wsAll = XLSX.utils.json_to_sheet(allEmployeesRows)

  // optional: nice column widths for the unified sheet
  wsAll['!cols'] = [
    { wch: 22 }, // Manager
    { wch: 12 }, // EmployeeID
    { wch: 22 }, // Name
    { wch: 20 }, // Department
    { wch: 12 }, // JoinDate
    { wch: 12 }, // ContractDate
    { wch: 12 }, // ContractEnd
    { wch: 12 }, // Mode
    { wch: 10 }, // Status

    { wch: 10 }, { wch: 10 }, { wch: 10 }, // AL Used/Ent/Remain
    { wch: 10 }, { wch: 10 }, { wch: 10 }, // SP Used/Ent/Remain
    { wch: 10 }, // MC_Used
    { wch: 10 }, // MA_Used
    { wch: 10 }, // UL_Used
  ]

  XLSX.utils.book_append_sheet(wb, wsAll, 'AllEmployees')

  // ✅ Existing: One sheet per manager/GM group
  const usedNames = new Map()

  for (const g of base) {
    const managerName = managerDisplayName(g) // ✅ GM fallback
    const list = Array.isArray(g.employees) ? g.employees : []

    const rows = list.map((e) => {
      const bm = buildBalanceMap(e.balances)

      const AL = balanceObj(bm, 'AL')
      const SP = balanceObj(bm, 'SP')
      const MC = balanceObj(bm, 'MC')
      const MA = balanceObj(bm, 'MA')
      const UL = balanceObj(bm, 'UL')
      const BL = balanceObj(bm, "BL")

      return {
        GroupLabel: managerBadgeLabel(g),
        GroupManagerName: fmt(managerName),

        EmployeeID: fmt(e.employeeId),
        Name: fmt(e.name),
        Department: fmt(e.department),

        JoinDate: fmt(e.joinDate),
        ContractDate: fmt(e.contractDate),
        ContractEndDate: fmt(e.contractEndDate),

        ApprovalMode: fmt(e.approvalMode),
        Status: e.isActive ? 'Active' : 'Inactive',

        AL_Used: AL.used,
        AL_Remain: AL.remain,

        SP_Used: SP.used,
        SP_Remain: SP.remain,

        MC_Used: MC.used,
        MC_Remain: MC.remain,

        MA_Used: MA.used,
        MA_Remain: MA.remain,

        UL_Used: UL.used,
        UL_Remain: UL.remain,

        BL_Used: BL.used,
        BL_Remain: BL.remain,
      }
    })

    let sheetName = safeSheetName(managerName, 'Manager')
    const used = usedNames.get(sheetName) || 0
    usedNames.set(sheetName, used + 1)
    if (used > 0) {
      const suffix = ` (${used + 1})`
      sheetName = safeSheetName(sheetName.slice(0, 31 - suffix.length) + suffix)
    }

    const ws = XLSX.utils.json_to_sheet(rows)

    ws['!cols'] = [
      { wch: 10 }, // GroupLabel
      { wch: 24 }, // GroupManagerName

      { wch: 12 }, // EmployeeID
      { wch: 22 }, // Name
      { wch: 22 }, // Department

      { wch: 12 }, // JoinDate
      { wch: 12 }, // ContractDate
      { wch: 12 }, // ContractEndDate

      { wch: 16 }, // ApprovalMode
      { wch: 10 }, // Status

      { wch: 8 }, { wch: 10 }, // AL
      { wch: 8 }, { wch: 10 }, // SP
      { wch: 8 }, { wch: 10 }, // MC
      { wch: 8 }, { wch: 10 }, // MA
      { wch: 8 }, { wch: 10 }, // UL
      { wch: 8 }, { ech: 10 }, // BL
    ]

    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `ExpatProfiles-${scope}-${stamp}.xlsx`
  XLSX.writeFile(wb, filename)

  showToast({ type: 'success', title: 'Export', message: `Saved: ${filename}` })
}


/* ─────────────────────────────────────────────────────────────
   Modal scroll lock
───────────────────────────────────────────────────────────── */
watch(createOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!open)
})

/* ─────────────────────────────────────────────────────────────
   Lifecycle
───────────────────────────────────────────────────────────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  if (typeof document !== 'undefined') document.addEventListener('click', onDocClick)

  fetchGroups()
  fetchDefaultApprovers()
  ensureRowSearchModels()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (typeof document !== 'undefined') document.removeEventListener('click', onDocClick)
  if (typeof document !== 'undefined') document.body.classList.remove('overflow-hidden')
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full min-h-screen flex flex-col">
      <!-- HERO -->
      <div class="ui-hero-gradient rounded-t-2xl border-x-0 border-t-0">
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-[240px]">
            <div class="text-[18px] sm:text-[22px] font-extrabold tracking-tight">Expat Profiles</div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="ui-badge bg-white/15 border-white/25 text-white">Employees: <b>{{ filteredCount }}</b></span>
              <span class="ui-badge bg-white/15 border-white/25 text-white">Managers: <b>{{ managerCount }}</b></span>
            </div>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <div class="min-w-[260px] max-w-sm">
              <div class="text-[11px] font-extrabold uppercase tracking-[0.20em] text-emerald-50/90">Search</div>
              <div class="relative mt-1">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-white/80"></i>
                <input
                  v-model="q"
                  type="text"
                  placeholder="Employee / manager / department..."
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 pl-8 text-[12px] text-white placeholder:text-white/70 outline-none
                         focus:ring-2 focus:ring-white/25"
                />
              </div>
            </div>

            <div class="flex items-center gap-2 pt-5">
              <label class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white">
                <input v-model="includeInactive" type="checkbox" class="h-4 w-4 rounded border-white/30 bg-transparent" />
                <span>Include inactive</span>
              </label>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-xl bg-white px-3 py-2 text-[12px] font-extrabold text-emerald-700 hover:bg-emerald-50"
                @click="openCreate"
              >
                <i class="fa-solid fa-plus text-[11px]"></i>
                New
              </button>

              <button
                type="button"
                class="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] font-extrabold text-white hover:bg-white/15"
                @click="exportCurrentViewExcel"
              >
                <i class="fa-solid fa-file-excel text-[11px]" />
                Export
              </button>

              <button
                type="button"
                class="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] font-extrabold text-white hover:bg-white/15"
                @click="clearFilters"
              >
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>

              <button
                type="button"
                class="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] font-extrabold text-white hover:bg-white/15 disabled:opacity-60"
                @click="fetchGroups"
                :disabled="loading"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                Refresh
              </button>
            </div>
          </div>
        </div>

        <!-- Mobile -->
        <div v-else class="space-y-2">
          <div>
            <div class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/85">Expat Leave</div>
            <div class="text-[18px] font-extrabold tracking-tight">Expat Profiles</div>
            <div class="text-[12px] text-emerald-50/90">Profiles grouped by manager.</div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="ui-badge bg-white/15 border-white/25 text-white">Employees: <b>{{ filteredCount }}</b></span>
              <span class="ui-badge bg-white/15 border-white/25 text-white">Managers: <b>{{ managerCount }}</b></span>
              <span class="ui-badge bg-white/15 border-white/25 text-white">Page: <b>{{ page }}/{{ totalPages }}</b></span>
            </div>
          </div>

          <div class="space-y-2">
            <div>
              <div class="text-[11px] font-extrabold uppercase tracking-[0.20em] text-emerald-50/90">Search</div>
              <div class="relative mt-1">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-white/80"></i>
                <input
                  v-model="q"
                  type="text"
                  placeholder="Employee / manager / dept..."
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 pl-8 text-[12px] text-white placeholder:text-white/70 outline-none
                         focus:ring-2 focus:ring-white/25"
                />
              </div>
              <div class="mt-1 text-[10px] text-white/75">Smooth search (no reload).</div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white">
                <input v-model="includeInactive" type="checkbox" class="h-4 w-4 rounded border-white/30 bg-transparent" />
                <span>Include inactive</span>
              </label>

              <div class="flex items-center gap-2">
                <select
                  v-model.number="pageSize"
                  class="w-auto rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] text-white outline-none"
                >
                  <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}/page</option>
                </select>
                <button
                  type="button"
                  class="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] font-extrabold text-white hover:bg-white/15 disabled:opacity-60"
                  @click="fetchGroups"
                  :disabled="loading"
                >
                  <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''"></i>
                  Refresh
                </button>

                <button
                  type="button"
                  class="rounded-xl bg-white px-3 py-2 text-[12px] font-extrabold text-emerald-700 hover:bg-emerald-50"
                  @click="openCreate"
                >
                  <i class="fa-solid fa-plus text-[11px]"></i>
                  New
                </button>
              </div>
            </div>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[12px] font-extrabold text-white hover:bg-white/15"
                @click="clearFilters"
              >
                <i class="fa-solid fa-broom text-[11px]"></i>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- CONTENT -->
      <div class="flex-1 overflow-y-auto ui-scrollbar px-3 sm:px-4 lg:px-6 py-3">
        <div
          v-if="error"
          class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span class="font-semibold">Failed:</span> {{ error }}
        </div>

        <div
          v-if="loading && !pagedManagers.length"
          class="mt-2 ui-card !rounded-2xl border border-ui-border/70 bg-ui-bg-2/60 px-3 py-2 text-[11px] text-ui-muted"
        >
          Loading profiles...
        </div>

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
                    <span class="ui-badge ui-badge-indigo mr-2">{{ managerBadgeLabel(g) }}</span>
                      {{ managerDisplayName(g) }}
                      <span
                        v-if="String(g.manager?.employeeId || '').trim()"
                        class="ml-1 font-mono text-[11px] text-ui-muted"
                      >
                        ({{ safeTxt(g.manager?.employeeId) }})
                      </span>
                  </div>
                  <div class="truncate text-[11px] text-ui-muted">{{ safeTxt(g.manager?.department) }}</div>
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

                <div class="mt-2 text-[11px] text-ui-muted">Manager login: {{ safeTxt(e.managerLoginId) }}</div>

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
                    <span class="ui-badge ui-badge-indigo mr-2">{{ managerBadgeLabel(g) }}</span>
                      {{ managerDisplayName(g) }}
                      <span
                        v-if="String(g.manager?.employeeId || '').trim()"
                        class="ml-1 font-mono text-[11px] text-ui-muted"
                      >
                        ({{ safeTxt(g.manager?.employeeId) }})
                      </span>
                  </div>
                  <div class="truncate text-[11px] text-ui-muted">{{ safeTxt(g.manager?.department) }}</div>
                </div>

                <div class="text-[11px] font-extrabold text-ui-muted">{{ g.employees?.length || 0 }} employees</div>
              </div>
            </div>

            <div class="ui-table-wrap ui-scrollbar">
              <table class="ui-table">
                <colgroup>
                  <col style="width: 20%" />
                  <col style="width: 17%" />
                  <col style="width: 10%" />
                  <col style="width: 10%" />
                  <col style="width: 13%" />
                  <col style="width: 40%" />
                  <col style="width: 7%" />
                  <col style="width: 10%" />
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
                    <td class="ui-td">
                      <div class="flex flex-col items-center text-center gap-0.5">
                        <div class="font-mono text-[11px] text-ui-fg">{{ safeTxt(e.employeeId) }}</div>
                        <div class="text-[12px] font-extrabold text-ui-fg">{{ safeTxt(e.name) }}</div>
                        <div class="text-[11px] text-ui-muted">Manager: {{ safeTxt(e.managerLoginId) }}</div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="flex items-center justify-center text-center">{{ safeTxt(e.department) }}</div>
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      <div class="flex items-center justify-center">{{ safeTxt(e.joinDate) }}</div>
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      <div class="flex flex-col items-center text-center">
                        <div class="font-extrabold">{{ safeTxt(e.contractDate) }}</div>
                        <div class="text-[11px] text-ui-muted">end: {{ safeTxt(e.contractEndDate) }}</div>
                      </div>
                    </td>

                    <td class="ui-td">
                      <div class="flex items-center justify-center">
                        <span :class="modeChipClasses(e.approvalMode)">{{ modeLabel(e.approvalMode) }}</span>
                      </div>
                    </td>

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
                        <span v-if="!e.balances?.length" class="text-[11px] text-ui-muted col-span-3 text-center">None</span>
                      </div>
                    </td>

                    <td class="ui-td !px-2">
                      <div class="flex items-center justify-center">
                        <span :class="statusChipClasses(!!e.isActive)">{{ e.isActive ? 'Active' : 'Inactive' }}</span>
                      </div>
                    </td>

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

        <!-- Bottom pagination -->
        <div
          v-if="!loading && totalRows"
          class="mt-3 ui-card !rounded-2xl px-3 py-2 text-[11px] text-ui-muted flex flex-wrap items-center justify-between gap-2"
        >
          <div class="flex flex-wrap items-center gap-3">
            <!-- Rows per page (moved here) -->
            <div class="flex items-center gap-2">
              <select
                v-model.number="pageSize"
                class="h-8 rounded-xl border border-ui-border/70 bg-ui-card/70 px-2 text-[11px] text-ui-fg outline-none
                      focus:ring-2 focus:ring-ui-ring/30"
              >
                <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
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

      <!-- Create modal -->
      <transition name="modal-fade">
        <div v-if="createOpen" class="ui-modal-backdrop">
          <div class="ui-modal max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden" @click.stop>
            <!-- Header -->
            <div class="ui-hero rounded-b-none px-4 py-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[14px] font-extrabold text-ui-fg">New leave profile</div>
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
                  <option value="MANAGER_AND_COO">Manager + COO</option>
                  <option value="GM_AND_COO">GM + COO</option>
                </select>
              </div>

              <!-- Manager picker (OPTIONAL now) -->
              <div>
                <div class="ui-label">Direct manager</div>
                <div v-if="createTab === 'bulk'" class="relative" @click.stop>
                  <div class="relative">
                    <i class="fa-solid fa-user-tie absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ui-muted"></i>
                    <input
                      v-model="mgrSearch.query"
                      type="text"
                      class="ui-input pl-8 pr-16"
                      placeholder="Type then press Enter..."
                      @input="debouncedRunSearch(mgrSearch)"
                      @keydown.enter.prevent="runSearchSimple(mgrSearch)"
                    />
                    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="runSearchSimple(mgrSearch)" title="Search">
                        <i class="fa-solid fa-magnifying-glass"></i>
                      </button>
                      <button v-if="mgrSearch.selected" type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="clearSelected(mgrSearch)" title="Clear">
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  </div>

                  <div
                    v-if="mgrSearch.open"
                    class="absolute left-0 right-0 top-full z-50 mt-2 ui-card !rounded-2xl p-2 shadow-xl max-h-[260px] overflow-auto"
                    @click.stop
                  >
                    <div v-if="mgrSearch.loading" class="text-[11px] text-ui-muted px-2 py-1">Searching…</div>
                    <div v-else-if="mgrSearch.error" class="text-[11px] text-rose-600 px-2 py-1">{{ mgrSearch.error }}</div>
                    <template v-else>
                      <button
                        v-for="(r, idx) in mgrSearch.results"
                        :key="pickEmployeeId(r) + '_' + idx"
                        type="button"
                        class="w-full text-left rounded-xl px-2 py-2 text-[12px] hover:bg-ui-bg-2/60"
                        @click="setSelected(mgrSearch, r)"
                      >
                        {{ displayOption(r) }}
                      </button>
                      <div v-if="!mgrSearch.results.length" class="text-[11px] text-ui-muted px-2 py-1">No results.</div>
                    </template>
                  </div>
                </div>

                <div v-else class="relative" @click.stop>
                  <div class="relative">
                    <i class="fa-solid fa-user-tie absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ui-muted"></i>
                    <input
                      v-model="singleMgrSearch.query"
                      type="text"
                      class="ui-input pl-8 pr-16"
                      placeholder="Type then press Enter..."
                      @input="debouncedRunSearch(singleMgrSearch)"
                      @keydown.enter.prevent="runSearchSimple(singleMgrSearch)"
                      autocomplete="off"
                    />
                    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="runSearchSimple(singleMgrSearch)" title="Search">
                        <i class="fa-solid fa-magnifying-glass"></i>
                      </button>
                      <button v-if="singleMgrSearch.selected" type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="clearSelected(singleMgrSearch)" title="Clear">
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  </div>

                  <div
                    v-if="singleMgrSearch.open"
                    class="absolute left-0 right-0 top-full z-50 mt-2 ui-card !rounded-2xl p-2 shadow-xl max-h-[260px] overflow-auto"
                    @click.stop
                  >
                    <div v-if="singleMgrSearch.loading" class="text-[11px] text-ui-muted px-2 py-1">Searching…</div>
                    <div v-else-if="singleMgrSearch.error" class="text-[11px] text-rose-600 px-2 py-1">{{ singleMgrSearch.error }}</div>
                    <template v-else>
                      <button
                        v-for="(r, idx) in singleMgrSearch.results"
                        :key="pickEmployeeId(r) + '_' + idx"
                        type="button"
                        class="w-full text-left rounded-xl px-2 py-2 text-[12px] hover:bg-ui-bg-2/60"
                        @click="setSelected(singleMgrSearch, r)"
                      >
                        {{ displayOption(r) }}
                      </button>
                      <div v-if="!singleMgrSearch.results.length" class="text-[11px] text-ui-muted px-2 py-1">No results.</div>
                    </template>
                  </div>
                </div>
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

                  <!-- Employee picker -->
                  <div class="mt-2">
                    <div class="ui-label">Employee *</div>
                    <div class="relative" @click.stop>
                      <div class="relative">
                        <i class="fa-solid fa-id-card absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ui-muted"></i>
                        <input
                          v-model="rowSearches[i].query"
                          type="text"
                          class="ui-input pl-8 pr-16"
                          placeholder="Type then press Enter..."
                          @input="debouncedRunSearch(rowSearches[i])"
                          @keydown.enter.prevent="runSearchSimple(rowSearches[i])"
                          autocomplete="off"
                        />
                        <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="runSearchSimple(rowSearches[i])" title="Search">
                            <i class="fa-solid fa-magnifying-glass"></i>
                          </button>
                          <button v-if="rowSearches[i].selected" type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="clearSelected(rowSearches[i])" title="Clear">
                            <i class="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      </div>

                      <div
                        v-if="rowSearches[i].open"
                        class="absolute left-0 right-0 top-full z-50 mt-2 ui-card !rounded-2xl p-2 shadow-xl"
                        style="max-height: 260px; overflow:auto;"
                        @click.stop
                      >
                        <div v-if="rowSearches[i].loading" class="text-[11px] text-ui-muted px-2 py-1">Searching…</div>
                        <div v-else-if="rowSearches[i].error" class="text-[11px] text-rose-600 px-2 py-1">{{ rowSearches[i].error }}</div>
                        <template v-else>
                          <button
                            v-for="(rr, idx) in rowSearches[i].results"
                            :key="pickEmployeeId(rr) + '_' + idx"
                            type="button"
                            class="w-full text-left rounded-xl px-2 py-2 text-[12px] hover:bg-ui-bg-2/60"
                            @click="setSelected(rowSearches[i], rr)"
                          >
                            {{ displayOption(rr) }}
                          </button>
                          <div v-if="!rowSearches[i].results.length" class="text-[11px] text-ui-muted px-2 py-1">No results.</div>
                        </template>
                      </div>
                    </div>
                  </div>

                  <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div class="flex items-center pt-1 sm:pt-6">
                      <label class="inline-flex items-center gap-2 text-[11px] text-ui-fg">
                        <input v-model="r.isActive" type="checkbox" class="h-4 w-4 rounded border-ui-border/70 bg-transparent" />
                        Active
                      </label>
                    </div>

                    <div>
                      <div class="ui-label">Join date *</div>
                      <input v-model="r.joinDate" type="date" class="ui-date" @change="syncContractFromJoinRow(r)" />
                    </div>

                    <div>
                      <div class="ui-label">Contract date</div>
                      <input v-model="r.contractDate" type="date" class="ui-date" />
                    </div>

                    <div class="sm:col-span-3">
                      <div class="ui-label">Password</div>
                      <div class="relative">
                        <input
                          v-model="r.password"
                          :type="showRowPwd[i] ? 'text' : 'password'"
                          autocomplete="new-password"
                          placeholder="Enter strong password…"
                          class="ui-input pr-12"
                        />
                        <button
                          type="button"
                          class="absolute right-2 top-1/2 -translate-y-1/2 ui-btn ui-btn-ghost ui-btn-xs"
                          @click="showRowPwd[i] = !showRowPwd[i]"
                          :title="showRowPwd[i] ? 'Hide password' : 'Show password'"
                        >
                          <i class="fa-solid" :class="showRowPwd[i] ? 'fa-eye-slash' : 'fa-eye'"></i>
                        </button>
                      </div>
                    </div>

                    <div class="sm:col-span-3">
                      <div class="flex items-center justify-between">
                        <div class="ui-label">Carry</div>
                        <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="showCarryAdvanced = !showCarryAdvanced">
                          <i class="fa-solid" :class="showCarryAdvanced ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                          {{ showCarryAdvanced ? 'Hide' : 'Advanced' }}
                        </button>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-5 gap-2">
                        <div class="sm:col-span-2">
                          <div class="ui-label">AL</div>
                          <input v-model.number="r.carry.AL" type="number" placeholder="0" class="ui-input" />
                        </div>

                        <template v-if="showCarryAdvanced">
                          <div><div class="ui-label">SP</div><input v-model.number="r.carry.SP" type="number" placeholder="0" class="ui-input" /></div>
                          <div><div class="ui-label">MC</div><input v-model.number="r.carry.MC" type="number" placeholder="0" class="ui-input" /></div>
                          <div><div class="ui-label">MA</div><input v-model.number="r.carry.MA" type="number" placeholder="0" class="ui-input" /></div>
                          <div><div class="ui-label">UL</div><input v-model.number="r.carry.UL" type="number" placeholder="0" class="ui-input" /></div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Single -->
              <div v-else class="ui-card !rounded-2xl p-3">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div class="sm:col-span-2">
                    <div class="ui-label">Employee *</div>

                    <div class="relative" @click.stop>
                      <div class="relative">
                        <i class="fa-solid fa-id-card absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ui-muted"></i>
                        <input
                          v-model="singleEmpSearch.query"
                          type="text"
                          class="ui-input pl-8 pr-16"
                          placeholder="Type then press Enter..."
                          @input="debouncedRunSearch(singleEmpSearch)"
                          @keydown.enter.prevent="runSearchSimple(singleEmpSearch)"
                          autocomplete="off"
                        />
                        <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="runSearchSimple(singleEmpSearch)" title="Search">
                            <i class="fa-solid fa-magnifying-glass"></i>
                          </button>
                          <button v-if="singleEmpSearch.selected" type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="clearSelected(singleEmpSearch)" title="Clear">
                            <i class="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      </div>

                      <div
                        v-if="singleEmpSearch.open"
                        class="absolute left-0 right-0 top-full z-50 mt-2 ui-card !rounded-2xl p-2 shadow-xl max-h-[260px] overflow-auto"
                        @click.stop
                      >
                        <div v-if="singleEmpSearch.loading" class="text-[11px] text-ui-muted px-2 py-1">Searching…</div>
                        <div v-else-if="singleEmpSearch.error" class="text-[11px] text-rose-600 px-2 py-1">{{ singleEmpSearch.error }}</div>
                        <template v-else>
                          <button
                            v-for="(rr, idx) in singleEmpSearch.results"
                            :key="pickEmployeeId(rr) + '_' + idx"
                            type="button"
                            class="w-full text-left rounded-xl px-2 py-2 text-[12px] hover:bg-ui-bg-2/60"
                            @click="setSelected(singleEmpSearch, rr)"
                          >
                            {{ displayOption(rr) }}
                          </button>
                          <div v-if="!singleEmpSearch.results.length" class="text-[11px] text-ui-muted px-2 py-1">No results.</div>
                        </template>
                      </div>
                    </div>
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

                  <div class="sm:col-span-3">
                    <div class="ui-label">Password</div>
                    <div class="relative">
                      <input
                        v-model="form.singlePassword"
                        :type="showSinglePwd ? 'text' : 'password'"
                        autocomplete="new-password"
                        placeholder="Enter strong password…"
                        class="ui-input pr-12"
                      />
                      <button
                        type="button"
                        class="absolute right-2 top-1/2 -translate-y-1/2 ui-btn ui-btn-ghost ui-btn-xs"
                        @click="showSinglePwd = !showSinglePwd"
                        :title="showSinglePwd ? 'Hide password' : 'Show password'"
                      >
                        <i class="fa-solid" :class="showSinglePwd ? 'fa-eye-slash' : 'fa-eye'"></i>
                      </button>
                    </div>
                  </div>

                  <div class="sm:col-span-3">
                    <div class="flex items-center justify-between">
                      <div class="ui-label">Carry</div>
                      <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="showCarryAdvanced = !showCarryAdvanced">
                        <i class="fa-solid" :class="showCarryAdvanced ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                        {{ showCarryAdvanced ? 'Hide' : 'Advanced' }}
                      </button>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      <div class="sm:col-span-2">
                        <div class="ui-label">AL carry</div>
                        <input v-model.number="form.singleCarry.AL" type="number" placeholder="0" class="ui-input" />
                      </div>

                      <template v-if="showCarryAdvanced">
                        <div><div class="ui-label">SP</div><input v-model.number="form.singleCarry.SP" type="number" placeholder="0" class="ui-input" /></div>
                        <div><div class="ui-label">MC</div><input v-model.number="form.singleCarry.MC" type="number" placeholder="0" class="ui-input" /></div>
                        <div><div class="ui-label">MA</div><input v-model.number="form.singleCarry.MA" type="number" placeholder="0" class="ui-input" /></div>
                        <div><div class="ui-label">UL</div><input v-model.number="form.singleCarry.UL" type="number" placeholder="0" class="ui-input" /></div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="createError"
                class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                       dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
              >
                <span class="font-semibold">Failed:</span> {{ createError }}
              </div>

              <div
                v-if="approversError && !createError"
                class="ui-card !rounded-2xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-[11px] text-indigo-700
                       dark:border-indigo-700/60 dark:bg-indigo-950/40 dark:text-indigo-200"
              >
                {{ approversError }}
              </div>
            </div>

            <!-- Footer -->
            <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
              <button type="button" class="ui-btn ui-btn-ghost" @click="closeCreate" :disabled="saving">Cancel</button>

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

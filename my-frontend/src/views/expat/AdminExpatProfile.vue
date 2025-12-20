<!-- src/views/expat/AdminExpatProfile.vue  (or AdminExpatProfiles.vue) -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminExpatProfiles' })

const router = useRouter()
const { showToast } = useToast()

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── Leave types (display order) ───────── */
const leaveTypes = ref([])
async function fetchLeaveTypes() {
  try {
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
  }
}
const TYPE_ORDER = computed(() => {
  const codes = (leaveTypes.value || [])
    .map(t => String(t?.code || '').toUpperCase())
    .filter(Boolean)
  const fallback = ['AL', 'SP', 'MC', 'MA', 'UL']
  return [...new Set([...fallback, ...codes])]
})

/* ───────── GM Approver list (only GM) ───────── */
const approvers = ref([]) // [{loginId,name,role}]
const gms = computed(() => (approvers.value || []).filter(a => a.role === 'LEAVE_GM'))

async function fetchApprovers() {
  try {
    const res = await api.get('/admin/leave/approvers')
    const arr = Array.isArray(res.data)
      ? res.data
      : (Array.isArray(res.data?.gms) ? res.data.gms : [])

    approvers.value = arr.map(x => ({
      loginId: String(x.loginId || ''),
      name: x.name || '',
      role: x.role || 'LEAVE_GM',
    }))
  } catch (e) {
    console.error('fetchApprovers error', e)
    showToast({
      type: 'error',
      title: 'Failed to load GM',
      message: e?.response?.data?.message || 'Cannot load GM list.',
    })
  }
}

/* ───────── Profiles (grouped) ───────── */
const loading = ref(false)
const loadError = ref('')
const groups = ref([]) // [{ manager:{employeeId,name,department}, employees:[...] }]
const search = ref('')

async function fetchGrouped() {
  try {
    loading.value = true
    loadError.value = ''
    const res = await api.get('/admin/leave/profiles/grouped')
    groups.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchGrouped error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load profiles.'
    showToast({ type: 'error', title: 'Failed to load profiles', message: loadError.value })
  } finally {
    loading.value = false
  }
}

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function normalizeBalances(rawBalances = []) {
  const map = new Map()
  for (const b of rawBalances || []) {
    const code = String(b?.leaveTypeCode || '').toUpperCase()
    if (!code) continue
    map.set(code, {
      leaveTypeCode: code,
      yearlyEntitlement: num(b?.yearlyEntitlement),
      used: num(b?.used),
      remaining: num(b?.remaining),
    })
  }
  for (const code of TYPE_ORDER.value) {
    if (!map.has(code)) map.set(code, { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
  }
  const arr = Array.from(map.values())
  arr.sort((a, b) => TYPE_ORDER.value.indexOf(a.leaveTypeCode) - TYPE_ORDER.value.indexOf(b.leaveTypeCode))
  return arr
}

function findBalance(rawBalances = [], code) {
  const c = String(code || '').toUpperCase()
  const list = normalizeBalances(rawBalances)
  return list.find(b => b.leaveTypeCode === c) || { leaveTypeCode: c, yearlyEntitlement: 0, used: 0, remaining: 0 }
}

/* filtered groups */
const filteredGroups = computed(() => {
  const q = String(search.value || '').trim().toLowerCase()
  if (!q) return groups.value || []

  const out = []
  for (const g of groups.value || []) {
    const mgr = g?.manager || {}
    const mgrHit =
      String(mgr.employeeId || '').toLowerCase().includes(q) ||
      String(mgr.name || '').toLowerCase().includes(q) ||
      String(mgr.department || '').toLowerCase().includes(q)

    const emps = (g?.employees || []).filter(e =>
      String(e.employeeId || '').toLowerCase().includes(q) ||
      String(e.name || '').toLowerCase().includes(q) ||
      String(e.department || '').toLowerCase().includes(q)
    )

    if (mgrHit || emps.length) {
      out.push({
        manager: mgr,
        employees: mgrHit ? (g.employees || []) : emps,
      })
    }
  }
  return out
})

/* ───────── Public directory search helper ───────── */
async function searchDirectory(q) {
  const res = await api.get('/public/employees', { params: { q } })
  return Array.isArray(res.data) ? res.data : []
}

/* ───────── Create modal: mode = manager | employee ───────── */
const createDialog = ref(false)
const createMode = ref('manager') // 'manager' | 'employee'
const createSaving = ref(false)
const createError = ref('')

const gmLoginId = ref('')

watch(gms, () => {
  if (!gmLoginId.value && gms.value.length) gmLoginId.value = gms.value[0].loginId
})

/* Manager creation */
const mgrQuery = ref('')
const mgrLoading = ref(false)
const mgrResults = ref([])
const pickedMgr = ref(null)

let mgrTimer = null
watch(mgrQuery, (v) => {
  pickedMgr.value = null
  mgrResults.value = []
  if (mgrTimer) clearTimeout(mgrTimer)
  const q = String(v || '').trim()
  if (!q) return
  mgrTimer = setTimeout(async () => {
    try {
      mgrLoading.value = true
      mgrResults.value = await searchDirectory(q)
    } catch (e) {
      console.error(e)
      mgrResults.value = []
    } finally {
      mgrLoading.value = false
    }
  }, 250)
})
function pickManager(emp) { pickedMgr.value = emp }

/* Add employees */
const empQuery = ref('')
const empLoading = ref(false)
const empResults = ref([])
const selectedEmployees = ref([])

let empTimer = null
watch(empQuery, (v) => {
  empResults.value = []
  if (empTimer) clearTimeout(empTimer)
  const q = String(v || '').trim()
  if (!q) return
  empTimer = setTimeout(async () => {
    try {
      empLoading.value = true
      empResults.value = await searchDirectory(q)
    } catch (e) {
      console.error(e)
      empResults.value = []
    } finally {
      empLoading.value = false
    }
  }, 250)
})

function hasEmployee(id) {
  return selectedEmployees.value.some(x => String(x.employeeId) === String(id))
}
function addEmployee(emp) {
  if (!emp?.employeeId) return
  if (hasEmployee(emp.employeeId)) return
  selectedEmployees.value.push({
    employeeId: String(emp.employeeId),
    name: emp.name || '',
    department: emp.department || '',
    joinDate: '',
    contractDate: '',
    alCarry: 0,
    isActive: true,
  })
}
function removeEmployee(id) {
  selectedEmployees.value = selectedEmployees.value.filter(x => String(x.employeeId) !== String(id))
}

/* Employee-only creation */
const oneEmpQuery = ref('')
const oneEmpLoading = ref(false)
const oneEmpResults = ref([])
const pickedEmployee = ref(null)

let oneEmpTimer = null
watch(oneEmpQuery, (v) => {
  pickedEmployee.value = null
  oneEmpResults.value = []
  if (oneEmpTimer) clearTimeout(oneEmpTimer)
  const q = String(v || '').trim()
  if (!q) return
  oneEmpTimer = setTimeout(async () => {
    try {
      oneEmpLoading.value = true
      oneEmpResults.value = await searchDirectory(q)
    } catch (e) {
      console.error(e)
      oneEmpResults.value = []
    } finally {
      oneEmpLoading.value = false
    }
  }, 250)
})
function pickEmployee(emp) { pickedEmployee.value = emp }

/* pick manager for employee-only */
const oneMgrQuery = ref('')
const oneMgrLoading = ref(false)
const oneMgrResults = ref([])
const pickedOneMgr = ref(null)

let oneMgrTimer = null
watch(oneMgrQuery, (v) => {
  pickedOneMgr.value = null
  oneMgrResults.value = []
  if (oneMgrTimer) clearTimeout(oneMgrTimer)
  const q = String(v || '').trim()
  if (!q) return
  oneMgrTimer = setTimeout(async () => {
    try {
      oneMgrLoading.value = true
      oneMgrResults.value = await searchDirectory(q)
    } catch (e) {
      console.error(e)
      oneMgrResults.value = []
    } finally {
      oneMgrLoading.value = false
    }
  }, 250)
})
function pickOneManager(emp) { pickedOneMgr.value = emp }

const oneForm = ref({
  joinDate: '',
  contractDate: '',
  alCarry: 0,
  isActive: true,
})

function openCreate() {
  createError.value = ''
  createMode.value = 'manager'
  gmLoginId.value = gms.value[0]?.loginId || ''

  mgrQuery.value = ''
  mgrResults.value = []
  pickedMgr.value = null

  empQuery.value = ''
  empResults.value = []
  selectedEmployees.value = []

  oneEmpQuery.value = ''
  oneEmpResults.value = []
  pickedEmployee.value = null

  oneMgrQuery.value = ''
  oneMgrResults.value = []
  pickedOneMgr.value = null

  oneForm.value = { joinDate: '', contractDate: '', alCarry: 0, isActive: true }

  createDialog.value = true
}

async function submitCreate() {
  createError.value = ''

  if (!gmLoginId.value) {
    createError.value = 'GM is required. Please seed LEAVE_GM first.'
    return
  }

  createSaving.value = true
  try {
    if (createMode.value === 'manager') {
      if (!pickedMgr.value?.employeeId) {
        createError.value = 'Please select a manager from EmployeeDirectory.'
        createSaving.value = false
        return
      }
      if (!selectedEmployees.value.length) {
        createError.value = 'Please add at least 1 employee under this manager.'
        createSaving.value = false
        return
      }

      const payload = {
        managerEmployeeId: String(pickedMgr.value.employeeId),
        gmLoginId: String(gmLoginId.value),
        employees: selectedEmployees.value.map(x => ({
          employeeId: String(x.employeeId),
          joinDate: x.joinDate || null,
          contractDate: x.contractDate || null,
          isActive: x.isActive !== false,
          alCarry: num(x.alCarry),
        })),
      }

      const res = await api.post('/admin/leave/managers', payload)

      showToast({
        type: 'success',
        title: 'Manager created',
        message: `Created ${res?.data?.createdCount || 0} employee profile(s). Skipped ${res?.data?.skippedCount || 0}.`,
      })
    } else {
      if (!pickedEmployee.value?.employeeId) {
        createError.value = 'Please select an employee from EmployeeDirectory.'
        createSaving.value = false
        return
      }
      if (!pickedOneMgr.value?.employeeId) {
        createError.value = 'Please select a manager from EmployeeDirectory.'
        createSaving.value = false
        return
      }

      // ✅ IMPORTANT: send managerEmployeeId (not managerLoginId)
      const payload = {
        employeeId: String(pickedEmployee.value.employeeId),
        managerEmployeeId: String(pickedOneMgr.value.employeeId),
        gmLoginId: String(gmLoginId.value),
        joinDate: oneForm.value.joinDate || null,
        contractDate: oneForm.value.contractDate || null,
        isActive: oneForm.value.isActive !== false,
        alCarry: num(oneForm.value.alCarry),
      }

      await api.post('/admin/leave/profiles', payload)
      showToast({ type: 'success', title: 'Profile created', message: 'Created successfully.' })
    }

    createDialog.value = false
    await fetchGrouped()
  } catch (e) {
    console.error('submitCreate error', e)
    createError.value = e?.response?.data?.message || 'Failed to create.'
    showToast({ type: 'error', title: 'Create failed', message: createError.value })
  } finally {
    createSaving.value = false
  }
}

/* ───────── Edit page link (AdminLeaveProfileEdit.vue) ───────── */
function openEditPage(emp) {
  router.push({ name: 'leave-admin-profile-edit', params: { employeeId: emp.employeeId } })
}

function openYearSheet(emp) {
  router.push({ name: 'expat-leave-year-sheet', params: { employeeId: emp.employeeId } })
}

/* ───────── Deactivate ───────── */
async function deactivate(emp) {
  try {
    await api.delete(`/admin/leave/profiles/${emp.employeeId}`)
    showToast({ type: 'success', title: 'Deactivated', message: `Profile ${emp.employeeId} deactivated.` })
    await fetchGrouped()
  } catch (e) {
    showToast({ type: 'error', title: 'Failed', message: e?.response?.data?.message || 'Deactivate failed.' })
  }
}

/* ───────── Contracts Log modal ───────── */
const contractsOpen = ref(false)
const contractsLoading = ref(false)
const contractsError = ref('')
const contractsEmp = ref(null)
const contractsProfile = ref(null)

function normalizeContractHistory(list) {
  const arr = Array.isArray(list) ? list : []
  // newest first if createdAt exists
  return arr.slice().sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
}

function getContractLogs(profile) {
  // support either profile.contractHistory or profile.contracts (if backend uses a different field)
  if (!profile) return []
  if (Array.isArray(profile.contractHistory)) return normalizeContractHistory(profile.contractHistory)
  if (Array.isArray(profile.contracts)) return normalizeContractHistory(profile.contracts)
  return []
}

async function openContracts(emp) {
  contractsEmp.value = emp
  contractsProfile.value = null
  contractsError.value = ''
  contractsOpen.value = true
  contractsLoading.value = true

  try {
    const res = await api.get(`/admin/leave/profiles/${emp.employeeId}`)
    contractsProfile.value = res?.data?.profile || null
  } catch (e) {
    console.error(e)
    contractsError.value = e?.response?.data?.message || 'Failed to load profile.'
  } finally {
    contractsLoading.value = false
  }
}

/* ───────── Renew Contract (quick from list) ───────── */
const renewOpen = ref(false)
const renewSaving = ref(false)
const renewError = ref('')
const renewEmp = ref(null)
const renewForm = ref({ newContractDate: '', clearUnusedAL: false, note: '' })

function openRenew(emp) {
  renewEmp.value = emp
  renewError.value = ''
  renewForm.value = {
    newContractDate: dayjs().format('YYYY-MM-DD'),
    clearUnusedAL: false,
    note: '',
  }
  renewOpen.value = true
}

async function submitRenew() {
  if (!renewEmp.value?.employeeId) return
  renewError.value = ''

  const payload = {
    newContractDate: String(renewForm.value.newContractDate || '').trim(),
    clearUnusedAL: !!renewForm.value.clearUnusedAL,
    note: String(renewForm.value.note || '').trim() || null,
  }

  if (!payload.newContractDate) {
    renewError.value = 'New contract start date is required.'
    return
  }

  renewSaving.value = true
  try {
    await api.post(`/admin/leave/profiles/${renewEmp.value.employeeId}/contracts/renew`, payload)
    showToast({ type: 'success', title: 'Contract renewed', message: `${renewEmp.value.employeeId} renewed.` })
    renewOpen.value = false
    await fetchGrouped()
  } catch (e) {
    console.error(e)
    renewError.value = e?.response?.data?.message || 'Renew failed.'
    showToast({ type: 'error', title: 'Renew failed', message: renewError.value })
  } finally {
    renewSaving.value = false
  }
}

/* ───────── small helpers ───────── */
function fmtYMD(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function gmLabel(gm) {
  const id = String(gm?.loginId || '')
  const nm = String(gm?.name || '')
  return nm ? `${id} — ${nm}` : id
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await Promise.all([fetchLeaveTypes(), fetchApprovers()])
  await fetchGrouped()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (mgrTimer) clearTimeout(mgrTimer)
  if (empTimer) clearTimeout(empTimer)
  if (oneEmpTimer) clearTimeout(oneEmpTimer)
  if (oneMgrTimer) clearTimeout(oneMgrTimer)
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500 px-4 py-3 text-white">
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Profiles grouped by Manager</p>
            <p class="text-[11px] text-emerald-50/90">
              View balances + open contract logs per employee. Use Renew to start a new contract period.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-emerald-50">Search</label>
              <div class="flex items-center rounded-xl border border-emerald-200/80 bg-emerald-900/20 px-2.5 py-1.5 text-xs">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-emerald-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Manager / employee ID, name, dept..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-emerald-100/80"
                />
              </div>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm hover:bg-slate-50"
              @click="openCreate"
            >
              <i class="fa-solid fa-plus text-[11px]" />
              Create
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
              :disabled="loading"
              @click="fetchGrouped()"
            >
              <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <div v-if="loading" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
          <div v-for="i in 5" :key="'sk-' + i" class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
        </div>

        <div v-else class="space-y-4">
          <p v-if="!filteredGroups.length" class="py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
            No profiles found.
          </p>

          <!-- Desktop grouped table -->
          <div v-if="!isMobile" class="overflow-x-auto">
            <table class="min-w-full border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">Employee ID</th>
                  <th class="table-th">Name</th>
                  <th class="table-th">Department</th>
                  <th class="table-th whitespace-nowrap">Join Date</th>
                  <th class="table-th whitespace-nowrap">Contract</th>
                  <th v-for="code in TYPE_ORDER" :key="'h-'+code" class="table-th text-right">{{ code }}</th>
                  <th class="table-th text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                <template v-for="g in filteredGroups" :key="'mgr-' + g.manager.employeeId">
                  <!-- manager header row -->
                  <tr class="bg-slate-50/80 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-700">
                    <td class="px-3 py-2 font-semibold text-slate-900 dark:text-slate-50" :colspan="6 + TYPE_ORDER.length">
                      <i class="fa-solid fa-user-tie mr-2 text-slate-500 dark:text-slate-300" />
                      Manager:
                      <span class="font-mono">{{ g.manager.employeeId }}</span>
                      <span class="ml-2">{{ g.manager.name || '—' }}</span>
                      <span v-if="g.manager.department" class="ml-2 text-slate-500 dark:text-slate-300">
                        • {{ g.manager.department }}
                      </span>
                      <span class="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                        ({{ g.employees.length }} employees)
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right whitespace-nowrap"></td>
                  </tr>

                  <!-- employee rows -->
                  <tr
                    v-for="p in g.employees"
                    :key="'emp-' + p.employeeId"
                    class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
                  >
                    <td class="table-td font-mono">{{ p.employeeId || '—' }}</td>
                    <td class="table-td">{{ p.name || '—' }}</td>
                    <td class="table-td">{{ p.department || '—' }}</td>
                    <td class="table-td whitespace-nowrap">{{ p.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '—' }}</td>
                    <td class="table-td whitespace-nowrap">{{ p.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '—' }}</td>

                    <td v-for="code in TYPE_ORDER" :key="p.employeeId + '-' + code" class="table-td text-right">
                      <div class="ur-cell">
                        <span class="ur-used">U{{ num(findBalance(p.balances, code).used) }}</span>
                        <span class="ur-rem">R{{ num(findBalance(p.balances, code).remaining) }}</span>
                      </div>
                    </td>

                    <td class="table-td">
                      <div class="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50
                                 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          @click="openYearSheet(p)"
                        >
                          <i class="fa-regular fa-file-lines text-[11px]" />
                          Sheet
                        </button>

                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-indigo-500 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50
                                 dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                          @click="openContracts(p)"
                        >
                          <i class="fa-regular fa-folder-open text-[11px]" />
                          Contracts
                        </button>

                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
                                 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                          @click="openEditPage(p)"
                        >
                          <i class="fa-solid fa-pen text-[11px]" />
                          Edit
                        </button>

                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-indigo-500 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50
                                 dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                          @click="openRenew(p)"
                        >
                          <i class="fa-solid fa-arrows-rotate text-[11px]" />
                          Renew
                        </button>

                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50
                                 dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/60"
                          @click="deactivate(p)"
                        >
                          <i class="fa-regular fa-circle-xmark text-[11px]" />
                          Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- Mobile: grouped cards -->
          <div v-else class="space-y-3">
            <section
              v-for="g in filteredGroups"
              :key="'m-' + g.manager.employeeId"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                <i class="fa-solid fa-user-tie mr-2 text-slate-500 dark:text-slate-300" />
                {{ g.manager.employeeId }} — {{ g.manager.name || '—' }}
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ g.manager.department || '—' }} • {{ g.employees.length }} employees
              </div>

              <div class="mt-3 space-y-2">
                <article
                  v-for="p in g.employees"
                  :key="'c-' + p.employeeId"
                  class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <div class="text-[13px] font-semibold text-slate-900 dark:text-slate-50">{{ p.name || '—' }}</div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        ID {{ p.employeeId }} <span v-if="p.department">• {{ p.department }}</span>
                      </div>
                    </div>
                    <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                      <div>Join: <span class="font-medium text-slate-700 dark:text-slate-100">{{ p.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '—' }}</span></div>
                      <div>Contract: <span class="font-medium text-slate-700 dark:text-slate-100">{{ p.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '—' }}</span></div>
                    </div>
                  </div>

                  <div class="mt-2 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50
                             dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      @click="openYearSheet(p)"
                    >
                      <i class="fa-regular fa-file-lines text-[11px]" /> Sheet
                    </button>

                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-indigo-500 px-3 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50
                             dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                      @click="openContracts(p)"
                    >
                      <i class="fa-regular fa-folder-open text-[11px]" /> Contracts
                    </button>

                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-3 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
                             dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                      @click="openEditPage(p)"
                    >
                      <i class="fa-solid fa-pen text-[11px]" /> Edit
                    </button>

                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-indigo-500 px-3 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50
                             dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                      @click="openRenew(p)"
                    >
                      <i class="fa-solid fa-arrows-rotate text-[11px]" /> Renew
                    </button>

                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-3 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50
                             dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/60"
                      @click="deactivate(p)"
                    >
                      <i class="fa-regular fa-circle-xmark text-[11px]" /> Deactivate
                    </button>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>

    <!-- Create modal (FULL) -->
    <transition name="modal-fade">
      <div v-if="createDialog" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Create</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">Pick from EmployeeDirectory. Then create profiles.</div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="createDialog = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 overflow-auto space-y-4 max-h-[72vh]">
            <!-- mode + GM -->
            <div class="grid gap-3 lg:grid-cols-3">
              <div class="lg:col-span-2">
                <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Create mode</div>
                <div class="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    class="rounded-lg px-3 py-1.5 text-[11px] font-semibold"
                    :class="createMode === 'manager'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'"
                    @click="createMode = 'manager'"
                    type="button"
                  >
                    Manager + multiple employees
                  </button>
                  <button
                    class="rounded-lg px-3 py-1.5 text-[11px] font-semibold"
                    :class="createMode === 'employee'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'"
                    @click="createMode = 'employee'"
                    type="button"
                  >
                    Single employee
                  </button>
                </div>
              </div>

              <div>
                <div class="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">GM approver</div>
                <select
                  v-model="gmLoginId"
                  class="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="" disabled>Select GM</option>
                  <option v-for="gm in gms" :key="gm.loginId" :value="gm.loginId">
                    {{ gmLabel(gm) }}
                  </option>
                </select>
                <p v-if="!gms.length" class="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                  No GM found. Please seed user role LEAVE_GM.
                </p>
              </div>
            </div>

            <!-- MANAGER MODE -->
            <div v-if="createMode === 'manager'" class="grid gap-4 lg:grid-cols-2">
              <!-- pick manager -->
              <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">1) Select manager</div>
                <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Search manager by ID / name / dept.</p>

                <div class="mt-2 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-[11px] text-slate-500 dark:text-slate-400" />
                  <input
                    v-model="mgrQuery"
                    class="flex-1 bg-transparent text-[12px] outline-none"
                    placeholder="Search manager..."
                  />
                  <i v-if="mgrLoading" class="fa-solid fa-circle-notch fa-spin text-[12px] text-slate-500" />
                </div>

                <div class="mt-2 max-h-56 overflow-auto">
                  <p v-if="!mgrQuery" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    Type to search.
                  </p>

                  <button
                    v-for="m in mgrResults"
                    :key="'mgr-' + m.employeeId"
                    type="button"
                    class="w-full rounded-xl border px-3 py-2 text-left text-[12px] mb-2
                           hover:bg-slate-50 dark:hover:bg-slate-800"
                    :class="pickedMgr?.employeeId === m.employeeId
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-900/25'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'"
                    @click="pickManager(m)"
                  >
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ m.employeeId }} — {{ m.name || '—' }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ m.department || '—' }}
                    </div>
                  </button>

                  <p v-if="mgrQuery && !mgrLoading && !mgrResults.length" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    No results.
                  </p>
                </div>
              </div>

              <!-- add employees -->
              <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">2) Add employees under manager</div>
                <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Search employees and add many.</p>

                <div class="mt-2 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-[11px] text-slate-500 dark:text-slate-400" />
                  <input
                    v-model="empQuery"
                    class="flex-1 bg-transparent text-[12px] outline-none"
                    placeholder="Search employees..."
                  />
                  <i v-if="empLoading" class="fa-solid fa-circle-notch fa-spin text-[12px] text-slate-500" />
                </div>

                <div class="mt-2 max-h-56 overflow-auto">
                  <p v-if="!empQuery" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    Type to search.
                  </p>

                  <div
                    v-for="e in empResults"
                    :key="'emp-res-' + e.employeeId"
                    class="mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="font-semibold text-[12px] text-slate-900 dark:text-slate-50">
                          {{ e.employeeId }} — {{ e.name || '—' }}
                        </div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">
                          {{ e.department || '—' }}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold
                               border border-emerald-500 text-emerald-700 hover:bg-emerald-50
                               dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                        :disabled="hasEmployee(e.employeeId)"
                        @click="addEmployee(e)"
                      >
                        <i class="fa-solid" :class="hasEmployee(e.employeeId) ? 'fa-check' : 'fa-plus'" />
                        {{ hasEmployee(e.employeeId) ? 'Added' : 'Add' }}
                      </button>
                    </div>
                  </div>

                  <p v-if="empQuery && !empLoading && !empResults.length" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    No results.
                  </p>
                </div>
              </div>

              <!-- selected employees editor -->
              <div class="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Selected employees</div>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400">Fill join/contract date if needed, AL carry, active.</p>
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ selectedEmployees.length }} selected
                  </div>
                </div>

                <p v-if="!selectedEmployees.length" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                  No employees added yet.
                </p>

                <div v-else class="mt-3 overflow-x-auto">
                  <table class="min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
                    <thead class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                                  dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300">
                      <tr>
                        <th class="table-th">Employee</th>
                        <th class="table-th">Join Date</th>
                        <th class="table-th">Contract Date</th>
                        <th class="table-th text-right">AL Carry</th>
                        <th class="table-th text-center">Active</th>
                        <th class="table-th text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="s in selectedEmployees"
                        :key="'sel-' + s.employeeId"
                        class="border-b border-slate-200 dark:border-slate-700"
                      >
                        <td class="table-td">
                          <div class="font-semibold text-slate-900 dark:text-slate-50">
                            {{ s.employeeId }} — {{ s.name || '—' }}
                          </div>
                          <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ s.department || '—' }}</div>
                        </td>

                        <td class="table-td">
                          <input
                            v-model="s.joinDate"
                            type="date"
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[12px]
                                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </td>

                        <td class="table-td">
                          <input
                            v-model="s.contractDate"
                            type="date"
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[12px]
                                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </td>

                        <td class="table-td text-right">
                          <input
                            v-model.number="s.alCarry"
                            type="number"
                            step="0.5"
                            class="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-[12px]
                                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </td>

                        <td class="table-td text-center">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold"
                            :class="s.isActive
                              ? 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
                              : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'"
                            @click="s.isActive = !s.isActive"
                          >
                            <i class="fa-solid" :class="s.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                            {{ s.isActive ? 'Yes' : 'No' }}
                          </button>
                        </td>

                        <td class="table-td text-right">
                          <button
                            type="button"
                            class="inline-flex items-center justify-center rounded-full border border-rose-500 px-3 py-1 text-[11px] font-semibold
                                   text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            @click="removeEmployee(s.employeeId)"
                          >
                            <i class="fa-solid fa-trash" />
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div v-if="pickedMgr" class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                  Manager selected: <span class="font-mono font-semibold">{{ pickedMgr.employeeId }}</span> — {{ pickedMgr.name || '—' }}
                </div>
              </div>
            </div>

            <!-- EMPLOYEE MODE -->
            <div v-else class="grid gap-4 lg:grid-cols-2">
              <!-- pick employee -->
              <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">1) Select employee</div>
                <div class="mt-2 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-[11px] text-slate-500 dark:text-slate-400" />
                  <input v-model="oneEmpQuery" class="flex-1 bg-transparent text-[12px] outline-none" placeholder="Search employee..." />
                  <i v-if="oneEmpLoading" class="fa-solid fa-circle-notch fa-spin text-[12px] text-slate-500" />
                </div>

                <div class="mt-2 max-h-56 overflow-auto">
                  <p v-if="!oneEmpQuery" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">Type to search.</p>

                  <button
                    v-for="e in oneEmpResults"
                    :key="'one-emp-' + e.employeeId"
                    type="button"
                    class="w-full rounded-xl border px-3 py-2 text-left text-[12px] mb-2
                           hover:bg-slate-50 dark:hover:bg-slate-800"
                    :class="pickedEmployee?.employeeId === e.employeeId
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-900/25'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'"
                    @click="pickEmployee(e)"
                  >
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ e.employeeId }} — {{ e.name || '—' }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ e.department || '—' }}
                    </div>
                  </button>

                  <p v-if="oneEmpQuery && !oneEmpLoading && !oneEmpResults.length" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    No results.
                  </p>
                </div>
              </div>

              <!-- pick manager -->
              <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">2) Select manager</div>
                <div class="mt-2 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-[11px] text-slate-500 dark:text-slate-400" />
                  <input v-model="oneMgrQuery" class="flex-1 bg-transparent text-[12px] outline-none" placeholder="Search manager..." />
                  <i v-if="oneMgrLoading" class="fa-solid fa-circle-notch fa-spin text-[12px] text-slate-500" />
                </div>

                <div class="mt-2 max-h-56 overflow-auto">
                  <p v-if="!oneMgrQuery" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">Type to search.</p>

                  <button
                    v-for="m in oneMgrResults"
                    :key="'one-mgr-' + m.employeeId"
                    type="button"
                    class="w-full rounded-xl border px-3 py-2 text-left text-[12px] mb-2
                           hover:bg-slate-50 dark:hover:bg-slate-800"
                    :class="pickedOneMgr?.employeeId === m.employeeId
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-900/25'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'"
                    @click="pickOneManager(m)"
                  >
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ m.employeeId }} — {{ m.name || '—' }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ m.department || '—' }}
                    </div>
                  </button>

                  <p v-if="oneMgrQuery && !oneMgrLoading && !oneMgrResults.length" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    No results.
                  </p>
                </div>
              </div>

              <!-- extra fields -->
              <div class="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">3) Profile fields</div>
                <div class="mt-3 grid gap-3 sm:grid-cols-4">
                  <div class="space-y-1 sm:col-span-1">
                    <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Join Date</label>
                    <input
                      v-model="oneForm.joinDate"
                      type="date"
                      class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div class="space-y-1 sm:col-span-1">
                    <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Contract Date</label>
                    <input
                      v-model="oneForm.contractDate"
                      type="date"
                      class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div class="space-y-1 sm:col-span-1">
                    <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">AL Carry</label>
                    <input
                      v-model.number="oneForm.alCarry"
                      type="number"
                      step="0.5"
                      class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div class="space-y-1 sm:col-span-1">
                    <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Active</label>
                    <button
                      type="button"
                      class="w-full inline-flex items-center justify-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold"
                      :class="oneForm.isActive
                        ? 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'"
                      @click="oneForm.isActive = !oneForm.isActive"
                    >
                      <i class="fa-solid" :class="oneForm.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                      {{ oneForm.isActive ? 'Yes' : 'No' }}
                    </button>
                  </div>
                </div>

                <div class="mt-3 grid gap-2 sm:grid-cols-2">
                  <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    <div class="font-semibold">Employee</div>
                    <div class="mt-1">
                      <span class="font-mono">{{ pickedEmployee?.employeeId || '—' }}</span>
                      <span class="ml-2">{{ pickedEmployee?.name || '' }}</span>
                    </div>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    <div class="font-semibold">Manager</div>
                    <div class="mt-1">
                      <span class="font-mono">{{ pickedOneMgr?.employeeId || '—' }}</span>
                      <span class="ml-2">{{ pickedOneMgr?.name || '' }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- error -->
            <div v-if="createError" class="rounded-xl border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100">
              {{ createError }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              :disabled="createSaving"
              @click="createDialog = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm
                     hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="createSaving"
              @click="submitCreate"
            >
              <i class="fa-solid" :class="createSaving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
              <span>{{ createSaving ? 'Saving...' : 'Create' }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Contracts modal -->
    <transition name="modal-fade">
      <div v-if="contractsOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Contract Logs</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ contractsEmp?.employeeId }} · {{ contractsEmp?.name || '—' }}
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="contractsOpen = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 space-y-3 overflow-auto">
            <div v-if="contractsLoading" class="space-y-2">
              <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
              <div class="h-16 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
              <div class="h-16 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
            </div>

            <div v-else-if="contractsError" class="rounded-xl border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100">
              {{ contractsError }}
            </div>

            <template v-else>
              <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                    Current contract start:
                    <span class="font-mono">{{ contractsProfile?.contractDate || '—' }}</span>
                  </div>
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-full border border-emerald-500 px-3 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50
                           dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                    @click="openEditPage(contractsEmp)"
                  >
                    <i class="fa-solid fa-pen" />
                    Open Edit Page
                  </button>
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                <div class="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                  Contract history
                </div>
                <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Each row is a contract snapshot log.
                </p>

                <p v-if="!getContractLogs(contractsProfile).length"
                   class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  No contract logs yet.
                </p>

                <div v-else class="mt-3 overflow-x-auto">
                  <table class="min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
                    <thead class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                                  dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300">
                      <tr>
                        <th class="table-th">#</th>
                        <th class="table-th">Start</th>
                        <th class="table-th">End</th>
                        <th class="table-th text-right">AL Carry</th>
                        <th class="table-th">Snapshot</th>
                        <th class="table-th">Note</th>
                        <th class="table-th">By</th>
                        <th class="table-th">At</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(c, idx) in getContractLogs(contractsProfile)"
                        :key="idx"
                        class="border-b border-slate-200 dark:border-slate-700"
                      >
                        <td class="table-td font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                        <td class="table-td font-mono">{{ c.startDate || '—' }}</td>
                        <td class="table-td font-mono">{{ c.endDate || '—' }}</td>
                        <td class="table-td text-right font-mono">{{ num(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                        <td class="table-td">
                          <div class="text-[11px] text-slate-600 dark:text-slate-300">
                            <div v-if="Array.isArray(c.balancesSnapshot)">
                              <span
                                v-for="b in c.balancesSnapshot"
                                :key="String(b.leaveTypeCode) + idx"
                                class="mr-2 mb-1 inline-flex rounded-full border border-slate-300 px-2 py-0.5 text-[10px] dark:border-slate-600"
                              >
                                {{ String(b.leaveTypeCode).toUpperCase() }}:
                                U{{ num(b.used) }} / R{{ num(b.remaining) }}
                              </span>
                            </div>
                            <div v-else class="text-slate-400">—</div>
                          </div>
                        </td>

                        <td class="table-td">
                          <div class="max-w-[260px] truncate text-[11px] text-slate-600 dark:text-slate-300">
                            {{ c.note || '—' }}
                          </div>
                        </td>

                        <td class="table-td font-mono text-[11px]">{{ c.createdBy || '—' }}</td>
                        <td class="table-td font-mono text-[11px]">
                          {{ c.createdAt ? dayjs(c.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

              </div>
            </template>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="contractsOpen = false"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Renew modal -->
    <transition name="modal-fade">
      <div v-if="renewOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Renew Contract</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ renewEmp?.employeeId }} · {{ renewEmp?.name || '—' }}
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="renewOpen = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">New Contract Start Date</label>
                <input
                  v-model="renewForm.newContractDate"
                  type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Clear unused AL?</label>
                <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                        {{ renewForm.clearUnusedAL ? 'Yes (clear AL to 0)' : 'No (carry AL forward)' }}
                      </div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        {{ renewForm.clearUnusedAL
                          ? 'Old remaining AL is cleared. New contract starts fresh.'
                          : 'Carries remaining AL (positive/negative) into new contract.' }}
                      </div>
                    </div>

                    <button
                      type="button"
                      class="inline-flex items-center rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700
                             dark:border-slate-600 dark:text-slate-200"
                      @click="renewForm.clearUnusedAL = !renewForm.clearUnusedAL"
                    >
                      <i class="fa-solid" :class="renewForm.clearUnusedAL ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-1">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Note (optional)</label>
              <textarea
                v-model="renewForm.note"
                rows="3"
                class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Example: Renewed contract for next period"
              />
            </div>

            <div v-if="renewError" class="text-[11px] text-rose-600 dark:text-rose-400">
              {{ renewError }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="renewOpen = false"
            >
              Cancel
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm
                     hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="renewSaving"
              @click="submitRenew"
            >
              <i class="fa-solid fa-arrows-rotate text-[11px]" :class="renewSaving ? 'fa-spin' : ''" />
              Renew
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.table-th { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 800; white-space: nowrap; }
.table-td { padding: 8px 10px; vertical-align: top; }

/* Used/Remaining cell */
.ur-cell { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
.ur-used { font-size: 11px; font-weight: 700; }
.ur-rem  { font-size: 11px; color: #64748b; }

/* Modal transition */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.18s ease-out, transform 0.18s ease-out; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; transform: translateY(6px) scale(0.98); }
</style>

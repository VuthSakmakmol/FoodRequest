<!-- src/views/expat/AdminExpatProfiles.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'

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

    // backend returns array [{loginId,name,role}]
    const arr = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.gms) ? res.data.gms : [])
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

/* GM selection */
const gmLoginId = ref('')

watch(gms, () => {
  if (!gmLoginId.value && gms.value.length) gmLoginId.value = gms.value[0].loginId
})

/* Manager creation (pick manager + add many employees) */
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

function pickManager(emp) {
  pickedMgr.value = emp
}

/* Add employees to manager */
const empQuery = ref('')
const empLoading = ref(false)
const empResults = ref([])
const selectedEmployees = ref([]) // [{ employeeId,name,department, joinDate, contractDate, alCarry, isActive }]

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

/* Employee-only creation (pick employee + pick manager) */
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

function pickEmployee(emp) {
  pickedEmployee.value = emp
}

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

function pickOneManager(emp) {
  pickedOneMgr.value = emp
}

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
      // employee-only
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

      const payload = {
        employeeId: String(pickedEmployee.value.employeeId),
        managerLoginId: String(pickedOneMgr.value.employeeId),
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

/* ───────── Edit modal ───────── */
const editOpen = ref(false)
const editSaving = ref(false)
const editError = ref('')
const selected = ref(null)

const editForm = ref({
  joinDate: '',
  contractDate: '',
  managerLoginId: '',
  gmLoginId: '',
  isActive: true,
  alCarry: 0,
})

const editMgrQuery = ref('')
const editMgrLoading = ref(false)
const editMgrResults = ref([])
let editMgrTimer = null

watch(editMgrQuery, (v) => {
  editMgrResults.value = []
  if (editMgrTimer) clearTimeout(editMgrTimer)
  const q = String(v || '').trim()
  if (!q) return
  editMgrTimer = setTimeout(async () => {
    try {
      editMgrLoading.value = true
      editMgrResults.value = await searchDirectory(q)
    } catch (e) {
      console.error(e)
      editMgrResults.value = []
    } finally {
      editMgrLoading.value = false
    }
  }, 250)
})

function pickEditManager(emp) {
  editForm.value.managerLoginId = String(emp.employeeId || '')
}

async function openEditProfile(emp) {
  editError.value = ''
  selected.value = emp
  editOpen.value = true
  editMgrQuery.value = ''
  editMgrResults.value = []

  try {
    const res = await api.get(`/admin/leave/profiles/${emp.employeeId}`)
    const prof = res?.data?.profile || {}

    editForm.value = {
      joinDate: prof.joinDate ? dayjs(prof.joinDate).format('YYYY-MM-DD') : '',
      contractDate: prof.contractDate ? dayjs(prof.contractDate).format('YYYY-MM-DD') : '',
      managerLoginId: String(prof.managerLoginId || ''),
      gmLoginId: String(prof.gmLoginId || ''),
      isActive: prof.isActive !== false,
      alCarry: num(prof.alCarry),
    }
  } catch {
    editForm.value = {
      joinDate: emp.joinDate ? dayjs(emp.joinDate).format('YYYY-MM-DD') : '',
      contractDate: emp.contractDate ? dayjs(emp.contractDate).format('YYYY-MM-DD') : '',
      managerLoginId: String(emp.managerLoginId || ''),
      gmLoginId: String(emp.gmLoginId || ''),
      isActive: emp.isActive !== false,
      alCarry: num(emp.alCarry),
    }
  }
}

async function saveEdit() {
  if (!selected.value?.employeeId) return
  editError.value = ''

  const payload = {
    joinDate: editForm.value.joinDate || null,
    contractDate: editForm.value.contractDate || null,
    managerLoginId: String(editForm.value.managerLoginId || '').trim(),
    gmLoginId: String(editForm.value.gmLoginId || '').trim(),
    isActive: editForm.value.isActive !== false,
    alCarry: num(editForm.value.alCarry),
  }

  if (!payload.managerLoginId) {
    editError.value = 'Manager is required.'
    return
  }
  if (!payload.gmLoginId) {
    editError.value = 'GM is required.'
    return
  }

  editSaving.value = true
  try {
    await api.put(`/admin/leave/profiles/${selected.value.employeeId}`, payload)
    showToast({ type: 'success', title: 'Saved', message: 'Updated successfully.' })
    editOpen.value = false
    await fetchGrouped()
  } catch (e) {
    console.error(e)
    editError.value = e?.response?.data?.message || 'Failed to save.'
    showToast({ type: 'error', title: 'Save failed', message: editError.value })
  } finally {
    editSaving.value = false
  }
}

/* ───────── Deactivate / hard delete ───────── */
async function deactivate(emp) {
  try {
    await api.delete(`/admin/leave/profiles/${emp.employeeId}`)
    showToast({ type: 'success', title: 'Deactivated', message: `Profile ${emp.employeeId} deactivated.` })
    await fetchGrouped()
  } catch (e) {
    showToast({ type: 'error', title: 'Failed', message: e?.response?.data?.message || 'Deactivate failed.' })
  }
}

function openYearSheet(emp) {
  router.push({ name: 'expat-leave-year-sheet', params: { employeeId: emp.employeeId } })
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
  if (editMgrTimer) clearTimeout(editMgrTimer)
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
              Create Manager + assign employees (multi) or create single employee. GM must exist.
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
                    <td class="px-3 py-2 text-right whitespace-nowrap">
                      <!-- spacer -->
                    </td>
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
                          class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
                                 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                          @click="openEditProfile(p)"
                        >
                          <i class="fa-solid fa-pen text-[11px]" />
                          Edit
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

                  <div class="mt-2 flex justify-end gap-2">
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
                      class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-3 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
                             dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                      @click="openEditProfile(p)"
                    >
                      <i class="fa-solid fa-pen text-[11px]" /> Edit
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

    <!-- Create modal -->
    <transition name="modal-fade">
      <div v-if="createDialog" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Create</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">Pick from EmployeeDirectory. No defaults.</div>
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

          <div class="px-4 py-3 space-y-3">
            <!-- mode switch -->
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-full px-3 py-1.5 text-[11px] font-semibold border"
                :class="createMode === 'manager'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'"
                @click="createMode = 'manager'"
              >
                Create Manager + Assign Employees
              </button>

              <button
                type="button"
                class="rounded-full px-3 py-1.5 text-[11px] font-semibold border"
                :class="createMode === 'employee'
                  ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200'
                  : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'"
                @click="createMode = 'employee'"
              >
                Create Single Employee
              </button>
            </div>

            <!-- GM select -->
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">GM</label>
                <select
                  v-model="gmLoginId"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="" disabled>Select GM...</option>
                  <option v-for="g in gms" :key="g.loginId" :value="g.loginId">{{ g.loginId }} — {{ g.name }}</option>
                </select>
                <p v-if="!gms.length" class="text-[10px] text-rose-500">
                  No GM found. Please seed LEAVE_GM first.
                </p>
              </div>
            </div>

            <!-- Manager mode -->
            <div v-if="createMode === 'manager'" class="space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Search manager</label>
                  <div class="flex items-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                    <i class="fa-solid fa-user-tie mr-2 text-slate-500 dark:text-slate-300" />
                    <input v-model="mgrQuery" type="text" placeholder="Type manager ID or name..."
                      class="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400 dark:text-slate-100" />
                    <span v-if="mgrLoading" class="text-[11px] text-slate-500">Searching…</span>
                  </div>

                  <div v-if="mgrResults.length" class="max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      v-for="m in mgrResults"
                      :key="'mgr-' + m.employeeId"
                      type="button"
                      class="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                      @click="pickManager(m)"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="font-semibold text-slate-900 dark:text-slate-50">{{ m.name || '—' }}</div>
                          <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ m.employeeId }} <span v-if="m.department">• {{ m.department }}</span></div>
                        </div>
                        <span
                          v-if="String(pickedMgr?.employeeId) === String(m.employeeId)"
                          class="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200"
                        >Selected</span>
                      </div>
                    </button>
                  </div>

                  <p v-if="pickedMgr" class="text-[11px] text-slate-600 dark:text-slate-300">
                    Selected manager: <span class="font-mono">{{ pickedMgr.employeeId }}</span> — {{ pickedMgr.name }}
                  </p>
                </div>

                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Add employees under manager</label>
                  <div class="flex items-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                    <i class="fa-solid fa-user-plus mr-2 text-slate-500 dark:text-slate-300" />
                    <input v-model="empQuery" type="text" placeholder="Type employee ID or name..."
                      class="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400 dark:text-slate-100" />
                    <span v-if="empLoading" class="text-[11px] text-slate-500">Searching…</span>
                  </div>

                  <div v-if="empResults.length" class="max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      v-for="e in empResults"
                      :key="'emp-' + e.employeeId"
                      type="button"
                      class="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                      @click="addEmployee(e)"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="font-semibold text-slate-900 dark:text-slate-50">{{ e.name || '—' }}</div>
                          <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ e.employeeId }} <span v-if="e.department">• {{ e.department }}</span></div>
                        </div>
                        <span
                          v-if="hasEmployee(e.employeeId)"
                          class="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
                        >Added</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <!-- selected employees list -->
              <div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                <div class="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Employees to create ({{ selectedEmployees.length }})</div>

                <p v-if="!selectedEmployees.length" class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Add employees from search. Then click Create.
                </p>

                <div v-else class="mt-2 space-y-2">
                  <div
                    v-for="e in selectedEmployees"
                    :key="'sel-' + e.employeeId"
                    class="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                          {{ e.employeeId }} — {{ e.name || '—' }}
                        </div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ e.department || '—' }}</div>
                      </div>

                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-rose-500 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50
                               dark:text-rose-200 dark:hover:bg-rose-950/50"
                        @click="removeEmployee(e.employeeId)"
                      >
                        <i class="fa-solid fa-xmark text-[11px]" />
                        Remove
                      </button>
                    </div>

                    <div class="mt-2 grid gap-2 sm:grid-cols-4">
                      <div class="space-y-1">
                        <label class="block text-[10px] font-medium text-slate-600 dark:text-slate-300">Join Date</label>
                        <input v-model="e.joinDate" type="date"
                          class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                      </div>
                      <div class="space-y-1">
                        <label class="block text-[10px] font-medium text-slate-600 dark:text-slate-300">Contract Date</label>
                        <input v-model="e.contractDate" type="date"
                          class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                      </div>
                      <div class="space-y-1">
                        <label class="block text-[10px] font-medium text-slate-600 dark:text-slate-300">AL Carry</label>
                        <input v-model.number="e.alCarry" type="number" step="0.5"
                          class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                      </div>
                      <div class="flex items-center gap-2 pt-5">
                        <input v-model="e.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
                        <span class="text-[11px] text-slate-700 dark:text-slate-200">Active</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Employee mode -->
            <div v-else class="space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Search employee</label>
                  <div class="flex items-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                    <i class="fa-solid fa-id-badge mr-2 text-slate-500 dark:text-slate-300" />
                    <input v-model="oneEmpQuery" type="text" placeholder="Type employee ID or name..."
                      class="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400 dark:text-slate-100" />
                    <span v-if="oneEmpLoading" class="text-[11px] text-slate-500">Searching…</span>
                  </div>

                  <div v-if="oneEmpResults.length" class="max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      v-for="e in oneEmpResults"
                      :key="'one-e-' + e.employeeId"
                      type="button"
                      class="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                      @click="pickEmployee(e)"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="font-semibold text-slate-900 dark:text-slate-50">{{ e.name || '—' }}</div>
                          <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ e.employeeId }} <span v-if="e.department">• {{ e.department }}</span></div>
                        </div>
                        <span
                          v-if="String(pickedEmployee?.employeeId) === String(e.employeeId)"
                          class="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200"
                        >Selected</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Search manager</label>
                  <div class="flex items-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                    <i class="fa-solid fa-user-tie mr-2 text-slate-500 dark:text-slate-300" />
                    <input v-model="oneMgrQuery" type="text" placeholder="Type manager ID or name..."
                      class="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400 dark:text-slate-100" />
                    <span v-if="oneMgrLoading" class="text-[11px] text-slate-500">Searching…</span>
                  </div>

                  <div v-if="oneMgrResults.length" class="max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      v-for="m in oneMgrResults"
                      :key="'one-m-' + m.employeeId"
                      type="button"
                      class="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                      @click="pickOneManager(m)"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="font-semibold text-slate-900 dark:text-slate-50">{{ m.name || '—' }}</div>
                          <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ m.employeeId }} <span v-if="m.department">• {{ m.department }}</span></div>
                        </div>
                        <span
                          v-if="String(pickedOneMgr?.employeeId) === String(m.employeeId)"
                          class="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
                        >Selected</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-3">
                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Join Date</label>
                  <input v-model="oneForm.joinDate" type="date"
                    class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Contract Date</label>
                  <input v-model="oneForm.contractDate" type="date"
                    class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                </div>
                <div class="space-y-1">
                  <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">AL Carry</label>
                  <input v-model.number="oneForm.alCarry" type="number" step="0.5"
                    class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                </div>
              </div>

              <div class="flex items-center gap-2">
                <input v-model="oneForm.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
                <span class="text-[12px] text-slate-700 dark:text-slate-200">Active</span>
              </div>
            </div>

            <div v-if="createError" class="text-[11px] text-rose-600 dark:text-rose-400">
              {{ createError }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="createDialog = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm
                     hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="createSaving"
              @click="submitCreate"
            >
              <i class="fa-solid fa-floppy-disk text-[11px]" />
              <span>Create</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Edit modal -->
    <transition name="modal-fade">
      <div v-if="editOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Edit Profile</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ selected?.employeeId }} · {{ selected?.name }}
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="editOpen = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 space-y-3">
            <div class="space-y-1">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Search new manager</label>
              <div class="flex items-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                <i class="fa-solid fa-user-tie mr-2 text-slate-500 dark:text-slate-300" />
                <input v-model="editMgrQuery" type="text" placeholder="Type manager ID or name..."
                  class="flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-400 dark:text-slate-100" />
                <span v-if="editMgrLoading" class="text-[11px] text-slate-500">Searching…</span>
              </div>
              <p class="text-[10px] text-slate-400">
                Current manager ID: <span class="font-mono">{{ editForm.managerLoginId || '—' }}</span>
              </p>
            </div>

            <div v-if="editMgrResults.length" class="max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                v-for="m in editMgrResults"
                :key="'ed-m-' + m.employeeId"
                type="button"
                class="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                @click="pickEditManager(m)"
              >
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="font-semibold text-slate-900 dark:text-slate-50">{{ m.name || '—' }}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ m.employeeId }} <span v-if="m.department">• {{ m.department }}</span></div>
                  </div>
                  <span
                    v-if="String(editForm.managerLoginId) === String(m.employeeId)"
                    class="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
                  >Selected</span>
                </div>
              </button>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Join Date</label>
                <input v-model="editForm.joinDate" type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Contract Date</label>
                <input v-model="editForm.contractDate" type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">GM</label>
                <select
                  v-model="editForm.gmLoginId"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="" disabled>Select GM...</option>
                  <option v-for="g in gms" :key="g.loginId" :value="g.loginId">{{ g.loginId }} — {{ g.name }}</option>
                </select>
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">AL Carry</label>
                <input v-model.number="editForm.alCarry" type="number" step="0.5"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </div>

              <div class="flex items-center gap-2 pt-5">
                <input v-model="editForm.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
                <span class="text-[12px] text-slate-700 dark:text-slate-200">Active</span>
              </div>
            </div>

            <div v-if="editError" class="text-[11px] text-rose-600 dark:text-rose-400">
              {{ editError }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="editOpen = false"
            >
              Cancel
            </button>

            <button type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm
                     hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="editSaving"
              @click="saveEdit"
            >
              <i class="fa-solid fa-floppy-disk text-[11px]" />
              Save
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

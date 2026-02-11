<!-- src/views/expat/admin/profiles/AdminLeaveProfileEdit.vue
  ✅ Fullscreen Admin edit page
  ✅ Profile settings edit (joinDate, approvalMode, approvers, active)
  ✅ Contract-aware carry edit (per contractNo)
  ✅ Logs + Renew contract modal (components)
  ✅ NEW: Admin password reset (component)
  ✅ CLEAN UI: consistent sections, header bars, spacing, responsive
-->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

/* components (same path) */
import InfoRow from './components/InfoRow.vue'
import EditPageHeader from './components/EditPageHeader.vue'
import PasswordResetCard from './components/PasswordResetCard.vue'
import RenewModal from './components/RenewModal.vue'
import ContractsLogsModal from './components/ContractsLogsModal.vue'

defineOptions({ name: 'AdminLeaveProfileEdit' })

const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

/* ───────────────── responsive ───────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── route param ───────────────── */
const employeeId = computed(() => String(route.params.employeeId || '').trim())

/* ───────────────── leave types (dynamic order) ───────────────── */
const leaveTypes = ref([])
async function fetchLeaveTypes() {
  try {
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch {
    leaveTypes.value = []
  }
}
const TYPE_ORDER = computed(() => {
  const codes = (leaveTypes.value || [])
    .map((t) => String(t?.code || '').toUpperCase())
    .filter(Boolean)
  const fallback = ['AL', 'SP', 'MC', 'MA', 'UL']
  return [...new Set([...fallback, ...codes])]
})

/* ───────────────── base state ───────────────── */
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const profile = ref(null)

/* store original joinDate to detect changes */
const originalJoinDate = ref('')

/* ───────────────── helpers ───────────────── */
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function fmt(v) {
  const n = num(v)
  return String(Number.isInteger(n) ? n : n.toFixed(1))
}
function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}
function toInputDate(v) {
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}
function fmtYMD(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function safeStr(v) {
  return String(v || '').trim()
}
function up(v) {
  return String(v || '').trim().toUpperCase()
}

/* ───────────────── approval mode helpers ───────────────── */
const APPROVAL_MODES = [
  { value: 'MANAGER_AND_GM', label: 'Manager + GM', hint: 'Manager approves first, then GM.' },
  { value: 'GM_AND_COO', label: 'GM + COO', hint: 'GM approves first, then COO.' },
]
function normApprovalMode(v) {
  const s = up(v)
  if (s === 'GM_AND_COO') return 'GM_AND_COO'
  if (s === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  // backward aliases
  if (s === 'ADMIN_AND_GM') return 'MANAGER_AND_GM'
  if (s === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (s === 'MANAGER+GM') return 'MANAGER_AND_GM'
  return 'MANAGER_AND_GM'
}

/* ───────────────── carry helpers ───────────────── */
const showCarryAdvanced = ref(false)
function emptyCarry() {
  return { AL: 0, SP: 0, MC: 0, MA: 0, UL: 0 }
}
function normalizeCarry(src) {
  const c = src || {}
  return {
    AL: num(c.AL),
    SP: num(c.SP),
    MC: num(c.MC),
    MA: num(c.MA),
    UL: num(c.UL),
  }
}
function readCarryFromProfile(p) {
  // prefer new carry, fallback to legacy alCarry
  const c = normalizeCarry(p?.carry)
  if (num(c.AL) === 0 && typeof p?.alCarry === 'number' && num(p?.alCarry) !== 0) {
    c.AL = num(p.alCarry)
  }
  return c
}

/* ───────────────── balances normalize ───────────────── */
function normalizeBalances(rawBalances = []) {
  const map = new Map()

  for (const b of rawBalances || []) {
    const code = safeStr(b?.leaveTypeCode).toUpperCase()
    if (!code) continue
    map.set(code, {
      leaveTypeCode: code,
      yearlyEntitlement: num(b?.yearlyEntitlement),
      used: num(b?.used),
      remaining: num(b?.remaining),
    })
  }

  // ensure all types exist
  for (const code of TYPE_ORDER.value) {
    if (!map.has(code)) {
      map.set(code, { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
    }
  }

  const arr = Array.from(map.values())
  arr.sort((a, b) => TYPE_ORDER.value.indexOf(a.leaveTypeCode) - TYPE_ORDER.value.indexOf(b.leaveTypeCode))
  return arr
}
const normalizedBalances = computed(() => normalizeBalances(profile.value?.balances || []))

/* ───────────────── contract history (logs snapshot) ───────────────── */
function readContractHistory(p) {
  if (!p) return []
  if (Array.isArray(p.contractHistory)) return p.contractHistory
  if (Array.isArray(p.contracts)) return p.contracts
  return []
}
const contractHistory = computed(() => {
  const arr = readContractHistory(profile.value).slice()
  return arr.sort((x, y) => {
    const tx = x?.createdAt ? new Date(x.createdAt).getTime() : 0
    const ty = y?.createdAt ? new Date(y.createdAt).getTime() : 0
    return ty - tx
  })
})

/* ───────────────── contract-aware carry editing ───────────────── */
const contractsLoading = ref(false)
const contractsError = ref('')
const contracts = ref([])

function normalizeContracts(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.contracts) ? raw.contracts : []
  return arr
    .map((c, idx) => {
      const contractNo = c?.contractNo ?? c?.no ?? c?.index ?? idx + 1
      const start = c?.startDate || c?.from || c?.contractDate || c?.start || ''
      const end = c?.endDate || c?.to || c?.contractEndDate || c?.end || ''
      const carry = normalizeCarry(c?.carry || c?.closeSnapshot?.carry || c?.openSnapshot?.carry || {})
      const isCurrent = !!(c?.isCurrent || c?.current || c?.active)
      return {
        ...c,
        contractNo: Number(contractNo),
        startDate: start,
        endDate: end,
        carry,
        isCurrent,
      }
    })
    .sort((a, b) => Number(b.contractNo) - Number(a.contractNo))
}

const selectedContractNo = ref(null)

const selectedContract = computed(() => {
  const no = Number(selectedContractNo.value)
  if (!no) return null
  return contracts.value.find((c) => Number(c.contractNo) === no) || null
})

const contractCarryForm = reactive({
  carry: emptyCarry(),
})

function setSelectedContractDefault() {
  if (!contracts.value.length) {
    selectedContractNo.value = null
    return
  }
  const current = contracts.value.find((c) => c.isCurrent) || contracts.value[0]
  selectedContractNo.value = Number(current.contractNo)
}

function fillContractCarryFormFromSelected() {
  const c = selectedContract.value
  if (!c) {
    contractCarryForm.carry = emptyCarry()
    return
  }
  contractCarryForm.carry = { ...normalizeCarry(c.carry) }
}

watch(selectedContractNo, () => {
  fillContractCarryFormFromSelected()
})

async function fetchContracts() {
  if (!employeeId.value) return
  contractsLoading.value = true
  contractsError.value = ''
  try {
    const res = await api.get(`/admin/leave/profiles/${employeeId.value}/contracts`)
    contracts.value = normalizeContracts(res.data)
    if (!selectedContractNo.value) setSelectedContractDefault()
    fillContractCarryFormFromSelected()
  } catch (e) {
    console.error(e)
    contractsError.value = e?.response?.data?.message || 'Failed to load contracts.'
    contracts.value = []
  } finally {
    contractsLoading.value = false
  }
}


async function saveContractCarry() {
  if (!employeeId.value) return
  const no = Number(selectedContractNo.value)
  if (!no) {
    showToast({ type: 'error', title: 'Validation', message: 'Please select a contract.' })
    return
  }

  saving.value = true
  try {
    const carry = normalizeCarry(contractCarryForm.carry)

    // ✅ PATCH /admin/leave/profiles/:employeeId/contracts/:contractNo
    await api.patch(`/admin/leave/profiles/${employeeId.value}/contracts/${no}`, {
      carry,
      alCarry: num(carry.AL), // optional mirror
    })

    showToast({ type: 'success', title: 'Saved', message: `Carry updated for contract #${no}.` })
    await fetchProfile()
    await fetchContracts()
  } catch (e) {
    console.error(e)
    const msg = e?.response?.data?.message || 'Failed to save contract carry.'
    showToast({ type: 'error', title: 'Save failed', message: msg })
  } finally {
    saving.value = false
  }
}

/* ───────────────── profile form ───────────────── */
const form = reactive({
  joinDate: '',
  approvalMode: 'MANAGER_AND_GM',
  managerEmployeeId: '',
  gmLoginId: '',
  cooLoginId: '',
  carry: emptyCarry(), // legacy only
  alCarry: 0,
  isActive: true,
})

const formError = ref('')

function fillFormFromProfile(p) {
  form.joinDate = toInputDate(p?.joinDate)
  form.approvalMode = normApprovalMode(p?.approvalMode)

  form.managerEmployeeId = String(p?.managerEmployeeId || p?.managerLoginId || '')
  form.gmLoginId = String(p?.gmLoginId || '')
  form.cooLoginId = String(p?.cooLoginId || '')

  const c = readCarryFromProfile(p)
  form.carry = { ...c }
  form.alCarry = num(c.AL)

  form.isActive = p?.isActive === false ? false : true
  originalJoinDate.value = toInputDate(p?.joinDate)
}

watch(
  () => form.carry.AL,
  (v) => {
    form.alCarry = num(v)
  }
)

const joinDateChanged = computed(() => {
  const a = String(originalJoinDate.value || '')
  const b = String(form.joinDate || '')
  return a !== b
})

const needManager = computed(() => String(form.approvalMode || '') === 'MANAGER_AND_GM')
const needCoo = computed(() => String(form.approvalMode || '') === 'GM_AND_COO')

const isDirty = computed(() => {
  const p = profile.value
  if (!p) return false

  const a = {
    joinDate: toInputDate(p.joinDate),
    approvalMode: normApprovalMode(p.approvalMode),
    managerEmployeeId: String(p.managerEmployeeId || p.managerLoginId || ''),
    gmLoginId: String(p.gmLoginId || ''),
    cooLoginId: String(p.cooLoginId || ''),
    carry: readCarryFromProfile(p),
    isActive: p.isActive === false ? false : true,
  }

  const b = {
    joinDate: String(form.joinDate || ''),
    approvalMode: normApprovalMode(form.approvalMode),
    managerEmployeeId: String(form.managerEmployeeId || ''),
    gmLoginId: String(form.gmLoginId || ''),
    cooLoginId: String(form.cooLoginId || ''),
    carry: normalizeCarry(form.carry),
    isActive: !!form.isActive,
  }

  return JSON.stringify(a) !== JSON.stringify(b)
})

/* ───────────────── API: profile ───────────────── */
async function fetchProfile() {
  if (!employeeId.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.get(`/admin/leave/profiles/${employeeId.value}`)
    profile.value = res?.data?.profile || null
    if (profile.value) fillFormFromProfile(profile.value)
  } catch (e) {
    console.error(e)
    error.value = e?.response?.data?.message || 'Failed to load profile.'
    showToast({ type: 'error', title: 'Load failed', message: error.value })
  } finally {
    loading.value = false
  }
}

function resetForm() {
  if (!profile.value) return
  formError.value = ''
  fillFormFromProfile(profile.value)
}

async function updateProfile(payload, { recalc } = { recalc: false }) {
  const url = `/admin/leave/profiles/${employeeId.value}`
  const params = recalc ? { recalc: '1' } : undefined
  try {
    return await api.patch(url, payload, { params })
  } catch (e) {
    const st = e?.response?.status
    if (st === 404 || st === 405) return await api.put(url, payload, { params })
    throw e
  }
}

async function forceRecalcBalances() {
  const id = employeeId.value
  if (!id) return false

  const payload = { asOf: dayjs().format('YYYY-MM-DD'), reason: 'JOIN_DATE_CHANGED' }
  const tries = [
    () => api.post(`/admin/leave/profiles/${id}/recalculate`, payload),
    () => api.post(`/admin/leave/profiles/${id}/recalc`, payload),
    () => api.post(`/admin/leave/profiles/${id}/balances/recalc`, payload),
  ]

  let lastErr = null
  for (const fn of tries) {
    try {
      await fn()
      return true
    } catch (e) {
      const st = e?.response?.status
      if (st === 404 || st === 405) {
        lastErr = e
        continue
      }
      throw e
    }
  }

  console.warn('No recalc endpoint found', lastErr)
  return false
}

function validateApprovers() {
  const mode = normApprovalMode(form.approvalMode)
  if (!String(form.gmLoginId || '').trim()) return 'GM Login ID is required.'
  if (mode === 'MANAGER_AND_GM' && !String(form.managerEmployeeId || '').trim()) return 'Manager Employee ID is required.'
  if (mode === 'GM_AND_COO' && !String(form.cooLoginId || '').trim()) return 'COO Login ID is required.'
  return ''
}

async function saveProfile() {
  formError.value = ''

  if (!employeeId.value) return (formError.value = 'Missing employeeId.')
  if (form.joinDate && !isValidYMD(form.joinDate)) return (formError.value = 'Join Date is invalid.')

  const approverErr = validateApprovers()
  if (approverErr) {
    formError.value = approverErr
    showToast({ type: 'error', title: 'Validation', message: approverErr })
    return
  }

  saving.value = true
  try {
    const mode = normApprovalMode(form.approvalMode)
    const carry = normalizeCarry(form.carry)

    await updateProfile(
      {
        joinDate: form.joinDate ? String(form.joinDate) : null,
        approvalMode: mode,
        managerEmployeeId: form.managerEmployeeId ? String(form.managerEmployeeId).trim() : null,
        gmLoginId: form.gmLoginId ? String(form.gmLoginId).trim() : null,
        cooLoginId: mode === 'GM_AND_COO' ? String(form.cooLoginId || '').trim() || null : null,
        // legacy carry
        carry,
        alCarry: num(carry.AL),
        isActive: form.isActive !== false,
      },
      { recalc: joinDateChanged.value }
    )

    if (joinDateChanged.value) {
      const ok = await forceRecalcBalances()
      showToast({
        type: ok ? 'success' : 'warning',
        title: ok ? 'Saved + Recalculated' : 'Saved',
        message: ok ? 'Join Date updated and balances recalculated.' : 'Join Date saved. (No recalc endpoint found.)',
      })
    } else {
      showToast({ type: 'success', title: 'Saved', message: 'Profile updated.' })
    }

    await fetchProfile()
    await fetchContracts()
  } catch (e) {
    console.error(e)
    const msg = e?.response?.data?.message || 'Failed to save.'
    formError.value = msg
    showToast({ type: 'error', title: 'Save failed', message: msg })
  } finally {
    saving.value = false
  }
}

/* ───────────────── password reset (NEW) ───────────────── */
const pwd = reactive({
  open: false,
  show: false,
  password: '',
  confirm: '',
  submitting: false,
  error: '',
})

function validateStrongPassword(p) {
  const s = String(p || '')
  if (s.length < 13) return 'Password must be at least 13 characters.'
  const hasUpper = /[A-Z]/.test(s)
  const hasLower = /[a-z]/.test(s)
  const hasNum = /\d/.test(s)
  const hasSym = /[^A-Za-z0-9]/.test(s)
  const score = [hasUpper, hasLower, hasNum, hasSym].filter(Boolean).length
  if (score < 3) return 'Password must include at least 3 of: uppercase, lowercase, number, symbol.'
  return ''
}

function resetPwdForm() {
  pwd.password = ''
  pwd.confirm = ''
  pwd.error = ''
  pwd.show = false
}

function openPwdPanel() {
  pwd.open = true
  pwd.error = ''
  pwd.show = false
}

function closePwdPanel() {
  if (pwd.submitting) return
  pwd.open = false
  resetPwdForm()
}

async function submitResetPassword() {
  pwd.error = ''
  if (!employeeId.value) return (pwd.error = 'Missing employeeId.')

  const v = validateStrongPassword(pwd.password)
  if (v) {
    pwd.error = v
    showToast({ type: 'error', title: 'Validation', message: v })
    return
  }
  if (pwd.password !== pwd.confirm) {
    pwd.error = 'Confirm password does not match.'
    showToast({ type: 'error', title: 'Validation', message: pwd.error })
    return
  }

  pwd.submitting = true
  try {
    await api.patch(`/admin/leave/profiles/${employeeId.value}/password`, {
      password: String(pwd.password),
    })

    showToast({ type: 'success', title: 'Password updated', message: 'New password saved for this employee.' })
    closePwdPanel()
  } catch (e) {
    console.error(e)
    const msg = e?.response?.data?.message || 'Failed to reset password.'
    pwd.error = msg
    showToast({ type: 'error', title: 'Reset failed', message: msg })
  } finally {
    pwd.submitting = false
  }
}

/* ───────────────── actions ───────────────── */
function goBack() {
  router.back()
}

/* ───────────────── contracts modal ───────────────── */
const contractsOpen = ref(false)
function openContractsModal() {
  contractsOpen.value = true
}

/* ───────────────── renew modal ───────────────── */
const renew = reactive({
  open: false,
  newContractDate: '',
  clearOldLeave: true,
  note: '',
  submitting: false,
  error: '',
})

function openRenewModal() {
  renew.error = ''
  renew.note = ''
  renew.clearOldLeave = true
  renew.newContractDate = dayjs().format('YYYY-MM-DD')
  renew.open = true
}
function closeRenewModal() {
  if (renew.submitting) return
  renew.open = false
}
async function submitRenew() {
  renew.error = ''
  if (!employeeId.value) return (renew.error = 'Missing employeeId.')
  if (!isValidYMD(renew.newContractDate)) return (renew.error = 'Please choose a valid new contract start date.')

  renew.submitting = true
  try {
    await api.post(`/admin/leave/profiles/${employeeId.value}/contracts/renew`, {
      newContractDate: renew.newContractDate,
      clearOldLeave: !!renew.clearOldLeave,
      clearUnusedAL: !!renew.clearOldLeave,
      note: renew.note ? String(renew.note).trim() : null,
    })

    showToast({
      type: 'success',
      title: 'Contract renewed',
      message: renew.clearOldLeave ? 'Unused AL cleared (debt carried if negative).' : 'AL carried forward.',
    })

    renew.open = false
    await fetchProfile()
    await fetchContracts()
  } catch (e) {
    console.error(e)
    renew.error = e?.response?.data?.message || 'Failed to renew contract.'
    showToast({ type: 'error', title: 'Renew failed', message: renew.error })
  } finally {
    renew.submitting = false
  }
}

/* ✅ lock background scroll for ANY modal / drawer */
const anyModalOpen = computed(() => !!renew.open || !!contractsOpen.value)
watch(anyModalOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!open)
})

/* ───────────────── lifecycle ───────────────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  await fetchLeaveTypes()
  await fetchProfile()
  await fetchContracts()
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (typeof document !== 'undefined') document.body.classList.remove('overflow-hidden')
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="min-h-screen w-full flex flex-col">
      <!-- Page header (component) -->
      <EditPageHeader
        :employeeId="employeeId"
        :isDirty="isDirty"
        :joinDateChanged="joinDateChanged"
        :loading="loading"
        :saving="saving"
        :hasProfile="!!profile"
        @back="goBack"
        @reset="resetForm"
        @openLogs="openContractsModal"
        @openRenew="openRenewModal"
        @openPassword="openPwdPanel"
        @save="saveProfile"
        @refresh="fetchProfile()"
      />

      <!-- Body -->
      <main class="flex-1 overflow-y-auto ui-scrollbar px-3 sm:px-4 lg:px-6 py-4 space-y-4">
        <!-- Error -->
        <div
          v-if="error"
          class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span class="font-semibold">Failed:</span> {{ error }}
        </div>

        <!-- Loading -->
        <div v-if="loading" class="space-y-3">
          <div class="ui-card !rounded-2xl h-14 animate-pulse bg-ui-bg-2/60" />
          <div class="ui-card !rounded-2xl h-56 animate-pulse bg-ui-bg-2/60" />
          <div class="ui-card !rounded-2xl h-56 animate-pulse bg-ui-bg-2/60" />
        </div>

        <template v-else>
          <div v-if="!profile" class="py-10 text-center text-[11px] text-ui-muted">Profile not loaded.</div>

          <template v-else>
            <!-- Mini summary cards -->
            <section class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <InfoRow label="Employee ID" :value="profile.employeeId || '—'" hint="Read-only" />
              <InfoRow label="Name" :value="profile.name || '—'" hint="Read-only" />
              <InfoRow label="Department" :value="profile.department || '—'" hint="Read-only" />
            </section>

            <!-- Password reset (component card) -->
            <PasswordResetCard
              :open="pwd.open"
              :submitting="pwd.submitting"
              :show="pwd.show"
              :password="pwd.password"
              :confirm="pwd.confirm"
              :error="pwd.error"
              :employeeId="profile?.employeeId || employeeId"
              :employeeName="profile?.name || ''"
              @update:show="pwd.show = $event"
              @update:password="pwd.password = $event"
              @update:confirm="pwd.confirm = $event"
              @clear="resetPwdForm"
              @close="closePwdPanel"
              @submit="submitResetPassword"
            />

            <!-- SECTION: Profile Settings + Balances -->
            <section class="ui-card overflow-hidden">
              <div class="section-head section-head--indigo">
                <div>
                  <div class="section-title">Profile settings</div>
                </div>
                <div class="hidden sm:flex items-center gap-2">
                  <span class="ui-badge">Mode: {{ normApprovalMode(profile.approvalMode) }}</span>
                  <span class="ui-badge">Active: {{ profile.isActive === false ? 'No' : 'Yes' }}</span>
                </div>
              </div>

              <div class="p-3 lg:p-4">
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <!-- Left: settings form -->
                  <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <!-- Join Date -->
                    <div class="ui-card !rounded-2xl px-3 py-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Controls AL accrual and service-year rules">
                        Join date
                      </div>
                      <div class="mt-1">
                        <input v-model="form.joinDate" type="date" class="ui-date w-full" />
                        <div class="mt-1 text-[11px] text-ui-muted">
                          Current: <span class="font-mono">{{ fmtYMD(profile.joinDate) }}</span>
                          <span v-if="joinDateChanged" class="ml-2 ui-badge">Changed → will recalc</span>
                        </div>
                      </div>
                    </div>

                    <!-- Contract start (read-only) -->
                    <InfoRow label="Current contract start" :value="fmtYMD(profile.contractDate)" hint="To change contract date, use Renew" />

                    <!-- Approval mode -->
                    <div class="ui-card !rounded-2xl px-2.5 py-2 sm:col-span-2">
                      <div
                        class="ui-label !text-[9px] !tracking-[0.26em] uppercase cursor-help"
                        title="Approval chain for this employee profile"
                      >
                        Approval mode
                      </div>

                      <div class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <select v-model="form.approvalMode" class="ui-select w-full !py-1.5 !text-[11px]">
                          <option v-for="m in APPROVAL_MODES" :key="m.value" :value="m.value">
                            {{ m.label }}
                          </option>
                        </select>

                        <!-- Active mini box -->
                        <div class="ui-card !rounded-2xl px-2.5 py-2 bg-ui-bg-2/60">
                          <div
                            class="ui-label !text-[9px] !tracking-[0.26em] uppercase cursor-help"
                            title="If inactive, employee cannot request leave"
                          >
                            Active
                          </div>

                          <div class="mt-1.5 flex items-center justify-between gap-2">
                            <div class="text-[11px] font-extrabold text-ui-fg">
                              {{ form.isActive ? 'Yes' : 'No' }}
                            </div>

                            <button
                              type="button"
                              class="ui-btn ui-btn-soft ui-btn-xs !px-2 !py-1"
                              @click="form.isActive = !form.isActive"
                            >
                              <i class="fa-solid text-[10px]" :class="form.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                              Toggle
                            </button>
                          </div>

                          <div class="mt-1 text-[10px] text-ui-muted">
                            Current: <span class="font-mono">{{ profile.isActive === false ? 'No' : 'Yes' }}</span>
                          </div>
                        </div>
                      </div>

                      <div class="mt-1 text-[10px] text-ui-muted">
                        Current: <span class="font-mono">{{ normApprovalMode(profile.approvalMode) }}</span>
                      </div>
                    </div>


                    <!-- Manager employeeId -->
                    <div class="ui-card !rounded-2xl px-3 py-2">
                      <div
                        class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help"
                        :title="needManager ? 'Required for Manager + GM' : 'Optional (skipped if empty)'"
                      >
                        Manager employee ID
                        <span v-if="needManager" class="ml-2 ui-badge">required</span>
                      </div>
                      <div class="mt-1">
                        <input v-model="form.managerEmployeeId" type="text" placeholder="Example: 51820386" class="ui-input w-full" />
                        <div class="mt-1 text-[11px] text-ui-muted">
                          Current: <span class="font-mono">{{ profile.managerEmployeeId || profile.managerLoginId || '—' }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- GM login -->
                    <div class="ui-card !rounded-2xl px-3 py-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Approver loginId with role LEAVE_GM (required)">
                        GM login ID <span class="ml-1 text-rose-600 font-extrabold">*</span>
                      </div>
                      <div class="mt-1">
                        <input v-model="form.gmLoginId" type="text" placeholder="Example: leave_gm" class="ui-input w-full" />
                        <div class="mt-1 text-[11px] text-ui-muted">
                          Current: <span class="font-mono">{{ profile.gmLoginId || '—' }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- COO login -->
                    <div v-if="needCoo" class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Required when approval mode is GM + COO">
                        COO login ID <span class="ml-1 text-rose-600 font-extrabold">*</span>
                      </div>
                      <div class="mt-1">
                        <input v-model="form.cooLoginId" type="text" placeholder="Example: leave_coo" class="ui-input w-full" />
                        <div class="mt-1 text-[11px] text-ui-muted">
                          Current: <span class="font-mono">{{ profile.cooLoginId || '—' }}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Right: balances -->
                  <aside class="ui-card !rounded-2xl p-3">
                    <div class="flex items-end justify-between gap-3">
                      <div>
                        <div class="text-[12px] font-extrabold text-ui-fg">Balances</div>
                        <div class="text-[11px] text-ui-muted">
                          As of <span class="font-mono">{{ profile.balancesAsOf || '—' }}</span>
                        </div>
                      </div>
                      <span class="ui-badge ui-badge-emerald">Live</span>
                    </div>

                    <div v-if="!normalizedBalances.length" class="mt-3 text-[11px] text-ui-muted">No balances yet.</div>

                    <div v-else class="mt-3">
                      <div class="overflow-x-auto ui-scrollbar rounded-xl border border-ui-border/60">
                        <table class="w-full text-[11px]">
                          <thead class="bg-ui-bg-2/60">
                            <tr class="text-ui-muted">
                              <th class="px-3 py-2 text-left text-[10px] font-extrabold">Type</th>
                              <th class="px-3 py-2 text-right text-[10px] font-extrabold">Used</th>
                              <th class="px-3 py-2 text-right text-[10px] font-extrabold">Remain</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="b in normalizedBalances" :key="b.leaveTypeCode" class="border-t border-ui-border/60">
                              <td class="px-3 py-2 font-extrabold text-ui-fg">{{ b.leaveTypeCode }}</td>
                              <td class="px-3 py-2 text-right font-mono text-ui-fg">{{ fmt(b.used) }}</td>
                              <td class="px-3 py-2 text-right font-mono">
                                <span
                                  class="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-extrabold"
                                  :class="
                                    num(b.remaining) < 0
                                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                                      : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                                  "
                                >
                                  {{ fmt(b.remaining) }}
                                </span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div class="mt-2 text-[10px] text-ui-muted">Tip: If Join Date changed, Save will try to recalc balances.</div>
                  </aside>
                </div>

                <div
                  v-if="formError"
                  class="mt-3 ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                         dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
                >
                  <span class="font-semibold">Validation:</span> {{ formError }}
                </div>
              </div>
            </section>

            <!-- SECTION: Contract carry -->
            <section class="ui-card overflow-hidden">
              <div class="section-head section-head--emerald">
                <div>
                  <div class="section-title">Contract carry</div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="contractsLoading" @click="fetchContracts">
                    <i class="fa-solid fa-rotate text-[11px]" :class="contractsLoading ? 'fa-spin' : ''" />
                    Refresh
                  </button>

                  <button
                    type="button"
                    class="ui-btn ui-btn-primary ui-btn-sm"
                    :disabled="saving || !selectedContract"
                    @click="saveContractCarry"
                  >
                    <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
                    Save carry
                  </button>
                </div>
              </div>

              <div class="p-3 lg:p-4">
                <div
                  v-if="contractsError"
                  class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                         dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
                >
                  <span class="font-semibold">Contracts:</span> {{ contractsError }}
                </div>

                <div v-if="contractsLoading" class="mt-3 ui-card !rounded-2xl h-12 animate-pulse bg-ui-bg-2/60" />

                <div v-else class="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <!-- selector -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Select contract</div>

                    <select v-model.number="selectedContractNo" class="ui-select w-full mt-1" :disabled="!contracts.length">
                      <option v-if="!contracts.length" :value="null">No contracts</option>
                      <option v-for="c in contracts" :key="c.contractNo" :value="c.contractNo">
                        #{{ c.contractNo }} · {{ c.startDate || '—' }} → {{ c.endDate || '—' }}{{ c.isCurrent ? ' (current)' : '' }}
                      </option>
                    </select>

                    <div class="mt-2 text-[11px] text-ui-muted">
                      Selected:
                      <span class="font-mono font-semibold">{{ selectedContract ? `#${selectedContract.contractNo}` : '—' }}</span>
                    </div>
                  </div>

                  <!-- period -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Contract period</div>
                    <div class="mt-1 text-[12px] font-extrabold text-ui-fg">
                      {{ selectedContract?.startDate || '—' }}
                      <span class="opacity-60 mx-1">→</span>
                      {{ selectedContract?.endDate || '—' }}
                    </div>
                  </div>

                  <!-- carry editor -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="flex items-center justify-between">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Carry editor</div>

                      <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="showCarryAdvanced = !showCarryAdvanced">
                        <i class="fa-solid" :class="showCarryAdvanced ? 'fa-chevron-up' : 'fa-chevron-down'" />
                        {{ showCarryAdvanced ? 'Basic' : 'Advanced' }}
                      </button>
                    </div>

                    <div class="mt-2 grid grid-cols-1 sm:grid-cols-1 gap-2">
                      <div class="sm:col-span-2">
                        <div class="ui-label">AL</div>
                        <input
                          v-model.number="contractCarryForm.carry.AL"
                          type="number"
                          step="0.5"
                          class="ui-input w-full"
                          placeholder="0"
                          :disabled="!selectedContract"
                        />
                      </div>

                      <template v-if="showCarryAdvanced">
                        <div>
                          <div class="ui-label">SP</div>
                          <input v-model.number="contractCarryForm.carry.SP" type="number" step="0.5" class="ui-input w-full" :disabled="!selectedContract" />
                        </div>
                        <div>
                          <div class="ui-label">MC</div>
                          <input v-model.number="contractCarryForm.carry.MC" type="number" step="0.5" class="ui-input w-full" :disabled="!selectedContract" />
                        </div>
                        <div>
                          <div class="ui-label">MA</div>
                          <input v-model.number="contractCarryForm.carry.MA" type="number" step="0.5" class="ui-input w-full" :disabled="!selectedContract" />
                        </div>
                        <div>
                          <div class="ui-label">UL</div>
                          <input v-model.number="contractCarryForm.carry.UL" type="number" step="0.5" class="ui-input w-full" :disabled="!selectedContract" />
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Renew modal (component) -->
            <RenewModal
              :open="renew.open"
              :submitting="renew.submitting"
              :error="renew.error"
              :newContractDate="renew.newContractDate"
              :clearOldLeave="renew.clearOldLeave"
              :note="renew.note"
              :employeeId="profile?.employeeId || employeeId"
              :employeeName="profile?.name || ''"
              @close="closeRenewModal"
              @submit="submitRenew"
              @update:newContractDate="renew.newContractDate = $event"
              @update:clearOldLeave="renew.clearOldLeave = $event"
              @update:note="renew.note = $event"
            />

            <!-- Logs modal (component) -->
            <ContractsLogsModal
              :open="contractsOpen"
              :employeeId="profile?.employeeId || employeeId"
              :employeeName="profile?.name || ''"
              :contractHistory="contractHistory"
              :fmt="fmt"
              @close="contractsOpen = false"
            />
          </template>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
/* modal transition (used by component modals too) */
:deep(.modal-fade-enter-active),
:deep(.modal-fade-leave-active) {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
:deep(.modal-fade-enter-from),
:deep(.modal-fade-leave-to) {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

/* ✅ section header system - make it work across child components */
:deep(.section-head) {
  @apply flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between px-3 lg:px-4 py-3 border-b border-ui-border/60;
}
:deep(.section-title) {
  @apply text-[12px] font-extrabold text-ui-fg;
}
:deep(.section-sub) {
  @apply text-[11px] text-ui-muted;
}

:deep(.section-head--indigo) {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(255, 255, 255, 0));
}
:deep(.section-head--emerald) {
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.12), rgba(255, 255, 255, 0));
}
:deep(.section-head--slate) {
  background: linear-gradient(90deg, rgba(100, 116, 139, 0.12), rgba(255, 255, 255, 0));
}
:deep(.section-head--amber) {
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.14), rgba(255, 255, 255, 0));
}

/* dark mode */
:deep(.dark) .section-head--indigo {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.18), rgba(2, 6, 23, 0));
}
:deep(.dark) .section-head--emerald {
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.18), rgba(2, 6, 23, 0));
}
:deep(.dark) .section-head--slate {
  background: linear-gradient(90deg, rgba(100, 116, 139, 0.18), rgba(2, 6, 23, 0));
}
:deep(.dark) .section-head--amber {
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.22), rgba(2, 6, 23, 0));
}
</style>

<!-- src/views/expat/admin/profiles/AdminLeaveProfileEdit.vue
  ✅ Fullscreen Admin edit page
  ✅ Profile settings edit (joinDate, approvalMode, approvers, active)
  ✅ Contract-aware carry edit (per contractNo)
  ✅ Logs + Renew contract modal (components)
  ✅ Admin password reset (component)

  ✅ IMPORTANT:
     - Carry stored ONLY on contracts[].carry
     - computeBalances() already applies carry into balances.used + balances.remaining
     - Frontend must NOT apply carry again

  ✅ FIXED:
     - Added MANAGER_AND_COO to dropdown
     - GM_AND_COO hides manager input
     - If mode does NOT involve manager => managerLoginId will be cleared (null)
-->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

/* components */
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

/* ───────────────── approval mode ───────────────── */
const APPROVAL_MODES = [
  { value: 'MANAGER_AND_GM', label: 'Manager + GM', hint: 'Manager approves first, then GM.' },
  { value: 'MANAGER_AND_COO', label: 'Manager + COO', hint: 'Manager approves first, then COO.' },
  { value: 'GM_AND_COO', label: 'GM + COO', hint: 'GM approves first, then COO.' },
]

function normApprovalMode(v) {
  const s = up(v)
  if (s === 'GM_AND_COO') return 'GM_AND_COO'
  if (s === 'MANAGER_AND_COO') return 'MANAGER_AND_COO'
  if (s === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  // backward aliases
  if (s === 'ADMIN_AND_GM') return 'MANAGER_AND_GM'
  if (s === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (s === 'MANAGER+GM') return 'MANAGER_AND_GM'
  return 'MANAGER_AND_GM'
}

const needManager = computed(() => {
  const m = normApprovalMode(form.approvalMode)
  return m === 'MANAGER_AND_GM' || m === 'MANAGER_AND_COO'
})
const needCoo = computed(() => {
  const m = normApprovalMode(form.approvalMode)
  return m === 'GM_AND_COO' || m === 'MANAGER_AND_COO'
})

/* ───────────────── balances normalize (NO carry math here) ───────────────── */
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

  for (const code of TYPE_ORDER.value) {
    if (!map.has(code)) map.set(code, { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
  }

  const arr = Array.from(map.values())
  arr.sort((a, b) => TYPE_ORDER.value.indexOf(a.leaveTypeCode) - TYPE_ORDER.value.indexOf(b.leaveTypeCode))
  return arr
}
const balancesForDisplay = computed(() => normalizeBalances(profile.value?.balances || []))

/* ───────────────── contract history ───────────────── */
function readContractHistory(p) {
  if (!p) return []
  if (Array.isArray(p.contracts)) return p.contracts
  if (Array.isArray(p.contractHistory)) return p.contractHistory
  return []
}
const contractHistory = computed(() => {
  const arr = readContractHistory(profile.value).slice()
  return arr.sort((a, b) => {
    const ta = a?.openedAt ? new Date(a.openedAt).getTime() : a?.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b?.openedAt ? new Date(b.openedAt).getTime() : b?.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
})

/* ───────────────── contract carry editing ───────────────── */
const contractsLoading = ref(false)
const contractsError = ref('')
const contracts = ref([])

function emptyCarry() {
  return { AL: 0, SP: 0, MC: 0, MA: 0, UL: 0 }
}
function normalizeCarry(src) {
  const c = src || {}
  return { AL: num(c.AL), SP: num(c.SP), MC: num(c.MC), MA: num(c.MA), UL: num(c.UL) }
}
function normalizeContracts(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.contracts) ? raw.contracts : []
  return arr
    .map((c, idx) => {
      const contractNo = c?.contractNo ?? c?.no ?? c?.index ?? idx + 1
      const start = c?.startDate || c?.from || c?.contractDate || c?.start || ''
      const end = c?.endDate || c?.to || c?.contractEndDate || c?.end || ''
      const carry = normalizeCarry(c?.carry || {})
      const isCurrent = !!(c?.isCurrent || c?.current || c?.active)
      return { ...c, contractNo: Number(contractNo), startDate: start, endDate: end, carry, isCurrent }
    })
    .sort((a, b) => Number(b.contractNo) - Number(a.contractNo))
}

const selectedContractNo = ref(null)
const selectedContract = computed(() => {
  const no = Number(selectedContractNo.value)
  if (!no) return null
  return contracts.value.find((c) => Number(c.contractNo) === no) || null
})
const contractCarryForm = reactive({ carry: emptyCarry() })

function fillContractCarryFormFromSelected() {
  const c = selectedContract.value
  contractCarryForm.carry = c ? { ...normalizeCarry(c.carry) } : emptyCarry()
}
function setSelectedContractDefault() {
  if (!contracts.value.length) {
    selectedContractNo.value = null
    contractCarryForm.carry = emptyCarry()
    return
  }
  const current = contracts.value.find((c) => c.isCurrent) || contracts.value[0]
  selectedContractNo.value = Number(current.contractNo)
  fillContractCarryFormFromSelected()
}
watch(selectedContractNo, () => fillContractCarryFormFromSelected())

async function fetchProfile() {
  if (!employeeId.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.get(`/admin/leave/profiles/${employeeId.value}`)
    profile.value = res?.data?.profile ?? res?.data ?? null
    if (profile.value) fillFormFromProfile(profile.value)
  } catch (e) {
    console.error(e)
    error.value = e?.response?.data?.message || 'Failed to load profile.'
    showToast({ type: 'error', title: 'Load failed', message: error.value })
  } finally {
    loading.value = false
  }
}

async function fetchContracts() {
  if (!employeeId.value) return
  contractsLoading.value = true
  contractsError.value = ''
  try {
    const res = await api.get(`/admin/leave/profiles/${employeeId.value}`)
    const p = res?.data?.profile ?? res?.data ?? null
    profile.value = p
    if (profile.value) fillFormFromProfile(profile.value)

    contracts.value = normalizeContracts(profile.value?.contracts || profile.value?.contractHistory || [])
    setSelectedContractDefault()
  } catch (e) {
    console.error(e)
    contractsError.value = e?.response?.data?.message || 'Failed to load contracts.'
    contracts.value = []
    selectedContractNo.value = null
  } finally {
    contractsLoading.value = false
  }
}

async function saveContractCarry() {
  if (!employeeId.value) return
  const no = Number(selectedContractNo.value)
  if (!no) return showToast({ type: 'error', title: 'Validation', message: 'Please select a contract.' })

  saving.value = true
  try {
    const carry = normalizeCarry(contractCarryForm.carry)
    await api.patch(`/admin/leave/profiles/${employeeId.value}/contracts/${no}`, { carry })
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

  // IMPORTANT: backend uses managerLoginId; we keep UI name managerEmployeeId but will map -> managerLoginId.
  managerEmployeeId: '',

  gmLoginId: '',
  cooLoginId: '',
  isActive: true,
})
const formError = ref('')

function fillFormFromProfile(p) {
  form.joinDate = toInputDate(p?.joinDate)
  form.approvalMode = normApprovalMode(p?.approvalMode)

  // accept either key from backend
  form.managerEmployeeId = String(p?.managerEmployeeId || p?.managerLoginId || '')

  form.gmLoginId = String(p?.gmLoginId || '')
  form.cooLoginId = String(p?.cooLoginId || '')
  form.isActive = p?.isActive === false ? false : true
  originalJoinDate.value = toInputDate(p?.joinDate)
}

/* If switching to a mode that doesn't involve manager => clear manager value */
watch(
  () => form.approvalMode,
  () => {
    const m = normApprovalMode(form.approvalMode)

    if (m === 'GM_AND_COO') {
      form.managerEmployeeId = ''
    }
    if (m === 'MANAGER_AND_GM') {
      // optional: clear COO on mode switch
      form.cooLoginId = ''
    }
  }
)

const joinDateChanged = computed(() => String(originalJoinDate.value || '') !== String(form.joinDate || ''))

const isDirty = computed(() => {
  const p = profile.value
  if (!p) return false

  const a = {
    joinDate: toInputDate(p.joinDate),
    approvalMode: normApprovalMode(p.approvalMode),
    managerEmployeeId: String(p.managerEmployeeId || p.managerLoginId || ''),
    gmLoginId: String(p.gmLoginId || ''),
    cooLoginId: String(p.cooLoginId || ''),
    isActive: p.isActive === false ? false : true,
  }
  const b = {
    joinDate: String(form.joinDate || ''),
    approvalMode: normApprovalMode(form.approvalMode),
    managerEmployeeId: String(form.managerEmployeeId || ''),
    gmLoginId: String(form.gmLoginId || ''),
    cooLoginId: String(form.cooLoginId || ''),
    isActive: !!form.isActive,
  }
  return JSON.stringify(a) !== JSON.stringify(b)
})

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

  for (const fn of tries) {
    try {
      await fn()
      return true
    } catch (e) {
      const st = e?.response?.status
      if (st === 404 || st === 405) continue
      throw e
    }
  }
  return false
}

function validateApprovers() {
  const mode = normApprovalMode(form.approvalMode)

  // your backend requires GM in all modes (validateModeApprovers)
  if (!String(form.gmLoginId || '').trim()) return 'GM Login ID is required.'

  if ((mode === 'MANAGER_AND_GM' || mode === 'MANAGER_AND_COO') && !String(form.managerEmployeeId || '').trim()) {
    return 'Manager Employee ID is required.'
  }

  if ((mode === 'GM_AND_COO' || mode === 'MANAGER_AND_COO') && !String(form.cooLoginId || '').trim()) {
    return 'COO Login ID is required.'
  }

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

    await updateProfile(
      {
        joinDate: form.joinDate ? String(form.joinDate) : null,
        approvalMode: mode,

        // ✅ KEY FIX: backend expects managerLoginId, not managerEmployeeId
        // ✅ If mode doesn't involve manager => null removes it from manager grouping
        managerLoginId: needManager.value ? String(form.managerEmployeeId || '').trim() || null : null,

        gmLoginId: String(form.gmLoginId || '').trim() || null,
        cooLoginId: needCoo.value ? String(form.cooLoginId || '').trim() || null : null,

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

/* ───────────────── password reset ───────────────── */
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
    await api.patch(`/admin/leave/profiles/${employeeId.value}/password`, { password: String(pwd.password) })
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

/* ───────────────── contracts logs modal ───────────────── */
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
const anyModalOpen = computed(() => !!renew.open || !!contractsOpen.value || !!pwd.open)
watch(anyModalOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!open)
})

/* ───────────────── lifecycle ───────────────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchLeaveTypes()
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
        @refresh="fetchProfile"
      />

      <main class="flex-1 overflow-y-auto ui-scrollbar px-3 sm:px-4 lg:px-6 py-4 space-y-4">
        <div
          v-if="error"
          class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span class="font-semibold">Failed:</span> {{ error }}
        </div>

        <div v-if="loading" class="space-y-3">
          <div class="ui-card !rounded-2xl h-14 animate-pulse bg-ui-bg-2/60" />
          <div class="ui-card !rounded-2xl h-56 animate-pulse bg-ui-bg-2/60" />
          <div class="ui-card !rounded-2xl h-56 animate-pulse bg-ui-bg-2/60" />
        </div>

        <template v-else>
          <div v-if="!profile" class="py-10 text-center text-[11px] text-ui-muted">Profile not loaded.</div>

          <template v-else>
            <section class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <InfoRow label="Employee ID" :value="profile.employeeId || '—'" />
              <InfoRow label="Name" :value="profile.name || '—'" />
              <InfoRow label="Department" :value="profile.department || '—'" />
            </section>

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

            <section class="ui-card overflow-hidden">
              <div class="section-head section-head--indigo">
                <div>
                  <div class="section-title">Profile settings</div>
                </div>
                <div class="hidden sm:flex items-center gap-2">
                  <span class="ui-badge">Active: {{ profile.isActive === false ? 'No' : 'Yes' }}</span>
                </div>
              </div>

              <div class="p-3 lg:p-4">
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="ui-card !rounded-2xl px-3 py-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Controls AL accrual and service-year rules">
                        Join date
                      </div>
                      <div class="mt-1">
                        <input v-model="form.joinDate" type="date" class="ui-date w-full" />
                        <div class="mt-1 text-[11px] text-ui-muted">
                          <span v-if="joinDateChanged" class="ml-2 ui-badge">Changed date, will recalculate</span>
                        </div>
                      </div>
                    </div>

                    <InfoRow label="Current contract start" :value="fmtYMD(profile.contractDate)" />

                    <div class="ui-card !rounded-2xl px-2.5 py-2 sm:col-span-2">
                      <div class="ui-label !text-[9px] !tracking-[0.26em] uppercase cursor-help" title="Approval chain for this employee profile">
                        Approval mode
                      </div>

                      <div class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <select v-model="form.approvalMode" class="ui-select w-full !py-1.5 !text-[11px]">
                          <option v-for="m in APPROVAL_MODES" :key="m.value" :value="m.value">
                            {{ m.label }}
                          </option>
                        </select>

                        <div class="ui-card !rounded-2xl px-2.5 py-2 bg-ui-bg-2/60">
                          <div class="ui-label !text-[9px] !tracking-[0.26em] uppercase cursor-help" title="If inactive, employee cannot request leave">
                            Active
                          </div>

                          <div class="mt-1.5 flex items-center justify-between gap-2">
                            <div class="text-[11px] font-extrabold text-ui-fg">{{ form.isActive ? 'Yes' : 'No' }}</div>

                            <button type="button" class="ui-btn ui-btn-soft ui-btn-xs !px-2 !py-1" @click="form.isActive = !form.isActive">
                              <i class="fa-solid text-[10px]" :class="form.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                              Toggle
                            </button>
                          </div>

                          <div class="mt-1 text-[10px] text-ui-muted">
                            Current: <span class="font-mono">{{ profile.isActive === false ? 'No' : 'Yes' }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- ✅ show only if mode needs manager -->
                    <div v-if="needManager" class="ui-card !rounded-2xl px-3 py-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Required for Manager modes">
                        Manager employee ID <span class="ml-2 ui-badge">required</span>
                      </div>
                      <div class="mt-1">
                        <input v-model="form.managerEmployeeId" type="text" placeholder="Example: 51820386" class="ui-input w-full" />
                      </div>
                    </div>

                    <div class="ui-card !rounded-2xl px-3 py-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Approver loginId with role LEAVE_GM (required)">
                        GM login ID <span class="ml-1 text-rose-600 font-extrabold">*</span>
                      </div>
                      <div class="mt-1">
                        <input v-model="form.gmLoginId" type="text" placeholder="Example: leave_gm" class="ui-input w-full" />
                      </div>
                    </div>

                    <!-- ✅ show COO when needed -->
                    <div v-if="needCoo" class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Required when approval mode includes COO">
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

                  <aside class="ui-card !rounded-2xl p-3">
                    <div class="flex items-end justify-between gap-3">
                      <div>
                        <div class="text-[12px] font-extrabold text-ui-fg">Balances</div>
                        <div class="text-[11px] text-ui-muted">
                          <span class="font-mono">{{ profile.balancesAsOf || '—' }}</span>
                        </div>
                      </div>
                    </div>

                    <div v-if="!balancesForDisplay.length" class="mt-3 text-[11px] text-ui-muted">No balances yet.</div>

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
                            <tr v-for="b in balancesForDisplay" :key="b.leaveTypeCode" class="border-t border-ui-border/60">
                              <td class="px-3 py-2 font-extrabold text-ui-fg">{{ b.leaveTypeCode }}</td>
                              <td class="px-3 py-2 text-right font-mono text-ui-fg">{{ fmt(b.used) }}</td>
                              <td class="px-3 py-2 text-right font-mono">
                                <span
                                  class="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-extrabold"
                                  :class="
                                    num(b.remaining) <= 0
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

                  <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="saving || !selectedContract" @click="saveContractCarry">
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
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Select contract</div>

                    <select v-model.number="selectedContractNo" class="ui-select w-full mt-1" :disabled="!contracts.length">
                      <option v-if="!contracts.length" :value="null">No contracts</option>
                      <option v-for="c in contracts" :key="c.contractNo" :value="c.contractNo">
                        #{{ c.contractNo }} · {{ c.startDate || '—' }} → {{ c.endDate || '—' }}{{ c.isCurrent ? ' (current)' : '' }}
                      </option>
                    </select>

                    <div class="mt-2 text-[11px] text-ui-muted">
                      Selected: <span class="font-mono font-semibold">{{ selectedContract ? `#${selectedContract.contractNo}` : '—' }}</span>
                    </div>
                  </div>

                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Contract period</div>
                    <div class="mt-1 text-[12px] font-extrabold text-ui-fg">
                      {{ selectedContract?.startDate || '—' }}
                      <span class="opacity-60 mx-1">→</span>
                      {{ selectedContract?.endDate || '—' }}
                    </div>
                  </div>

                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Carry editor</div>

                    <div class="mt-2 grid grid-cols-1 gap-2">
                      <div>
                        <div class="ui-label">AL</div>
                        <input v-model.number="contractCarryForm.carry.AL" type="number" step="0.5" class="ui-input w-full" placeholder="0" :disabled="!selectedContract" />
                      </div>

                      <div class="grid grid-cols-2 gap-2">
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
                      </div>

                      <p class="text-[11px] text-ui-muted">Carry supports positive or negative.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

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
:deep(.modal-fade-enter-active),
:deep(.modal-fade-leave-active) {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
:deep(.modal-fade-enter-from),
:deep(.modal-fade-leave-to) {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

:deep(.section-head) {
  @apply flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between px-3 lg:px-4 py-3 border-b border-ui-border/60;
}
:deep(.section-title) {
  @apply text-[12px] font-extrabold text-ui-fg;
}

:deep(.section-head--indigo) {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(255, 255, 255, 0));
}
:deep(.section-head--emerald) {
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.12), rgba(255, 255, 255, 0));
}

:deep(.dark) .section-head--indigo {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.18), rgba(2, 6, 23, 0));
}
:deep(.dark) .section-head--emerald {
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.18), rgba(2, 6, 23, 0));
}
</style>
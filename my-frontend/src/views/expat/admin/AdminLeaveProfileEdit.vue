<!-- src/views/expat/admin/AdminLeaveProfileEdit.vue
  ✅ Fullscreen Admin edit page
  ✅ Profile settings edit (joinDate, approvalMode, approvers, active)
  ✅ Contract-aware carry edit (per contractNo)
  ✅ Logs + Renew contract modal
  ✅ NEW: Admin password reset (set new password only, no old password)
  ✅ CLEAN UI: consistent sections, header bars, spacing, responsive
-->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, defineComponent, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

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

const contractCarryDirty = computed(() => {
  const c = selectedContract.value
  if (!c) return false
  const a = normalizeCarry(c.carry)
  const b = normalizeCarry(contractCarryForm.carry)
  return JSON.stringify(a) !== JSON.stringify(b)
})

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
    // ✅ PATCH (you changed to patch)
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

/* ───────────────── InfoRow ───────────────── */
const InfoRow = defineComponent({
  name: 'InfoRow',
  props: {
    label: { type: String, default: '' },
    value: { type: String, default: '' },
    hint: { type: String, default: '' },
  },
  setup(props) {
    return () =>
      h('div', { class: 'ui-card !rounded-2xl px-3 py-2' }, [
        h(
          'div',
          {
            class:
              'ui-label !text-[10px] !font-extrabold !tracking-[0.28em] uppercase ' + (props.hint ? 'cursor-help' : ''),
            title: props.hint || '',
          },
          props.label
        ),
        h('div', { class: 'mt-1 text-[13px] font-semibold text-ui-fg truncate' }, props.value),
      ])
  },
})

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
      <!-- Page header -->
      <header class="ui-hero rounded-none border-x-0 border-t-0 px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0">
            <div class="ui-hero-kicker">Expat Leave · Admin</div>
            <div class="ui-hero-title">Leave Profile Edit</div>
            <div class="ui-hero-subtitle">
              Employee:
              <span class="font-mono font-semibold">{{ employeeId || '—' }}</span>
              <span class="mx-2 opacity-60">•</span>
              Edit settings, carry, logs and password.
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span v-if="isDirty" class="ui-badge ui-badge-indigo">Unsaved changes</span>
              <span v-if="joinDateChanged" class="ui-badge">Join date changed → recalc</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-start lg:justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" @click="goBack">
              <i class="fa-solid fa-arrow-left text-[11px]" />
              Back
            </button>

            <button type="button" class="ui-btn ui-btn-soft" :disabled="loading || saving || !profile || !isDirty" @click="resetForm">
              <i class="fa-solid fa-rotate-left text-[11px]" />
              Reset
            </button>

            <button type="button" class="ui-btn ui-btn-soft" :disabled="loading || !profile" @click="openContractsModal">
              <i class="fa-regular fa-folder-open text-[11px]" />
              Logs
            </button>

            <button type="button" class="ui-btn ui-btn-soft" :disabled="loading || !profile" @click="openRenewModal">
              <i class="fa-solid fa-arrows-rotate text-[11px]" />
              Renew
            </button>

            <button type="button" class="ui-btn ui-btn-soft" :disabled="loading || !profile" @click="openPwdPanel">
              <i class="fa-solid fa-key text-[11px]" />
              Password
            </button>

            <button type="button" class="ui-btn ui-btn-primary" :disabled="loading || saving || !profile || !isDirty" @click="saveProfile">
              <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
              Save
              <span v-if="joinDateChanged" class="ml-1 ui-badge">+recalc</span>
            </button>

            <button type="button" class="ui-btn ui-btn-ghost" :disabled="loading" @click="fetchProfile()">
              <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>
      </header>

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

            <!-- SECTION: Password reset (inline card) -->
            <section v-if="pwd.open" class="ui-card overflow-hidden">
              <div class="section-head section-head--amber">
                <div>
                  <div class="section-title">Reset password</div>
                  <div class="section-sub">
                    Set a new password directly (no old password). Min 13 chars, must include 3 of 4 categories.
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="pwd.submitting" @click="resetPwdForm">
                    <i class="fa-solid fa-eraser text-[11px]" />
                    Clear
                  </button>

                  <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" :disabled="pwd.submitting" @click="closePwdPanel">
                    <i class="fa-solid fa-xmark text-[11px]" />
                    Close
                  </button>

                  <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="pwd.submitting" @click="submitResetPassword">
                    <i class="fa-solid" :class="pwd.submitting ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
                    Save password
                  </button>
                </div>
              </div>

              <div class="p-3 lg:p-4">
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">New password</div>
                      <div class="mt-1 relative">
                        <input
                          v-model="pwd.password"
                          :type="pwd.show ? 'text' : 'password'"
                          class="ui-input w-full pr-12"
                          placeholder="Type strong password…"
                          :disabled="pwd.submitting"
                          autocomplete="new-password"
                        />
                        <button
                          type="button"
                          class="absolute right-2 top-1/2 -translate-y-1/2 ui-btn ui-btn-ghost ui-btn-xs"
                          :disabled="pwd.submitting"
                          @click="pwd.show = !pwd.show"
                          :title="pwd.show ? 'Hide' : 'Show'"
                        >
                          <i class="fa-solid" :class="pwd.show ? 'fa-eye-slash' : 'fa-eye'" />
                        </button>
                      </div>

                      <div class="mt-2 text-[11px] text-ui-muted">
                        Rule: 13+ chars and at least 3 of:
                        <span class="font-semibold">Upper</span>, <span class="font-semibold">Lower</span>,
                        <span class="font-semibold">Number</span>, <span class="font-semibold">Symbol</span>.
                      </div>
                    </div>

                    <div class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Confirm password</div>
                      <input
                        v-model="pwd.confirm"
                        :type="pwd.show ? 'text' : 'password'"
                        class="ui-input w-full"
                        placeholder="Re-type password…"
                        :disabled="pwd.submitting"
                        autocomplete="new-password"
                      />
                    </div>
                  </div>

                  <aside class="ui-card !rounded-2xl p-3">
                    <div class="text-[12px] font-extrabold text-ui-fg">Target</div>
                    <div class="mt-1 text-[11px] text-ui-muted">This will update the login password for:</div>
                    <div class="mt-2">
                      <div class="ui-badge ui-badge-amber font-mono">{{ profile.employeeId }}</div>
                      <div class="mt-1 text-[11px] text-ui-muted truncate">{{ profile.name || '—' }}</div>
                    </div>

                    <div class="mt-3 text-[11px] text-ui-muted">
                      Tip: after saving, inform employee securely (don’t post password in group chats).
                    </div>
                  </aside>
                </div>

                <div
                  v-if="pwd.error"
                  class="mt-3 ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                         dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
                >
                  <span class="font-semibold">Failed:</span> {{ pwd.error }}
                </div>
              </div>
            </section>

            <!-- SECTION: Profile Settings + Balances -->
            <section class="ui-card overflow-hidden">
              <div class="section-head section-head--indigo">
                <div>
                  <div class="section-title">Profile settings</div>
                  <div class="section-sub">Join date, approval chain, active status and approvers.</div>
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
                    <div class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Approval chain for this employee profile">
                        Approval mode
                      </div>

                      <div class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select v-model="form.approvalMode" class="ui-select w-full">
                          <option v-for="m in APPROVAL_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>

                        <div class="ui-card !rounded-2xl px-3 py-2 bg-ui-bg-2/60">
                          <div class="text-[11px] font-extrabold text-ui-fg">Rule</div>
                          <div class="mt-0.5 text-[11px] text-ui-muted">
                            <span v-if="needManager">Manager is required.</span>
                            <span v-else>COO is required.</span>
                            <span class="ml-1 opacity-70">GM is always required.</span>
                          </div>
                        </div>
                      </div>

                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ normApprovalMode(profile.approvalMode) }}</span>
                      </div>
                    </div>

                    <!-- Active -->
                    <div class="ui-card !rounded-2xl px-3 py-2">
                      <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="If inactive, employee cannot request leave">
                        Active
                      </div>
                      <div class="mt-2 flex items-center justify-between gap-3">
                        <div class="text-[12px] font-extrabold text-ui-fg">{{ form.isActive ? 'Yes' : 'No' }}</div>
                        <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="form.isActive = !form.isActive">
                          <i class="fa-solid" :class="form.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                          Toggle
                        </button>
                      </div>
                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ profile.isActive === false ? 'No' : 'Yes' }}</span>
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
                  <div class="section-sub">Correct place for AL debt/carry. Edit per contract.</div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="contractsLoading" @click="fetchContracts">
                    <i class="fa-solid fa-rotate text-[11px]" :class="contractsLoading ? 'fa-spin' : ''" />
                    Refresh
                  </button>

                  <button
                    type="button"
                    class="ui-btn ui-btn-primary ui-btn-sm"
                    :disabled="saving || !selectedContract || !contractCarryDirty"
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
                        <input v-model.number="contractCarryForm.carry.AL" type="number" step="0.5" class="ui-input w-full" placeholder="0" :disabled="!selectedContract" />
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

                    <div class="mt-2 text-[11px] text-ui-muted">
                      Dirty:
                      <span class="font-semibold" :class="contractCarryDirty ? 'text-rose-600' : 'text-emerald-700'">
                        {{ contractCarryDirty ? 'Yes' : 'No' }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- SECTION: Contract history -->
            <section class="ui-card overflow-hidden">
              <div class="section-head section-head--slate">
                <div>
                  <div class="section-title">Contract history</div>
                  <div class="section-sub">Newest first. Full view also available in Logs.</div>
                </div>
                <div class="text-[11px] text-ui-muted">{{ contractHistory.length }} log(s)</div>
              </div>

              <div class="p-3 lg:p-4">
                <div v-if="!contractHistory.length" class="py-8 text-center text-[11px] text-ui-muted">No contract history.</div>

                <div v-else class="ui-table-wrap ui-scrollbar">
                  <table class="ui-table min-w-[980px]">
                    <thead>
                      <tr>
                        <th class="ui-th">#</th>
                        <th class="ui-th">Start</th>
                        <th class="ui-th">End</th>
                        <th class="ui-th text-right">Carry snapshot</th>
                        <th class="ui-th">Snapshot balances</th>
                        <th class="ui-th">Note</th>
                      </tr>
                    </thead>

                    <tbody>
                      <tr v-for="(c, idx) in contractHistory" :key="c._id || c.createdAt || idx" class="ui-tr-hover">
                        <td class="ui-td font-mono">{{ c.contractNo ?? idx + 1 }}</td>
                        <td class="ui-td font-mono">{{ c.startDate || '—' }}</td>
                        <td class="ui-td font-mono">{{ c.endDate || '—' }}</td>

                        <td class="ui-td">
                          <div class="flex flex-wrap justify-end gap-2 text-[11px]">
                            <span class="ui-badge">AL: {{ fmt(c?.closeSnapshot?.carry?.AL ?? c?.carry?.AL ?? 0) }}</span>
                            <span class="ui-badge">SP: {{ fmt(c?.closeSnapshot?.carry?.SP ?? c?.carry?.SP ?? 0) }}</span>
                            <span class="ui-badge">MC: {{ fmt(c?.closeSnapshot?.carry?.MC ?? c?.carry?.MC ?? 0) }}</span>
                            <span class="ui-badge">MA: {{ fmt(c?.closeSnapshot?.carry?.MA ?? c?.carry?.MA ?? 0) }}</span>
                            <span class="ui-badge">UL: {{ fmt(c?.closeSnapshot?.carry?.UL ?? c?.carry?.UL ?? 0) }}</span>
                          </div>
                        </td>

                        <td class="ui-td">
                          <div class="text-[11px] text-ui-muted">
                            <div v-if="Array.isArray(c?.closeSnapshot?.balances)">
                              <span
                                v-for="b in c.closeSnapshot.balances"
                                :key="String(b.leaveTypeCode) + String(c.openedAt || c.createdAt || idx)"
                                class="mr-2 mb-1 inline-flex ui-badge"
                              >
                                {{ String(b.leaveTypeCode).toUpperCase() }}: U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                              </span>
                            </div>
                            <div v-else class="opacity-60">—</div>
                          </div>
                        </td>

                        <td class="ui-td">
                          <div class="max-w-[260px] truncate text-[11px] text-ui-muted">{{ c.note || '—' }}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </template>
        </template>
      </main>

      <!-- Renew modal -->
      <transition name="modal-fade">
        <div v-if="renew.open" class="ui-modal-backdrop" @click.self="closeRenewModal">
          <div class="ui-modal max-h-[calc(100vh-3rem)] w-full max-w-2xl flex flex-col overflow-hidden">
            <div class="ui-hero rounded-b-none px-4 py-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[14px] font-extrabold text-ui-fg">Renew contract</div>
                  <div class="text-[11px] text-ui-muted">{{ profile?.employeeId }} · {{ profile?.name || '—' }}</div>
                </div>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="renew.submitting" @click="closeRenewModal">
                  <i class="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-3 space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <div class="ui-label">New contract start date</div>
                  <input v-model="renew.newContractDate" type="date" class="ui-date w-full" />
                </div>

                <div>
                  <div class="ui-label">Clear unused AL?</div>
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-[12px] font-extrabold text-ui-fg">
                          {{ renew.clearOldLeave ? 'Yes (clear AL to 0)' : 'No (carry AL forward)' }}
                        </div>
                        <div class="mt-1 text-[11px] text-ui-muted">
                          ON: positive AL cleared, negative debt remains. OFF: carry everything.
                        </div>
                      </div>

                      <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="renew.clearOldLeave = !renew.clearOldLeave">
                        <i class="fa-solid" :class="renew.clearOldLeave ? 'fa-toggle-on' : 'fa-toggle-off'" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div class="ui-label">Note (optional)</div>
                <textarea v-model="renew.note" rows="3" class="ui-input w-full" placeholder="Example: renewed contract for 3 months" />
              </div>

              <div
                v-if="renew.error"
                class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                       dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
              >
                <span class="font-semibold">Failed:</span> {{ renew.error }}
              </div>
            </div>

            <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
              <button type="button" class="ui-btn ui-btn-ghost" :disabled="renew.submitting" @click="closeRenewModal">Cancel</button>

              <button type="button" class="ui-btn ui-btn-primary" :disabled="renew.submitting" @click="submitRenew">
                <i class="fa-solid" :class="renew.submitting ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'" />
                {{ renew.submitting ? 'Saving…' : 'Renew' }}
              </button>
            </div>
          </div>
        </div>
      </transition>

      <!-- Contract logs modal -->
      <transition name="modal-fade">
        <div v-if="contractsOpen" class="ui-modal-backdrop" @click.self="contractsOpen = false">
          <div class="ui-modal max-h-[calc(100vh-3rem)] w-full max-w-5xl flex flex-col overflow-hidden">
            <div class="ui-hero rounded-b-none px-4 py-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[14px] font-extrabold text-ui-fg">Contract logs</div>
                  <div class="text-[11px] text-ui-muted">{{ profile?.employeeId }} · {{ profile?.name || '—' }}</div>
                </div>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="contractsOpen = false">
                  <i class="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-3">
              <p v-if="!contractHistory.length" class="text-[11px] text-ui-muted">No contract logs yet.</p>

              <div v-else class="ui-table-wrap ui-scrollbar">
                <table class="ui-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th class="ui-th">#</th>
                      <th class="ui-th">Start</th>
                      <th class="ui-th">End</th>
                      <th class="ui-th text-right">Carry snapshot</th>
                      <th class="ui-th">Snapshot balances</th>
                      <th class="ui-th">Note</th>
                      <th class="ui-th">By</th>
                      <th class="ui-th">At</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(c, idx) in contractHistory" :key="c._id || c.createdAt || idx" class="ui-tr-hover">
                      <td class="ui-td font-mono">{{ c.contractNo ?? idx + 1 }}</td>
                      <td class="ui-td font-mono">{{ c.startDate || '—' }}</td>
                      <td class="ui-td font-mono">{{ c.endDate || '—' }}</td>

                      <td class="ui-td">
                        <div class="flex flex-wrap justify-end gap-2 text-[11px]">
                          <span class="ui-badge">AL: {{ fmt(c?.closeSnapshot?.carry?.AL ?? c?.carry?.AL ?? 0) }}</span>
                          <span class="ui-badge">SP: {{ fmt(c?.closeSnapshot?.carry?.SP ?? c?.carry?.SP ?? 0) }}</span>
                          <span class="ui-badge">MC: {{ fmt(c?.closeSnapshot?.carry?.MC ?? c?.carry?.MC ?? 0) }}</span>
                          <span class="ui-badge">MA: {{ fmt(c?.closeSnapshot?.carry?.MA ?? c?.carry?.MA ?? 0) }}</span>
                          <span class="ui-badge">UL: {{ fmt(c?.closeSnapshot?.carry?.UL ?? c?.carry?.UL ?? 0) }}</span>
                        </div>
                      </td>

                      <td class="ui-td">
                        <div class="text-[11px] text-ui-muted">
                          <div v-if="Array.isArray(c?.closeSnapshot?.balances)">
                            <span
                              v-for="b in c.closeSnapshot.balances"
                              :key="String(b.leaveTypeCode) + String(c.openedAt || c.createdAt || idx)"
                              class="mr-2 mb-1 inline-flex ui-badge"
                            >
                              {{ String(b.leaveTypeCode).toUpperCase() }}: U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                            </span>
                          </div>
                          <div v-else class="opacity-60">—</div>
                        </div>
                      </td>

                      <td class="ui-td">
                        <div class="max-w-[260px] truncate text-[11px] text-ui-muted">{{ c.note || '—' }}</div>
                      </td>

                      <td class="ui-td font-mono text-[11px]">{{ c.closedBy || c.openedBy || '—' }}</td>
                      <td class="ui-td font-mono text-[11px]">
                        {{ (c.closedAt || c.openedAt) ? dayjs(c.closedAt || c.openedAt).format('YYYY-MM-DD HH:mm') : '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
              <button type="button" class="ui-btn ui-btn-ghost" @click="contractsOpen = false">Close</button>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
/* existing modal */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

/* ✅ consistent section header system */
.section-head {
  @apply flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between px-3 lg:px-4 py-3 border-b border-ui-border/60;
}
.section-title {
  @apply text-[12px] font-extrabold text-ui-fg;
}
.section-sub {
  @apply text-[11px] text-ui-muted;
}

/* subtle colored header backgrounds */
.section-head--indigo {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(255, 255, 255, 0));
}
.section-head--emerald {
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.12), rgba(255, 255, 255, 0));
}
.section-head--slate {
  background: linear-gradient(90deg, rgba(100, 116, 139, 0.12), rgba(255, 255, 255, 0));
}
.section-head--amber {
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.14), rgba(255, 255, 255, 0));
}

/* dark mode tune */
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

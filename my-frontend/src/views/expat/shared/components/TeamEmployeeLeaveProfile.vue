<!-- src/views/expat/shared/TeamEmployeeLeaveProfile.vue
  ✅ Same UI as UserLeaveProfile.vue
  ✅ Loads employee profile via /leave/user/profile?employeeId=...
  ✅ Preview uses /leave/user/record/employee with signature blobs
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { onSocket } from '@/utils/socket'

import TeamLeavePreviewModal from './components/TeamLeavePreviewModal.vue'

defineOptions({ name: 'TeamEmployeeLeaveProfile' })

const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const s = (v) => String(v ?? '').trim()
const up = (v) => s(v).toUpperCase()
const ymd = (v) => {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}
const num = (v) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const ui = {
  wrap: 'w-full min-h-screen px-4 sm:px-6 py-5 bg-slate-950 text-slate-100',
  card: 'rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur',
  th: 'px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap',
  td: 'px-3 py-2.5 text-[12px] text-slate-100 align-middle',
  table: 'min-w-full border-collapse text-[12px] table-fixed',
  btn: 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold',
  btnGhost:
    'border border-slate-700 bg-slate-950/40 hover:bg-slate-900/60 text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed',
  btnPrimary:
    'bg-white text-slate-900 hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed',
}

const targetEmployeeId = computed(() => s(route.params.employeeId))

const loading = ref(false)
const error = ref('')
const updatedAt = ref('')

const me = ref({
  employeeId: '',
  loginId: '',
  name: '',
  department: '',
  joinDate: '',
  contractDate: '',
  contractEndDate: '',
  approvalMode: '',
  isActive: true,
  balances: [],
  carry: {},
  contracts: [],
  manager: null,
})

function normalizeProfileResponse(data) {
  const root = data || {}
  const p = root.profile || root.data?.profile || root

  const employeeId = s(p.employeeId || targetEmployeeId.value || '')
  const loginId = s(p.loginId || '')
  const name = s(p.name || p.fullName || '')
  const department = s(p.department || '')
  const joinDate = ymd(p.joinDate || '')
  const contractDate = ymd(p.contractDate || '')
  const contractEndDate = ymd(p.contractEndDate || '')
  const approvalMode = s(p.approvalMode || '')
  const isActive = p.isActive !== false

  const balances = Array.isArray(p.balances) ? p.balances : []
  const carry = p.carry && typeof p.carry === 'object' ? p.carry : {}
  const manager = p.manager || null

  const contracts = Array.isArray(root?.meta?.contracts)
    ? root.meta.contracts
    : Array.isArray(p.contracts)
      ? p.contracts
      : []

  return {
    employeeId,
    loginId,
    name,
    department,
    joinDate,
    contractDate,
    contractEndDate,
    approvalMode,
    isActive,
    balances,
    carry,
    contracts,
    manager,
  }
}

function normalizeContracts(list, fallbackMe) {
  const arr = Array.isArray(list) ? list : []
  const mapped = arr
    .map((c, i) => {
      const id = s(c.contractId || c._id || c.id || '')
      const idx = Number(c.contractNo || c.contractNumber || c.no || i + 1)
      const from = ymd(c.startDate || c.from || c.contractDate || '')
      const to = ymd(c.endDate || c.to || c.contractEndDate || '')
      const isCurrent = !!c.isCurrent
      const label = s(c.label) || `Contract ${idx}${from ? `: ${from}` : ''}${to ? ` → ${to}` : ''}`
      return { id, idx, from, to, isCurrent, label }
    })
    .filter((x) => x.id || x.from || x.to)

  if (!mapped.length) {
    const from = ymd(fallbackMe?.contractDate || '')
    const to = ymd(fallbackMe?.contractEndDate || '')
    mapped.push({
      id: 'single',
      idx: 1,
      from,
      to,
      isCurrent: true,
      label: `Contract 1${from ? `: ${from}` : ''}${to ? ` → ${to}` : ''}`,
    })
  }

  const today = dayjs().format('YYYY-MM-DD')
  if (mapped.length && !mapped.some((x) => x.isCurrent)) {
    for (const c of mapped) {
      if (c.from && (!c.to ? c.from <= today : c.from <= today && today <= c.to)) c.isCurrent = true
    }
    if (!mapped.some((x) => x.isCurrent)) mapped[mapped.length - 1].isCurrent = true
  }

  mapped.sort((a, b) => (a.from || '').localeCompare(b.from || ''))
  return mapped
}

const contractId = ref('')
const contractOptions = computed(() => normalizeContracts(me.value.contracts, me.value))
const selectedContract = computed(() => contractOptions.value.find((c) => s(c.id) === s(contractId.value)) || null)

watch(contractOptions, (arr) => {
  if (!arr?.length) return (contractId.value = '')
  if (!contractId.value) {
    const cur = arr.find((x) => x.isCurrent)
    contractId.value = s(cur?.id || arr[arr.length - 1]?.id || '')
  }
})

const balancePairs = computed(() => {
  const order = ['AL', 'SP', 'MC', 'MA', 'UL']
  const m = new Map((me.value.balances || []).map((b) => [up(b.leaveTypeCode), b]))
  const carry = me.value.carry || {}

  return order
    .map((k) => {
      const b = m.get(k)
      if (!b) return null
      const ent = num(b.yearlyEntitlement)
      let used = num(b.used)
      const carryVal = num(carry[k])
      if (carryVal < 0) used += Math.abs(carryVal)
      const remaining = ent - used
      return { k, used, ent, remaining }
    })
    .filter(Boolean)
})

async function fetchProfile() {
  if (!targetEmployeeId.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/leave/user/profile', {
      params: { employeeId: targetEmployeeId.value, ts: Date.now() },
    })
    me.value = normalizeProfileResponse(res?.data)
    updatedAt.value = s(res?.data?.meta?.updatedAt || new Date().toISOString())
  } catch (e) {
    console.error('fetchProfile error', e)
    error.value = e?.response?.data?.message || e?.message || 'Failed to load profile.'
    showToast({ type: 'error', title: 'Failed', message: error.value })
  } finally {
    loading.value = false
  }
}

/* realtime refresh if target employee changes */
const off = []
onMounted(async () => {
  await fetchProfile()
  off.push(
    onSocket('leave:profile', (payload) => {
      const pid = s(payload?.employeeId || payload?.profile?.employeeId)
      if (pid && pid === me.value.employeeId) fetchProfile()
    }),
    onSocket('leave:request', (payload) => {
      const pid = s(payload?.employeeId || payload?.request?.employeeId)
      if (pid && pid === me.value.employeeId) fetchProfile()
    })
  )
})
onBeforeUnmount(() => off.forEach((fn) => fn && fn()))

/* preview modal */
const previewOpen = ref(false)
const previewContract = ref(null)

function openPreviewForContract(c) {
  contractId.value = s(c?.id || contractId.value)
  previewContract.value = c || selectedContract.value
  previewOpen.value = true
}
function closePreview() {
  previewOpen.value = false
  previewContract.value = null
}
</script>

<template>
  <div :class="ui.wrap">
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-[22px] font-black">Employee Leave Profile</div>
        <div class="text-[12px] text-slate-400">
          Approver view · Employee:
          <span class="font-mono text-slate-200">{{ targetEmployeeId || '—' }}</span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button :class="[ui.btn, ui.btnGhost]" @click="router.back()">
          <i class="fa-solid fa-arrow-left text-[11px]" />
          Back
        </button>
        <button :class="[ui.btn, ui.btnGhost]" :disabled="loading" @click="fetchProfile">
          <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
          Refresh
        </button>
      </div>
    </div>

    <div v-if="error" class="mt-3 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-[12px] text-rose-100">
      <b>Failed:</b> {{ error }}
    </div>

    <div class="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div :class="ui.card" class="p-4">
        <div class="text-[12px] font-extrabold">Employee</div>
        <div class="mt-3 space-y-2">
          <div class="flex justify-between">
            <div class="text-[11px] text-slate-400">Employee ID</div>
            <div class="font-mono font-bold">{{ me.employeeId || '—' }}</div>
          </div>
          <div class="flex justify-between">
            <div class="text-[11px] text-slate-400">Name</div>
            <div class="font-semibold">{{ me.name || '—' }}</div>
          </div>
          <div class="flex justify-between">
            <div class="text-[11px] text-slate-400">Department</div>
            <div class="font-semibold">{{ me.department || '—' }}</div>
          </div>
          <div class="flex justify-between">
            <div class="text-[11px] text-slate-400">Join Date</div>
            <div class="font-mono font-bold">{{ me.joinDate || '—' }}</div>
          </div>
          <div class="flex justify-between">
            <div class="text-[11px] text-slate-400">Updated</div>
            <div class="font-mono text-[11px] text-slate-300">{{ updatedAt || '—' }}</div>
          </div>

          <div v-if="me.manager" class="mt-2 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
            <div class="text-[11px] font-extrabold text-slate-200">Manager</div>
            <div class="mt-1 text-[12px] font-semibold">{{ me.manager.name || '—' }}</div>
            <div class="text-[11px] text-slate-400">
              <span class="font-mono">{{ me.manager.loginId || '—' }}</span>
              · <span class="font-mono">{{ me.manager.employeeId || '—' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div :class="ui.card" class="p-4 lg:col-span-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-[12px] font-extrabold">Current Balances</div>
            <div class="text-[11px] text-slate-400">Carry-aware</div>
          </div>
          <span class="text-[11px] text-slate-400">
            Selected contract:
            <span class="font-mono text-slate-200">{{ selectedContract?.from || '—' }} → {{ selectedContract?.to || '—' }}</span>
          </span>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <div
            v-for="b in balancePairs"
            :key="b.k"
            class="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/30 px-3 py-1 text-[11px] font-semibold"
          >
            <span class="font-black">{{ b.k }}</span>
            <span class="font-mono text-slate-300">{{ b.used }}/{{ b.ent }}</span>
            <span
              class="ml-1 rounded-full px-2 py-0.5 text-[10px] font-black"
              :class="b.remaining < 0 ? 'bg-rose-900/40 text-rose-200' : 'bg-emerald-900/35 text-emerald-200'"
            >
              {{ b.remaining }}
            </span>
          </div>
          <div v-if="!balancePairs.length" class="text-[12px] text-slate-400">No balances</div>
        </div>
      </div>
    </div>

    <div class="mt-4" :class="ui.card">
      <div class="overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div class="text-[12px] font-extrabold">Contract History</div>
            <div class="text-[11px] text-slate-400">Preview PDF per contract</div>
          </div>
          <div class="text-[11px] text-slate-400">Total: {{ contractOptions.length }}</div>
        </div>

        <div class="overflow-x-auto">
          <table :class="ui.table">
            <colgroup>
              <col style="width: 220px" />
              <col style="width: 220px" />
              <col />
              <col style="width: 140px" />
              <col style="width: 170px" />
            </colgroup>
            <thead class="border-b border-slate-800 bg-slate-950/40">
              <tr>
                <th :class="ui.th">From</th>
                <th :class="ui.th">To</th>
                <th :class="ui.th">Label</th>
                <th :class="ui.th">Current</th>
                <th :class="[ui.th, 'text-right']">Action</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="c in contractOptions"
                :key="c.id || c.label"
                class="border-b border-slate-800 hover:bg-slate-950/40"
              >
                <td :class="ui.td" class="font-mono">{{ c.from || '—' }}</td>
                <td :class="ui.td" class="font-mono">{{ c.to || '—' }}</td>
                <td :class="ui.td" class="truncate">
                  <span class="font-semibold">{{ c.label }}</span>
                </td>
                <td :class="ui.td">
                  <span v-if="c.isCurrent" class="rounded-full bg-emerald-900/35 px-2 py-0.5 text-[10px] font-black text-emerald-200">
                    Current
                  </span>
                  <span v-else class="text-[11px] text-slate-500">—</span>
                </td>
                <td :class="ui.td" class="text-right">
                  <button :class="[ui.btn, ui.btnPrimary]" :disabled="loading" @click="openPreviewForContract(c)">
                    <i class="fa-solid fa-eye text-[11px]" />
                    Preview PDF
                  </button>
                </td>
              </tr>

              <tr v-if="!contractOptions.length">
                <td colspan="5" class="py-8 text-center text-[12px] text-slate-400">
                  No contract history found from backend.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <TeamLeavePreviewModal
      :open="previewOpen"
      :employee-id="me.employeeId"
      :me="me"
      :contracts="contractOptions"
      :contract-id="contractId"
      @update:contractId="(v) => (contractId = v)"
      @close="closePreview"
    />
  </div>
</template>

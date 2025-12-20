<!-- src/views/expat/admin/AdminLeaveProfileEdit.vue -->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, defineComponent, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminLeaveProfileEdit' })

const route = useRoute()
const router = useRouter()
const { toasts, removeToast, showToast } = useToast()

/* ───────── responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── route param ───────── */
const employeeId = computed(() => String(route.params.employeeId || ''))

/* ───────── leave types (dynamic order) ───────── */
const leaveTypes = ref([])
async function fetchLeaveTypes() {
  try {
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
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

/* ───────── base state ───────── */
const loading = ref(false)
const error = ref('')
const profile = ref(null)

async function fetchProfile() {
  if (!employeeId.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.get(`/admin/leave/profiles/${employeeId.value}`)
    profile.value = res?.data?.profile || null
  } catch (e) {
    console.error(e)
    error.value = e?.response?.data?.message || 'Failed to load profile.'
    showToast({ type: 'error', title: 'Load failed', message: error.value })
  } finally {
    loading.value = false
  }
}

/* ───────── helpers ───────── */
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function fmt(v) {
  const n = num(v)
  return String(Number.isInteger(n) ? n : n.toFixed(1))
}
function fmtYMD(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}
function safeStr(v) {
  return String(v || '').trim()
}

/* ───────── balances normalize ───────── */
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
    if (!map.has(code)) {
      map.set(code, { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
    }
  }

  const arr = Array.from(map.values())
  arr.sort((a, b) => TYPE_ORDER.value.indexOf(a.leaveTypeCode) - TYPE_ORDER.value.indexOf(b.leaveTypeCode))
  return arr
}

const normalizedBalances = computed(() => normalizeBalances(profile.value?.balances || []))

/* ───────── contract history (supports contractHistory or contracts) ───────── */
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

/* ───────── actions ───────── */
function goBack() {
  router.back()
}
function openYearSheet() {
  if (!profile.value?.employeeId) return
  router.push({ name: 'expat-leave-year-sheet', params: { employeeId: profile.value.employeeId } })
}

/* ───────── contracts modal ───────── */
const contractsOpen = ref(false)
function openContractsModal() {
  contractsOpen.value = true
}

/* ───────── renew modal ───────── */
const renew = reactive({
  open: false,
  newContractDate: '',
  clearOldLeave: true, // backend compatibility
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

  if (!employeeId.value) {
    renew.error = 'Missing employeeId.'
    return
  }
  if (!isValidYMD(renew.newContractDate)) {
    renew.error = 'Please choose a valid new contract start date.'
    return
  }

  renew.submitting = true
  try {
    await api.post(`/admin/leave/profiles/${employeeId.value}/contracts/renew`, {
      newContractDate: renew.newContractDate,
      // send both keys (older/newer backend naming safe)
      clearOldLeave: !!renew.clearOldLeave,
      clearUnusedAL: !!renew.clearOldLeave,
      note: renew.note ? String(renew.note).trim() : null,
    })

    showToast({
      type: 'success',
      title: 'Contract renewed',
      message: renew.clearOldLeave
        ? 'Unused AL cleared (debt carried if negative).'
        : 'AL carried forward.',
    })

    renew.open = false
    await fetchProfile()
  } catch (e) {
    console.error(e)
    renew.error = e?.response?.data?.message || 'Failed to renew contract.'
    showToast({ type: 'error', title: 'Renew failed', message: renew.error })
  } finally {
    renew.submitting = false
  }
}

/* ───────── InfoRow (NO template warning) ───────── */
const InfoRow = defineComponent({
  name: 'InfoRow',
  props: {
    label: { type: String, default: '' },
    value: { type: String, default: '' },
    hint: { type: String, default: '' },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          class:
            'rounded-xl border border-slate-200 bg-white px-3 py-2 ' +
            'dark:border-slate-700 dark:bg-slate-950/40',
        },
        [
          h(
            'div',
            {
              class:
                'text-[10px] uppercase tracking-[0.28em] font-semibold text-slate-500 dark:text-slate-400',
            },
            props.label
          ),
          h(
            'div',
            {
              class: 'mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-50',
            },
            props.value
          ),
          props.hint
            ? h(
                'div',
                {
                  class: 'mt-1 text-[11px] text-slate-500 dark:text-slate-400',
                },
                props.hint
              )
            : null,
        ]
      )
  },
})

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchLeaveTypes()
  await fetchProfile()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Gradient Header -->
      <div class="rounded-t-2xl bg-gradient-to-r from-indigo-600 via-violet-500 to-sky-500 px-4 py-3 text-white">
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-indigo-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Admin · Leave Profile</p>
            <p class="text-[11px] text-indigo-50/90">
              Manage contract & balances. Contract history is tracked per contract period.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
              @click="goBack"
            >
              <i class="fa-solid fa-arrow-left text-[11px]" />
              Back
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm hover:bg-slate-50
                     disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="loading || !profile"
              @click="openRenewModal"
            >
              <i class="fa-solid fa-arrows-rotate text-[11px]" />
              Renew
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15
                     disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="loading || !profile"
              @click="openYearSheet"
            >
              <i class="fa-regular fa-file-lines text-[11px]" />
              Sheet
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15
                     disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="loading"
              @click="fetchProfile()"
            >
              <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3 space-y-4">
        <div
          v-if="error"
          class="rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ error }}
        </div>

        <div v-if="loading" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
          <div class="h-28 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
          <div class="h-28 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
        </div>

        <template v-else>
          <div v-if="!profile" class="py-8 text-center text-[12px] text-slate-500 dark:text-slate-400">
            Profile not loaded.
          </div>

          <template v-else>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <!-- Profile card -->
              <section class="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Profile</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      Employee details + contract pointers (renew to change contract start)
                    </div>
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    ID <span class="font-mono">{{ profile.employeeId || '—' }}</span>
                  </div>
                </div>

                <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <InfoRow label="Employee ID" :value="profile.employeeId || '—'" />
                  <InfoRow label="Name" :value="profile.name || '—'" />
                  <InfoRow label="Department" :value="profile.department || '—'" />
                  <InfoRow label="Join Date" :value="fmtYMD(profile.joinDate)" />

                  <InfoRow
                    label="Current Contract Start"
                    :value="fmtYMD(profile.contractDate)"
                    hint="To change this, use Renew."
                  />

                  <InfoRow label="AL Carry (debt allowed)" :value="fmt(profile.alCarry ?? 0)" />
                  <InfoRow label="Manager" :value="String(profile.managerEmployeeId || profile.managerLoginId || '—')" />
                  <InfoRow label="GM" :value="String(profile.gmLoginId || '—')" />
                  <InfoRow label="Active" :value="profile.isActive === false ? 'No' : 'Yes'" />
                </div>
              </section>

              <!-- Balances card -->
              <section class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Balances</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      As of <span class="font-mono">{{ profile.balancesAsOf || '—' }}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-full border border-indigo-500 px-3 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50
                           dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                    @click="openContractsModal"
                  >
                    <i class="fa-regular fa-folder-open text-[11px]" />
                    Logs
                  </button>
                </div>

                <div v-if="normalizedBalances.length" class="mt-3 space-y-2">
                  <div
                    v-for="b in normalizedBalances"
                    :key="b.leaveTypeCode"
                    class="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div class="flex items-center justify-between">
                      <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                        {{ b.leaveTypeCode }}
                      </div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        Ent {{ fmt(b.yearlyEntitlement) }}
                      </div>
                    </div>

                    <div class="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                      <div class="text-slate-600 dark:text-slate-300">
                        Used:
                        <span class="font-semibold text-slate-900 dark:text-slate-50">{{ fmt(b.used) }}</span>
                      </div>
                      <div class="text-slate-600 dark:text-slate-300 text-right">
                        Remain:
                        <span class="font-semibold text-slate-900 dark:text-slate-50">{{ fmt(b.remaining) }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="mt-3 text-[12px] text-slate-500 dark:text-slate-400">
                  No balances yet.
                </div>
              </section>
            </div>

            <!-- Contract History (quick view) -->
            <section class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                <div>
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Contract History</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Quick view (newest first). Full table in Logs modal.
                  </div>
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ contractHistory.length }} log(s)
                </div>
              </div>

              <div v-if="!contractHistory.length" class="mt-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
                No contract history.
              </div>

              <!-- Desktop table -->
              <div v-else-if="!isMobile" class="mt-3 overflow-x-auto">
                <table class="min-w-full border-collapse text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
                  <thead
                    class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                           dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
                  >
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
                      v-for="(c, idx) in contractHistory"
                      :key="c._id || c.createdAt || idx"
                      class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/80 dark:hover:bg-slate-900/70"
                    >
                      <td class="table-td font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                      <td class="table-td font-mono">{{ c.startDate || '—' }}</td>
                      <td class="table-td font-mono">{{ c.endDate || '—' }}</td>
                      <td class="table-td text-right font-mono">{{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                      <td class="table-td">
                        <div class="text-[11px] text-slate-600 dark:text-slate-300">
                          <div v-if="Array.isArray(c.balancesSnapshot)">
                            <span
                              v-for="b in c.balancesSnapshot"
                              :key="String(b.leaveTypeCode) + String(c.createdAt)"
                              class="mr-2 mb-1 inline-flex rounded-full border border-slate-300 px-2 py-0.5 text-[10px]
                                     dark:border-slate-600"
                            >
                              {{ String(b.leaveTypeCode).toUpperCase() }}:
                              U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
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

              <!-- Mobile cards -->
              <div v-else class="mt-3 space-y-2">
                <article
                  v-for="(c, idx) in contractHistory"
                  :key="c._id || c.createdAt || idx"
                  class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                        Contract #{{ c.contractNo ?? (idx + 1) }}
                      </div>
                      <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {{ c.startDate || '—' }} → {{ c.endDate || '—' }}
                      </div>
                    </div>
                    <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                      <div class="font-mono">{{ c.createdAt ? dayjs(c.createdAt).format('YYYY-MM-DD') : '—' }}</div>
                      <div class="font-mono">{{ c.createdBy || '—' }}</div>
                    </div>
                  </div>

                  <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                    AL Carry:
                    <span class="font-mono font-semibold text-slate-900 dark:text-slate-50">
                      {{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}
                    </span>
                  </div>

                  <div class="mt-2 flex flex-wrap gap-2">
                    <span
                      v-for="b in (c.balancesSnapshot || [])"
                      :key="String(b.leaveTypeCode) + String(c.createdAt)"
                      class="inline-flex rounded-full border border-slate-300 px-2 py-0.5 text-[10px]
                             dark:border-slate-600"
                    >
                      {{ String(b.leaveTypeCode).toUpperCase() }}:
                      U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                    </span>

                    <span v-if="!Array.isArray(c.balancesSnapshot)" class="text-[11px] text-slate-500 dark:text-slate-400">
                      No snapshot
                    </span>
                  </div>

                  <div v-if="c.note" class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                    Note: <span class="font-semibold">{{ c.note }}</span>
                  </div>
                </article>
              </div>
            </section>
          </template>
        </template>
      </div>
    </div>

    <!-- Renew Contract Modal -->
    <transition name="modal-fade">
      <div v-if="renew.open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Renew Contract</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ profile?.employeeId }} · {{ profile?.name || '—' }}
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                :disabled="renew.submitting"
                @click="closeRenewModal"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  New Contract Start Date
                </label>
                <input
                  v-model="renew.newContractDate"
                  type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px]
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Clear unused AL?
                </label>

                <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                        {{ renew.clearOldLeave ? 'Yes (clear AL to 0)' : 'No (carry AL forward)' }}
                      </div>
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        If ON: positive AL remaining is cleared, but negative debt is kept (carry).
                        If OFF: remaining AL (positive/negative) is carried forward.
                      </div>
                    </div>

                    <button
                      type="button"
                      class="inline-flex items-center rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700
                             dark:border-slate-600 dark:text-slate-200"
                      @click="renew.clearOldLeave = !renew.clearOldLeave"
                    >
                      <i class="fa-solid" :class="renew.clearOldLeave ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-1">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Note (optional)</label>
              <textarea
                v-model="renew.note"
                rows="3"
                class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[12px]
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Example: renewed contract for 3 months"
              />
            </div>

            <div
              v-if="renew.error"
              class="rounded-xl border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                     dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
            >
              {{ renew.error }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-60"
              :disabled="renew.submitting"
              @click="closeRenewModal"
            >
              Cancel
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm
                     hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="renew.submitting"
              @click="submitRenew"
            >
              <i class="fa-solid" :class="renew.submitting ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'" />
              <span>{{ renew.submitting ? 'Saving...' : 'Renew' }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Contract Logs Modal (table) -->
    <transition name="modal-fade">
      <div v-if="contractsOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-2">
        <div
          class="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl
                 dark:border-slate-700 dark:bg-slate-950"
        >
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Contract Logs</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ profile?.employeeId }} · {{ profile?.name || '—' }}
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
            <p v-if="!contractHistory.length" class="text-[12px] text-slate-500 dark:text-slate-400">
              No contract logs yet.
            </p>

            <div v-else class="overflow-x-auto">
              <table class="min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
                <thead
                  class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                        dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
                >
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
                    v-for="(c, idx) in contractHistory"
                    :key="c._id || c.createdAt || idx"
                    class="border-b border-slate-200 dark:border-slate-700"
                  >
                    <td class="table-td font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                    <td class="table-td font-mono">{{ c.startDate || '—' }}</td>
                    <td class="table-td font-mono">{{ c.endDate || '—' }}</td>
                    <td class="table-td text-right font-mono">{{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                    <td class="table-td">
                      <div class="text-[11px] text-slate-600 dark:text-slate-300">
                        <div v-if="Array.isArray(c.balancesSnapshot)">
                          <span
                            v-for="b in c.balancesSnapshot"
                            :key="String(b.leaveTypeCode) + String(c.createdAt)"
                            class="mr-2 inline-flex rounded-full border border-slate-300 px-2 py-0.5 text-[10px] dark:border-slate-600"
                          >
                            {{ String(b.leaveTypeCode).toUpperCase() }}:
                            U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
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

          <div
            class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5
                   dark:border-slate-700 dark:bg-slate-900/80"
          >
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800"
              @click="contractsOpen = false"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Toasts -->
    <div class="fixed bottom-3 right-3 z-[60] space-y-2">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-lg max-w-sm"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold">{{ t.title }}</p>
            <p class="text-xs text-slate-600 dark:text-slate-300 mt-1">{{ t.message }}</p>
          </div>
          <button class="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white" @click="removeToast(t.id)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-th { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 800; white-space: nowrap; }
.table-td { padding: 8px 10px; vertical-align: top; }

/* Modal transition */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.18s ease-out, transform 0.18s ease-out; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; transform: translateY(6px) scale(0.98); }
</style>

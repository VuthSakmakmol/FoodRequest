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

/* ───────── computed ───────── */
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

function compactBalances(balances) {
  const arr = Array.isArray(balances) ? balances : []
  const order = ['AL', 'SP', 'MC', 'MA', 'UL']
  const m = new Map(arr.map((x) => [String(x.leaveTypeCode || '').toUpperCase(), x]))
  const out = []
  for (const k of order) {
    const b = m.get(k)
    if (!b) continue
    out.push({ k, v: Number.isFinite(Number(b.remaining)) ? Number(b.remaining) : 0 })
  }
  return out
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
    showToast({ type: 'error', title: 'Failed', message: error.value })
  } finally {
    loading.value = false
  }
}

watch(includeInactive, () => fetchGroups())

/* ───────── create modal ───────── */
const createOpen = ref(false)
const createTab = ref('bulk') // bulk | single
const createError = ref('')
const saving = ref(false)

function newRow() {
  return {
    key: Math.random().toString(16).slice(2),
    employee: null, // EmployeeSearch returns { employeeId, name, department }
    joinDate: '',
    contractDate: '',
    alCarry: 0,
    isActive: true,
  }
}

const form = ref({
  approvalMode: 'GM_ONLY',
  manager: null, // optional EmployeeSearch result
  rows: [newRow()],

  singleEmployee: null,
  singleJoinDate: '',
  singleContractDate: '',
  singleAlCarry: 0,
  singleActive: true,
})

function openCreate() {
  createError.value = ''
  createTab.value = 'bulk'
  form.value = {
    approvalMode: 'GM_ONLY',
    manager: null,
    rows: [newRow()],
    singleEmployee: null,
    singleJoinDate: '',
    singleContractDate: '',
    singleAlCarry: 0,
    singleActive: true,
  }
  createOpen.value = true
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

async function submitCreate() {
  createError.value = ''
  try {
    saving.value = true

    if (createTab.value === 'bulk') {
      const rows = form.value.rows || []
      if (!rows.length) throw new Error('Please add at least 1 employee.')

      const employees = rows.map((r, i) => {
        const employeeId = String(r.employee?.employeeId || '').trim()
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

      const payload = {
        approvalMode: form.value.approvalMode,
        managerEmployeeId: String(form.value.manager?.employeeId || '').trim(),
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

    // single
    const employeeId = String(form.value.singleEmployee?.employeeId || '').trim()
    if (!employeeId) throw new Error('Employee is required.')
    if (!mustYmd(form.value.singleJoinDate)) throw new Error('Join date must be YYYY-MM-DD.')

    const contractDate = form.value.singleContractDate || form.value.singleJoinDate
    if (!mustYmd(contractDate)) throw new Error('Contract date must be YYYY-MM-DD.')

    const payload = {
      approvalMode: form.value.approvalMode,
      employeeId,
      joinDate: form.value.singleJoinDate,
      contractDate,
      alCarry: Number(form.value.singleAlCarry || 0),
      isActive: form.value.singleActive !== false,
      managerEmployeeId: String(form.value.manager?.employeeId || '').trim(),
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

/* ───────── lifecycle ───────── */
onMounted(() => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
  fetchGroups()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <div class="w-full">
    <div
      class="rounded-3xl border border-slate-200/70 bg-white/70 shadow-[0_18px_45px_rgba(15,23,42,0.10)]
             backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/55 overflow-hidden"
    >
      <!-- ✅ Gradient header (natural + modern) -->
      <header class="relative overflow-hidden px-4 py-4 sm:px-5">
        <div
          class="absolute inset-0"
          style="background: linear-gradient(90deg, rgba(2,132,199,1), rgba(79,70,229,1), rgba(16,185,129,1));"
        />
        <div
          class="absolute inset-0 opacity-60"
          style="background:
            radial-gradient(900px circle at 10% 0%, rgba(255,255,255,.22), transparent 45%),
            radial-gradient(900px circle at 100% 20%, rgba(255,255,255,.18), transparent 45%);"
        />
        <div class="relative flex flex-wrap items-start justify-between gap-3 text-white">
          <div class="min-w-0">
            <p class="text-[10px] font-extrabold uppercase tracking-[0.25em] text-white/80">
              Expat leave · Admin
            </p>
            <h1 class="mt-0.5 text-[16px] sm:text-[18px] font-extrabold tracking-tight truncate">
              Expat Profiles
            </h1>
            <p class="mt-1 text-[12px] text-white/85">
              Profiles grouped by manager. Approval chain is enforced by backend rules.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2
                     text-[12px] font-extrabold text-white transition hover:bg-white/15
                     disabled:cursor-not-allowed disabled:opacity-60"
              @click="fetchGroups"
              :disabled="loading"
              title="Refresh"
            >
              <i class="fa-solid fa-rotate-right text-[12px]" :class="loading ? 'fa-spin' : ''"></i>
              Refresh
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px]
                     font-extrabold text-slate-900 shadow hover:bg-white/95 transition"
              @click="openCreate()"
            >
              <i class="fa-solid fa-plus text-[12px]"></i>
              New profile
            </button>
          </div>
        </div>
      </header>

      <!-- ✅ Filter bar -->
      <div class="px-3 sm:px-4 pt-4">
        <div
          class="rounded-3xl border border-slate-200/70 bg-white/75 p-3 sm:p-4
                 dark:border-slate-800/70 dark:bg-slate-950/55"
        >
          <div class="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
            <div class="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="sm:col-span-2">
                <label class="mb-1 block text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
                  Search
                </label>
                <div
                  class="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2
                         focus-within:ring-2 focus-within:ring-emerald-500/30
                         dark:border-slate-800 dark:bg-slate-900/60"
                >
                  <i class="fa-solid fa-magnifying-glass text-[12px] text-slate-400"></i>
                  <input
                    v-model="q"
                    type="text"
                    placeholder="Search employeeId, name, department…"
                    class="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400
                           text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div class="flex items-center">
                <label class="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200 select-none">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                    v-model="includeInactive"
                  />
                  Include inactive
                </label>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="rounded-full bg-sky-50 px-3 py-1 text-[12px] font-extrabold text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                {{ filteredCount }} employees
              </span>
              <span class="rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-extrabold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                {{ groups.length }} managers
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-3 sm:px-4 py-4 space-y-3">
        <!-- Error -->
        <div
          v-if="error"
          class="rounded-3xl border border-rose-400/60 bg-rose-50 px-4 py-3 text-[13px] text-rose-800
                 dark:border-rose-500/60 dark:bg-rose-950/35 dark:text-rose-100"
        >
          <div class="font-extrabold mb-1">Failed</div>
          <div class="opacity-95">{{ error }}</div>
        </div>

        <!-- Loading -->
        <div
          v-if="loading"
          class="rounded-3xl border border-slate-200/70 bg-white/75 px-4 py-4 text-[13px] text-slate-600
                 dark:border-slate-800/70 dark:bg-slate-950/55 dark:text-slate-300"
        >
          <div class="h-4 w-44 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800/60"></div>
          <div class="mt-2 h-10 w-full animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50"></div>
        </div>

        <!-- Empty -->
        <div
          v-if="!loading && !error && filteredManagers.length === 0"
          class="rounded-3xl border border-slate-200/70 bg-white/75 p-8 text-center
                 dark:border-slate-800/70 dark:bg-slate-950/55"
        >
          <div class="text-slate-900 dark:text-slate-50 font-extrabold">No profiles found</div>
          <div class="text-slate-500 dark:text-slate-400 text-[13px] mt-1">
            Try changing search or include inactive.
          </div>
        </div>

        <!-- Desktop -->
        <div v-if="!isMobile && filteredManagers.length" class="space-y-4">
          <section
            v-for="(g, idx) in filteredManagers"
            :key="idx"
            class="rounded-3xl border border-slate-200/70 bg-white/75 overflow-hidden
                   dark:border-slate-800/70 dark:bg-slate-950/55"
          >
            <!-- Manager header -->
            <div class="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50 truncate">
                  <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 mr-2">
                    Manager
                  </span>
                  <span>{{ g.manager.name || '—' }}</span>
                  <span class="text-slate-500 dark:text-slate-400 font-semibold ml-2">
                    ({{ g.manager.employeeId }})
                  </span>
                </div>
                <div class="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                  {{ g.manager.department || '—' }}
                </div>
              </div>

              <div class="text-[12px] font-extrabold text-slate-600 dark:text-slate-300">
                {{ g.employees.length }} employees
              </div>
            </div>

            <!-- Table -->
            <div class="overflow-x-auto">
              <table class="min-w-full text-[13px]">
                <thead class="text-[11px] uppercase tracking-wide">
                  <tr class="bg-gradient-to-r from-sky-600 via-indigo-600 to-emerald-600 text-white">
                    <th class="px-4 py-3 text-left font-extrabold">Employee</th>
                    <th class="px-4 py-3 text-left font-extrabold">Department</th>
                    <th class="px-4 py-3 text-left font-extrabold">Join</th>
                    <th class="px-4 py-3 text-left font-extrabold">Contract</th>
                    <th class="px-4 py-3 text-left font-extrabold">Mode</th>
                    <th class="px-4 py-3 text-left font-extrabold">Balances</th>
                    <th class="px-4 py-3 text-right font-extrabold">Status</th>
                    <th class="px-4 py-3 text-right font-extrabold">Actions</th>
                  </tr>
                </thead>

                <!-- ✅ Row split + zebra -->
                <tbody class="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                  <tr
                    v-for="(e, rIdx) in g.employees"
                    :key="e.employeeId"
                    class="transition cursor-pointer"
                    :class="[
                      rIdx % 2 === 0 ? 'bg-white/70 dark:bg-slate-950/25' : 'bg-sky-50/50 dark:bg-slate-900/35',
                      'hover:bg-emerald-50/70 dark:hover:bg-emerald-900/20'
                    ]"
                    @click="goProfile(e.employeeId)"
                  >
                    <td class="px-4 py-3">
                      <div class="font-extrabold text-slate-900 dark:text-slate-50">
                        {{ e.employeeId }} · {{ e.name || '—' }}
                      </div>
                      <div class="text-[12px] text-slate-500 dark:text-slate-400">
                        Manager: {{ e.managerLoginId || '—' }}
                      </div>
                    </td>

                    <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {{ e.department || '—' }}
                    </td>

                    <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {{ e.joinDate || '—' }}
                    </td>

                    <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                      <div class="font-semibold">{{ e.contractDate || '—' }}</div>
                      <div class="text-[12px] text-slate-500 dark:text-slate-400">
                        end: {{ e.contractEndDate || '—' }}
                      </div>
                    </td>

                    <td class="px-4 py-3">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold border"
                        :class="e.approvalMode === 'GM_AND_COO'
                          ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/25 dark:text-amber-200 dark:border-amber-700/40'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-700/40'"
                      >
                        {{ e.approvalMode === 'GM_AND_COO' ? 'GM + COO' : 'GM only' }}
                      </span>
                    </td>

                    <td class="px-4 py-3">
                      <div class="flex flex-wrap gap-2">
                        <span
                          v-for="b in compactBalances(e.balances)"
                          :key="b.k"
                          class="rounded-full px-2 py-1 text-[11px] font-extrabold
                                 border border-slate-200 bg-white text-slate-700
                                 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200"
                        >
                          {{ b.k }}: {{ b.v }}
                        </span>
                        <span v-if="!e.balances?.length" class="text-[12px] text-slate-500 dark:text-slate-400">—</span>
                      </div>
                    </td>

                    <td class="px-4 py-3 text-right">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold border"
                        :class="e.isActive
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-700/40'
                          : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-900/25 dark:text-rose-200 dark:border-rose-700/40'"
                      >
                        {{ e.isActive ? 'Active' : 'Inactive' }}
                      </span>
                    </td>

                    <!-- Actions -->
                    <td class="px-4 py-3 text-right" @click.stop>
                      <div class="inline-flex items-center gap-2">
                        <button
                          type="button"
                          class="rounded-full px-3 py-1.5 text-[12px] font-extrabold
                                 border border-slate-200 bg-white hover:bg-slate-50 transition
                                 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-900"
                          @click="goProfile(e.employeeId)"
                          title="Open profile"
                        >
                          <i class="fa-regular fa-folder-open mr-2"></i>
                          Open
                        </button>

                        <button
                          type="button"
                          class="rounded-full px-3 py-1.5 text-[12px] font-extrabold text-white
                                 bg-emerald-600 hover:bg-emerald-500 transition"
                          @click="goEdit(e.employeeId)"
                          title="Edit profile"
                        >
                          <i class="fa-solid fa-pen-to-square mr-2"></i>
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

        <!-- Mobile -->
        <div v-else-if="isMobile && filteredManagers.length" class="space-y-4">
          <section
            v-for="(g, idx) in filteredManagers"
            :key="idx"
            class="rounded-3xl border border-slate-200/70 bg-white/75 overflow-hidden
                   dark:border-slate-800/70 dark:bg-slate-950/55"
          >
            <div class="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70">
              <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">
                <span class="mr-2 text-emerald-700 dark:text-emerald-200">Manager</span>
                {{ g.manager.name || '—' }}
                <span class="text-slate-500 dark:text-slate-400 font-semibold">({{ g.manager.employeeId }})</span>
              </div>
              <div class="text-[12px] text-slate-500 dark:text-slate-400">{{ g.manager.department || '—' }}</div>
            </div>

            <div class="p-4 space-y-3">
              <article
                v-for="e in g.employees"
                :key="e.employeeId"
                class="rounded-3xl border border-slate-200/70 bg-white/70 p-3
                       dark:border-slate-800/70 dark:bg-slate-900/35"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      {{ e.employeeId }} · {{ e.name || '—' }}
                    </div>
                    <div class="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                      {{ e.department || '—' }}
                    </div>
                  </div>

                  <span
                    class="shrink-0 inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold border"
                    :class="e.isActive
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-700/40'
                      : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-900/25 dark:text-rose-200 dark:border-rose-700/40'"
                  >
                    {{ e.isActive ? 'Active' : 'Inactive' }}
                  </span>
                </div>

                <div class="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  <div class="rounded-2xl border border-slate-200/70 bg-white/70 p-2 dark:border-slate-800/70 dark:bg-slate-950/40">
                    <div class="text-slate-500 dark:text-slate-400">Join</div>
                    <div class="font-extrabold text-slate-900 dark:text-slate-50">{{ e.joinDate || '—' }}</div>
                  </div>
                  <div class="rounded-2xl border border-slate-200/70 bg-white/70 p-2 dark:border-slate-800/70 dark:bg-slate-950/40">
                    <div class="text-slate-500 dark:text-slate-400">Contract</div>
                    <div class="font-extrabold text-slate-900 dark:text-slate-50">{{ e.contractDate || '—' }}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">end: {{ e.contractEndDate || '—' }}</div>
                  </div>
                </div>

                <div class="mt-2 flex items-center justify-between gap-2">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold border"
                    :class="e.approvalMode === 'GM_AND_COO'
                      ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/25 dark:text-amber-200 dark:border-amber-700/40'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-700/40'"
                  >
                    {{ e.approvalMode === 'GM_AND_COO' ? 'GM + COO' : 'GM only' }}
                  </span>

                  <div class="flex flex-wrap justify-end gap-2">
                    <span
                      v-for="b in compactBalances(e.balances)"
                      :key="b.k"
                      class="rounded-full px-2 py-1 text-[11px] font-extrabold
                             border border-slate-200 bg-white text-slate-700
                             dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                    >
                      {{ b.k }}: {{ b.v }}
                    </span>
                    <span v-if="!e.balances?.length" class="text-[11px] text-slate-500 dark:text-slate-400">—</span>
                  </div>
                </div>

                <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Manager: {{ e.managerLoginId || '—' }}
                </div>

                <!-- Actions -->
                <div class="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-full px-4 py-2 text-[12px] font-extrabold
                           border border-slate-200 bg-white hover:bg-slate-50 transition
                           dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-900"
                    @click="goProfile(e.employeeId)"
                  >
                    <i class="fa-regular fa-folder-open mr-2"></i>
                    Open
                  </button>

                  <button
                    type="button"
                    class="rounded-full px-4 py-2 text-[12px] font-extrabold text-white
                           bg-emerald-600 hover:bg-emerald-500 transition"
                    @click="goEdit(e.employeeId)"
                  >
                    <i class="fa-solid fa-pen-to-square mr-2"></i>
                    Edit
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ✅ Create modal (your style) -->
    <transition name="fade">
      <div
        v-if="createOpen"
        class="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
        @click.self="closeCreate()"
      >
        <div class="mx-auto max-w-3xl px-3 sm:px-4 lg:px-6 py-6">
          <div class="rounded-3xl border border-slate-200/30 bg-white/90 shadow-2xl overflow-hidden
                      dark:border-slate-800/50 dark:bg-slate-950/92">
            <!-- modal header -->
            <div class="relative overflow-hidden px-4 sm:px-5 py-4">
              <div
                class="absolute inset-0"
                style="background: linear-gradient(90deg, rgba(2,132,199,1), rgba(79,70,229,1), rgba(16,185,129,1));"
              />
              <div
                class="absolute inset-0 opacity-60"
                style="background: radial-gradient(900px circle at 10% 0%, rgba(255,255,255,.22), transparent 45%);"
              />
              <div class="relative flex items-start justify-between gap-3 text-white">
                <div>
                  <div class="text-[15px] font-extrabold">New leave profile</div>
                  <div class="text-[12px] text-white/85 mt-1">
                    UI selects <span class="font-extrabold">mode</span> only. Backend enforces approval chain.
                  </div>
                </div>
                <button
                  class="h-10 w-10 rounded-2xl border border-white/25 bg-white/10 hover:bg-white/15 transition"
                  @click="closeCreate()"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            <div class="p-4 sm:p-5 space-y-4">
              <!-- tabs -->
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="px-4 py-2 rounded-2xl text-[13px] font-extrabold border transition"
                  :class="createTab==='bulk'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900/60 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900'"
                  @click="createTab='bulk'"
                >
                  Manager + multiple employees
                </button>

                <button
                  class="px-4 py-2 rounded-2xl text-[13px] font-extrabold border transition"
                  :class="createTab==='single'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900/60 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900'"
                  @click="createTab='single'"
                >
                  Single employee
                </button>
              </div>

              <!-- mode select -->
              <div>
                <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Approval mode</label>
                <select
                  v-model="form.approvalMode"
                  class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                         focus:ring-2 focus:ring-emerald-500/30
                         dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                >
                  <option value="GM_ONLY">Only GM (COO read-only)</option>
                  <option value="GM_AND_COO">GM + COO (both must approve)</option>
                </select>
              </div>

              <!-- manager optional -->
              <div>
                <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                  Direct manager (optional)
                </label>
                <EmployeeSearch v-model="form.manager" placeholder="Search manager…" />
                <p class="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  If empty, request goes directly to GM/COO chain.
                </p>
              </div>

              <!-- bulk -->
              <div v-if="createTab==='bulk'" class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">Employees</div>
                    <div class="text-[12px] text-slate-500 dark:text-slate-400">
                      Join date auto sets first contract date.
                    </div>
                  </div>
                  <button
                    class="rounded-full px-4 py-2 text-[12px] font-extrabold
                           border border-slate-200 bg-white hover:bg-slate-50 transition
                           dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-900"
                    @click="addRow()"
                  >
                    <i class="fa-solid fa-plus mr-2"></i>
                    Add row
                  </button>
                </div>

                <div
                  v-for="(r, i) in form.rows"
                  :key="r.key"
                  class="rounded-3xl border border-slate-200/70 bg-white/75 p-4
                         dark:border-slate-800/70 dark:bg-slate-950/55"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="font-extrabold text-[13px] text-slate-900 dark:text-slate-50">
                      Employee #{{ i + 1 }}
                    </div>
                    <button
                      class="h-10 w-10 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition
                             disabled:opacity-40 disabled:cursor-not-allowed
                             dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900"
                      @click="removeRow(i)"
                      :disabled="form.rows.length===1"
                      title="Remove"
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>

                  <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="sm:col-span-2">
                      <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Employee *</label>
                      <EmployeeSearch v-model="r.employee" placeholder="Search employee…" />
                    </div>

                    <div class="flex items-center">
                      <label class="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200 select-none">
                        <input
                          type="checkbox"
                          class="h-4 w-4 rounded border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                          v-model="r.isActive"
                        />
                        Active
                      </label>
                    </div>

                    <div>
                      <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Join date *</label>
                      <input
                        type="date"
                        v-model="r.joinDate"
                        class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                               focus:ring-2 focus:ring-emerald-500/30
                               dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                        @change="syncContractFromJoin(r)"
                      />
                    </div>

                    <div>
                      <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Contract date</label>
                      <input
                        type="date"
                        v-model="r.contractDate"
                        class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                               focus:ring-2 focus:ring-emerald-500/30
                               dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">AL carry</label>
                      <input
                        type="number"
                        v-model.number="r.alCarry"
                        class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                               focus:ring-2 focus:ring-emerald-500/30
                               dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- single -->
              <div v-else class="rounded-3xl border border-slate-200/70 bg-white/75 p-4 dark:border-slate-800/70 dark:bg-slate-950/55">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div class="sm:col-span-2">
                    <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Employee *</label>
                    <EmployeeSearch v-model="form.singleEmployee" placeholder="Search employee…" />
                  </div>

                  <div class="flex items-center">
                    <label class="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200 select-none">
                      <input
                        type="checkbox"
                        class="h-4 w-4 rounded border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                        v-model="form.singleActive"
                      />
                      Active
                    </label>
                  </div>

                  <div>
                    <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Join date *</label>
                    <input
                      type="date"
                      v-model="form.singleJoinDate"
                      class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                             focus:ring-2 focus:ring-emerald-500/30
                             dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                      @change="syncSingleContract()"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">Contract date</label>
                    <input
                      type="date"
                      v-model="form.singleContractDate"
                      class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                             focus:ring-2 focus:ring-emerald-500/30
                             dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-extrabold text-slate-700 dark:text-slate-200 mb-1">AL carry</label>
                    <input
                      type="number"
                      v-model.number="form.singleAlCarry"
                      class="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold outline-none
                             focus:ring-2 focus:ring-emerald-500/30
                             dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              <!-- modal error -->
              <div
                v-if="createError"
                class="rounded-3xl border border-rose-400/60 bg-rose-50 px-4 py-3 text-[13px] text-rose-800
                       dark:border-rose-500/60 dark:bg-rose-950/35 dark:text-rose-100"
              >
                <div class="font-extrabold mb-1">Failed</div>
                <div>{{ createError }}</div>
              </div>

              <div class="flex items-center justify-end gap-2 pt-2">
                <button
                  class="rounded-full px-5 py-2 text-[12px] font-extrabold
                         border border-slate-200 bg-white hover:bg-slate-50 transition
                         dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-900
                         disabled:opacity-50"
                  @click="closeCreate()"
                  :disabled="saving"
                >
                  Cancel
                </button>

                <button
                  class="rounded-full px-5 py-2 text-[12px] font-extrabold text-white
                         bg-emerald-600 hover:bg-emerald-500 transition disabled:opacity-50"
                  @click="submitCreate()"
                  :disabled="saving"
                >
                  <i class="fa-solid fa-check mr-2"></i>
                  {{ saving ? 'Creating…' : 'Create' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

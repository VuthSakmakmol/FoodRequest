<!-- src/views/expat/admin/AdminExpatProfile.vue -->
<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <!-- Header -->
    <header class="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur">
      <div class="mx-auto max-w-7xl px-3 sm:px-4 lg:px-6 py-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[10px] uppercase tracking-[0.35em] font-semibold text-emerald-300/90">
              Expat leave · Admin
            </p>
            <h1 class="text-lg sm:text-xl font-semibold">
              Expat Leave Admin Portal
            </h1>
            <p class="text-xs sm:text-sm text-slate-300 mt-1">
              Profiles grouped by manager. Approval chain is enforced in backend.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              class="rounded-xl px-3 py-2 text-sm font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition"
              @click="fetchGroups"
              :disabled="loading"
              title="Refresh"
            >
              <i class="fa-solid fa-rotate-right mr-2"></i>
              Refresh
            </button>
            <button
              class="rounded-xl px-3 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition"
              @click="openCreate()"
            >
              <i class="fa-solid fa-plus mr-2"></i>
              New profile
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Content -->
    <main class="mx-auto max-w-7xl px-3 sm:px-4 lg:px-6 py-5 sm:py-7 space-y-4">
      <!-- Filter bar -->
      <div class="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
        <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div class="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label class="block text-[11px] uppercase tracking-wider text-slate-300 mb-1">Search</label>
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input
                  v-model="q"
                  type="text"
                  placeholder="Search employeeId, name, department…"
                  class="w-full rounded-xl bg-slate-900/60 border border-white/10 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>

            <div class="flex items-end">
              <label class="flex items-center gap-2 text-sm text-slate-200 select-none">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-white/20 bg-slate-900/60"
                  v-model="includeInactive"
                />
                Include inactive
              </label>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-300">
              {{ filteredCount }} employees
            </span>
            <span class="text-xs text-slate-500">·</span>
            <span class="text-xs text-slate-300">
              {{ groups.length }} managers
            </span>
          </div>
        </div>
      </div>

      <!-- Error / Loading -->
      <div v-if="error" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm">
        <div class="font-semibold text-rose-200 mb-1">Failed</div>
        <div class="text-rose-100/90">{{ error }}</div>
      </div>

      <div v-if="loading" class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
        Loading…
      </div>

      <!-- Empty -->
      <div
        v-if="!loading && !error && filteredManagers.length === 0"
        class="rounded-2xl border border-white/10 bg-white/5 p-8 text-center"
      >
        <div class="text-slate-200 font-semibold">No profiles found</div>
        <div class="text-slate-400 text-sm mt-1">Try changing search or include inactive.</div>
      </div>

      <!-- Desktop table -->
      <div v-if="!isMobile && filteredManagers.length" class="space-y-4">
        <div
          v-for="(g, idx) in filteredManagers"
          :key="idx"
          class="rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
        >
          <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-100 truncate">
                <span class="text-emerald-300/90 mr-2">Manager</span>
                <span>{{ g.manager.name || '—' }}</span>
                <span class="text-slate-400 font-normal ml-2">({{ g.manager.employeeId }})</span>
              </div>
              <div class="text-xs text-slate-400 truncate">
                {{ g.manager.department || '—' }}
              </div>
            </div>

            <div class="text-xs text-slate-300">
              {{ g.employees.length }} employees
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-slate-900/40 text-slate-300 text-xs">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold">Employee</th>
                  <th class="px-4 py-3 text-left font-semibold">Department</th>
                  <th class="px-4 py-3 text-left font-semibold">Join</th>
                  <th class="px-4 py-3 text-left font-semibold">Contract</th>
                  <th class="px-4 py-3 text-left font-semibold">Mode</th>
                  <th class="px-4 py-3 text-left font-semibold">Balances</th>
                  <th class="px-4 py-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="e in g.employees"
                  :key="e.employeeId"
                  class="border-t border-white/10 hover:bg-white/5"
                >
                  <td class="px-4 py-3">
                    <div class="font-semibold text-slate-100">
                      {{ e.employeeId }} · {{ e.name || '—' }}
                    </div>
                    <div class="text-xs text-slate-400">
                      Manager: {{ e.managerLoginId || '—' }}
                    </div>
                  </td>

                  <td class="px-4 py-3 text-slate-200">
                    {{ e.department || '—' }}
                  </td>

                  <td class="px-4 py-3 text-slate-200">
                    {{ e.joinDate || '—' }}
                  </td>

                  <td class="px-4 py-3 text-slate-200">
                    <div>{{ e.contractDate || '—' }}</div>
                    <div class="text-xs text-slate-400">end: {{ e.contractEndDate || '—' }}</div>
                  </td>

                  <td class="px-4 py-3">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold border"
                      :class="e.approvalMode === 'GM_AND_COO'
                        ? 'bg-amber-500/15 text-amber-200 border-amber-400/30'
                        : 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'"
                    >
                      {{ e.approvalMode === 'GM_AND_COO' ? 'GM + COO' : 'GM only' }}
                    </span>
                  </td>

                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-2">
                      <span
                        v-for="b in compactBalances(e.balances)"
                        :key="b.k"
                        class="rounded-full px-2 py-1 text-[11px] border border-white/10 bg-slate-900/40 text-slate-200"
                      >
                        {{ b.k }}: {{ b.v }}
                      </span>
                      <span v-if="!e.balances?.length" class="text-xs text-slate-400">—</span>
                    </div>
                  </td>

                  <td class="px-4 py-3 text-right">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold border"
                      :class="e.isActive
                        ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'
                        : 'bg-rose-500/15 text-rose-200 border-rose-400/30'"
                    >
                      {{ e.isActive ? 'Active' : 'Inactive' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Mobile cards -->
      <div v-else-if="isMobile && filteredManagers.length" class="space-y-4">
        <div
          v-for="(g, idx) in filteredManagers"
          :key="idx"
          class="rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
        >
          <div class="px-4 py-3 border-b border-white/10">
            <div class="text-sm font-semibold">
              <span class="text-emerald-300/90 mr-2">Manager</span>
              {{ g.manager.name || '—' }}
              <span class="text-slate-400 font-normal">({{ g.manager.employeeId }})</span>
            </div>
            <div class="text-xs text-slate-400">{{ g.manager.department || '—' }}</div>
          </div>

          <div class="p-4 space-y-3">
            <div
              v-for="e in g.employees"
              :key="e.employeeId"
              class="rounded-2xl border border-white/10 bg-slate-900/30 p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-semibold text-slate-100 truncate">
                    {{ e.employeeId }} · {{ e.name || '—' }}
                  </div>
                  <div class="text-xs text-slate-400 truncate">{{ e.department || '—' }}</div>
                </div>

                <span
                  class="shrink-0 inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold border"
                  :class="e.isActive
                    ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'
                    : 'bg-rose-500/15 text-rose-200 border-rose-400/30'"
                >
                  {{ e.isActive ? 'Active' : 'Inactive' }}
                </span>
              </div>

              <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div class="rounded-xl border border-white/10 bg-white/5 p-2">
                  <div class="text-slate-400">Join</div>
                  <div class="text-slate-200 font-semibold">{{ e.joinDate || '—' }}</div>
                </div>
                <div class="rounded-xl border border-white/10 bg-white/5 p-2">
                  <div class="text-slate-400">Contract</div>
                  <div class="text-slate-200 font-semibold">{{ e.contractDate || '—' }}</div>
                  <div class="text-[11px] text-slate-400">end: {{ e.contractEndDate || '—' }}</div>
                </div>
              </div>

              <div class="mt-2 flex items-center justify-between gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold border"
                  :class="e.approvalMode === 'GM_AND_COO'
                    ? 'bg-amber-500/15 text-amber-200 border-amber-400/30'
                    : 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'"
                >
                  {{ e.approvalMode === 'GM_AND_COO' ? 'GM + COO' : 'GM only' }}
                </span>

                <div class="flex flex-wrap justify-end gap-2">
                  <span
                    v-for="b in compactBalances(e.balances)"
                    :key="b.k"
                    class="rounded-full px-2 py-1 text-[11px] border border-white/10 bg-slate-900/40 text-slate-200"
                  >
                    {{ b.k }}: {{ b.v }}
                  </span>
                  <span v-if="!e.balances?.length" class="text-[11px] text-slate-400">—</span>
                </div>
              </div>

              <div class="mt-2 text-[11px] text-slate-400">
                Manager: {{ e.managerLoginId || '—' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Create modal -->
    <transition name="fade">
      <div v-if="createOpen" class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" @click.self="closeCreate()">
        <div class="mx-auto max-w-3xl px-3 sm:px-4 lg:px-6 py-6">
          <div class="rounded-3xl border border-white/10 bg-slate-950 shadow-2xl overflow-hidden">
            <div class="px-4 sm:px-5 py-4 border-b border-white/10 flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold">New leave profile</div>
                <div class="text-xs text-slate-400 mt-1">
                  UI selects <span class="font-semibold text-slate-200">mode only</span>. Backend auto-assigns GM/COO based on seed/env.
                </div>
              </div>
              <button class="h-9 w-9 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition" @click="closeCreate()">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div class="p-4 sm:p-5 space-y-4">
              <!-- tabs -->
              <div class="flex items-center gap-2">
                <button
                  class="px-4 py-2 rounded-xl text-sm font-semibold border transition"
                  :class="createTab==='bulk'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'"
                  @click="createTab='bulk'"
                >
                  Manager + multiple employees
                </button>
                <button
                  class="px-4 py-2 rounded-xl text-sm font-semibold border transition"
                  :class="createTab==='single'
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'"
                  @click="createTab='single'"
                >
                  Single employee
                </button>
              </div>

              <!-- mode select -->
              <div>
                <label class="block text-[11px] uppercase tracking-wider text-slate-300 mb-1">Approval mode</label>
                <select
                  v-model="form.approvalMode"
                  class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  <option value="GM_ONLY">Only GM (COO read-only)</option>
                  <option value="GM_AND_COO">GM + COO (both must approve)</option>
                </select>
                <p class="mt-1 text-xs text-slate-400">
                  Backend decides who is GM/COO using <span class="font-semibold">LEAVE_GM_LOGINID</span> and <span class="font-semibold">LEAVE_COO_LOGINID</span>.
                </p>
              </div>

              <!-- manager optional -->
              <div>
                <label class="block text-[11px] uppercase tracking-wider text-slate-300 mb-1">
                  Direct manager (optional)
                </label>
                <EmployeeSearch v-model="form.manager" placeholder="Search manager…" />
                <p class="mt-1 text-xs text-slate-400">
                  If empty, request will go directly to GM/COO chain.
                </p>
              </div>

              <!-- bulk -->
              <div v-if="createTab==='bulk'" class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-sm font-semibold">Employees (add many)</div>
                    <div class="text-xs text-slate-400">Join date will auto set first contract date.</div>
                  </div>
                  <button
                    class="rounded-xl px-3 py-2 text-sm font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition"
                    @click="addRow()"
                  >
                    <i class="fa-solid fa-plus mr-2"></i>
                    Add row
                  </button>
                </div>

                <div v-for="(r, i) in form.rows" :key="r.key" class="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div class="font-semibold text-sm">Employee #{{ i + 1 }}</div>
                    <button
                      class="h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
                      @click="removeRow(i)"
                      :disabled="form.rows.length===1"
                      title="Remove"
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>

                  <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="sm:col-span-2">
                      <label class="block text-xs text-slate-300 mb-1">Employee *</label>
                      <EmployeeSearch v-model="r.employee" placeholder="Search employee…" />
                    </div>

                    <div class="flex items-end gap-2">
                      <label class="flex items-center gap-2 text-sm text-slate-200 select-none">
                        <input type="checkbox" class="h-4 w-4 rounded border-white/20 bg-slate-900/60" v-model="r.isActive" />
                        Active
                      </label>
                    </div>

                    <div>
                      <label class="block text-xs text-slate-300 mb-1">Join date *</label>
                      <input
                        type="date"
                        v-model="r.joinDate"
                        class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                        @change="syncContractFromJoin(r)"
                      />
                      <p class="mt-1 text-[11px] text-slate-400">Required.</p>
                    </div>

                    <div>
                      <label class="block text-xs text-slate-300 mb-1">Contract date</label>
                      <input
                        type="date"
                        v-model="r.contractDate"
                        class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                      <p class="mt-1 text-[11px] text-slate-400">Auto = join date (first contract).</p>
                    </div>

                    <div>
                      <label class="block text-xs text-slate-300 mb-1">AL carry</label>
                      <input
                        type="number"
                        v-model.number="r.alCarry"
                        class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                        placeholder="0"
                      />
                      <p class="mt-1 text-[11px] text-slate-400">Optional (kept for compatibility).</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- single -->
              <div v-else class="space-y-3">
                <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="sm:col-span-2">
                      <label class="block text-xs text-slate-300 mb-1">Employee *</label>
                      <EmployeeSearch v-model="form.singleEmployee" placeholder="Search employee…" />
                    </div>

                    <div class="flex items-end gap-2">
                      <label class="flex items-center gap-2 text-sm text-slate-200 select-none">
                        <input type="checkbox" class="h-4 w-4 rounded border-white/20 bg-slate-900/60" v-model="form.singleActive" />
                        Active
                      </label>
                    </div>

                    <div>
                      <label class="block text-xs text-slate-300 mb-1">Join date *</label>
                      <input
                        type="date"
                        v-model="form.singleJoinDate"
                        class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                        @change="syncSingleContract()"
                      />
                    </div>

                    <div>
                      <label class="block text-xs text-slate-300 mb-1">Contract date</label>
                      <input
                        type="date"
                        v-model="form.singleContractDate"
                        class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                      <p class="mt-1 text-[11px] text-slate-400">Auto = join date (first contract).</p>
                    </div>

                    <div>
                      <label class="block text-xs text-slate-300 mb-1">AL carry</label>
                      <input
                        type="number"
                        v-model.number="form.singleAlCarry"
                        class="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- modal error -->
              <div v-if="createError" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                <div class="font-semibold mb-1">Failed</div>
                <div>{{ createError }}</div>
              </div>

              <div class="flex items-center justify-end gap-2 pt-2">
                <button
                  class="rounded-xl px-4 py-2 text-sm font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition"
                  @click="closeCreate()"
                  :disabled="saving"
                >
                  Cancel
                </button>
                <button
                  class="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition disabled:opacity-50"
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

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import EmployeeSearch from '../expat/admin/components/EmployeeSearch.vue'

const { showToast } = useToast()

/* responsive */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* main state */
const loading = ref(false)
const error = ref('')
const includeInactive = ref(false)
const q = ref('')
const groups = ref([])

const filteredManagers = computed(() => {
  const term = String(q.value || '').trim().toLowerCase()
  const base = Array.isArray(groups.value) ? groups.value : []

  const filtered = base
    .map(g => {
      const emps = (g.employees || []).filter(e => {
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
    .filter(g => (g.employees || []).length > 0)

  return filtered
})

const filteredCount = computed(() =>
  filteredManagers.value.reduce((sum, g) => sum + (g.employees?.length || 0), 0)
)

function compactBalances(balances) {
  const arr = Array.isArray(balances) ? balances : []
  // show most important first
  const order = ['AL', 'SP', 'MC', 'MA', 'UL']
  const m = new Map(arr.map(x => [String(x.leaveTypeCode || '').toUpperCase(), x]))
  const out = []
  for (const k of order) {
    const b = m.get(k)
    if (!b) continue
    out.push({ k, v: Number.isFinite(Number(b.remaining)) ? Number(b.remaining) : 0 })
  }
  return out
}

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
  } finally {
    loading.value = false
  }
}

watch(includeInactive, () => fetchGroups())

/* create modal */
const createOpen = ref(false)
const createTab = ref('bulk') // bulk | single
const createError = ref('')
const saving = ref(false)

function newRow() {
  return {
    key: Math.random().toString(16).slice(2),
    employee: null,       // EmployeeSearch returns { employeeId, name, department }
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
      // validate
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
        // ✅ manager optional (backend accepts empty)
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
      managerLoginId: String(form.value.manager?.employeeId || '').trim(), // optional
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

/* lifecycle */
onMounted(() => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
  fetchGroups()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
})

</script>

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

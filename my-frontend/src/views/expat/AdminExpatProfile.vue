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

/* ───────── Leave types (display order + default list) ─────────
 * Backend now computes balances. Admin should NOT edit balances.
 */
const leaveTypes = ref([]) // [{ code, name, ... }]
async function fetchLeaveTypes() {
  try {
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    showToast({
      type: 'error',
      title: 'Failed to load leave types',
      message: e?.response?.data?.message || 'Please contact admin.'
    })
  }
}

const TYPE_ORDER = computed(() => {
  const codes = (leaveTypes.value || []).map(t => String(t?.code || '').toUpperCase()).filter(Boolean)
  // fallback if types not loaded yet
  const fallback = ['AL', 'SP', 'MC', 'MA', 'UL']
  const merged = [...new Set([...fallback, ...codes])]
  return merged
})

/* ───────── EXPAT PROFILES ───────── */
const loadingProfiles = ref(false)
const loadError = ref('')
const profiles = ref([])
const profileSearch = ref('')

/* pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

watch(profileSearch, () => { page.value = 1 })
watch(perPage, () => { page.value = 1 })

async function fetchProfiles() {
  try {
    loadingProfiles.value = true
    loadError.value = ''
    const res = await api.get('/admin/leave/profiles')
    profiles.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchProfiles error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load expat profiles.'
    showToast({
      type: 'error',
      title: 'Failed to load profiles',
      message: loadError.value
    })
  } finally {
    loadingProfiles.value = false
  }
}

/* helpers */
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
      remaining: num(b?.remaining) // ✅ trust backend (can be negative for AL)
    })
  }

  // ensure all known types exist for display
  for (const code of TYPE_ORDER.value) {
    if (!map.has(code)) {
      map.set(code, { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
    }
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

// text summary: AL: U2 / R16 | …
function summarizeBalances(rawBalances = []) {
  const list = normalizeBalances(rawBalances)
  if (!list.length) return '—'
  return list
    .map(b => `${b.leaveTypeCode}: U${num(b.used)} / R${num(b.remaining)}`)
    .join(' | ')
}

const filteredProfiles = computed(() => {
  const q = profileSearch.value.trim().toLowerCase()
  let list = profiles.value.slice()

  if (q) {
    list = list.filter(p =>
      String(p.employeeId || '').toLowerCase().includes(q) ||
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.department || '').toLowerCase().includes(q)
    )
  }

  list.sort((a, b) => {
    const eidA = String(a.employeeId || '')
    const eidB = String(b.employeeId || '')
    if (eidA !== eidB) return eidA.localeCompare(eidB)
    return String(a.name || '').localeCompare(String(b.name || ''))
  })

  return list
})

const pagedProfiles = computed(() => {
  if (perPage.value === 'All') return filteredProfiles.value
  const per = Number(perPage.value || 20)
  const start = (page.value - 1) * per
  return filteredProfiles.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 20)
  return Math.ceil(filteredProfiles.value.length / per) || 1
})

/* ───────── Edit modal (joinDate/contractDate/manager/gm/isActive/alCarry) ───────── */
const profileDialog = ref(false)
const profileSaving = ref(false)
const profileError = ref('')
const selected = ref(null)

const profileForm = ref({
  joinDate: '',
  contractDate: '',
  managerLoginId: '',
  gmLoginId: '',
  isActive: true,
  alCarry: 0
})

const previewBalances = ref([]) // read-only in modal

async function openEditProfile(p) {
  profileError.value = ''
  selected.value = p
  profileDialog.value = true
  previewBalances.value = normalizeBalances(p?.balances || [])

  // Prefer fetching single profile (has managerLoginId/gmLoginId/isActive/alCarry)
  try {
    const res = await api.get(`/admin/leave/profiles/${p.employeeId}`)
    const prof = res?.data?.profile || res?.data || {}
    previewBalances.value = normalizeBalances(prof?.balances || p?.balances || [])

    profileForm.value = {
      joinDate: prof?.joinDate ? dayjs(prof.joinDate).format('YYYY-MM-DD') : '',
      contractDate: prof?.contractDate ? dayjs(prof.contractDate).format('YYYY-MM-DD') : '',
      managerLoginId: String(prof?.managerLoginId || ''),
      gmLoginId: String(prof?.gmLoginId || ''),
      isActive: prof?.isActive !== false,
      alCarry: num(prof?.alCarry)
    }
  } catch (e) {
    // fallback to list data if GET single not available
    profileForm.value = {
      joinDate: p?.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '',
      contractDate: p?.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '',
      managerLoginId: String(p?.managerLoginId || ''),
      gmLoginId: String(p?.gmLoginId || ''),
      isActive: p?.isActive !== false,
      alCarry: num(p?.alCarry)
    }
  }
}

async function saveProfile() {
  if (!selected.value?.employeeId) return
  profileSaving.value = true
  profileError.value = ''

  try {
    const payload = {
      joinDate: profileForm.value.joinDate || null,
      contractDate: profileForm.value.contractDate || null,
      managerLoginId: String(profileForm.value.managerLoginId || '').trim(),
      gmLoginId: String(profileForm.value.gmLoginId || '').trim(),
      isActive: !!profileForm.value.isActive,
      alCarry: num(profileForm.value.alCarry)
      // ✅ DO NOT send balances (backend computes them)
    }

    await api.put(`/admin/leave/profiles/${selected.value.employeeId}`, payload)

    profileDialog.value = false
    showToast({
      type: 'success',
      title: 'Profile saved',
      message: 'Expat leave profile has been updated.'
    })
    await fetchProfiles()
  } catch (e) {
    console.error('saveProfile error', e)
    profileError.value = e?.response?.data?.message || 'Failed to save profile.'
    showToast({
      type: 'error',
      title: 'Save failed',
      message: profileError.value
    })
  } finally {
    profileSaving.value = false
  }
}

function openYearSheet(item) {
  router.push({
    name: 'expat-leave-year-sheet',
    params: { employeeId: item.employeeId }
  })
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  await fetchLeaveTypes()
  await fetchProfiles()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header / filter bar -->
      <div class="rounded-t-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500 px-4 py-3 text-white">
        <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Expat Leave Profiles</p>
            <p class="text-[11px] text-emerald-50/90">
              Manage join date / contract date / manager mapping. Balances are computed automatically.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-emerald-50">Search employee</label>
              <div class="flex items-center rounded-xl border border-emerald-200/80 bg-emerald-900/20 px-2.5 py-1.5 text-xs">
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-emerald-50/80" />
                <input
                  v-model="profileSearch"
                  type="text"
                  placeholder="ID, name, department..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-emerald-100/80"
                />
              </div>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
              :disabled="loadingProfiles"
              @click="fetchProfiles()"
            >
              <i class="fa-solid fa-rotate text-[11px]" :class="loadingProfiles ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>

        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Expat Leave Profiles</p>
            <p class="text-[11px] text-emerald-50/90">
              Balances are computed automatically.
            </p>
          </div>

          <div class="space-y-1">
            <label class="mb-1 block text-[11px] font-medium text-emerald-50">Search employee</label>
            <div class="flex items-center rounded-xl border border-emerald-200/80 bg-emerald-900/20 px-2.5 py-1.5 text-[11px]">
              <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-emerald-50/80" />
              <input
                v-model="profileSearch"
                type="text"
                placeholder="ID, name, department..."
                class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-emerald-100/80"
              />
            </div>
          </div>

          <button
            type="button"
            class="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
            :disabled="loadingProfiles"
            @click="fetchProfiles()"
          >
            <i class="fa-solid fa-rotate text-[11px]" :class="loadingProfiles ? 'fa-spin' : ''" />
            Refresh
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading -->
        <div v-if="loadingProfiles" class="space-y-2">
          <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
          <div v-for="i in 4" :key="'sk-' + i" class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
        </div>

        <div v-else>
          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!pagedProfiles.length" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No expat profiles found.
            </p>

            <article
              v-for="p in pagedProfiles"
              :key="p.employeeId"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                    {{ p.name || '—' }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    ID {{ p.employeeId || '—' }}
                    <span v-if="p.department"> • {{ p.department }}</span>
                  </div>
                </div>

                <div class="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  <div>
                    Join:
                    <span class="font-medium text-slate-700 dark:text-slate-100">
                      {{ p.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '—' }}
                    </span>
                  </div>
                  <div>
                    Contract:
                    <span class="font-medium text-slate-700 dark:text-slate-100">
                      {{ p.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '—' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-2 h-px bg-slate-200 dark:bg-slate-700" />

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="font-semibold">Balances:</span>
                <span class="ml-1">{{ summarizeBalances(p.balances) }}</span>
              </div>

              <div class="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50
                         dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  @click="openYearSheet(p)"
                >
                  <i class="fa-regular fa-file-lines text-[11px]" />
                  Sheet
                </button>

                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-3 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
                         dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                  @click="openEditProfile(p)"
                >
                  <i class="fa-solid fa-pen text-[11px]" />
                  Edit
                </button>
              </div>
            </article>
          </div>

          <!-- Desktop table -->
          <div v-else class="overflow-x-auto">
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

                  <th v-for="code in TYPE_ORDER" :key="'h-'+code" class="table-th text-right">
                    {{ code }}
                  </th>

                  <th class="table-th text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr
                  v-for="p in pagedProfiles"
                  :key="p.employeeId"
                  class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80
                         dark:border-slate-700 dark:hover:bg-slate-900/70"
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
                    </div>
                  </td>
                </tr>

                <tr v-if="!pagedProfiles.length">
                  <td
                    :colspan="6 + TYPE_ORDER.length"
                    class="px-3 py-6 text-center text-[12px] text-slate-500 border-t border-slate-200
                           dark:border-slate-700 dark:text-slate-400"
                  >
                    No expat profiles found.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                v-model="perPage"
                class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-900"
              >
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <span class="px-2">Page {{ page }} / {{ pageCount }}</span>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Edit profile (NO balance editing) -->
    <transition name="modal-fade">
      <div v-if="profileDialog" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2">
        <div
          class="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl
                 dark:border-slate-700 dark:bg-slate-950"
        >
          <!-- Header -->
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">Edit Expat Profile</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ selected?.employeeId }} · {{ selected?.name }}
                  <span v-if="selected?.department">({{ selected.department }})</span>
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="profileDialog = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="px-4 py-3 space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Join Date</label>
                <input
                  v-model="profileForm.joinDate"
                  type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  Used for AL accrual &amp; join-year renew rules (SP/MC).
                </p>
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Contract Date</label>
                <input
                  v-model="profileForm.contractDate"
                  type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  New contract resets AL entitlement (per your backend rule).
                </p>
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Manager Login ID</label>
                <input
                  v-model="profileForm.managerLoginId"
                  type="text"
                  placeholder="leave_mgr_hr"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">GM Login ID</label>
                <input
                  v-model="profileForm.gmLoginId"
                  type="text"
                  placeholder="leave_gm"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">AL Carry (debt)</label>
                <input
                  v-model.number="profileForm.alCarry"
                  type="number"
                  step="0.5"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  Negative means employee owes AL days (from SP borrowing across contracts).
                </p>
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Active</label>
                <div class="flex items-center gap-2">
                  <input id="isActive" v-model="profileForm.isActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
                  <label for="isActive" class="text-[12px] text-slate-700 dark:text-slate-200">
                    Profile is active
                  </label>
                </div>
              </div>
            </div>

            <!-- Read-only balances preview -->
            <div class="mt-1">
              <div class="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                Computed balances (read-only)
              </div>

              <div class="mt-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-900/60">
                <table class="min-w-full border-collapse text-[11px] text-slate-700 dark:text-slate-100">
                  <thead class="bg-slate-100/80 text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300">
                    <tr>
                      <th class="px-2 py-1 text-left">Type</th>
                      <th class="px-2 py-1 text-right">Entitlement</th>
                      <th class="px-2 py-1 text-right">Used</th>
                      <th class="px-2 py-1 text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="b in previewBalances"
                      :key="b.leaveTypeCode"
                      class="border-b border-slate-200 last:border-b-0 dark:border-slate-700"
                    >
                      <td class="px-2 py-1">
                        <span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                          {{ b.leaveTypeCode }}
                        </span>
                      </td>
                      <td class="px-2 py-1 text-right tabular-nums">{{ num(b.yearlyEntitlement) }}</td>
                      <td class="px-2 py-1 text-right tabular-nums">{{ num(b.used) }}</td>
                      <td class="px-2 py-1 text-right tabular-nums">
                        <span
                          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                          :class="num(b.remaining) >= 0
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'"
                        >
                          {{ num(b.remaining) }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                To change balances, approve/reject requests or adjust rules in backend. Admin editing balances is disabled.
              </div>
            </div>

            <div v-if="profileError" class="text-[11px] text-rose-600 dark:text-rose-400">
              {{ profileError }}
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="profileDialog = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm
                     hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="profileSaving"
              @click="saveProfile"
            >
              <i class="fa-solid fa-floppy-disk text-[11px]" />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.table-th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.table-td {
  padding: 8px 10px;
  vertical-align: top;
}

/* Used/Remaining cell */
.ur-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.1;
}
.ur-used {
  font-size: 11px;
  font-weight: 700;
}
.ur-rem {
  font-size: 11px;
  color: #64748b;
}

/* Pagination buttons */
.pagination-btn {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1.5px solid rgba(100, 116, 139, 0.95);
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination-btn:not(:disabled):hover {
  background: #e5edff;
}
.dark .pagination-btn {
  background: #020617;
  border-color: rgba(148, 163, 184, 0.9);
  color: #e5e7eb;
}
.dark .pagination-btn:not(:disabled):hover {
  background: #1e293b;
}

/* Modal transition */
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

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

/* ───────── LEAVE TYPES (for balances) ───────── */

const leaveTypes = ref([])

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

/* ───────── EXPAT PROFILES ───────── */

const loadingProfiles = ref(false)
const loadError = ref('')
const profiles = ref([])
const profileSearch = ref('')

const profileDialog = ref(false)
const profileSaving = ref(false)
const profileError = ref('')

const selectedProfile = ref(null)

const profileForm = ref({
  joinDate: '',
  contractDate: '',
  balances: [] // [{ leaveTypeCode, yearlyEntitlement, used, remaining }]
})

/* simple client pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

const profileHeaders = [
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'name', label: 'Name' },
  { key: 'department', label: 'Department' },
  { key: 'joinDate', label: 'Join Date' },
  { key: 'contractDate', label: 'Contract' },
  { key: 'AL', label: 'AL' },
  { key: 'SP', label: 'SP' },
  { key: 'MC', label: 'MC' },
  { key: 'MA', label: 'MA' },
  { key: 'UL', label: 'UL' },
  { key: 'actions', label: 'Actions' }
]

// find used / remain for one type in one profile
function findUR(balances = [], code) {
  const rec = (balances || []).find(b => b.leaveTypeCode === code) || {}
  const ent = Number(rec.yearlyEntitlement ?? 0)
  const used = Number(rec.used ?? 0)
  const rem = rec.remaining != null
    ? Number(rec.remaining)
    : Math.max(ent - used, 0)
  return { used, rem }
}

// text summary: AL: U2 / R16 | …
function summarizeBalances(balances = []) {
  if (!balances.length) return '—'
  const done = new Set()
  return balances
    .filter(b => {
      if (!b.leaveTypeCode || done.has(b.leaveTypeCode)) return false
      done.add(b.leaveTypeCode)
      return true
    })
    .map(b => {
      const { used, rem } = findUR(balances, b.leaveTypeCode)
      return `${b.leaveTypeCode}: U${used} / R${rem}`
    })
    .join(' | ')
}

const filteredProfiles = computed(() => {
  const q = profileSearch.value.trim().toLowerCase()
  let list = profiles.value.slice()

  if (q) {
    list = list.filter(p =>
      (p.employeeId || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.department || '').toLowerCase().includes(q)
    )
  }

  // sort by employeeId then name for stable order
  list.sort((a, b) => {
    const eidA = String(a.employeeId || '')
    const eidB = String(b.employeeId || '')
    if (eidA !== eidB) return eidA.localeCompare(eidB)
    return String(a.name || '').localeCompare(b.name || '')
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

watch(profileSearch, () => {
  page.value = 1
})

async function fetchProfiles() {
  try {
    loadingProfiles.value = true
    loadError.value = ''
    const res = await api.get('/admin/leave/profiles')
    profiles.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchProfiles error', e)
    loadError.value =
      e?.response?.data?.message || 'Unable to load expat profiles.'
    showToast({
      type: 'error',
      title: 'Failed to load profiles',
      message: loadError.value
    })
  } finally {
    loadingProfiles.value = false
  }
}

/**
 * Ensure every leave type exists in balances array
 * (so admin can see/edit all types for that employee)
 */
function ensureAllTypesInBalances(balances) {
  const map = new Map()

  for (const b of balances || []) {
    if (!b || !b.leaveTypeCode) continue
    map.set(b.leaveTypeCode, { ...b })
  }

  for (const t of leaveTypes.value) {
    if (!t.code) continue
    if (!map.has(t.code)) {
      map.set(t.code, {
        leaveTypeCode: t.code,
        yearlyEntitlement: t.yearlyEntitlement ?? 0,
        used: 0,
        remaining: t.yearlyEntitlement ?? 0
      })
    }
  }

  return Array.from(map.values())
}

/* ───────── AL ACCRUAL FROM JOIN DATE ───────── */

// compute AL entitlement = monthsSinceJoin * 1.5 (cap 18)
function computeAlEntitlementFromJoin(joinDateStr) {
  if (!joinDateStr) return null
  const jd = dayjs(joinDateStr)
  if (!jd.isValid()) return null

  const now = dayjs().startOf('day')
  const months = Math.max(0, now.diff(jd.startOf('day'), 'month'))

  const fullYear = 18
  const perMonth = 1.5

  const ent = Math.min(fullYear, months * perMonth)
  return Number(ent.toFixed(1))
}

function applyAlAccrualForForm() {
  const joinDate = profileForm.value.joinDate
  const ent = computeAlEntitlementFromJoin(joinDate)
  if (ent === null) return

  const idx = profileForm.value.balances.findIndex(
    b => b.leaveTypeCode === 'AL'
  )
  if (idx === -1) return

  const b = profileForm.value.balances[idx]
  b.yearlyEntitlement = ent

  const used = Number(b.used || 0)
  let rem = ent - used
  if (rem < 0) rem = 0
  b.remaining = rem
}

function openEditProfile(p) {
  selectedProfile.value = p
  profileError.value = ''

  profileForm.value = {
    joinDate: p.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '',
    contractDate: p.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '',
    balances: ensureAllTypesInBalances(p.balances || [])
  }

  applyAlAccrualForForm()
  profileDialog.value = true
}

// re-apply AL accrual whenever join date changes in the dialog
watch(
  () => profileForm.value.joinDate,
  () => {
    applyAlAccrualForForm()
  }
)

function updateRemaining(idx) {
  const b = profileForm.value.balances[idx]
  if (!b) return
  const ent = Number(b.yearlyEntitlement || 0)
  const used = Number(b.used || 0)
  let rem = ent - used
  if (rem < 0) rem = 0
  b.remaining = rem
}

async function saveProfile() {
  if (!selectedProfile.value) return

  profileSaving.value = true
  profileError.value = ''
  try {
    const payload = {
      joinDate: profileForm.value.joinDate || null,
      contractDate: profileForm.value.contractDate || null,
      balances: profileForm.value.balances.map(b => ({
        leaveTypeCode: b.leaveTypeCode,
        yearlyEntitlement: Number(b.yearlyEntitlement || 0),
        used: Number(b.used || 0),
        remaining: Number(b.remaining || 0)
      }))
    }

    await api.put(
      `/admin/leave/profiles/${selectedProfile.value.employeeId}`,
      payload
    )

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
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
  }
  await fetchLeaveTypes()
  await fetchProfiles()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
  }
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-800 dark:bg-slate-900"
    >
      <!-- Gradient header / filter bar -->
      <div
        class="rounded-t-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500
               px-4 py-3 text-white"
      >
        <!-- Desktop header -->
        <div
          v-if="!isMobile"
          class="flex flex-wrap items-end justify-between gap-4"
        >
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">
              Expat Leave
            </p>
            <p class="text-sm font-semibold">
              Expat Leave Profiles
            </p>
            <p class="text-[11px] text-emerald-50/90">
              Manage join dates, contract dates and yearly leave balances.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-emerald-50">
                Search employee
              </label>
              <div
                class="flex items-center rounded-xl border border-emerald-200/80 bg-emerald-900/20
                       px-2.5 py-1.5 text-xs"
              >
                <i
                  class="fa-solid fa-magnifying-glass mr-2 text-xs text-emerald-50/80"
                />
                <input
                  v-model="profileSearch"
                  type="text"
                  placeholder="ID, name, department..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-emerald-100/80"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile header -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">
              Expat Leave
            </p>
            <p class="text-sm font-semibold">
              Expat Leave Profiles
            </p>
            <p class="text-[11px] text-emerald-50/90">
              Manage leave balances for expatriate employees.
            </p>
          </div>
          <div class="space-y-1">
            <label class="mb-1 block text-[11px] font-medium text-emerald-50">
              Search employee
            </label>
            <div
              class="flex items-center rounded-xl border border-emerald-200/80 bg-emerald-900/20
                     px-2.5 py-1.5 text-[11px]"
            >
              <i
                class="fa-solid fa-magnifying-glass mr-2 text-xs text-emerald-50/80"
              />
              <input
                v-model="profileSearch"
                type="text"
                placeholder="ID, name, department..."
                class="flex-1 bg-transparent text-[11px] outline-none
                       placeholder:text-emerald-100/80"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error banner -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading skeleton -->
        <div v-if="loadingProfiles" class="space-y-2">
          <div
            class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70"
          ></div>
          <div
            v-for="i in 4"
            :key="'sk-' + i"
            class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60"
          ></div>
        </div>

        <!-- Content -->
        <div v-else>
          <!-- MOBILE: cards -->
          <div v-if="isMobile" class="space-y-2">
            <p
              v-if="!pagedProfiles.length"
              class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400"
            >
              No expat profiles found.
            </p>

            <article
              v-for="p in pagedProfiles"
              :key="p.employeeId"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.12)]
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
                <span class="ml-1">
                  {{ summarizeBalances(p.balances) }}
                </span>
              </div>

              <div class="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1
                         text-[11px] font-medium text-slate-700 hover:bg-slate-50
                         dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  @click="openYearSheet(p)"
                >
                  <i class="fa-regular fa-file-lines text-[11px]" />
                  Sheet
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-3 py-1
                         text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
                         dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                  @click="openEditProfile(p)"
                >
                  <i class="fa-solid fa-pen text-[11px]" />
                  Edit
                </button>
              </div>
            </article>
          </div>

          <!-- DESKTOP: table -->
          <div v-else class="overflow-x-auto">
            <table
              class="min-w-full border-collapse text-xs sm:text-[13px]
                     text-slate-700 dark:text-slate-100"
            >
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th
                    v-for="h in profileHeaders"
                    :key="h.key"
                    class="table-th border-l border-slate-200 first:border-l-0
                           dark:border-slate-700"
                  >
                    {{ h.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in pagedProfiles"
                  :key="p.employeeId"
                  class="border-b border-slate-200 text-[12px]
                         hover:bg-slate-50/80
                         dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td">
                    {{ p.employeeId || '—' }}
                  </td>
                  <td class="table-td">
                    {{ p.name || '—' }}
                  </td>
                  <td class="table-td">
                    {{ p.department || '—' }}
                  </td>
                  <td class="table-td whitespace-nowrap">
                    {{ p.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '—' }}
                  </td>
                  <td class="table-td whitespace-nowrap">
                    {{ p.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '—' }}
                  </td>

                  <!-- AL -->
                  <td class="table-td">
                    <div class="ur-cell">
                      <span class="ur-used">
                        {{ findUR(p.balances, 'AL').used }}
                      </span>
                      <span class="ur-rem">
                        {{ findUR(p.balances, 'AL').rem }}
                      </span>
                    </div>
                  </td>
                  <!-- SP -->
                  <td class="table-td">
                    <div class="ur-cell">
                      <span class="ur-used">
                        {{ findUR(p.balances, 'SP').used }}
                      </span>
                      <span class="ur-rem">
                        {{ findUR(p.balances, 'SP').rem }}
                      </span>
                    </div>
                  </td>
                  <!-- MC -->
                  <td class="table-td">
                    <div class="ur-cell">
                      <span class="ur-used">
                        {{ findUR(p.balances, 'MC').used }}
                      </span>
                      <span class="ur-rem">
                        {{ findUR(p.balances, 'MC').rem }}
                      </span>
                    </div>
                  </td>
                  <!-- MA -->
                  <td class="table-td">
                    <div class="ur-cell">
                      <span class="ur-used">
                        {{ findUR(p.balances, 'MA').used }}
                      </span>
                      <span class="ur-rem">
                        {{ findUR(p.balances, 'MA').rem }}
                      </span>
                    </div>
                  </td>
                  <!-- UL -->
                  <td class="table-td">
                    <div class="ur-cell">
                      <span class="ur-used">
                        {{ findUR(p.balances, 'UL').used }}
                      </span>
                      <span class="ur-rem">
                        {{ findUR(p.balances, 'UL').rem }}
                      </span>
                    </div>
                  </td>

                  <td class="table-td">
                    <div class="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1
                               text-[11px] font-medium text-slate-700 hover:bg-slate-50
                               dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        @click="openYearSheet(p)"
                      >
                        <i class="fa-regular fa-file-lines text-[11px]" />
                        Sheet
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border border-emerald-500 px-2.5 py-1
                               text-[11px] font-medium text-emerald-700 hover:bg-emerald-50
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
                    :colspan="profileHeaders.length"
                    class="px-3 py-6 text-center text-[12px] text-slate-500
                           border-t border-slate-200
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
            class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2
                   text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300
                   sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                v-model="perPage"
                class="rounded-lg border border-slate-300 bg-white px-2 py-1
                       text-[11px] dark:border-slate-600 dark:bg-slate-900"
              >
                <option
                  v-for="opt in perPageOptions"
                  :key="'per-' + opt"
                  :value="opt"
                >
                  {{ opt }}
                </option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = 1"
              >
                «
              </button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = Math.max(1, page - 1)"
              >
                Prev
              </button>
              <span class="px-2">
                Page {{ page }} / {{ pageCount }}
              </span>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = Math.min(pageCount, page + 1)"
              >
                Next
              </button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = pageCount"
              >
                »
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MODAL: Edit Expat Profile -->
    <transition name="modal-fade">
      <div
        v-if="profileDialog"
        class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-2"
      >
        <div
          class="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200
                 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950"
        >
          <!-- Modal header -->
          <div
            class="border-b border-slate-200 bg-slate-50/80 px-4 py-3
                   dark:border-slate-700 dark:bg-slate-900/80"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Edit Expat Profile
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ selectedProfile?.employeeId }} · {{ selectedProfile?.name }}
                  <span v-if="selectedProfile?.department">
                    ({{ selectedProfile.department }})
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-full
                       text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="profileDialog = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <!-- Modal body -->
          <div class="px-4 py-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Join Date
                </label>
                <input
                  v-model="profileForm.joinDate"
                  type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                         text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <p class="text-[10px] text-slate-400">
                  AL entitlement auto-accrues from this date (1.5 days / month, max 18).
                </p>
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  New Contract Date
                </label>
                <input
                  v-model="profileForm.contractDate"
                  type="date"
                  class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5
                         text-[12px] text-slate-800 outline-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div class="mt-3 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              Leave Usage (per year)
            </div>

            <div
              class="mt-2 max-h-[46vh] overflow-auto rounded-xl border border-slate-200
                     bg-slate-50/60 p-2
                     dark:border-slate-700 dark:bg-slate-900/60"
            >
              <table class="min-w-full border-collapse text-[11px] text-slate-700 dark:text-slate-100">
                <thead
                  class="bg-slate-100/80 text-[10px] uppercase tracking-wide text-slate-500
                         border-b border-slate-200
                         dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
                >
                  <tr>
                    <th class="px-2 py-1 text-left">Type</th>
                    <th class="px-2 py-1 text-right">Entitlement</th>
                    <th class="px-2 py-1 text-right">Used</th>
                    <th class="px-2 py-1 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(b, idx) in profileForm.balances"
                    :key="b.leaveTypeCode || idx"
                    class="border-b border-slate-200 last:border-b-0
                           dark:border-slate-700"
                  >
                    <td class="px-2 py-1 text-left">
                      <span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px]
                                   font-medium text-slate-700
                                   dark:bg-slate-800 dark:text-slate-100">
                        {{ b.leaveTypeCode }}
                      </span>
                    </td>
                    <td class="px-2 py-1 text-right">
                      <input
                        v-model.number="b.yearlyEntitlement"
                        type="number"
                        min="0"
                        class="w-full max-w-[72px] rounded-md border border-slate-300 bg-white px-2 py-1
                               text-right text-[11px] outline-none
                               focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                               dark:border-slate-600 dark:bg-slate-950"
                        @change="updateRemaining(idx)"
                      />
                    </td>
                    <td class="px-2 py-1 text-right">
                      <input
                        v-model.number="b.used"
                        type="number"
                        min="0"
                        class="w-full max-w-[72px] rounded-md border border-slate-300 bg-white px-2 py-1
                               text-right text-[11px] outline-none
                               focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400
                               dark:border-slate-600 dark:bg-slate-950"
                        @change="updateRemaining(idx)"
                      />
                    </td>
                    <td class="px-2 py-1 text-right">
                      {{ Number(b.remaining || 0).toLocaleString() }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="profileError" class="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
              {{ profileError }}
            </div>
          </div>

          <!-- Modal footer -->
          <div
            class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5
                   dark:border-slate-700 dark:bg-slate-900/80"
          >
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium
                     text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800"
              @click="profileDialog = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5
                     text-[11px] font-semibold text-white shadow-sm
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
  font-weight: 700;
}

.table-td {
  padding: 8px 10px;
  vertical-align: top;
}

/* Used/Remaining small cell */
.ur-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.1;
}
.ur-used {
  font-size: 11px;
  font-weight: 600;
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

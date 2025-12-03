<!-- src/views/expat/AdminExpatProfiles.vue -->
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'

/* ─────────────────────────────
 *  LEAVE TYPES (for balances)
 * ───────────────────────────── */

const leaveTypes = ref([])

async function fetchLeaveTypes() {
  try {
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
  }
}

/* ─────────────────────────────
 *  EXPAT PROFILES
 * ───────────────────────────── */

const loadingProfiles  = ref(false)
const profiles         = ref([])
const profileSearch    = ref('')
const profileDialog    = ref(false)
const profileSaving    = ref(false)
const profileError     = ref('')

const selectedProfile  = ref(null)

const profileForm = ref({
  joinDate: '',
  contractDate: '',
  balances: [], // [{ leaveTypeCode, yearlyEntitlement, used, remaining }]
})

const profileHeaders = [
  { title: 'Employee ID',          key: 'employeeId',     width: 120 },
  { title: 'Name',                 key: 'name',           minWidth: 160 },
  { title: 'Department',           key: 'department',     minWidth: 130 },
  { title: 'Join Date',            key: 'joinDate',       width: 110 },
  { title: 'Contract',             key: 'contractDate',   width: 110 },
  { title: 'AL',                   key: 'alUR',           width: 60, align: 'end' },
  { title: 'SP',                   key: 'spUR',           width: 60, align: 'end' },
  { title: 'MC',                   key: 'mcUR',           width: 60, align: 'end' },
  { title: 'MA',                   key: 'maUR',           width: 60, align: 'end' },
  { title: 'UL',                   key: 'ulUR',           width: 60, align: 'end' },
  { title: 'Actions',              key: 'actions',        width: 250, align: 'end' },
]

// find used / remain for one type in one profile
function findUR(balances = [], code) {
  const rec = (balances || []).find(b => b.leaveTypeCode === code) || {}
  const ent  = Number(rec.yearlyEntitlement ?? 0)
  const used = Number(rec.used ?? 0)
  const rem  = rec.remaining != null
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
  if (!q) return profiles.value

  return profiles.value.filter(p =>
    (p.employeeId || '').toLowerCase().includes(q) ||
    (p.name || '').toLowerCase().includes(q) ||
    (p.department || '').toLowerCase().includes(q)
  )
})

async function fetchProfiles() {
  try {
    loadingProfiles.value = true
    const res = await api.get('/admin/leave/profiles')
    profiles.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchProfiles error', e)
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
        remaining: t.yearlyEntitlement ?? 0,
      })
    }
  }

  return Array.from(map.values())
}

/* ─────────────────────────────
 *  AL ACCRUAL FROM JOIN DATE
 * ───────────────────────────── */

// compute AL entitlement = monthsSinceJoin * 1.5 (cap 18)
function computeAlEntitlementFromJoin(joinDateStr) {
  if (!joinDateStr) return null
  const jd = dayjs(joinDateStr)
  if (!jd.isValid()) return null

  const now = dayjs().startOf('day')
  const months = Math.max(0, now.diff(jd.startOf('day'), 'month'))

  // full-year AL entitlement (18) & per-month (1.5)
  const fullYear = 18
  const perMonth = 1.5

  const ent = Math.min(fullYear, months * perMonth)
  return Number(ent.toFixed(1)) // keep 1 decimal (e.g. 1.5, 3.0, …)
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

  // recompute remaining based on new entitlement
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
    balances: ensureAllTypesInBalances(p.balances || []),
  }

  // 🔹 after balances + joinDate loaded, adjust AL entitlement
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
        remaining: Number(b.remaining || 0),
      })),
    }

    await api.put(
      `/admin/leave/profiles/${selectedProfile.value.employeeId}`,
      payload,
    )

    profileDialog.value = false
    await fetchProfiles()
  } catch (e) {
    console.error('saveProfile error', e)
    profileError.value = e?.response?.data?.message || 'Failed to save profile.'
  } finally {
    profileSaving.value = false
  }
}

/* INIT */
onMounted(async () => {
  await fetchLeaveTypes()
  await fetchProfiles()
})
</script>


<template>
  <v-container fluid class="pa-4">
    <v-row>
      <v-col cols="12">
        <h1 class="text-h5 font-weight-bold mb-2">
          Expat Leave Profiles
        </h1>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Assign join date, new contract date, and leave balances to expatriate employees.
        </p>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-card rounded="xl" elevation="3">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <div class="text-subtitle-1 font-weight-semibold">Expat Profiles</div>
              <div class="text-caption text-medium-emphasis">
                Search and edit profiles and leave usage.
              </div>
            </div>
            <v-text-field
              v-model="profileSearch"
              placeholder="Search by ID / Name / Dept..."
              density="compact"
              hide-details
              clearable
              prepend-inner-icon="mdi-magnify"
              style="max-width: 260px"
            />
          </v-card-title>

          <v-divider />

          <v-card-text class="pa-0">
            <v-data-table
              :headers="profileHeaders"
              :items="filteredProfiles"
              :loading="loadingProfiles"
              density="compact"
            >
              <template #item.joinDate="{ item }">
                {{ item.joinDate ? dayjs(item.joinDate).format('YYYY-MM-DD') : '—' }}
              </template>

              <template #item.contractDate="{ item }">
                {{ item.contractDate ? dayjs(item.contractDate).format('YYYY-MM-DD') : '—' }}
              </template>

              <!-- text summary (no 0/18 style) -->
              <template #item.balanceSummary="{ item }">
                {{ summarizeBalances(item.balances) }}
              </template>

              <!-- Per-type 2-line cells -->
              <template #item.alUR="{ item }">
                <div class="ur-cell">
                  <div class="ur-used">
                    {{ findUR(item.balances, 'AL').used }}
                  </div>
                  <div class="ur-rem">
                    {{ findUR(item.balances, 'AL').rem }}
                  </div>
                </div>
              </template>

              <template #item.spUR="{ item }">
                <div class="ur-cell">
                  <div class="ur-used">
                    {{ findUR(item.balances, 'SP').used }}
                  </div>
                  <div class="ur-rem">
                    {{ findUR(item.balances, 'SP').rem }}
                  </div>
                </div>
              </template>

              <template #item.mcUR="{ item }">
                <div class="ur-cell">
                  <div class="ur-used">
                    {{ findUR(item.balances, 'MC').used }}
                  </div>
                  <div class="ur-rem">
                    {{ findUR(item.balances, 'MC').rem }}
                  </div>
                </div>
              </template>

              <template #item.maUR="{ item }">
                <div class="ur-cell">
                  <div class="ur-used">
                    {{ findUR(item.balances, 'MA').used }}
                  </div>
                  <div class="ur-rem">
                    {{ findUR(item.balances, 'MA').rem }}
                  </div>
                </div>
              </template>

              <template #item.ulUR="{ item }">
                <div class="ur-cell">
                  <div class="ur-used">
                    {{ findUR(item.balances, 'UL').used }}
                  </div>
                  <div class="ur-rem">
                    {{ findUR(item.balances, 'UL').rem }}
                  </div>
                </div>
              </template>

              <template #item.actions="{ item }">
                <v-btn
                  size="small"
                  variant="outlined"
                  color="secondary"
                  prepend-icon="mdi-file-chart"
                  class="mr-2"
                  @click="$router.push({ name: 'expat-leave-year-sheet', params: { employeeId: item.employeeId } })"
                >
                  Sheet
                </v-btn>
                <v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  prepend-icon="mdi-pencil"
                  @click="openEditProfile(item)"
                >
                  Edit
                </v-btn>
              </template>

              <template #loading>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  Loading expat profiles...
                </div>
              </template>

              <template #no-data>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  No expat profiles found.
                </div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- DIALOG: Edit Expat Profile -->
    <v-dialog v-model="profileDialog" max-width="900">
      <v-card rounded="xl">
        <v-card-title class="d-flex flex-column align-start">
          <span class="text-subtitle-1 font-weight-semibold">
            Edit Expat Profile
          </span>
          <span class="text-caption text-medium-emphasis">
            {{ selectedProfile?.employeeId }} · {{ selectedProfile?.name }}
            <span v-if="selectedProfile?.department">
              ({{ selectedProfile.department }})
            </span>
          </span>
        </v-card-title>

        <v-card-text>
          <v-row dense class="mb-2">
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="profileForm.joinDate"
                label="Join Date"
                type="date"
                density="compact"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="profileForm.contractDate"
                label="New Contract Date"
                type="date"
                density="compact"
                variant="outlined"
              />
            </v-col>
          </v-row>

          <div class="text-subtitle-2 font-weight-semibold mb-1">
            Leave Usage (per year)
          </div>

          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-left">Type</th>
                <th class="text-right">Entitlement</th>
                <th class="text-right">Used</th>
                <th class="text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(b, idx) in profileForm.balances"
                :key="b.leaveTypeCode || idx"
              >
                <td>
                  {{ b.leaveTypeCode }}
                </td>
                <td class="text-right">
                  <v-text-field
                    v-model.number="b.yearlyEntitlement"
                    type="number"
                    variant="underlined"
                    hide-details
                    density="compact"
                    min="0"
                    style="max-width: 90px; margin-left: auto;"
                    @change="updateRemaining(idx)"
                  />
                </td>
                <td class="text-right">
                  <v-text-field
                    v-model.number="b.used"
                    type="number"
                    variant="underlined"
                    hide-details
                    density="compact"
                    min="0"
                    style="max-width: 90px; margin-left: auto;"
                    @change="updateRemaining(idx)"
                  />
                </td>
                <td class="text-right">
                  {{ Number(b.remaining || 0).toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </v-table>

          <div v-if="profileError" class="text-caption text-error mt-2">
            {{ profileError }}
          </div>
        </v-card-text>

        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="profileDialog = false">
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="profileSaving"
            @click="saveProfile"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.text-subtitle-1 {
  letter-spacing: 0.01em;
}

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
  color: #4b5563; /* slate-ish */
}
</style>

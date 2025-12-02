<!-- src/views/expat/AdminLeaveRequests.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'

/* ─────────────────────────────
 *  LEAVE TYPES
 * ───────────────────────────── */

const loadingTypes   = ref(false)
const leaveTypes     = ref([])
const typeDialog     = ref(false)
const typeSaving     = ref(false)
const typeError      = ref('')

const editingTypeId  = ref(null)
const typeForm = ref({
  code: '',
  name: '',
  description: '',
  yearlyEntitlement: 0,
  isActive: true,
})

const typeHeaders = [
  { title: 'Code',            key: 'code',              width: 90 },
  { title: 'Name',            key: 'name',              minWidth: 140 },
  { title: 'Yearly Entitle.', key: 'yearlyEntitlement', width: 130, align: 'end' },
  { title: 'Active',          key: 'isActive',          width: 80,  align: 'center' },
  { title: 'Actions',         key: 'actions',           width: 120, align: 'end' },
]

const sortedLeaveTypes = computed(() =>
  [...leaveTypes.value].sort((a, b) => a.code.localeCompare(b.code))
)

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
  } finally {
    loadingTypes.value = false
  }
}

function openCreateType() {
  editingTypeId.value = null
  typeError.value = ''
  typeForm.value = {
    code: '',
    name: '',
    description: '',
    yearlyEntitlement: 0,
    isActive: true,
  }
  typeDialog.value = true
}

function openEditType(item) {
  editingTypeId.value = item._id
  typeError.value = ''
  typeForm.value = {
    code: item.code || '',
    name: item.name || '',
    description: item.description || '',
    yearlyEntitlement: item.yearlyEntitlement ?? 0,
    isActive: item.isActive ?? true,
  }
  typeDialog.value = true
}

async function saveType() {
  if (!typeForm.value.code || !typeForm.value.name) {
    typeError.value = 'Code and Name are required.'
    return
  }

  typeSaving.value = true
  typeError.value = ''
  try {
    const payload = { ...typeForm.value }

    if (editingTypeId.value) {
      await api.put(`/admin/leave/types/${editingTypeId.value}`, payload)
    } else {
      await api.post('/admin/leave/types', payload)
    }

    typeDialog.value = false
    await fetchLeaveTypes()
    await fetchProfiles() // refresh balances summary
  } catch (e) {
    console.error('saveType error', e)
    typeError.value = e?.response?.data?.message || 'Failed to save leave type.'
  } finally {
    typeSaving.value = false
  }
}

async function deleteType(item) {
  if (!window.confirm(`Delete leave type "${item.name}"?`)) return

  try {
    await api.delete(`/admin/leave/types/${item._id}`)
    await fetchLeaveTypes()
    await fetchProfiles()
  } catch (e) {
    console.error('deleteType error', e)
    window.alert(e?.response?.data?.message || 'Failed to delete leave type.')
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
  { title: 'Employee ID', key: 'employeeId',     width: 120 },
  { title: 'Name',        key: 'name',           minWidth: 160 },
  { title: 'Department',  key: 'department',     minWidth: 130 },
  { title: 'Join Date',   key: 'joinDate',       width: 110 },
  { title: 'Contract',    key: 'contractDate',   width: 110 },
  { title: 'Balances',    key: 'balanceSummary', minWidth: 220 },
  { title: 'Actions',     key: 'actions',        width: 110, align: 'end' },
]

function summarizeBalances(balances = []) {
  if (!balances.length) return '—'
  return balances
    .map(b => `${b.leaveTypeCode}: ${b.used ?? 0}/${b.yearlyEntitlement ?? 0}`)
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

function openEditProfile(p) {
  selectedProfile.value = p
  profileError.value = ''

  profileForm.value = {
    joinDate: p.joinDate ? dayjs(p.joinDate).format('YYYY-MM-DD') : '',
    contractDate: p.contractDate ? dayjs(p.contractDate).format('YYYY-MM-DD') : '',
    balances: ensureAllTypesInBalances(p.balances || []),
  }

  profileDialog.value = true
}

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

/* ─────────────────────────────
 *  INIT
 * ───────────────────────────── */

onMounted(async () => {
  await fetchLeaveTypes()
  await fetchProfiles()
})
</script>

<template>
  <v-container fluid class="pa-4">
    <!-- Title -->
    <v-row>
      <v-col cols="12">
        <h1 class="text-h5 font-weight-bold mb-2">
          Expat Leave – Admin Panel
        </h1>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Manage leave types and assign entitlements to expatriate employees.
        </p>
      </v-col>
    </v-row>

    <v-row>
      <!-- LEFT: Leave Types -->
      <v-col cols="12" md="4">
        <v-card rounded="xl" elevation="3" class="mb-4">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <div class="text-subtitle-1 font-weight-semibold">Leave Types</div>
              <div class="text-caption text-medium-emphasis">
                Configure available leave types &amp; yearly entitlements.
              </div>
            </div>
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              prepend-icon="mdi-plus"
              @click="openCreateType"
            >
              New
            </v-btn>
          </v-card-title>

          <v-divider />

          <v-card-text class="pa-0">
            <v-data-table
              :headers="typeHeaders"
              :items="sortedLeaveTypes"
              :loading="loadingTypes"
              density="compact"
              hide-default-footer
            >
              <template #item.isActive="{ item }">
                <v-chip
                  size="x-small"
                  :color="item.isActive ? 'green' : 'grey'"
                  variant="flat"
                >
                  {{ item.isActive ? 'Yes' : 'No' }}
                </v-chip>
              </template>

              <template #item.yearlyEntitlement="{ item }">
                {{ Number(item.yearlyEntitlement || 0).toLocaleString() }}
              </template>

              <template #item.actions="{ item }">
                <v-btn
                  icon="mdi-pencil"
                  variant="text"
                  size="small"
                  @click="openEditType(item)"
                />
                <v-btn
                  icon="mdi-delete"
                  variant="text"
                  size="small"
                  color="error"
                  @click="deleteType(item)"
                />
              </template>

              <template #loading>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  Loading leave types...
                </div>
              </template>

              <template #no-data>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  No leave types yet. Click <strong>New</strong> to create one.
                </div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- RIGHT: Expat Profiles -->
      <v-col cols="12" md="8">
        <v-card rounded="xl" elevation="3">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <div class="text-subtitle-1 font-weight-semibold">Expat Profiles</div>
              <div class="text-caption text-medium-emphasis">
                Assign join date, contract date, and leave balances.
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

              <template #item.balanceSummary="{ item }">
                {{ summarizeBalances(item.balances) }}
              </template>

              <template #item.actions="{ item }">
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

    <!-- DIALOG: Create / Edit Leave Type -->
    <v-dialog v-model="typeDialog" max-width="480">
      <v-card rounded="xl">
        <v-card-title class="pb-1">
          <span class="text-subtitle-1 font-weight-semibold">
            {{ editingTypeId ? 'Edit Leave Type' : 'New Leave Type' }}
          </span>
        </v-card-title>

        <v-card-text>
          <v-row dense>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="typeForm.code"
                label="Code"
                density="compact"
                variant="outlined"
                required
              />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="typeForm.name"
                label="Name"
                density="compact"
                variant="outlined"
                required
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="typeForm.description"
                label="Description"
                rows="2"
                density="compact"
                variant="outlined"
                auto-grow
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model.number="typeForm.yearlyEntitlement"
                label="Yearly Entitlement (days)"
                type="number"
                density="compact"
                variant="outlined"
                min="0"
              />
            </v-col>
            <v-col cols="12" sm="6" class="d-flex align-center">
              <v-switch
                v-model="typeForm.isActive"
                label="Active"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>

          <div v-if="typeError" class="text-caption text-error mt-2">
            {{ typeError }}
          </div>
        </v-card-text>

        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="typeDialog = false">
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="typeSaving"
            @click="saveType"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
            Leave Balances
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
</style>

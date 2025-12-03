<!-- src/views/expat/AdminLeaveTypes.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/utils/api'

/* ─────────────────────────────
 *  STATE
 * ───────────────────────────── */

const loadingTypes   = ref(false)
const leaveTypes     = ref([])

const typeDialog     = ref(false)
const typeSaving     = ref(false)
const typeError      = ref('')

const search         = ref('')
const activeFilter   = ref('ALL') // ALL | ACTIVE | INACTIVE

const editingTypeId  = ref(null)
const typeForm = ref({
  code: '',
  name: '',
  description: '',
  yearlyEntitlement: 0,
  requiresBalance: true,
  isActive: true,
  order: 0,
})

const typeHeaders = [
  { title: 'Code',            key: 'code',              width: 90 },
  { title: 'Name',            key: 'name',              minWidth: 160 },
  { title: 'Requires Bal.',   key: 'requiresBalance',   width: 130, align: 'center' },
  { title: 'Yearly Entitle.', key: 'yearlyEntitlement', width: 130, align: 'end' },
  { title: 'Active',          key: 'isActive',          width: 80,  align: 'center' },
  { title: 'Order',           key: 'order',             width: 80,  align: 'end' },
  { title: 'Actions',         key: 'actions',           width: 120, align: 'end' },
]

/* ─────────────────────────────
 *  HELPERS / COMPUTED
 * ───────────────────────────── */

const sortedLeaveTypes = computed(() => {
  const items = [...leaveTypes.value]

  // sort by order then code
  items.sort((a, b) => {
    const ao = Number(a.order ?? 0)
    const bo = Number(b.order ?? 0)
    if (ao !== bo) return ao - bo
    return (a.code || '').localeCompare(b.code || '')
  })

  // filter by search
  const q = search.value.trim().toLowerCase()
  let result = items
  if (q) {
    result = result.filter(t =>
      (t.code || '').toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q)
    )
  }

  // filter by active
  if (activeFilter.value === 'ACTIVE') {
    result = result.filter(t => !!t.isActive)
  } else if (activeFilter.value === 'INACTIVE') {
    result = result.filter(t => !t.isActive)
  }

  return result
})

/* ─────────────────────────────
 *  API
 * ───────────────────────────── */

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

/* ─────────────────────────────
 *  DIALOG / CRUD
 * ───────────────────────────── */

function resetForm() {
  typeForm.value = {
    code: '',
    name: '',
    description: '',
    yearlyEntitlement: 0,
    requiresBalance: true,
    isActive: true,
    order: 0,
  }
}

function openCreateType() {
  editingTypeId.value = null
  typeError.value = ''
  resetForm()
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
    requiresBalance: item.requiresBalance ?? true,
    isActive: item.isActive ?? true,
    order: item.order ?? 0,
  }
  typeDialog.value = true
}

async function saveType() {
  let { code, name } = typeForm.value
  code = String(code || '').trim().toUpperCase()
  name = String(name || '').trim()

  if (!code || !name) {
    typeError.value = 'Code and Name are required.'
    return
  }

  typeSaving.value = true
  typeError.value = ''
  try {
    const payload = {
      ...typeForm.value,
      code,
      name,
      yearlyEntitlement: Number(typeForm.value.yearlyEntitlement || 0),
      requiresBalance: !!typeForm.value.requiresBalance,
      isActive: !!typeForm.value.isActive,
      order: Number(typeForm.value.order || 0),
    }

    if (editingTypeId.value) {
      await api.put(`/admin/leave/types/${editingTypeId.value}`, payload)
    } else {
      await api.post('/admin/leave/types', payload)
    }

    typeDialog.value = false
    await fetchLeaveTypes()
  } catch (e) {
    console.error('saveType error', e)
    typeError.value = e?.response?.data?.message || 'Failed to save leave type.'
  } finally {
    typeSaving.value = false
  }
}

async function deleteType(item) {
  if (!window.confirm(`Delete leave type "${item.name}" (${item.code})?`)) return

  try {
    await api.delete(`/admin/leave/types/${item._id}`)
    await fetchLeaveTypes()
  } catch (e) {
    console.error('deleteType error', e)
    window.alert(e?.response?.data?.message || 'Failed to delete leave type.')
  }
}

/* INIT */
onMounted(fetchLeaveTypes)
</script>

<template>
  <v-container fluid class="pa-4">
    <!-- Title row -->
    <v-row>
      <v-col cols="12" class="d-flex flex-column flex-md-row align-md-center justify-md-space-between">
        <div class="mb-3 mb-md-0">
          <h1 class="text-h5 font-weight-bold mb-1">
            Leave Types
          </h1>
          <p class="text-body-2 text-medium-emphasis">
            Master data for expat leave options and yearly entitlements.
          </p>
        </div>

        <div class="d-flex flex-column flex-sm-row gap-2 align-sm-center">
          <v-text-field
            v-model="search"
            placeholder="Search code / name..."
            density="compact"
            variant="outlined"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            style="min-width: 220px;"
          />
          <v-btn-toggle
            v-model="activeFilter"
            mandatory
            density="comfortable"
            class="mt-2 mt-sm-0"
          >
            <v-btn value="ALL" size="small">All</v-btn>
            <v-btn value="ACTIVE" size="small">Active</v-btn>
            <v-btn value="INACTIVE" size="small">Inactive</v-btn>
          </v-btn-toggle>

          <v-btn
            color="primary"
            variant="flat"
            size="small"
            prepend-icon="mdi-plus"
            class="mt-2 mt-sm-0"
            @click="openCreateType"
          >
            New Type
          </v-btn>
        </div>
      </v-col>
    </v-row>

    <!-- Table -->
    <v-row>
      <v-col cols="12">
        <v-card rounded="xl" elevation="3">
          <v-card-text class="pa-0">
            <v-data-table
              :headers="typeHeaders"
              :items="sortedLeaveTypes"
              :loading="loadingTypes"
              density="compact"
              class="leave-types-table"
              hover
              hide-default-footer
            >
              <!-- Code as chip -->
              <template #item.code="{ item }">
                <v-chip size="small" variant="flat" color="primary">
                  {{ item.code }}
                </v-chip>
              </template>

              <!-- Requires Balance -->
              <template #item.requiresBalance="{ item }">
                <v-chip
                  size="x-small"
                  :color="item.requiresBalance ? 'blue' : 'grey'"
                  variant="flat"
                >
                  {{ item.requiresBalance ? 'Yes' : 'No' }}
                </v-chip>
              </template>

              <!-- Yearly Entitlement -->
              <template #item.yearlyEntitlement="{ item }">
                <span class="text-right d-inline-block" style="min-width: 60px;">
                  {{ Number(item.yearlyEntitlement || 0).toLocaleString() }}
                </span>
              </template>

              <!-- Active chip -->
              <template #item.isActive="{ item }">
                <v-chip
                  size="x-small"
                  :color="item.isActive ? 'green' : 'grey'"
                  variant="flat"
                >
                  {{ item.isActive ? 'Yes' : 'No' }}
                </v-chip>
              </template>

              <!-- Order -->
              <template #item.order="{ item }">
                <span class="text-right d-inline-block" style="min-width: 40px;">
                  {{ Number(item.order ?? 0) }}
                </span>
              </template>

              <!-- Actions -->
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

              <!-- Loading / no data -->
              <template #loading>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  Loading leave types...
                </div>
              </template>

              <template #no-data>
                <div class="pa-4 text-center text-body-2 text-medium-emphasis">
                  No leave types yet. Click <strong>New Type</strong> to create one.
                </div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- DIALOG: Create / Edit Leave Type -->
    <v-dialog v-model="typeDialog" max-width="520">
      <v-card rounded="xl">
        <v-card-title class="pb-1">
          <span class="text-subtitle-1 font-weight-semibold">
            {{ editingTypeId ? 'Edit Leave Type' : 'New Leave Type' }}
          </span>
          <div class="text-caption text-medium-emphasis mt-1">
            Define how this leave type behaves for expats.
          </div>
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
                hint="Example: AL, SL, UPL"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="typeForm.name"
                label="Name"
                density="compact"
                variant="outlined"
                required
                hint="Annual Leave, Sick Leave, Unpaid Leave..."
                persistent-hint
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
                hint="Default days per year for this type"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field
                v-model.number="typeForm.order"
                label="Display Order"
                type="number"
                density="compact"
                variant="outlined"
                min="0"
                hint="Smaller value = higher in the list"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" sm="6" class="d-flex align-center">
              <v-switch
                v-model="typeForm.requiresBalance"
                label="Requires Balance"
                density="compact"
                hide-details
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
  </v-container>
</template>

<style scoped>
.text-subtitle-1 {
  letter-spacing: 0.01em;
}

/* Small gap helper for flex layouts */
.gap-2 > * + * {
  margin-left: 0.5rem;
}

/* Improve table responsiveness a bit */
.leave-types-table :deep(table) {
  min-width: 720px;
}
@media (max-width: 960px) {
  .leave-types-table :deep(table) {
    min-width: 100%;
  }
}
</style>

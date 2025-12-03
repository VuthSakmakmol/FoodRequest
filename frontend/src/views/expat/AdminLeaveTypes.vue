<!-- src/views/expat/AdminLeaveTypes.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
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
  } catch (e) {
    console.error('deleteType error', e)
    window.alert(e?.response?.data?.message || 'Failed to delete leave type.')
  }
}

/* INIT */
onMounted(async () => {
  await fetchLeaveTypes()
})
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <v-col cols="12">
        <h1 class="text-h5 font-weight-bold mb-2">
          Leave Types
        </h1>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Configure available leave types and yearly entitlements.
        </p>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6" lg="5">
        <v-card rounded="xl" elevation="3">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <div class="text-subtitle-1 font-weight-semibold">Leave Types</div>
              <div class="text-caption text-medium-emphasis">
                Master data for expat leave request options.
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
  </v-container>
</template>

<style scoped>
.text-subtitle-1 {
  letter-spacing: 0.01em;
}
</style>

<!-- src/views/expat/RequestLeave.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/utils/api'

const emit = defineEmits(['submitted'])

/* ─────────────────────────────
 *  LEAVE TYPES (from ADMIN only)
 * ───────────────────────────── */

const loadingTypes = ref(false)
const leaveTypes   = ref([])
const typesError   = ref('')

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''

    const res = await api.get('/leave/types')
    const data = Array.isArray(res.data) ? res.data : []
    leaveTypes.value = data

    if (!data.length) {
      typesError.value = 'No leave types configured yet. Please contact admin.'
    }
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    typesError.value =
      e?.response?.data?.message ||
      'Unable to load leave types. Please contact admin.'
    leaveTypes.value = []
  } finally {
    loadingTypes.value = false
  }
}

/* ─────────────────────────────
 *  NEW LEAVE REQUEST FORM
 * ───────────────────────────── */

const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: '',
})

const submitting   = ref(false)
const formError    = ref('')
const formSuccess  = ref('')

const canSubmit = computed(() =>
  !!form.value.leaveTypeCode &&
  !!form.value.startDate &&
  !!form.value.endDate &&
  !submitting.value
)

function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: '',
    endDate: '',
    reason: '',
  }
  formError.value = ''
  formSuccess.value = ''
}

async function submitRequest() {
  if (!canSubmit.value) return

  formError.value = ''
  formSuccess.value = ''
  submitting.value = true

  try {
    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
      reason: form.value.reason || '',
    }

    await api.post('/leave/requests', payload)

    formSuccess.value = 'Leave request submitted successfully.'
    resetForm()

    // Let parent know so it can refresh MyRequests
    emit('submitted')
  } catch (e) {
    console.error('submitRequest error', e)
    formError.value = e?.response?.data?.message || 'Failed to submit leave request.'
  } finally {
    submitting.value = false
  }
}

/* INIT */
onMounted(async () => {
  await fetchLeaveTypes()
})
</script>

<template>
  <v-card rounded="xl" elevation="3">
    <v-card-title class="text-subtitle-1 font-weight-semibold pb-1">
      Request New Leave
    </v-card-title>

    <v-card-subtitle class="text-caption text-medium-emphasis pb-0">
      Choose leave type and date range, then submit for approval.
    </v-card-subtitle>

    <v-card-text>
      <v-form @submit.prevent="submitRequest">
        <v-select
          v-model="form.leaveTypeCode"
          :items="leaveTypes"
          :loading="loadingTypes"
          item-title="name"
          item-value="code"
          label="Leave Type"
          density="compact"
          variant="outlined"
          class="mb-2"
          :disabled="loadingTypes || !leaveTypes.length"
          :hint="typesError || ''"
          :persistent-hint="!!typesError"
        />

        <v-text-field
          v-model="form.startDate"
          label="Start Date"
          type="date"
          density="compact"
          variant="outlined"
          class="mb-3"
        />

        <v-text-field
          v-model="form.endDate"
          label="End Date"
          type="date"
          density="compact"
          variant="outlined"
          class="mb-3"
        />

        <v-textarea
          v-model="form.reason"
          label="Reason (optional)"
          rows="2"
          auto-grow
          density="compact"
          variant="outlined"
          class="mb-2"
        />

        <div v-if="formError" class="text-caption text-error mb-2">
          {{ formError }}
        </div>
        <div v-if="formSuccess" class="text-caption text-success mb-2">
          {{ formSuccess }}
        </div>

        <div class="d-flex justify-end mt-2">
          <v-btn
            variant="text"
            class="mr-2"
            @click="resetForm"
            :disabled="submitting"
          >
            Reset
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="submitting"
            :disabled="!canSubmit || !leaveTypes.length"
            @click="submitRequest"
          >
            Submit
          </v-btn>
        </div>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.text-success {
  color: #16a34a;
}
.text-subtitle-1 {
  letter-spacing: 0.01em;
}
</style>

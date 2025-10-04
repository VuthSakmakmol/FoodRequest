<script setup>
import { computed, watch } from 'vue'
const DEBUG = false

const props = defineProps({
  form: Object,                 // { employeeId, name, department, contactNumber, ... }
  employees: Array,
  loadingEmployees: Boolean
})
const emit = defineEmits(['updateEmployee'])

/* Build options with department + phone as subtitle */
const employeeOptions = computed(() =>
  (props.employees || []).map(e => ({
    value: String(e.employeeId || ''),
    title: `${String(e.employeeId || '')} — ${e.name || ''}`,
    subtitle: [e.department, e.contactNumber].filter(Boolean).join(' · ')
  }))
)

/* Copy fields from directory into the form */
function fillFromDirectory (id) {
  const emp = (props.employees || []).find(e => String(e.employeeId) === String(id))
  if (DEBUG) console.log('📒 fillFromDirectory id:', id, 'emp:', emp)
  props.form.name          = emp?.name || ''
  props.form.department    = emp?.department || ''
  props.form.contactNumber = emp?.contactNumber || ''
  if (DEBUG) console.log('✅ props.form.contactNumber:', props.form.contactNumber)
}

/* On select */
function onEmployeeSelected (val) {
  fillFromDirectory(val)
  emit('updateEmployee', val)
}

/* On clear (X) */
function onClear () {
  props.form.employeeId    = ''
  props.form.name          = ''
  props.form.department    = ''
  emit('updateEmployee', '')
}

/* Fill on preset id and when list arrives */
watch(
  () => [props.form.employeeId, props.employees.length],
  ([id]) => fillFromDirectory(id),
  { immediate: true }
)
</script>

<template>
  <v-sheet class="section pa-2" rounded="lg">
    <div class="hdr">
      <span class="n"><strong>1</strong></span>
      <span class="t"><strong>. Requester</strong></span>
    </div>

    <v-autocomplete
      v-model="props.form.employeeId"
      :items="employeeOptions"
      item-title="title"
      item-value="value"
      :loading="loadingEmployees"
      label="Employee | និយោជិក"
      variant="outlined"
      density="compact"
      class="mt-3"
      hide-details="auto"
      clearable
      @update:model-value="onEmployeeSelected"
      @click:clear="onClear"
    >
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps" :title="item.raw.title" :subtitle="item.raw.subtitle" />
      </template>
    </v-autocomplete>

    <v-row dense class="mt-3">
      <v-col cols="12" md="6">
        <v-text-field v-model="props.form.name" label="Name | ឈ្មោះ" readonly variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field v-model="props.form.department" label="Department | ផ្នែក" readonly variant="outlined" density="compact" hide-details />
      </v-col>
    </v-row>
  </v-sheet>
</template>

<style scoped>
.section { background: #fafafb; border: 1px dashed rgba(100,116,139,.25); }
.hdr { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.n { width:18px; height:18px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; background:#6b7280; color:#fff; font-size:11px; font-weight:700; }
:deep(.v-field__clearable) { opacity: 1 !important; } /* keep the X visible */
</style>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  form: Object,
  employees: Array,
  loadingEmployees: Boolean
})
const emit = defineEmits(['updateEmployee'])

const employeeOptions = computed(() =>
  props.employees.map(e => ({
    value: e.employeeId,
    title: `${e.employeeId} — ${e.name}`,
    subtitle: e.department
  }))
)

function onEmployeeSelected(val) {
  emit('updateEmployee', val)
}
</script>

<template>
  <v-sheet class="section pa-2" rounded="lg">
    <div class="hdr"><span class="n"><strong>1</strong></span><span class="t"><strong>. Requester</strong></span></div>

    <v-autocomplete
      v-model="form.employeeId"
      :items="employeeOptions"
      item-title="title"
      item-value="value"
      :loading="loadingEmployees"
      label="Employee"
      variant="outlined"
      density="compact"
      class="mt-3"
      hide-details="auto"
      clearable
      @update:model-value="onEmployeeSelected"
    />

    <v-row dense class="mt-1">
      <v-col cols="6">
        <v-text-field v-model="form.name" label="Name" readonly variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="6">
        <v-text-field v-model="form.department" label="Department" readonly variant="outlined" density="compact" hide-details />
      </v-col>
    </v-row>
  </v-sheet>
</template>

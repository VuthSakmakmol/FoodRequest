<!-- src/employee/carbooking/sections/RequesterSection.vue -->
<script setup>
import { computed, watch } from 'vue'

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
  props.form.name          = emp?.name || ''
  props.form.department    = emp?.department || ''
  props.form.contactNumber = emp?.contactNumber || ''
}

/* On select / clear */
function onEmployeeSelected (val) { fillFromDirectory(val); emit('updateEmployee', val) }
function onClear () {
  props.form.employeeId = ''
  props.form.name = ''
  props.form.department = ''
  props.form.contactNumber = ''
  emit('updateEmployee', '')
}

/* Fill when preset id or when list arrives */
watch(
  () => [props.form.employeeId, props.employees.length],
  ([id]) => fillFromDirectory(id),
  { immediate: true }
)
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <!-- Gradient header (match Section 2) -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-title">
          <i class="fa-solid fa-user"></i>
          <span>Requester</span>
        </div>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <v-card flat class="soft-card glass">
        <v-card-text class="pt-0 mt-4">
          <v-autocomplete
            v-model="props.form.employeeId"
            :items="employeeOptions"
            item-title="title"
            item-value="value"
            :loading="loadingEmployees"
            variant="outlined"
            density="compact"
            hide-details="auto"
            clearable
            @update:model-value="onEmployeeSelected"
            @click:clear="onClear"
          >
            <!-- custom label with red star -->
            <template #label>
              Employee<span class="required-star">*</span>
            </template>

            <template #item="{ props: ip, item }">
              <v-list-item
                v-bind="ip"
                :title="item.raw.title"
                :subtitle="item.raw.subtitle"
              />
            </template>
          </v-autocomplete>

          <v-row dense class="mt-3">
            <v-col cols="12" md="6">
              <v-text-field
                v-model="props.form.name"
                readonly
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Name<span class="required-star">*</span>
                </template>
              </v-text-field>
            </v-col>

            <v-col cols="12" md="6">
              <v-text-field
                v-model="props.form.department"
                readonly
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Department<span class="required-star">*</span>
                </template>
              </v-text-field>
            </v-col>

            <v-col cols="12" md="6">
              <v-text-field
                v-model="props.form.contactNumber"
                readonly
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Contact Number<span class="required-star">*</span>
                </template>
              </v-text-field>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
/* Match Section 2 look & feel */
.section {
  background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05));
  border: 1px solid rgba(100,116,139,.18);
  border-radius: 16px;
}

.hero {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 14px 18px;
  background: linear-gradient(90deg, #5d7884 0%, #9293d4 60%, #786e95 100%);
  color:#fff;
}
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }

.soft-card {
  border: 1px solid rgba(100,116,139,.14);
  border-radius: 14px;
}
.glass {
  background: rgba(255,255,255,.62);
  backdrop-filter: blur(6px);
}

.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; font-size: medium; }

:deep(.v-field__clearable) { opacity: 1 !important; } /* keep the X visible */

/* 🔴 make the * red and a bit bigger */
.required-star {
  color: #ef4444;       /* red-500 style */
  font-size: 20px;      /* slightly bigger than text */
  margin-left: 2px;
  line-height: 1;
}

/* 📱 Mobile: remove borders & stretch to edges to save space */
@media (max-width: 600px) {
  .section {
    border: none;
    border-radius: 0;
    margin-left: -12px;   /* match v-container padding */
    margin-right: -12px;
  }

  .hero {
    border-radius: 0;
  }

  .soft-card {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>

<!-- src/views/employee/carbooking/sections/PurposeSection.vue -->
<script setup>
import { computed } from 'vue'

const AIRPORT_DESTINATION = 'Techo International Airport'

const props = defineProps({
  form: Object,
  PURPOSES: Array,
  LOCATIONS: Array
})

/* Purpose handling: sort A → Z for easier scanning */
const purposeItems = computed(() => {
  const base = Array.isArray(props.PURPOSES) ? [...props.PURPOSES] : []
  return base.sort((a, b) => String(a).localeCompare(String(b)))
})

/* Destination handling: A→Z, with "Other" always at the bottom */
const destinationItems = computed(() => {
  const base = Array.isArray(props.LOCATIONS) ? [...props.LOCATIONS] : []

  if (!base.includes(AIRPORT_DESTINATION)) base.push(AIRPORT_DESTINATION)
  if (!base.includes('Other')) base.push('Other')

  // sort everything except "Other"
  const others = base.filter(x => x !== 'Other')
  others.sort((a, b) => String(a).localeCompare(String(b)))

  return [...others, 'Other']
})

const hasAirport = computed(() =>
  (props.form.stops || []).some(s => s.destination === AIRPORT_DESTINATION)
)

function addStop() {
  props.form.stops.push({ destination: '', destinationOther: '', mapLink: '' })
}
function removeStop(i) {
  props.form.stops.splice(i, 1)
  if (!props.form.stops.length) addStop()
}
function onDestinationChange(row) {
  if (row.destination !== 'Other') {
    row.destinationOther = ''
    row.mapLink = ''
  }
}
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <div class="hero">
      <div class="hero-title">
        <i class="fa-solid fa-clipboard-check"></i>
        <span>Purpose</span>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <v-card flat class="soft-card glass">
        <v-card-text class="pt-0">
          <v-row dense>
            <!-- Purpose: sorted + searchable -->
            <v-col cols="12" class="mt-4">
              <v-autocomplete
                v-model="props.form.purpose"
                :items="purposeItems"
                variant="outlined"
                density="compact"
                hide-details="auto"
                :menu-props="{ maxHeight: 320 }"
                :rules="[ v => !!v || 'Purpose is required' ]"
                clearable
              >
                <template #label>
                  Purpose<span class="required-star">*</span>
                </template>
              </v-autocomplete>
            </v-col>

            <!-- Notes -->
            <v-col cols="12">
              <v-textarea
                v-model="props.form.notes"
                auto-grow
                rows="2"
                variant="outlined"
                density="compact"
                hide-details="auto"
              >
                <template #label>
                  Notes / Special Instructions<span class="required-star"></span>
                </template>
              </v-textarea>
            </v-col>

            <!-- Airplane ticket upload (only when airport selected) -->
            <v-col v-if="hasAirport" cols="12">
              <v-file-input
                v-model="props.form.ticketFile"
                variant="outlined"
                density="compact"
                accept="image/*,application/pdf"
                prepend-icon="mdi-paperclip"
                hide-details="auto"
              >
                <template #label>
                  Airplane ticket (required for Techo International Airport)
                  <span class="required-star">*</span>
                </template>
              </v-file-input>
              <div class="text-caption text-error mt-1">
                This file is required when your destination includes Techo International Airport.
              </div>
            </v-col>
          </v-row>

          <v-divider class="my-4"></v-divider>

          <!-- Destination -->
          <v-card flat class="mb-2 soft-card glass">
            <v-card-text class="pt-0">
              <v-expansion-panels variant="accordion" density="compact">
                <v-expansion-panel
                  v-for="(row, idx) in props.form.stops"
                  :key="idx"
                  elevation="0"
                  class="mb-2 rounded-lg dashed"
                >
                  <v-expansion-panel-title>
                    <div class="row-title">
                      <div class="num">{{ idx + 1 }}</div>
                      <div class="txt">
                        {{ row.destination === 'Other'
                          ? (row.destinationOther || 'Other')
                          : (row.destination || 'Destination') }}
                      </div>
                    </div>
                  </v-expansion-panel-title>

                  <v-expansion-panel-text>
                    <v-row dense class="align-center">
                      <v-col cols="12" md="12">
                        <!-- 🔍 Destination as autocomplete (search + scroll) -->
                        <v-autocomplete
                          v-model="row.destination"
                          :items="destinationItems"
                          variant="outlined"
                          density="compact"
                          hide-details="auto"
                          clearable
                          :menu-props="{ maxHeight: 320 }"
                          @update:model-value="onDestinationChange(row)"
                          :rules="[ v => !!v || 'Destination is required' ]"
                        >
                          <template #label>
                            Destination #{{ idx + 1 }}<span class="required-star">*</span>
                          </template>
                        </v-autocomplete>
                      </v-col>

                      <!-- Required when destination = Other -->
                      <v-col v-if="row.destination === 'Other'" cols="12" md="12">
                        <v-text-field
                          v-model="row.destinationOther"
                          variant="outlined"
                          density="compact"
                          hide-details="auto"
                          :rules="[
                            v =>
                              row.destination !== 'Other' ||
                              !!(v && String(v).trim()) ||
                              'Please enter destination name'
                          ]"
                        >
                          <template #label>
                            Destination Name (Other)<span class="required-star">*</span>
                          </template>
                        </v-text-field>
                      </v-col>

                      <v-col v-if="row.destination === 'Other'" cols="12" md="12">
                        <v-text-field
                          v-model="row.mapLink"
                          placeholder="https://maps.google.com/…"
                          variant="outlined"
                          density="compact"
                          hide-details="auto"
                          :rules="[
                            v =>
                              row.destination !== 'Other' ||
                              !!(v && String(v).trim()) ||
                              'Google Maps link is required'
                          ]"
                        >
                          <template #label>
                            Google Maps Link<span class="required-star">*</span>
                          </template>
                        </v-text-field>
                      </v-col>

                      <v-col cols="12" md="auto" class="d-flex justify-end mt-2 mt-md-0">
                        <v-btn
                          color="error"
                          variant="text"
                          size="small"
                          class="remove-btn"
                          @click="removeStop(idx)"
                        >
                          <i class="fa-solid fa-trash"></i>
                          <span class="ml-1">Remove</span>
                        </v-btn>
                      </v-col>
                    </v-row>
                  </v-expansion-panel-text>
                </v-expansion-panel>

                <v-card-title class="subhdr between">
                  <v-btn size="x-small" class="btn-grad" @click="addStop">
                    <i class="fa-solid fa-plus"></i>&nbsp; Add destination
                  </v-btn>
                </v-card-title>
              </v-expansion-panels>
            </v-card-text>
          </v-card>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
.section {
  background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05));
  border: 1px solid rgba(100,116,139,.18);
  border-radius: 16px;
}
.hero {
  padding:14px 18px;
  background:linear-gradient(90deg,#5d7884,#9293d4 60%,#786e95);
  color:#fff;
  display:flex;
  align-items:center;
  gap:10px;
  font-weight:700;
}
.soft-card {
  border: 1px solid rgba(100,116,139,.14);
  border-radius:14px;
}
.glass {
  background: rgba(255,255,255,.62);
  backdrop-filter: blur(6px);
}
.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; }
.subhdr.between { justify-content:space-between; }
.dashed { border:1px dashed rgba(100,116,139,.25); }
.row-title { display:flex; align-items:center; gap:10px; }
.row-title .num {
  width:22px;
  height:22px;
  border-radius:999px;
  background:linear-gradient(135deg,#22d3ee,#6366f1);
  color:#fff;
  display:flex;
  justify-content:center;
  align-items:center;
  font-size:12px;
  font-weight:800;
}
.remove-btn { color:#ef4444; }
.btn-grad { background:linear-gradient(90deg,#22d3ee,#6366f1); color:#fff; }
.btn-grad:hover { filter:brightness(1.05); }

.required-star {
  color: #fd0000;
  font-size: 1.2em;
  margin-left: 2px;
  line-height: 1;
}

@media (max-width: 600px) {
  .section {
    border: none;
    border-radius: 0;
    margin-left: -12px;
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

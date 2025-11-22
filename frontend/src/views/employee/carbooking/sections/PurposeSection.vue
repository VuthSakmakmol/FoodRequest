<script setup>
import { computed } from 'vue'

const props = defineProps({
  form: Object,
  PURPOSES: Array,
  LOCATIONS: Array
})

/* Destination handling */
const destinationItems = computed(() => {
  const base = Array.isArray(props.LOCATIONS) ? props.LOCATIONS.slice() : []
  if (!base.includes('Airport')) base.unshift('Airport')
  if (!base.includes('Other')) base.push('Other')
  return base
})

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
            <v-col cols="12" class="mt-4">
              <v-select
                :items="PURPOSES"
                v-model="props.form.purpose"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Purpose<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>

            <v-col cols="12">
              <v-textarea
                v-model="props.form.notes"
                auto-grow
                rows="2"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Notes / Special Instructions<span class="required-star">*</span>
                </template>
              </v-textarea>
            </v-col>
          </v-row>

          <v-divider class="my-4"></v-divider>

          <!-- Destination -->
          <v-card flat class="mb-2 soft-card glass">
            <v-card-title class="subhdr between">
              <v-btn size="x-small" class="btn-grad" @click="addStop">
                <i class="fa-solid fa-plus"></i>&nbsp; Add destination
              </v-btn>
            </v-card-title>

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
                      <v-col cols="12" md="3">
                        <v-select
                          :items="destinationItems"
                          v-model="row.destination"
                          variant="outlined"
                          density="compact"
                          hide-details
                          @update:model-value="onDestinationChange(row)"
                        >
                          <template #label>
                            Destination #{{ idx + 1 }}<span class="required-star">*</span>
                          </template>
                        </v-select>
                      </v-col>

                      <v-col v-if="row.destination === 'Other'" cols="12" md="4">
                        <v-text-field
                          v-model="row.destinationOther"
                          variant="outlined"
                          density="compact"
                          hide-details
                        >
                          <template #label>
                            Destination Name (Other)<span class="required-star">*</span>
                          </template>
                        </v-text-field>
                      </v-col>

                      <v-col v-if="row.destination === 'Other'" cols="12" md="4">
                        <v-text-field
                          v-model="row.mapLink"
                          placeholder="https://maps.google.com/…"
                          variant="outlined"
                          density="compact"
                          hide-details
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

/* 🔴 red, slightly bigger star for required fields */
.required-star {
  color: #fd0000;
  font-size: 1.2em;
  margin-left: 2px;
  line-height: 1;
}

/* 📱 Mobile: remove borders & stretch to edges to save space */
@media (max-width: 600px) {
  .section {
    border: none;
    border-radius: 0;
    margin-left: -12px;  /* match v-container horizontal padding */
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

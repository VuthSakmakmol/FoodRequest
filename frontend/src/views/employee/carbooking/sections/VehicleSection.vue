<!-- src/employee/carbooking/sections/PurposeSection.vue -->
<script setup>
const props = defineProps({
  form: Object,       // expects { purpose, notes, ... }
  PURPOSES: Array     // e.g. ['Customer Visit','Airport Pickup','Delivery','Internal Meeting','Other']
})
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <!-- Gradient header (match Section 2) -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-title">
          <i class="fa-solid fa-clipboard-check"></i>
          <span>Purpose</span>
        </div>
        <div class="hero-sub">Tell us why you need this trip and add any special instructions.</div>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <v-card flat class="soft-card glass">
        <v-card-title class="subhdr">
          <i class="fa-solid fa-bullseye"></i>
          <span>Trip Purpose</span>
        </v-card-title>

        <v-card-text class="pt-0">
          <v-row dense>
            <v-col cols="12" md="6">
              <v-select
                :items="PURPOSES"
                v-model="props.form.purpose"
                label="Purpose"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>

            <v-col cols="12" md="12">
              <v-textarea
                v-model="props.form.notes"
                label="Notes / Special Instructions"
                auto-grow
                rows="2"
                variant="outlined"
                density="compact"
                hide-details
                placeholder="Anything the driver/dispatcher should know (e.g., gate pass needed, contact person on arrival)…"
                class="mt-2"
              />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
/* Match Section 2 look & feel */
.section { background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); border: 1px solid rgba(100,116,139,.18); }
.hero { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background: linear-gradient(90deg, #0ea5e9 0%, #6366f1 60%, #a78bfa 100%); color:#fff; }
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }

.soft-card { border: 1px solid rgba(100,116,139,.14); border-radius: 14px; }
.glass { background: rgba(255,255,255,.62); backdrop-filter: blur(6px); }

.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; }
</style>

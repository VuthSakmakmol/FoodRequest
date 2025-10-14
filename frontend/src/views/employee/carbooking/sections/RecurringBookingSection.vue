<!-- src/employee/carbooking/sections/RecurringBookingSection.vue -->
<script setup>
const props = defineProps({
  form: Object // expects { recurring, frequency, endDate, skipHolidays }
})
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden mt-2" rounded="lg">
    <!-- Gradient header (match Section 2 look) -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-title">
          <i class="fa-solid fa-rotate-right"></i>
          <span>Recurring Booking</span>
        </div>
        <div class="hero-sub">Repeat this trip on a regular schedule until the end date.</div>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <v-card flat class="soft-card glass">
        <v-card-text class="pt-3">
          <v-row dense align="center">
            <v-col cols="12" md="4">
              <v-switch
                v-model="props.form.recurring"
                inset color="primary"
                label="Enable recurring"
                hide-details
              />
            </v-col>

            <template v-if="props.form.recurring">
              <v-col cols="12" md="3">
                <v-select
                  :items="['DAILY','WEEKLY','MONTHLY']"
                  v-model="props.form.frequency"
                  label="Frequency"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>

              <v-col cols="12" md="3">
                <v-text-field
                  v-model="props.form.endDate"
                  type="date"
                  label="End date"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>

              <v-col cols="12" md="2">
                <v-switch
                  v-model="props.form.skipHolidays"
                  inset color="primary"
                  label="Skip holidays"
                  hide-details
                />
              </v-col>
            </template>
          </v-row>

          <v-alert
            v-if="props.form.recurring"
            class="mt-2"
            variant="tonal"
            type="info"
            border="start"
            density="comfortable"
          >
            Recurring requests are subject to vehicle availability each day.
          </v-alert>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
.section { background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); border: 1px solid rgba(100,116,139,.18); }
.hero { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background: linear-gradient(90deg, #5d7884 0%, #9293d4 60%, #786e95 100%); color:#fff; }
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }

.soft-card { border: 1px solid rgba(100,116,139,.14); border-radius: 14px; }
.glass { background: rgba(255,255,255,.62); backdrop-filter: blur(6px); }
</style>

<!-- src/views/employee/carBooking/sections/PurposeSection.vue -->
<script setup>
import { computed, ref, watch } from 'vue'

const AIRPORT_DESTINATION = 'Techo International Airport'

const props = defineProps({
  form: Object,
  PURPOSES: Array,
  LOCATIONS: Array
})

/* ---------- PURPOSE DROPDOWN + SEARCH ---------- */
const purposeItems = computed(() => {
  const base = Array.isArray(props.PURPOSES) ? [...props.PURPOSES] : []
  return base.sort((a, b) => String(a).localeCompare(String(b)))
})

const purposeSearch = ref('')
const purposeOpen = ref(false)

watch(
  () => props.form.purpose,
  (val) => { purposeSearch.value = val || '' },
  { immediate: true }
)

const filteredPurposes = computed(() => {
  const q = purposeSearch.value.trim().toLowerCase()
  if (!q) return purposeItems.value
  return purposeItems.value.filter(p =>
    String(p).toLowerCase().includes(q)
  )
})

function onPurposeInput (e) {
  const val = e?.target?.value || ''
  purposeSearch.value = val
  props.form.purpose = val
  purposeOpen.value = true
}
function selectPurpose (p) {
  props.form.purpose = p
  purposeSearch.value = p
  purposeOpen.value = false
}

/* ---------- DESTINATIONS ---------- */
const destinationItems = computed(() => {
  const base = Array.isArray(props.LOCATIONS) ? [...props.LOCATIONS] : []
  if (!base.includes(AIRPORT_DESTINATION)) base.push(AIRPORT_DESTINATION)
  if (!base.includes('Other')) base.push('Other')

  const others = base.filter(x => x !== 'Other')
  others.sort((a, b) => String(a).localeCompare(String(b)))
  return [...others, 'Other']
})

const hasAirport = computed(() =>
  (props.form.stops || []).some(s => s.destination === AIRPORT_DESTINATION)
)

function addStop () {
  props.form.stops.push({ destination: '', destinationOther: '', mapLink: '' })
}
function removeStop (i) {
  props.form.stops.splice(i, 1)
  if (!props.form.stops.length) addStop()
}
function onDestinationChange (row) {
  if (row.destination !== 'Other') {
    row.destinationOther = ''
    row.mapLink = ''
  }
}

/* ticket input */
function onTicketChange (e) {
  const files = e?.target?.files || []
  props.form.ticketFile = files[0] || null
}
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- header -->
    <header
      class="flex items-center gap-2
             rounded-t-2xl border-b border-slate-200
             rounded-t-2xl
               bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
               px-4 py-3 text-white"
    >
      <span class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">Purpose</span>
    </header>

      <div
        class="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/80"
      >
        <!-- PURPOSE + NOTES -->
        <div class="space-y-3 text-xs text-slate-800 dark:text-slate-100">
          <!-- Purpose dropdown + search -->
          <div class="mt-1">
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Purpose</span>
              <span class="required-star">*</span>
            </label>

            <div class="relative mt-1">
              <input
                :value="purposeSearch"
                @input="onPurposeInput"
                @focus="purposeOpen = true"
                @keydown.esc.prevent="purposeOpen = false"
                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 pr-7 text-xs
                       text-slate-900 outline-none
                       focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Type or search purpose…"
              />

              <!-- chevron icon -->
              <button
                type="button"
                class="absolute inset-y-0 right-1 flex items-center px-1 text-slate-400 hover:text-slate-600"
                @click="purposeOpen = !purposeOpen"
              >
                <i
                  :class="[
                    'fa-solid text-[10px] transition-transform',
                    purposeOpen ? 'fa-chevron-up' : 'fa-chevron-down'
                  ]"
                />
              </button>

              <!-- dropdown -->
              <div
                v-if="purposeOpen"
                class="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200
                       bg-white text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                <button
                  v-for="p in filteredPurposes"
                  :key="p"
                  type="button"
                  class="flex w-full items-start px-3 py-1.5 text-left hover:bg-slate-100
                         dark:hover:bg-slate-800"
                  @click="selectPurpose(p)"
                >
                  <span class="truncate">{{ p }}</span>
                </button>

                <div
                  v-if="!filteredPurposes.length"
                  class="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400"
                >
                  No match. Press Enter to keep current text.
                </div>
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div>
            <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              Notes / Special Instructions
            </label>
            <textarea
              v-model="props.form.notes"
              rows="3"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs
                     text-slate-900 outline-none
                     focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Anything the driver or messenger should know…"
            />
          </div>

          <!-- Ticket (only when airport in stops) -->
          <div v-if="hasAirport">
            <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>Airplane ticket (required for Techo International Airport)</span>
              <span class="required-star">*</span>
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              @change="onTicketChange"
              class="mt-1 block w-full rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1.5 text-xs
                     file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5
                     file:text-xs file:font-medium
                     hover:file:bg-slate-200
                     dark:border-slate-600 dark:bg-slate-900
                     dark:file:bg-slate-800 dark:text-slate-100"
            />
            <p class="mt-1 text-[11px] text-red-600">
              This file is required when your destination includes Techo International Airport.
            </p>
          </div>
        </div>

        <!-- DESTINATIONS -->
        <div
          class="mt-4 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
                 dark:border-slate-700 dark:bg-slate-950/80"
        >
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-50">
              <i class="fa-solid fa-location-dot text-[11px]"></i>
              <span>Destinations</span>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500
                     px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm
                     hover:brightness-105"
              @click="addStop"
            >
              <i class="fa-solid fa-plus text-[10px]"></i>
              <span>Add destination</span>
            </button>
          </div>

          <div class="space-y-3">
            <div
              v-for="(row, idx) in props.form.stops"
              :key="idx"
              class="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-3
                     dark:border-slate-600 dark:bg-slate-900/70"
            >
              <!-- card header -->
              <div class="mb-2 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div
                    class="flex h-6 w-6 items-center justify-center rounded-full
                           bg-gradient-to-br from-cyan-400 to-indigo-500 text-[11px] font-bold text-white"
                  >
                    {{ idx + 1 }}
                  </div>
                  <div class="text-xs font-semibold text-slate-800 dark:text-slate-50">
                    {{ row.destination === 'Other'
                      ? (row.destinationOther || 'Other')
                      : (row.destination || 'Destination') }}
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium
                         text-red-600 hover:bg-red-50 dark:hover:bg-red-900/40"
                  @click="removeStop(idx)"
                >
                  <i class="fa-solid fa-trash text-[10px]"></i>
                  <span>Remove</span>
                </button>
              </div>

              <!-- fields -->
              <div class="space-y-2 text-xs">
                <!-- Destination -->
                <div>
                  <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                    <span>Destination #{{ idx + 1 }}</span>
                    <span class="required-star">*</span>
                  </label>
                  <select
                    v-model="row.destination"
                    @change="onDestinationChange(row)"
                    class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                           text-slate-900 outline-none
                           focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                           dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Select destination</option>
                    <option
                      v-for="d in destinationItems"
                      :key="d"
                      :value="d"
                    >
                      {{ d }}
                    </option>
                  </select>
                </div>

                <!-- Other name -->
                <div v-if="row.destination === 'Other'">
                  <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                    <span>Destination Name (Other)</span>
                    <span class="required-star">*</span>
                  </label>
                  <input
                    v-model="row.destinationOther"
                    type="text"
                    class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                           text-slate-900 outline-none
                           focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                           dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Enter destination name"
                  />
                </div>

                <!-- Google Maps link -->
                <div v-if="row.destination === 'Other'">
                  <label class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                    <span>Google Maps Link</span>
                    <span class="required-star">*</span>
                  </label>
                  <input
                    v-model="row.mapLink"
                    type="url"
                    class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                           text-slate-900 outline-none
                           focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                           dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="https://maps.google.com/…"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  </section>
</template>

<style scoped>
.required-star {
  color: #ef4444;
  font-size: 1.1em;
  margin-left: 2px;
  line-height: 1;
}
</style>

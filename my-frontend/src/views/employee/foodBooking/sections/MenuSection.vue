<!-- src/components/MenuSection.vue -->
<script setup>
import { computed, watch } from 'vue'

const props = defineProps({
  form: { type: Object, required: true },
  MENU_CHOICES: {
    type: Array,
    default: () => ['Standard', 'Vegetarian', 'Vegan', 'No pork', 'No beef'],
  },
  ALLERGENS: {
    type: Array,
    default: () => ['Peanut', 'Shellfish', 'Egg', 'Gluten', 'Dairy/Lactose', 'Soy', 'Others'],
  },
  showOtherAllergy: { type: Boolean, default: true },
})

/* Khmer display labels (values stay English) */
const MENU_KM = {
  Standard: 'ញាំទូទៅ',
  Vegetarian: 'មិនញាំសាច់',
  Vegan: 'ញាំបួស',
  'No pork': 'តមសាច់ជ្រូក',
  'No beef': 'តមសាច់គោ',
}
const ALLERGEN_KM = {
  Peanut: 'សណ្តែកដី',
  Shellfish: 'សត្វសំបកសមុទ្រ',
  Egg: 'ស៊ុត',
  Gluten: 'គ្លុយតែន',
  'Dairy/Lactose': 'ទឹកដោះគោ/ឡាក់តូស',
  Soy: 'សណ្តែកសៀង',
  Others: 'ផ្សេងទៀត',
}

/* Helper: safe array for selection */
const selectedMenus = computed(() =>
  Array.isArray(props.form.menuChoices) ? props.form.menuChoices : []
)
const selectedDietary = computed(() =>
  Array.isArray(props.form.dietary) ? props.form.dietary : []
)

/* ---- From-menu items (DEDUPE + guarantee Standard exactly once) ---- */
const dietaryMenuItems = computed(() => {
  const base = selectedMenus.value
  const withStd = ['Standard', ...base]
  const uniq = Array.from(new Set(withStd))
  return uniq.map(v => ({ value: v, title: v, subtitle: MENU_KM[v] }))
})

/* toggle helper */
function toggleArrayValue(arr, val) {
  return Array.isArray(arr) && arr.includes(val)
    ? arr.filter(x => x !== val)
    : [...(arr || []), val]
}

/* --- Menu math (same as original) --- */
const assignedMenus = computed(() => {
  const map = props.form?.menuCounts || {}
  let total = 0
  for (const key in map) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue
    if (key === 'Standard') continue
    total += Number(map[key] || 0)
  }
  return total
})

const standardCount = computed(() => {
  const total = Number(props.form?.quantity || 0)
  const used = assignedMenus.value
  return Math.max(total - used, 0)
})

/* limits for dietary allocations – independent pool but capped by total quantity */
function menuLimit() {
  return Number(props.form?.quantity || 0)
}

/* guards */
function clampNonNegativeNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
function ensureMenuCountKey(mc) {
  if (mc === 'Standard') return
  if (!props.form.menuCounts) props.form.menuCounts = {}
  if (props.form.menuCounts[mc] == null) props.form.menuCounts[mc] = 0
}
function onMenuCountInput(mc) {
  if (mc === 'Standard') return
  ensureMenuCountKey(mc)
  props.form.menuCounts[mc] = clampNonNegativeNumber(props.form.menuCounts[mc])
}
function ensureDietaryKey(item) {
  if (!props.form.dietaryCounts) props.form.dietaryCounts = {}
  if (!props.form.dietaryCounts[item]) {
    props.form.dietaryCounts[item] = { count: 0, menu: 'Standard' }
  }
}
function onDietaryCountInput(item) {
  ensureDietaryKey(item)
  props.form.dietaryCounts[item].count = clampNonNegativeNumber(
    props.form.dietaryCounts[item].count
  )
}

/* cleanup if a special menu gets unselected, wipe its count so Standard rises back */
watch(
  () => selectedMenus.value.slice(),
  choices => {
    if (!props.form.menuCounts) return
    const set = new Set(choices)
    for (const key of Object.keys(props.form.menuCounts)) {
      if (key === 'Standard') {
        delete props.form.menuCounts.Standard
        continue
      }
      if (!set.has(key)) delete props.form.menuCounts[key]
    }
  }
)
</script>

<template>
  <!-- OUTER CARD like Requester -->
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- Gradient header (same style as Requester) -->
    <header
      class="flex items-center justify-between
             rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
             px-4 py-3 text-white
             dark:border-slate-700"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-8 w-8 items-center justify-center rounded-2xl
                 bg-white/90 text-sky-700 text-sm shadow-sm"
        >
          <i class="fa-solid fa-utensils" />
        </span>
        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">
            Menu &amp; Dietary
          </h2>
        </div>
      </div>
    </header>

    <!-- INNER CARD BODY (same pattern as Requester body) -->
    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-3
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="space-y-6">
          <!-- Menu choices -->
          <div class="space-y-3">
            <h3
              class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em]
                     text-slate-500 dark:text-slate-400"
            >
              <i class="fa-solid fa-bowl-food text-[13px] text-sky-500"></i>
              <span>Menu Choices</span>
            </h3>

            <!-- Compact grid -->
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
              <div
                v-for="mc in MENU_CHOICES"
                :key="mc"
                class="space-y-2"
              >
                <!-- Toggle button -->
                <button
                  type="button"
                  class="flex w-full flex-col rounded-xl border px-3 py-2.5 text-left text-xs
                         font-semibold shadow-sm transition sm:text-[13px]"
                  :class="
                    selectedMenus.includes(mc)
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-500 bg-slate-50/80 text-slate-700 hover:border-sky-500 hover:bg-sky-50/60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-sky-400 dark:hover:bg-slate-800/80'
                  "
                  @click="
                    props.form.menuChoices = toggleArrayValue(selectedMenus, mc);
                    if (mc !== 'Standard') ensureMenuCountKey(mc);
                  "
                >
                  <span class="flex items-center gap-1 text-[13px] font-semibold leading-tight">
                    <span>{{ mc }}</span>
                    <span
                      v-if="mc === 'Standard'"
                      class="text-[10px] font-medium"
                      :class="
                        selectedMenus.includes(mc)
                          ? 'text-sky-50/90'
                          : 'text-slate-500 dark:text-slate-300'
                      "
                    >
                      ({{ standardCount }})
                    </span>
                  </span>
                  <span
                    class="mt-0.5 text-[11px] km leading-snug"
                    :class="
                      selectedMenus.includes(mc)
                        ? 'text-sky-50/90'
                        : 'text-slate-500 dark:text-slate-400'
                    "
                  >
                    {{ MENU_KM[mc] }}
                  </span>
                </button>

                <!-- People input (Standard readonly) -->
                <div class="flex items-center gap-2 pl-0.5">
                  <span class="w-12 text-[11px] text-slate-600 dark:text-slate-300">
                    People
                  </span>

                  <!-- Non-standard -->
                  <input
                    v-if="mc !== 'Standard'"
                    v-model.number="props.form.menuCounts[mc]"
                    type="number"
                    min="0"
                    :max="props.form.quantity"
                    :disabled="!selectedMenus.includes(mc)"
                    class="w-20 rounded-md border border-slate-500 bg-white px-2 py-1 text-xs
                           text-slate-900 outline-none
                           focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                           disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400
                           dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50
                           dark:disabled:bg-slate-800/70 dark:disabled:text-slate-500"
                    @input="onMenuCountInput(mc)"
                  />

                  <!-- Standard: auto & readonly -->
                  <input
                    v-else
                    :value="standardCount"
                    type="number"
                    disabled
                    class="w-20 cursor-not-allowed rounded-md border border-slate-500 bg-slate-100
                           px-2 py-1 text-xs text-slate-600
                           dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div
            class="h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent
                   dark:via-slate-700"
          ></div>

          <!-- Allergies (2-row grid) -->
          <div class="space-y-3">
            <h3
              class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em]
                     text-slate-500 dark:text-slate-400"
            >
              <i class="fa-solid fa-triangle-exclamation text-[13px] text-sky-500"></i>
              <span>Dietary &amp; Allergies</span>
            </h3>

            <div class="grid grid-rows-2 grid-flow-col gap-3">
              <div
                v-for="item in ALLERGENS"
                :key="item"
                class="space-y-2 rounded-xl px-2 py-2"
                :class="
                  selectedDietary.includes(item)
                    ? 'border border-sky-200/70 bg-sky-50/80 dark:border-sky-800/60 dark:bg-sky-900/30'
                    : 'border border-transparent'
                "
              >
                <button
                  type="button"
                  class="flex w-full flex-col rounded-lg border px-2.5 py-1.5 text-left text-[12px]
                         shadow-sm transition"
                  :class="
                    selectedDietary.includes(item)
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-500 bg-slate-50/80 text-slate-700 hover:border-sky-500 hover:bg-sky-50/60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-sky-400 dark:hover:bg-slate-800/80'
                  "
                  @click="
                    props.form.dietary = toggleArrayValue(selectedDietary, item);
                    ensureDietaryKey(item);
                  "
                >
                  <span class="text-[13px] font-semibold leading-tight">
                    {{ item }}
                  </span>
                  <span
                    class="mt-0.5 text-[11px] km leading-snug"
                    :class="
                      selectedDietary.includes(item)
                        ? 'text-sky-50/90'
                        : 'text-slate-500 dark:text-slate-400'
                    "
                  >
                    {{ ALLERGEN_KM[item] }}
                  </span>
                </button>

                <div
                  v-if="selectedDietary.includes(item)"
                  class="space-y-1 pt-1"
                >
                  <label class="block text-[11px] text-slate-600 dark:text-slate-300">
                    From menu
                  </label>
                  <select
                    v-model="props.form.dietaryCounts[item].menu"
                    class="w-full rounded-md border border-slate-500 bg-white px-2 py-1 text-xs
                           focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                           dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
                  >
                    <option
                      v-for="opt in dietaryMenuItems"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.title }} — {{ opt.subtitle }}
                    </option>
                  </select>

                  <label class="mt-1 block text-[11px] text-slate-600 dark:text-slate-300">
                    People
                  </label>
                  <input
                    v-model.number="props.form.dietaryCounts[item].count"
                    type="number"
                    min="0"
                    :max="menuLimit()"
                    class="w-full rounded-md border border-slate-500 bg-white px-2 py-1 text-xs
                           focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                           dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
                    @input="onDietaryCountInput(item)"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div
            class="h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent
                   dark:via-slate-700"
          ></div>

          <!-- Other & notes -->
          <div class="space-y-3">
            <h3
              class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em]
                     text-slate-500 dark:text-slate-400"
            >
              <i class="fa-solid fa-clipboard-list text-[13px] text-sky-500"></i>
              <span>Other &amp; Notes</span>
            </h3>

            <div class="space-y-2">
              <div v-if="showOtherAllergy" class="space-y-1">
                <label
                  class="block text-[11px] font-medium text-slate-700 dark:text-slate-300"
                >
                  Other allergy (specify)
                </label>
                <input
                  v-model="props.form.dietaryOther"
                  type="text"
                  class="w-full rounded-md border border-slate-500 bg-white px-3 py-1.5 text-xs
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
                  placeholder="Describe other food allergy"
                />
              </div>

              <div class="space-y-1">
                <label
                  class="block text-[11px] font-medium text-slate-700 dark:text-slate-300"
                >
                  Special instructions
                </label>
                <textarea
                  v-model="props.form.specialInstructions"
                  rows="2"
                  class="w-full rounded-md border border-slate-500 bg-white px-3 py-1.5 text-xs
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
                  placeholder="Any extra note for chef (spicy, less oil, etc.)"
                ></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.km {
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
    'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}
</style>

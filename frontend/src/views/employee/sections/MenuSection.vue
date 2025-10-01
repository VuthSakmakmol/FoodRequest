<!-- src/components/MenuSection.vue -->
<script setup>
import { computed, watch } from 'vue'

const props = defineProps({
  form: { type: Object, required: true },
  MENU_CHOICES: {
    type: Array,
    default: () => ['Standard','Vegetarian','Vegan','No pork','No beef']
  },
  ALLERGENS: {
    type: Array,
    default: () => ['Peanut','Shellfish','Egg','Gluten','Dairy/Lactose','Soy','Others']
  },
  showOtherAllergy: { type: Boolean, default: true }
})

/* Khmer display labels (values stay English) */
const MENU_KM = {
  Standard: 'ញាំទូទៅ',
  Vegetarian: 'មិនញាំសាច់',
  Vegan: 'ញាំបួស',
  'No pork': 'តមសាច់ជ្រូក',
  'No beef': 'តមសាច់គោ'
}
const ALLERGEN_KM = {
  Peanut: 'សណ្តែកដី',
  Shellfish: 'សត្វសំបកសមុទ្រ',
  Egg: 'ស៊ុត',
  Gluten: 'គ្លុយតែន',
  'Dairy/Lactose': 'ទឹកដោះគោ/ឡាក់តូស',
  Soy: 'សណ្តែកសៀង',
  Others: 'ផ្សេងទៀត'
}

/* ---- From-menu items (DEDUPE + guarantee Standard exactly once) ---- */
const dietaryMenuItems = computed(() => {
  const base = (props.form.menuChoices?.length ? props.form.menuChoices : [])
  const withStd = ['Standard', ...base]
  const uniq = Array.from(new Set(withStd))
  return uniq.map(v => ({ value: v, title: v, subtitle: MENU_KM[v] }))
})

/* toggle helper */
function toggleArrayValue(arr, val) {
  return Array.isArray(arr) && arr.includes(val)
    ? arr.filter(x => x !== val)
    : [ ...(arr || []), val ]
}

/* --- Menu math --- */
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

/* limits for dietary allocations */
function menuLimit(menuName) {
  if (!menuName) return Number(props.form?.quantity || 0)
  if (menuName === 'Standard') return standardCount.value
  return Number((props.form?.menuCounts || {})[menuName] || 0)
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
  if (!props.form.dietaryCounts[item]) props.form.dietaryCounts[item] = { count: 0, menu: null }
}
function onDietaryCountInput(item) {
  ensureDietaryKey(item)
  props.form.dietaryCounts[item].count = clampNonNegativeNumber(props.form.dietaryCounts[item].count)
}

/* cleanup if a special menu gets unselected, wipe its count so Standard rises back */
watch(() => props.form.menuChoices.slice(), (choices) => {
  if (!props.form.menuCounts) return
  const set = new Set(choices)
  for (const key of Object.keys(props.form.menuCounts)) {
    if (key === 'Standard') { delete props.form.menuCounts.Standard; continue }
    if (!set.has(key)) delete props.form.menuCounts[key]
  }
})
</script>

<template>
  <v-sheet class="section pa-2 sticky-panel" rounded="lg">
    <div class="hdr">
      <span class="n"><strong>3. </strong></span>
      <span class="t"><strong>Menu Section</strong></span>
    </div>

    <!-- Menus -->
    <div class="mini-title mt-2">Menu Choices</div>
    <v-row dense class="mt-1">
      <v-col cols="6" v-for="mc in MENU_CHOICES" :key="mc">
        <v-btn
          block variant="tonal" class="choice-btn two-line"
          :class="{ active: props.form.menuChoices.includes(mc) }"
          @click="
            props.form.menuChoices = toggleArrayValue(props.form.menuChoices, mc);
            if (mc !== 'Standard') ensureMenuCountKey(mc);
          "
        >
          <div class="label mt-2">
            <div class="en">
              {{ mc }}
              <span v-if="mc === 'Standard'" class="std-count">({{ standardCount }})</span>
            </div>
            <div class="km">{{ MENU_KM[mc] }}</div>
          </div>
        </v-btn>

        <div v-if="props.form.menuChoices.includes(mc) && mc !== 'Standard'" class="mt-3">
          <v-text-field
            v-model.number="props.form.menuCounts[mc]"
            type="number"
            min="0"
            :max="props.form.quantity"
            density="compact"
            variant="outlined"
            label="People"
            hide-details
            @update:modelValue="onMenuCountInput(mc)"
          />
        </div>
      </v-col>
    </v-row>

    <!-- Allergies -->
    <div class="mini-title mt-3 mb-1">Dietary &amp; Allergies</div>
    <v-row dense class="mt-1">
      <v-col cols="12" v-for="item in ALLERGENS" :key="item">
        <v-btn
          block variant="tonal" class="choice-btn two-line"
          :class="{ active: props.form.dietary.includes(item) }"
          @click="
            props.form.dietary = toggleArrayValue(props.form.dietary, item);
            ensureDietaryKey(item);
          "
        >
          <div class="label mt-2">
            <div class="en">{{ item }}</div>
            <div class="km">{{ ALLERGEN_KM[item] }}</div>
          </div>
        </v-btn>

        <div v-if="props.form.dietary.includes(item)" class="mt-3">
          <v-row dense>
            <v-col cols="8">
              <v-select
                v-model="props.form.dietaryCounts[item].menu"
                :items="dietaryMenuItems"
                item-title="title"
                item-value="value"
                density="compact"
                variant="outlined"
                label="From menu"
                hide-details
              >
                <!-- Selection (EN + KM) -->
                <template #selection="{ item }">
                  <div class="two-line">
                    <div class="en">{{ item?.title }}</div>
                    <div class="km">{{ item?.raw?.subtitle }}</div>
                  </div>
                </template>
                <!-- Items (EN + KM) -->
                <template #item="{ props: iprops, item }">
                  <v-list-item v-bind="iprops">
                    <v-list-item-title>{{ item?.title }}</v-list-item-title>
                    <v-list-item-subtitle class="km">{{ item?.raw?.subtitle }}</v-list-item-subtitle>
                  </v-list-item>
                </template>
              </v-select>
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="props.form.dietaryCounts[item].count"
                type="number"
                min="0"
                :max="menuLimit(props.form.dietaryCounts[item].menu)"
                density="compact"
                variant="outlined"
                label="People"
                hide-details
                @update:modelValue="onDietaryCountInput(item)"
              />
            </v-col>
          </v-row>
        </div>
      </v-col>
    </v-row>

    <!-- Other allergy -->
    <v-text-field
      v-if="showOtherAllergy"
      v-model="props.form.dietaryOther"
      class="mt-2"
      label="Other (specify)"
      variant="outlined"
      density="compact"
    />

    <!-- Special instruction -->
    <v-textarea
      v-model="props.form.specialInstructions"
      class="mt-2"
      label="Special Instruction"
      variant="outlined"
      density="compact"
      rows="2"
    />

    <!-- Validation summary -->
    <div
      class="mt-2 text-caption"
      :class="{
        'text-error': assignedMenus > props.form.quantity,
        'text-success': assignedMenus <= props.form.quantity
      }"
    >
      Assigned non-standard: {{ assignedMenus }} / Total: {{ props.form.quantity }}
      → Standard auto = {{ standardCount }}
    </div>
  </v-sheet>
</template>

<style scoped>
/* Khmer font helper to match other screens */
.km{
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
               'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}

/* Two-line pattern for EN (top) + KM (bottom) */
.two-line{ display:flex; flex-direction:column; line-height:1.1; }
.two-line .km{ font-size:.86rem; opacity:.9; margin-top:2px; }

/* Choice buttons */
.choice-btn{
  font-weight:600;
  min-height:56px;
  text-transform:none;
  background-color:aliceblue;
  justify-content:flex-start;
  text-align:left;
}
.choice-btn.two-line .label{ display:flex; flex-direction:column; line-height:1.1; }
.label .en{ font-size:0.98rem; }
.label .km{ font-size:0.86rem; opacity:0.9; margin-top:2px; }
.std-count{ font-weight:500; margin-left:.25rem; opacity:.85; }
.choice-btn.active{ background-color:#16a34a !important; color:#fff !important; }

.text-error{ color:#dc2626 !important; }
.text-success{ color:#16a34a !important; }

/* Make list subtitles compact & consistent for KM lines */
:deep(.v-list-item-subtitle){
  line-height:1.1;
}
</style>

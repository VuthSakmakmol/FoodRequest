<script setup>
import { computed } from 'vue'

const props = defineProps({
  form: Object,
  MENU_CHOICES: Array,
  ALLERGENS: Array,
  showOtherAllergy: Boolean
})

// ✅ toggle array values
function toggleArrayValue(arr, val) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
}

// --- Menu math ---
// Sum all non-standard counts
const assignedMenus = computed(() => {
  let total = 0
  for (const key in props.form.menuCounts) {
    if (key !== 'Standard') {
      total += Number(props.form.menuCounts[key] || 0)
    }
  }
  return total
})

// Standard = quantity - sum(others)
const standardCount = computed(() => {
  const total = Number(props.form.quantity || 0)
  const used = assignedMenus.value
  return Math.max(total - used, 0)
})

// limit helper for allergies
function menuLimit(menuName) {
  if (!menuName) return props.form.quantity
  if (menuName === 'Standard') return standardCount.value
  return Number(props.form.menuCounts[menuName] || 0)
}
</script>

<template>
  <v-sheet class="section pa-2 sticky-panel" rounded="lg">
    <div class="hdr">
      <span class="n">3</span>
      <span class="t"><strong>. Menu Section</strong></span>
    </div>

    <!-- Menus -->
    <div class="mini-title mt-2">Menu Choices</div>
    <v-row dense class="mt-1">
      <v-col cols="6" v-for="mc in MENU_CHOICES" :key="mc">
        <!-- Button toggle -->
        <v-btn
          block
          variant="tonal"
          class="choice-btn"
          :class="{ active: form.menuChoices.includes(mc) }"
          @click="
            form.menuChoices = toggleArrayValue(form.menuChoices, mc);
            if (!form.menuCounts[mc]) form.menuCounts[mc] = 0;
          "
        >
          {{ mc }}
          <span v-if="mc === 'Standard'">({{ standardCount }})</span>
        </v-btn>

        <!-- If non-standard, show counter -->
        <div v-if="form.menuChoices.includes(mc) && mc !== 'Standard'" class="mt-3">
          <v-text-field
            v-model.number="form.menuCounts[mc]"
            type="number"
            min="0"
            :max="form.quantity"
            density="compact"
            variant="outlined"
            label="People"
            hide-details
          />
        </div>
      </v-col>
    </v-row>

    <!-- Allergies -->
    <div class="mini-title mt-3 mb-1">Dietary & Allergies</div>
    <v-row dense class="mt-1">
      <v-col cols="12" v-for="item in ALLERGENS" :key="item">
        <v-btn
          block
          variant="tonal"
          class="choice-btn"
          :class="{ active: form.dietary.includes(item) }"
          @click="
            form.dietary = toggleArrayValue(form.dietary, item);
            if (!form.dietaryCounts[item]) form.dietaryCounts[item] = { count: 0, menu: null };
          "
        >
          {{ item }}
        </v-btn>

        <!-- If selected, show count + menu select -->
        <div v-if="form.dietary.includes(item)" class="mt-3">
          <v-row dense>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.dietaryCounts[item].count"
                type="number"
                min="0"
                :max="menuLimit(form.dietaryCounts[item].menu)"
                density="compact"
                variant="outlined"
                label="People"
                hide-details
              />
            </v-col>
            <v-col cols="8">
              <v-select
                v-model="form.dietaryCounts[item].menu"
                :items="form.menuChoices.length ? form.menuChoices : ['Standard']"
                density="compact"
                variant="outlined"
                label="From menu"
                hide-details
              />
            </v-col>
          </v-row>
        </div>
      </v-col>
    </v-row>

    <!-- Other allergy -->
    <v-text-field
      v-if="showOtherAllergy"
      v-model="form.allergiesOther"
      class="mt-2"
      label="Other (identify)"
      variant="outlined"
      density="compact"
    />

    <!-- Special instruction -->
    <v-textarea
      v-model="form.specialInstructions"
      class="mt-2"
      label="Special Instruction"
      variant="outlined"
      density="compact"
      rows="2"
    />

    <!-- Validation summary -->
    <div class="mt-2 text-caption" :class="{
      'text-error': assignedMenus > form.quantity,
      'text-success': assignedMenus <= form.quantity
    }">
      Assigned non-standard: {{ assignedMenus }} / Total: {{ form.quantity }}  
      → Standard auto = {{ standardCount }}
    </div>
  </v-sheet>
</template>

<style scoped>
.choice-btn {
  font-weight: 600;
  min-height: 48px;
  text-transform: none;
  background-color: aliceblue;
}
.choice-btn.active {
  background-color: #16a34a !important;
  color: #fff !important;
}
.text-error {
  color: #dc2626 !important; /* red */
}
.text-success {
  color: #16a34a !important; /* green */
}
</style>

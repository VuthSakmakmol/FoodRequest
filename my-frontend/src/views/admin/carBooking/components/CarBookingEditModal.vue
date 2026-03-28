<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  form: {
    type: Object,
    required: true,
  },
  hours: {
    type: Array,
    default: () => [],
  },
  minutes: {
    type: Array,
    default: () => [],
  },
  purposes: {
    type: Array,
    default: () => [],
  },
  loading: Boolean,
  error: String,
})

const emit = defineEmits(['update:open', 'update:form', 'save'])

function patchForm(key, value) {
  emit('update:form', {
    ...props.form,
    [key]: value,
  })
}

const purposeItems = computed(() => {
  const base = Array.isArray(props.purposes) ? [...props.purposes] : []
  return base.sort((a, b) => String(a).localeCompare(String(b)))
})

const purposeSearch = ref('')
const purposeOpen = ref(false)

watch(
  () => props.form?.purpose,
  (val) => {
    purposeSearch.value = val || ''
  },
  { immediate: true }
)

const filteredPurposes = computed(() => {
  const q = purposeSearch.value.trim().toLowerCase()
  if (!q) return purposeItems.value
  return purposeItems.value.filter(p => String(p).toLowerCase().includes(q))
})

function onPurposeInput(e) {
  const val = e?.target?.value || ''
  purposeSearch.value = val
  patchForm('purpose', val)
  purposeOpen.value = true
}

function selectPurpose(p) {
  purposeSearch.value = p
  patchForm('purpose', p)
  purposeOpen.value = false
}
</script>

<template>
  <teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-3"
    >
      <div
        class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 class="text-sm font-semibold">Edit booking</h3>
          <button class="text-sm" @click="$emit('update:open', false)">✕</button>
        </div>

        <div class="space-y-4 px-4 py-4">
          <div
            v-if="error"
            class="rounded-lg border border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ error }}
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-[11px] font-medium">Trip date</label>
              <input
                :value="form.tripDate"
                type="date"
                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                @input="patchForm('tripDate', $event.target.value)"
              />
            </div>

            <div>
              <label class="mb-1 block text-[11px] font-medium">Category</label>
              <select
                :value="form.category"
                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900
                       outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                @change="patchForm('category', $event.target.value)"
              >
                <option value="Car">Car</option>
                <option value="Messenger">Messenger</option>
              </select>
            </div>

            <div>
              <label class="mb-1 block text-[11px] font-medium">Start time</label>
              <div class="grid grid-cols-2 gap-2">
                <select
                  :value="form.timeStartHour"
                  class="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  @change="patchForm('timeStartHour', $event.target.value)"
                >
                  <option v-for="h in hours" :key="h" :value="h">{{ h }}</option>
                </select>

                <select
                  :value="form.timeStartMinute"
                  class="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  @change="patchForm('timeStartMinute', $event.target.value)"
                >
                  <option v-for="m in minutes" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>

            <div>
              <label class="mb-1 block text-[11px] font-medium">End time</label>
              <div class="grid grid-cols-2 gap-2">
                <select
                  :value="form.timeEndHour"
                  class="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  @change="patchForm('timeEndHour', $event.target.value)"
                >
                  <option v-for="h in hours" :key="h" :value="h">{{ h }}</option>
                </select>

                <select
                  :value="form.timeEndMinute"
                  class="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  @change="patchForm('timeEndMinute', $event.target.value)"
                >
                  <option v-for="m in minutes" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>

            <div class="sm:col-span-2">
              <label class="mb-1 block text-[11px] font-medium">Purpose</label>

              <div class="relative">
                <input
                  :value="purposeSearch"
                  type="text"
                  placeholder="Type or search purpose..."
                  class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 pr-8 text-xs text-slate-900
                         outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  @input="onPurposeInput"
                  @focus="purposeOpen = true"
                  @keydown.esc.prevent="purposeOpen = false"
                />

                <button
                  type="button"
                  class="absolute inset-y-0 right-1 flex items-center px-2 text-slate-400 hover:text-slate-600"
                  @click="purposeOpen = !purposeOpen"
                >
                  <i
                    :class="[
                      'fa-solid text-[10px] transition-transform',
                      purposeOpen ? 'fa-chevron-up' : 'fa-chevron-down'
                    ]"
                  />
                </button>

                <div
                  v-if="purposeOpen"
                  class="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200
                         bg-white text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
                >
                  <button
                    v-for="p in filteredPurposes"
                    :key="p"
                    type="button"
                    class="flex w-full items-start px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    @click="selectPurpose(p)"
                  >
                    <span class="truncate">{{ p }}</span>
                  </button>

                  <div
                    v-if="!filteredPurposes.length"
                    class="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    No match. Keep typing to use custom purpose.
                  </div>
                </div>
              </div>

              <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Choose from list or type custom purpose.
              </p>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100
                   dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            @click="$emit('update:open', false)"
          >
            Close
          </button>

          <button
            type="button"
            class="rounded-lg border border-sky-500 bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
            :disabled="loading"
            @click="$emit('save')"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
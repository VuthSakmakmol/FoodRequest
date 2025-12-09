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
function onEmployeeSelected (val) {
  fillFromDirectory(val)
  emit('updateEmployee', val)
}
function onClear () {
  props.form.employeeId    = ''
  props.form.name          = ''
  props.form.department    = ''
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
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- Gradient header -->
    <header
      class="flex items-center justify-between
             rounded-t-2xl border-b border-slate-200
             rounded-t-2xl
            bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
            px-4 py-3 text-white"
    >
      <div class="flex flex-col">
        <span class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">
          Employee information
        </span>
      </div>
    </header>

    <!-- Body -->
      <div
        class="rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/80"
      >
        <div class="space-y-3 text-xs text-slate-800 dark:text-slate-100">
          <!-- Employee select -->
          <div>
            <label
              class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100"
            >
              <span>Employee</span>
              <span class="required-star">*</span>
            </label>
            <div class="mt-1 relative">
              <select
                v-model="props.form.employeeId"
                class="h-9 w-full rounded-lg border border-slate-300 bg-white pr-7 pl-2 text-xs
                       text-slate-900 outline-none
                       focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                :disabled="loadingEmployees"
                @change="onEmployeeSelected($event.target.value)"
              >
                <option value="">
                  {{ loadingEmployees ? 'Loading employees…' : 'Select employee' }}
                </option>
                <option
                  v-for="opt in employeeOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.title }}
                  <span v-if="opt.subtitle"> — {{ opt.subtitle }}</span>
                </option>
              </select>

              <!-- clear button -->
              <button
                v-if="props.form.employeeId"
                type="button"
                class="absolute inset-y-0 right-1 flex items-center px-1
                       text-slate-400 hover:text-red-500"
                @click.stop="onClear"
              >
                <i class="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>
            <p
              v-if="loadingEmployees"
              class="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
            >
              Loading active employees…
            </p>
          </div>

          <!-- Name / Department -->
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100"
              >
                <span>Name</span>
                <span class="required-star">*</span>
              </label>
              <input
                v-model="props.form.name"
                type="text"
                readonly
                class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 text-xs
                       text-slate-900 outline-none
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100"
              >
                <span>Department</span>
                <span class="required-star">*</span>
              </label>
              <input
                v-model="props.form.department"
                type="text"
                readonly
                class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 text-xs
                       text-slate-900 outline-none
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <!-- Contact number -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label
                class="flex items-center text-[11px] font-semibold text-slate-700 dark:text-slate-100"
              >
                <span>Contact Number</span>
                <span class="required-star">*</span>
              </label>
              <input
                v-model="props.form.contactNumber"
                type="tel"
                class="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs
                       text-slate-900 outline-none
                       focus:border-sky-500 focus:ring-1 focus:ring-sky-500
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>
      </div>
  </section>
</template>

<style scoped>
.required-star {
  color: #ef4444;
  font-size: 16px;
  margin-left: 3px;
  line-height: 1;
}

@media (max-width: 640px) {
  section {
    border-radius: 0.75rem;
  }
}
</style>

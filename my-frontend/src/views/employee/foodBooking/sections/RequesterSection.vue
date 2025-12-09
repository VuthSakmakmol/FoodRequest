<!-- src/employee/foodrequest/sections/RequesterSection.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

/* ───────── Props / Emits (same logic as before) ───────── */
const props = defineProps({
  form: Object,          // { employeeId, name, department, contactNumber, ... }
  employees: Array,
  loadingEmployees: Boolean
})
const emit = defineEmits(['updateEmployee'])

/* ───────── Build options from directory ───────── */
const employeeOptions = computed(() =>
  (props.employees || []).map(e => {
    const id    = String(e.employeeId || '')
    const name  = e.name || ''
    const dept  = e.department || ''
    const phone = e.contactNumber || ''
    const subtitle = [dept, phone].filter(Boolean).join(' · ')
    return {
      value: id,
      label: `${id} — ${name}`,
      subtitle,
      searchText: `${id} ${name} ${dept} ${phone}`.toLowerCase()
    }
  })
)

/* ───────── Autocomplete state ───────── */
const searchText     = ref('')      // what user sees/types
const dropdownOpen   = ref(false)
const highlightedIdx = ref(-1)
const rootEl         = ref(null)

/* Fill form fields from directory (same logic) */
function fillFromDirectory(id) {
  const emp = (props.employees || []).find(e => String(e.employeeId) === String(id))
  props.form.name          = emp?.name || ''
  props.form.department    = emp?.department || ''
  props.form.contactNumber = emp?.contactNumber || ''
}

/* When parent sets employeeId (e.g. from localStorage), sync label + fields */
watch(
  () => props.form.employeeId,
  id => {
    const opt = employeeOptions.value.find(o => o.value === String(id))
    if (opt) searchText.value = opt.label
    else if (!id) searchText.value = ''
    fillFromDirectory(id)
  },
  { immediate: true }
)

/* Filtered list */
const filteredOptions = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const all = employeeOptions.value
  if (!q) return all.slice(0, 50)
  return all.filter(o => o.searchText.includes(q)).slice(0, 50)})

/* Select employee */
function selectEmployee(opt) {
  props.form.employeeId = opt.value
  fillFromDirectory(opt.value)
  emit('updateEmployee', opt.value)
  searchText.value = opt.label
  dropdownOpen.value = false
  highlightedIdx.value = -1
}

/* Clear */
function clearSelection() {
  props.form.employeeId = ''
  props.form.name = ''
  props.form.department = ''
  props.form.contactNumber = ''
  searchText.value = ''
  emit('updateEmployee', '')
}

/* Input handlers */
function onFocus() {
  dropdownOpen.value = true
}
function onInput() {
  dropdownOpen.value = true
  highlightedIdx.value = -1
}
function onKeydown(e) {
  if (!dropdownOpen.value && (e.key === 'ArrowDown' || e.key === 'Enter')) {
    dropdownOpen.value = true
    return
  }
  if (!dropdownOpen.value) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!filteredOptions.value.length) return
    highlightedIdx.value =
      (highlightedIdx.value + 1 + filteredOptions.value.length) %
      filteredOptions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!filteredOptions.value.length) return
    highlightedIdx.value =
      (highlightedIdx.value - 1 + filteredOptions.value.length) %
      filteredOptions.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const opt = filteredOptions.value[highlightedIdx.value]
    if (opt) selectEmployee(opt)
  } else if (e.key === 'Escape') {
    dropdownOpen.value = false
    highlightedIdx.value = -1
  }
}

/* Close dropdown on outside click */
function handleClickOutside(ev) {
  if (!rootEl.value) return
  if (!rootEl.value.contains(ev.target)) {
    dropdownOpen.value = false
    highlightedIdx.value = -1
  }
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))
</script>

<template>
  <!-- OUTER CARD (standard pattern) -->
  <section
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900 overflow-hidden"
  >
    <!-- Gradient header -->
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
                 bg-white/90 text-emerald-600 text-sm shadow-sm"
        >
          <i class="fa-solid fa-user" />
        </span>
        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80t">
            Requester
          </h2>
        </div>
      </div>
    </header>

    <!-- Wrapper + inner card -->
    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-3
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="space-y-4">
          <!-- Autocomplete -->
          <div ref="rootEl" class="relative">
            <label
              class="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-100"
            >
              Employee
            </label>

            <div
              class="flex items-center rounded-xl border border-slate-300 bg-white
                     px-3 py-2 text-sm text-slate-900 shadow-sm
                     focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-slate-500"></i>
              <input
                v-model="searchText"
                type="text"
                class="flex-1 bg-transparent outline-none text-sm"
                placeholder="Search by ID, name, department..."
                @focus="onFocus"
                @input="onInput"
                @keydown="onKeydown"
              />
              <button
                v-if="searchText"
                type="button"
                class="ml-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                @click.stop="clearSelection"
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>

            <!-- Loading info -->
            <p
              v-if="loadingEmployees"
              class="mt-1 text-[11px] text-slate-600 dark:text-slate-400"
            >
              Loading employees…
            </p>

            <!-- Dropdown -->
            <div
              v-if="dropdownOpen && filteredOptions.length"
              class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border
                     border-slate-300 bg-white shadow-lg
                     dark:border-slate-700 dark:bg-slate-900"
            >
              <button
                v-for="(opt, idx) in filteredOptions"
                :key="opt.value"
                type="button"
                class="flex w-full flex-col items-start border-b border-slate-200 px-3 py-2 text-left text-xs
                       last:border-b-0
                       dark:border-slate-800"
                :class="[
                  idx === highlightedIdx
                    ? 'bg-sky-50 dark:bg-sky-500/20'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/80'
                ]"
                @mousedown.prevent="selectEmployee(opt)"
              >
                <span class="font-semibold text-slate-900 dark:text-slate-50">
                  {{ opt.label }}
                </span>
                <span class="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                  {{ opt.subtitle }}
                </span>
              </button>
            </div>
          </div>

          <!-- Read-only details -->
          <div class=  "gap-3">
            <div class="space-y-1">
              <label
                class="block text-xs font-semibold text-slate-700 dark:text-slate-100"
              >
                Name
              </label>
              <input
                v-model="props.form.name"
                type="text"
                readonly
                class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm
                       text-slate-900
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div class="space-y-1">
              <label
                class="block text-xs font-semibold text-slate-700 dark:text-slate-100"
              >
                Department
              </label>
              <input
                v-model="props.form.department"
                type="text"
                readonly
                class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm
                       text-slate-900
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div class="space-y-1 sm:col-span-1">
              <label
                class="block text-xs font-semibold text-slate-700 dark:text-slate-100"
              >
                Contact Number
              </label>
              <input
                v-model="props.form.contactNumber"
                type="text"
                readonly
                class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm
                       text-slate-900
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.font-khmer {
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
    'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}
</style>

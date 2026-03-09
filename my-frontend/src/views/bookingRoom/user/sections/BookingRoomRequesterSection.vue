<!-- src/views/bookingRoom/user/sections/BookingRoomRequesterSection.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

defineOptions({ name: 'BookingRoomRequesterSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },
  employees: {
    type: Array,
    default: () => [],
  },
  loadingEmployees: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['select-employee'])

/* ───────── Build options from directory ───────── */
const employeeOptions = computed(() =>
  (props.employees || []).map((e) => {
    const id = String(e.employeeId || '')
    const name = e.name || ''
    const dept = e.department || ''
    const pos = e.position || ''
    const phone = e.contactNumber || ''
    const subtitle = [dept, pos, phone].filter(Boolean).join(' · ')

    return {
      value: id,
      label: `${id} — ${name}`,
      subtitle,
      searchText: `${id} ${name} ${dept} ${pos} ${phone}`.toLowerCase(),
      raw: e,
    }
  })
)

/* ───────── Autocomplete state ───────── */
const searchText = ref('')
const dropdownOpen = ref(false)
const highlightedIdx = ref(-1)
const rootEl = ref(null)

/* ───────── Sync selected employee from parent form ───────── */
watch(
  () => props.form.employeeId,
  (id) => {
    const opt = employeeOptions.value.find((o) => o.value === String(id || ''))
    if (opt) searchText.value = opt.label
    else if (!id) searchText.value = ''
  },
  { immediate: true }
)

/* ───────── Filtered options ───────── */
const filteredOptions = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const all = employeeOptions.value
  if (!q) return all.slice(0, 50)
  return all.filter((o) => o.searchText.includes(q)).slice(0, 50)
})

/* ───────── Select employee ───────── */
function selectEmployee(opt) {
  if (!opt?.raw) return
  emit('select-employee', opt.raw)
  searchText.value = opt.label
  dropdownOpen.value = false
  highlightedIdx.value = -1
}

/* ───────── Clear ───────── */
function clearSelection() {
  searchText.value = ''
  dropdownOpen.value = false
  highlightedIdx.value = -1

  emit('select-employee', {
    employeeId: '',
    name: '',
    department: '',
    position: '',
    contactNumber: '',
  })
}

/* ───────── Input handlers ───────── */
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

/* ───────── Close dropdown on outside click ───────── */
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
  <section
    class="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- Header -->
    <header
      class="flex items-center justify-between rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-4 py-2.5 text-white
             dark:border-slate-700"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-7 w-7 items-center justify-center rounded-xl
                 bg-white/90 text-sky-700 text-sm shadow-sm"
        >
          <i class="fa-solid fa-user" />
        </span>

        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">
            Requester
          </h2>
        </div>
      </div>
    </header>

    <!-- Wrapper -->
    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-2.5
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="space-y-3">
          <!-- Search -->
          <div ref="rootEl" class="relative">
            <label class="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              Employee
            </label>

            <div
              class="flex items-center rounded-xl border border-slate-300 bg-white
                     px-3 py-2 text-sm text-slate-900 shadow-sm
                     focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500
                     dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <i class="fa-solid fa-magnifying-glass mr-2 text-[11px] text-slate-500" />
              <input
                v-model="searchText"
                type="text"
                class="flex-1 bg-transparent text-[13px] outline-none"
                placeholder="Search by ID, name, department..."
                @focus="onFocus"
                @input="onInput"
                @keydown="onKeydown"
              />
              <button
                v-if="searchText"
                type="button"
                class="ml-2 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                @click.stop="clearSelection"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>

            <p
              v-if="props.loadingEmployees"
              class="mt-1 text-[11px] text-slate-600 dark:text-slate-400"
            >
              Loading employees…
            </p>

            <div
              v-if="dropdownOpen && filteredOptions.length"
              class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border
                     border-slate-300 bg-white shadow-lg
                     dark:border-slate-700 dark:bg-slate-900"
            >
              <button
                v-for="(opt, idx) in filteredOptions"
                :key="opt.value"
                type="button"
                class="flex w-full flex-col items-start border-b border-slate-200 px-3 py-2 text-left text-xs
                       last:border-b-0 dark:border-slate-800"
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
                  {{ opt.subtitle || '—' }}
                </span>
              </button>
            </div>

            <div
              v-else-if="dropdownOpen && !props.loadingEmployees"
              class="absolute z-20 mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-[12px]
                     text-slate-500 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            >
              No employees found.
            </div>
          </div>

          <!-- Compact selected requester -->
          <div class="grid gap-2 sm:grid-cols-2">
            <div
              class="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2
                     dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div class="text-[10px] text-slate-500 dark:text-slate-400">Employee ID</div>
              <div class="mt-0.5 truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ props.form.employeeId || '—' }}
              </div>
            </div>

            <div
              class="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2
                     dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div class="text-[10px] text-slate-500 dark:text-slate-400">Name</div>
              <div class="mt-0.5 truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ props.form.name || '—' }}
              </div>
            </div>

            <div
              class="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2
                     dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div class="text-[10px] text-slate-500 dark:text-slate-400">Department</div>
              <div class="mt-0.5 truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ props.form.department || '—' }}
              </div>
            </div>

            <div
              class="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2
                     dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div class="text-[10px] text-slate-500 dark:text-slate-400">Position</div>
              <div class="mt-0.5 truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ props.form.position || '—' }}
              </div>
            </div>

            <div
              class="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 sm:col-span-2
                     dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div class="text-[10px] text-slate-500 dark:text-slate-400">Contact Number</div>
              <div class="mt-0.5 truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ props.form.contactNumber || '—' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
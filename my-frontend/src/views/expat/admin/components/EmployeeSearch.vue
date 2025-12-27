<!-- src/components/EmployeeDirectorySearch.vue -->
<template>
  <div class="relative">
    <div class="flex items-center gap-2">
      <div class="flex-1 relative">
        <input
          :placeholder="displayPlaceholder"
          :value="inputValue"
          @input="onInput"
          @focus="open = true"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="onEnter"
          @keydown.esc.prevent="closeDropdown"
          @blur="onBlur"
          type="text"
          autocomplete="off"
          class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none
                 focus:ring-2 focus:ring-emerald-500/40
                 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />

        <!-- Spinner / Clear -->
        <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <span v-if="loading" class="text-slate-400">
            <i class="fa-solid fa-spinner animate-spin"></i>
          </span>

          <button
            v-if="showClear"
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600
                   hover:bg-slate-50
                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
            @mousedown.prevent
            @click="clear"
            title="Clear"
          >
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="open && (items.length || err)"
      class="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl
             dark:border-slate-800 dark:bg-slate-950"
    >
      <div v-if="err" class="px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
        <i class="fa-solid fa-triangle-exclamation mr-2"></i>{{ err }}
      </div>

      <div v-else>
        <button
          v-for="(it, idx) in items"
          :key="it.employeeId"
          type="button"
          class="w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0
                 hover:bg-slate-50 dark:border-slate-900 dark:hover:bg-slate-900"
          :class="idx === activeIndex ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''"
          @mousedown.prevent="pick(it)"
          @mousemove="activeIndex = idx"
        >
          <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {{ it.employeeId }} · {{ it.name }}
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400">{{ it.department || '—' }}</div>
        </button>

        <div v-if="!items.length" class="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          No results
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import api from '@/utils/api'

defineOptions({ name: 'EmployeeDirectorySearch' })

const props = defineProps({
  modelValue: { type: Object, default: null },
  placeholder: { type: String, default: 'Search employee…' },
  minChars: { type: Number, default: 2 },
  debounceMs: { type: Number, default: 200 },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const loading = ref(false)
const items = ref([])
const err = ref('')
const inputValue = ref('')
const activeIndex = ref(-1)

let t = null
let lastQuery = ''

const selectedLabel = computed(() => {
  if (!props.modelValue) return ''
  const id = props.modelValue.employeeId || ''
  const nm = props.modelValue.name || ''
  return `${id}${nm ? ' · ' + nm : ''}`
})

const displayPlaceholder = computed(() => {
  // If selected, show label as placeholder (like your original behavior)
  return props.modelValue ? selectedLabel.value : props.placeholder
})

const showClear = computed(() => !!props.modelValue || !!String(inputValue.value || '').trim())

watch(
  () => props.modelValue,
  () => {
    // When parent sets/clears selection, reset input text
    inputValue.value = ''
    items.value = []
    err.value = ''
    activeIndex.value = -1
  }
)

function normalizeResults(resData) {
  const arr = Array.isArray(resData) ? resData : []
  return arr
    .map((x) => ({
      employeeId: String(x.employeeId || x.id || '').trim(),
      name: String(x.name || '').trim(),
      department: String(x.department || '').trim(),
    }))
    .filter((x) => x.employeeId)
}

async function doSearch(text) {
  err.value = ''
  activeIndex.value = -1

  const q = String(text || '').trim()
  if (!q || q.length < props.minChars) {
    items.value = []
    return
  }

  // avoid repeated same request
  if (q === lastQuery) return
  lastQuery = q

  loading.value = true
  try {
    const res = await api.get('/public/employees', { params: { q } })
    items.value = normalizeResults(res.data)
    if (!items.value.length) activeIndex.value = -1
  } catch (e) {
    items.value = []
    err.value = e?.response?.data?.message || 'Failed to search employees.'
  } finally {
    loading.value = false
  }
}

function onInput(e) {
  open.value = true
  const text = String(e?.target?.value ?? '').trimStart()
  inputValue.value = text

  clearTimeout(t)
  t = setTimeout(() => doSearch(text), props.debounceMs)
}

function pick(item) {
  emit('update:modelValue', item)
  open.value = false
  inputValue.value = ''
  items.value = []
  err.value = ''
  activeIndex.value = -1
}

function clear() {
  emit('update:modelValue', null)
  inputValue.value = ''
  items.value = []
  err.value = ''
  activeIndex.value = -1
  lastQuery = ''
}

function closeDropdown() {
  open.value = false
  activeIndex.value = -1
}

function onBlur() {
  // allow click selection
  setTimeout(() => closeDropdown(), 150)
}

function move(delta) {
  if (!open.value) open.value = true
  if (!items.value.length) return
  const max = items.value.length - 1
  const next = activeIndex.value < 0 ? 0 : activeIndex.value + delta
  activeIndex.value = Math.max(0, Math.min(max, next))
}

function onEnter() {
  if (!open.value) return
  if (activeIndex.value >= 0 && items.value[activeIndex.value]) {
    pick(items.value[activeIndex.value])
  }
}
</script>

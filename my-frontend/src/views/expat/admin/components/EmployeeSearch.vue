<template>
  <div class="relative">
    <div class="flex items-center gap-2">
      <div class="flex-1 relative">
        <input
          :placeholder="displayPlaceholder"
          v-model="q"
          @input="onInput"
          @focus="open = true"
          @blur="onBlur"
          type="text"
          class="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <div v-if="loading" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          <i class="fa-solid fa-spinner animate-spin"></i>
        </div>
      </div>

      <button
        v-if="modelValue"
        type="button"
        class="shrink-0 px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900"
        @click="clear"
        title="Clear"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <div
      v-if="open && (items.length || err)"
      class="absolute z-30 mt-2 w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xl overflow-hidden"
    >
      <div v-if="err" class="px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
        <i class="fa-solid fa-triangle-exclamation mr-2"></i>{{ err }}
      </div>

      <div v-else>
        <button
          v-for="it in items"
          :key="it.employeeId"
          type="button"
          class="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-100 dark:border-slate-900 last:border-b-0"
          @mousedown.prevent="pick(it)"
        >
          <div class="text-sm font-semibold">{{ it.employeeId }} · {{ it.name }}</div>
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
import { computed, ref } from 'vue'
import api from '@/utils/api'

const props = defineProps({
  modelValue: { type: Object, default: null },
  placeholder: { type: String, default: 'Search employee…' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const q = ref('')
const loading = ref(false)
const items = ref([])
const err = ref('')
let t = null

const selectedLabel = computed(() => {
  if (!props.modelValue) return ''
  const id = props.modelValue.employeeId || ''
  const nm = props.modelValue.name || ''
  return `${id}${nm ? ' · ' + nm : ''}`
})

const displayPlaceholder = computed(() => {
  return props.modelValue ? selectedLabel.value : props.placeholder
})

function normalizeResults(resData) {
  const arr = Array.isArray(resData) ? resData : []
  return arr
    .map((x) => ({
      employeeId: String(x.employeeId || x.id || '').trim(),
      name: x.name || '',
      department: x.department || '',
    }))
    .filter((x) => x.employeeId)
}

async function doSearch(text) {
  err.value = ''
  if (!text || text.length < 2) {
    items.value = []
    return
  }
  loading.value = true
  try {
    const res = await api.get(`/public/employees?q=${encodeURIComponent(text)}`)
    items.value = normalizeResults(res.data)
  } catch (e) {
    err.value = e?.response?.data?.message || 'Failed to search employees.'
  } finally {
    loading.value = false
  }
}

function onInput() {
  const text = String(q.value || '').trim()
  clearTimeout(t)
  t = setTimeout(() => doSearch(text), 200) // small debounce
}

function pick(item) {
  emit('update:modelValue', item)
  open.value = false
  q.value = ''
  items.value = []
  err.value = ''
}

function clear() {
  emit('update:modelValue', null)
  q.value = ''
  items.value = []
  err.value = ''
}

function onBlur() {
  // allow click selection
  setTimeout(() => {
    open.value = false
  }, 150)
}
</script>

<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  selectedDate: { type: String, default: '' },
  statusFilter: { type: String, default: 'ALL' },
  categoryFilter: { type: String, default: 'ALL' },
  qSearch: { type: String, default: '' },
  itemsPerPage: { type: Number, default: 10 },
  exportFrom: { type: String, default: '' },
  exportTo: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  perPageOptions: { type: Array, default: () => [10, 20, 50] },
})

const emit = defineEmits([
  'update:selectedDate',
  'update:statusFilter',
  'update:categoryFilter',
  'update:qSearch',
  'update:itemsPerPage',
  'update:exportFrom',
  'update:exportTo',
  'refresh',
  'export',
])

const statusOptions = computed(() => [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'ON_ROAD', label: 'On road' },
  { value: 'ARRIVING', label: 'Arriving' },
  { value: 'COMEBACK', label: 'Comeback' },
  { value: 'DELAYED', label: 'Delayed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
])

const categoryOptions = computed(() => [
  { value: 'ALL', label: 'All categories' },
  { value: 'Car', label: 'Car' },
  { value: 'Messenger', label: 'Messenger' },
])

function setTodayRange() {
  const today = dayjs().format('YYYY-MM-DD')
  emit('update:selectedDate', today)
  emit('update:exportFrom', today)
  emit('update:exportTo', today)
}
</script>

<template>
  <div class="border-b border-slate-200 px-2 py-2 dark:border-slate-700 sm:px-3">
    <div class="space-y-2">
      <!-- mobile -->
      <div class="grid grid-cols-2 gap-2 sm:hidden">
        <input
          :value="selectedDate"
          type="date"
          class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:selectedDate', $event.target.value)"
        />

        <select
          :value="statusFilter"
          class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @change="emit('update:statusFilter', $event.target.value)"
        >
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <select
          :value="categoryFilter"
          class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @change="emit('update:categoryFilter', $event.target.value)"
        >
          <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <select
          :value="itemsPerPage"
          class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @change="emit('update:itemsPerPage', Number($event.target.value))"
        >
          <option v-for="n in perPageOptions" :key="n" :value="n">{{ n }}/page</option>
        </select>

        <input
          :value="qSearch"
          type="text"
          placeholder="Search request..."
          class="col-span-2 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:qSearch', $event.target.value)"
        />

        <input
          :value="exportFrom"
          type="date"
          class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:exportFrom', $event.target.value)"
        />

        <input
          :value="exportTo"
          type="date"
          class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:exportTo', $event.target.value)"
        />

        <button
          type="button"
          class="h-10 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          :disabled="loading"
          @click="emit('refresh')"
        >
          Refresh
        </button>

        <button
          type="button"
          class="h-10 rounded-xl bg-emerald-600 px-3 text-[13px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          :disabled="loading"
          @click="emit('export')"
        >
          Export Excel
        </button>
      </div>

      <!-- desktop -->
      <div class="hidden sm:grid sm:grid-cols-12 sm:gap-2">
        <input
          :value="selectedDate"
          type="date"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:selectedDate', $event.target.value)"
        />

        <select
          :value="statusFilter"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @change="emit('update:statusFilter', $event.target.value)"
        >
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <select
          :value="categoryFilter"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @change="emit('update:categoryFilter', $event.target.value)"
        >
          <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <input
          :value="qSearch"
          type="text"
          placeholder="Search request..."
          class="col-span-3 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:qSearch', $event.target.value)"
        />

        <select
          :value="itemsPerPage"
          class="col-span-1 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @change="emit('update:itemsPerPage', Number($event.target.value))"
        >
          <option v-for="n in perPageOptions" :key="n" :value="n">{{ n }}/page</option>
        </select>

        <button
          type="button"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          :disabled="loading"
          @click="emit('refresh')"
        >
          Refresh
        </button>

        <input
          :value="exportFrom"
          type="date"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:exportFrom', $event.target.value)"
        />

        <input
          :value="exportTo"
          type="date"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900"
          @input="emit('update:exportTo', $event.target.value)"
        />

        <button
          type="button"
          class="col-span-2 h-10 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          :disabled="loading"
          @click="emit('export')"
        >
          Export Excel
        </button>

        <button
          type="button"
          class="col-span-2 h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          @click="setTodayRange"
        >
          Today
        </button>
      </div>
    </div>
  </div>
</template>
<script setup>
defineProps({
  selectedDate: String,
  statusFilter: String,
  categoryFilter: String,
  qSearch: String,
  itemsPerPage: Number,
  exportFrom: String,
  exportTo: String,
  loading: Boolean,
  perPageOptions: {
    type: Array,
    default: () => [10, 20, 50],
  },
})

defineEmits([
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
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50
           px-2 py-2 sm:px-3 dark:border-slate-700 dark:bg-slate-900/80"
  >
    <input
      :value="selectedDate"
      type="date"
      class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900
             outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      @input="$emit('update:selectedDate', $event.target.value)"
    />

    <select
      :value="statusFilter"
      class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900
             outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      @change="$emit('update:statusFilter', $event.target.value)"
    >
      <option value="ALL">All statuses</option>
      <option value="PENDING">PENDING</option>
      <option value="ACCEPTED">ACCEPTED</option>
      <option value="ON_ROAD">ON_ROAD</option>
      <option value="ARRIVING">ARRIVING</option>
      <option value="COMEBACK">COMEBACK</option>
      <option value="COMPLETED">COMPLETED</option>
      <option value="DELAYED">DELAYED</option>
      <option value="CANCELLED">CANCELLED</option>
    </select>

    <select
      :value="categoryFilter"
      class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900
             outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      @change="$emit('update:categoryFilter', $event.target.value)"
    >
      <option value="ALL">All categories</option>
      <option value="Car">Car</option>
      <option value="Messenger">Messenger</option>
    </select>

    <input
      :value="qSearch"
      type="text"
      placeholder="Search requester / purpose / destination / assignee / response"
      class="h-8 w-full max-w-xs flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs
             text-slate-900 placeholder-slate-400
             outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
      @input="$emit('update:qSearch', $event.target.value)"
    />

    <select
      :value="itemsPerPage"
      class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900
             outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500
             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      @change="$emit('update:itemsPerPage', Number($event.target.value))"
    >
      <option v-for="opt in perPageOptions" :key="opt" :value="opt">{{ opt }}/page</option>
    </select>

    <button
      type="button"
      class="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100
             dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      :disabled="loading"
      @click="$emit('refresh')"
    >
      <span
        v-if="loading"
        class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-slate-500 border-t-transparent"
      />
      Refresh
    </button>

    <div class="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
      <span class="hidden sm:inline">Export:</span>
      <input
        :value="exportFrom"
        type="date"
        class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900
               outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500
               dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        @input="$emit('update:exportFrom', $event.target.value)"
      />
      <span>→</span>
      <input
        :value="exportTo"
        type="date"
        class="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900
               outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500
               dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        @input="$emit('update:exportTo', $event.target.value)"
      />
    </div>

    <button
      type="button"
      class="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-500 bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-500
             disabled:opacity-60 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      :disabled="loading"
      @click="$emit('export')"
    >
      Export Excel
    </button>
  </div>
</template>
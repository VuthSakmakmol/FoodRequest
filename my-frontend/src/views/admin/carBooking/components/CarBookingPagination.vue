<script setup>
defineProps({
  page: Number,
  pageCount: Number,
})

defineEmits(['prev', 'next'])
</script>

<template>
  <div class="table-footer mt-2 border-t border-slate-200 dark:border-slate-700 dark:bg-slate-900/90">
    <div class="tf-left text-[11px] text-slate-600 dark:text-slate-300">
      Page {{ page }} / {{ pageCount }}
    </div>
    <div class="tf-middle" />
    <div class="tf-right flex items-center gap-1">
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        :disabled="page <= 1"
        @click="$emit('prev')"
      >
        Prev
      </button>
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        :disabled="page >= pageCount"
        @click="$emit('next')"
      >
        Next
      </button>
    </div>
  </div>
</template>
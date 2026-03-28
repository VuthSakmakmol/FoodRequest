<script setup>
defineProps({
  open: Boolean,
  title: String,
  message: String,
  confirmText: {
    type: String,
    default: 'Confirm',
  },
  confirmClass: {
    type: String,
    default: 'border-sky-500 bg-sky-600 text-white hover:bg-sky-500',
  },
  loading: Boolean,
  error: String,
})

defineEmits(['update:open', 'confirm'])
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-3">
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div class="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 class="text-sm font-semibold">{{ title }}</h3>
        </div>

        <div class="space-y-3 px-4 py-4">
          <p class="text-xs text-slate-700 dark:text-slate-200">{{ message }}</p>

          <div
            v-if="error"
            class="rounded-lg border border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ error }}
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600"
            @click="$emit('update:open', false)"
          >
            Close
          </button>
          <button
            :class="['rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-60', confirmClass]"
            :disabled="loading"
            @click="$emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
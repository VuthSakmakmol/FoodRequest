<script setup>
import { computed } from 'vue'
import { useToast } from '@/composables/useToast'

const { toasts, removeToast } = useToast()

const typeClasses = computed(() => ({
  success: 'border-emerald-500/70 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/80 dark:text-emerald-50',
  error:   'border-rose-500/70 bg-rose-50 text-rose-900 dark:bg-rose-900/80 dark:text-rose-50',
  info:    'border-sky-500/70 bg-sky-50 text-sky-900 dark:bg-sky-900/80 dark:text-sky-50',
  warning: 'border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-900/80 dark:text-amber-50',
}))
</script>

<template>
  <!-- Toast stack -->
  <div
    class="pointer-events-none fixed inset-x-0 top-3 z-[9999] flex flex-col items-end gap-2
           px-2 sm:px-4"
  >
    <transition-group name="toast-fade" tag="div" class="flex flex-col gap-2 w-full sm:w-auto">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto w-full sm:w-[320px] rounded-xl border shadow-lg
               backdrop-blur bg-white/95 dark:bg-slate-900/95
               flex items-start gap-3 px-3 py-2.5 text-sm"
        :class="typeClasses[t.type] || typeClasses.info"
      >
        <!-- Icon -->
        <div class="mt-0.5">
          <i
            v-if="t.type === 'success'"
            class="fa-solid fa-circle-check text-emerald-500 dark:text-emerald-300"
          />
          <i
            v-else-if="t.type === 'error'"
            class="fa-solid fa-triangle-exclamation text-rose-500 dark:text-rose-300"
          />
          <i
            v-else-if="t.type === 'warning'"
            class="fa-solid fa-circle-exclamation text-amber-500 dark:text-amber-300"
          />
          <i
            v-else
            class="fa-solid fa-circle-info text-sky-500 dark:text-sky-300"
          />
        </div>

        <!-- Text -->
        <div class="flex-1 min-w-0">
          <p v-if="t.title" class="font-semibold leading-snug">
            {{ t.title }}
          </p>
          <p
            v-if="t.message"
            class="mt-0.5 text-[12px] leading-snug opacity-90"
          >
            {{ t.message }}
          </p>
        </div>

        <!-- Close button -->
        <button
          type="button"
          class="ml-1 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full
                 hover:bg-black/5 dark:hover:bg-white/10"
          @click="removeToast(t.id)"
        >
          <i class="fa-solid fa-xmark text-[11px]" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.18s ease-out;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>

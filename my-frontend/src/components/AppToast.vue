<!-- src/components/AppToast.vue -->
<script setup>
import { computed } from 'vue'
import { useToast } from '@/composables/useToast'

const { toasts, removeToast } = useToast()

/**
 * ✅ Goal:
 * - Keep blur/glass look
 * - Avoid any “text behind showing through” by using HIGH opacity backgrounds
 * - No duplicate header/label (title + message)
 */
const typeClasses = computed(() => ({
  success:
    'border-emerald-500/55 bg-white/98 text-slate-900 dark:bg-slate-950/97 dark:text-slate-50',
  error:
    'border-rose-500/55 bg-white/98 text-slate-900 dark:bg-slate-950/97 dark:text-slate-50',
  info:
    'border-sky-500/55 bg-sky-50/98 text-slate-900 dark:bg-slate-950/97 dark:text-slate-50',
  warning:
    'border-amber-500/55 bg-white/98 text-slate-900 dark:bg-slate-950/97 dark:text-slate-50',
}))

const iconColor = computed(() => ({
  success: 'text-emerald-600 dark:text-emerald-300',
  error: 'text-rose-600 dark:text-rose-300',
  warning: 'text-amber-600 dark:text-amber-300',
  info: 'text-sky-600 dark:text-sky-300',
}))
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-14 z-[9999] flex flex-col items-end gap-2 px-2 sm:px-4"
  >
    <transition-group name="toast-fade" tag="div" class="flex w-full flex-col gap-2 sm:w-auto">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto w-full sm:w-[360px] rounded-2xl border
               shadow-[0_18px_42px_rgba(15,23,42,0.18)]
               backdrop-blur-md backdrop-saturate-150
               flex items-start gap-3 px-3.5 py-3"
        :class="typeClasses[t.type] || typeClasses.info"
      >
        <!-- Icon -->
        <div class="mt-0.5">
          <i
            v-if="t.type === 'success'"
            class="fa-solid fa-circle-check"
            :class="iconColor.success"
          />
          <i
            v-else-if="t.type === 'error'"
            class="fa-solid fa-triangle-exclamation"
            :class="iconColor.error"
          />
          <i
            v-else-if="t.type === 'warning'"
            class="fa-solid fa-circle-exclamation"
            :class="iconColor.warning"
          />
          <i v-else class="fa-solid fa-circle-info" :class="iconColor.info" />
        </div>

        <!-- ✅ Text (NO DUPLICATE HEADER) -->
        <div class="min-w-0 flex-1">
          <p class="text-[12px] leading-snug text-slate-700 dark:text-slate-200">
            {{ t.message || t.title }}
          </p>
        </div>

        <!-- Close -->
        <button
          type="button"
          class="ml-1 mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full
                 hover:bg-black/5 dark:hover:bg-white/10"
          @click="removeToast(t.id)"
          aria-label="Close toast"
        >
          <i class="fa-solid fa-xmark text-[12px]" />
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

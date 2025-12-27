<!-- src/components/ToastContainer.vue -->
<script setup>
import { computed } from 'vue'
import { useToast } from '@/composables/useToast'

const { toasts, removeToast } = useToast()

/**
 * ✅ Goal:
 * - Keep blur/glass look
 * - Remove/avoid the “black label / header text showing through”
 *   by using HIGH opacity backgrounds (especially in dark mode)
 * - Works well in both light + dark
 */
const typeClasses = computed(() => ({
  success:
    'border-emerald-500/55 bg-white/95 text-slate-900 dark:bg-slate-950/92 dark:text-slate-50',
  error:
    'border-rose-500/55 bg-white/95 text-slate-900 dark:bg-slate-950/92 dark:text-slate-50',
  info:
    'border-sky-500/55 bg-sky-50/95 text-slate-900 dark:bg-sky-950/82 dark:text-slate-50',
  warning:
    'border-amber-500/55 bg-white/95 text-slate-900 dark:bg-slate-950/92 dark:text-slate-50',
}))

const iconColor = computed(() => ({
  success: 'text-emerald-600 dark:text-emerald-300',
  error: 'text-rose-600 dark:text-rose-300',
  warning: 'text-amber-600 dark:text-amber-300',
  info: 'text-sky-600 dark:text-sky-300',
}))
</script>

<template>
  <!-- ✅ top-14 helps avoid overlapping your header/nav (prevents “Light” text behind) -->
  <div class="pointer-events-none fixed inset-x-0 top-14 z-[9999] flex flex-col items-end gap-2 px-2 sm:px-4">
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
          <i
            v-else
            class="fa-solid fa-circle-info"
            :class="iconColor.info"
          />
        </div>

        <!-- Text -->
        <div class="min-w-0 flex-1">
          <p v-if="t.title" class="text-[12px] font-extrabold leading-snug">
            {{ t.title }}
          </p>
          <p
            v-if="t.message"
            class="mt-0.5 text-[12px] leading-snug text-slate-600 dark:text-slate-300"
          >
            {{ t.message }}
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

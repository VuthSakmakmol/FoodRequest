<!-- src/components/AppToast.vue -->
<script setup>
import { computed } from 'vue'
import { useToast } from '@/composables/useToast'

const { toasts, removeToast } = useToast()

const typeClasses = computed(() => ({
  success: 'bg-emerald-600 border-emerald-700 text-white',
  error: 'bg-rose-600 border-rose-700 text-white',
  warning: 'bg-amber-500 border-amber-600 text-black',
  info: 'bg-sky-600 border-sky-700 text-white',
}))

const iconMap = {
  success: 'fa-solid fa-circle-check',
  error: 'fa-solid fa-circle-xmark',
  warning: 'fa-solid fa-triangle-exclamation',
  info: 'fa-solid fa-circle-info',
}
</script>

<template>
  <div class="fixed top-4 right-4 z-[9999] flex flex-col gap-3 w-[95%] max-w-md">
    <transition-group name="toast-slide">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="rounded-xl border shadow-lg px-4 py-3 flex items-start gap-3"
        :class="typeClasses[t.type] || typeClasses.info"
      >
        <!-- Icon -->
        <i :class="[iconMap[t.type] || iconMap.info, 'mt-1 text-lg']"></i>

        <!-- Content -->
        <div class="flex-1">
          <p class="text-sm font-medium">
            {{ t.message || t.title }}
          </p>

          <!-- Optional Action Button -->
          <button
            v-if="t.action"
            type="button"
            class="mt-2 text-xs font-semibold underline hover:opacity-80"
            @click="t.action.handler(); removeToast(t.id)"
          >
            {{ t.action.label }}
          </button>
        </div>

        <!-- Close -->
        <button
          type="button"
          class="ml-2 opacity-80 hover:opacity-100"
          @click="removeToast(t.id)"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.2s ease;
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
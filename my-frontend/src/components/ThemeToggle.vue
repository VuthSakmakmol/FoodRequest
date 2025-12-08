<!-- src/components/ThemeToggle.vue -->
<script setup>
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <button
    type="button"
    @click="toggleTheme"
    class="inline-flex items-center gap-2 rounded-full border border-slate-300/70 bg-white/80
           px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm
           hover:bg-slate-100 hover:border-slate-400
           dark:bg-slate-800/90 dark:border-slate-600 dark:text-slate-100
           dark:hover:bg-slate-700 transition-colors"
  >
    <span
      class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/90 text-slate-900 text-[10px]
             dark:bg-slate-700 dark:text-amber-200"
    >
      <!-- Font Awesome icons -->
      <i v-if="!isDark" class="fa-solid fa-sun text-[11px]"></i>
      <i v-else class="fa-solid fa-moon text-[11px]"></i>
    </span>

    <span class="whitespace-nowrap">
      {{ isDark ? 'Dark mode' : 'Light mode' }}
    </span>
  </button>
</template>

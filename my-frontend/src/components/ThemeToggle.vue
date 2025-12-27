<!-- src/components/ThemeToggle.vue -->
<script setup>
import { useTheme } from '@/composables/useTheme'
const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <button
    type="button"
    @click="toggleTheme"
    class="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold shadow-sm
           bg-white/85 backdrop-blur
           border-slate-200 text-slate-700 hover:bg-white
           dark:bg-slate-950/70 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-900/70 transition"
    title="Toggle theme"
  >
    <span
      class="flex h-7 w-7 items-center justify-center rounded-full
             bg-amber-400/90 text-slate-900
             dark:bg-slate-800 dark:text-amber-200"
    >
      <i v-if="!isDark" class="fa-solid fa-sun text-[12px]" />
      <i v-else class="fa-solid fa-moon text-[12px]" />
    </span>

    <span class="hidden sm:inline">
      {{ isDark ? 'Dark' : 'Light' }}
    </span>
  </button>
</template>

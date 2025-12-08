<!-- src/App.vue -->
<script setup>
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <!-- Global background + text color that responds to dark mode -->
  <div
    class="min-h-screen bg-slate-100 text-slate-900
           dark:bg-slate-950 dark:text-slate-50 transition-colors"
  >
    <!-- Global theme toggle: top-right -->
    <div class="fixed top-3 right-3 z-50">
      <ThemeToggle />
      
    </div>
      <AppToast />
    <!-- Your routed pages -->
    <router-view />
  </div>
</template>

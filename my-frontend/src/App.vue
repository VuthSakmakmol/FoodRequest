<!-- src/App.vue -->
<script setup>
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <div class="min-h-screen transition-colors">
    <div class="fixed top-3 right-3 z-50">
      <ThemeToggle />
    </div>

    <AppToast />
    <router-view />
  </div>
</template>

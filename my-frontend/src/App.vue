<!-- src/App.vue -->
<script setup>
import ThemeToggle from '@/components/ThemeToggle.vue'
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <div class="app-shell transition-colors">
    <div class="fixed right-3 top-3 z-50">
      <ThemeToggle />
    </div>

    <AppToast />
    <router-view />
  </div>
</template>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  position: fixed;
  inset: 0;
  overscroll-behavior-y: none;
}

.app-shell {
  width: 100%;
  height: 100dvh;
  overflow: hidden;
}
</style>
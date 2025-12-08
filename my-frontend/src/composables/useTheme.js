// src/composables/useTheme.js
import { ref } from 'vue'

const isDark = ref(false)
let initialized = false

function applyTheme(dark) {
  isDark.value = dark
  const root = document.documentElement
  if (dark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem('theme', dark ? 'dark' : 'light')
}

function initTheme() {
  if (initialized) return
  initialized = true

  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || stored === 'light') {
      applyTheme(stored === 'dark')
      return
    }

    // default: follow system preference
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches

    applyTheme(prefersDark)
  } catch {
    applyTheme(false)
  }
}

export function useTheme() {
  if (!initialized && typeof window !== 'undefined') {
    initTheme()
  }

  function toggleTheme() {
    applyTheme(!isDark.value)
  }

  return {
    isDark,
    toggleTheme,
  }
}

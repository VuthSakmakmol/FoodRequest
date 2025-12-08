// src/composables/useToast.js
import { ref, readonly } from 'vue'

const toasts = ref([]) // shared singleton

let idCounter = 1

function showToast({ type = 'success', title = '', message = '', timeout = 3000 } = {}) {
  const id = idCounter++

  toasts.value.push({
    id,
    type,
    title,
    message,
  })

  if (timeout && timeout > 0) {
    setTimeout(() => removeToast(id), timeout)
  }

  return id
}

function removeToast(id) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

export function useToast() {
  // every component using this composable shares the same toasts
  return {
    toasts: readonly(toasts),
    showToast,
    removeToast,
  }
}

// src/composables/useToast.js
import { ref, readonly } from 'vue'

const toasts = ref([])
let idCounter = 1

function showToast({
  type = 'success',
  title = '',
  message = '',
  timeout = 3000,
  action = null, // { label: 'Undo', handler: () => {} }
} = {}) {
  const id = idCounter++

  toasts.value.push({
    id,
    type,
    title,
    message,
    action,
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
  return {
    toasts: readonly(toasts),
    showToast,
    removeToast,
  }
}
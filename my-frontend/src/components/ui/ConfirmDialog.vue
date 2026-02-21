<!-- src/components/ui/ComfiremDialog.vue -->
<script setup>
import { computed } from 'vue'

defineOptions({ name: 'ConfirmDialog' })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: 'Confirm' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: 'Confirm' },
  cancelText: { type: String, default: 'Close' },
  tone: { type: String, default: 'primary' }, // primary | danger | warning
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const toneBtn = computed(() => {
  if (props.tone === 'danger') return 'ui-btn ui-btn-rose'
  if (props.tone === 'warning') return 'ui-btn ui-btn-soft'
  return 'ui-btn ui-btn-primary'
})
</script>

<template>
  <div v-if="open" class="ui-modal-backdrop">
    <div class="ui-modal p-4">
      <div class="flex items-start gap-3">
        <div
          class="grid h-10 w-10 place-items-center rounded-2xl border"
          :style="tone === 'danger'
            ? 'border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));'
            : tone === 'warning'
              ? 'border-color: rgb(var(--ui-warning) / 0.25); background: rgb(var(--ui-warning) / 0.10); color: rgb(var(--ui-warning));'
              : 'border-color: rgb(var(--ui-primary) / 0.25); background: rgb(var(--ui-primary) / 0.10); color: rgb(var(--ui-primary));'
          "
        >
          <i class="fa-solid fa-circle-question" />
        </div>

        <div class="flex-1">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">{{ title }}</div>
          <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
            {{ message }}
          </div>
        </div>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="ui-btn ui-btn-ghost" :disabled="busy" @click="open = false">
          {{ cancelText }}
        </button>
        <button type="button" :class="toneBtn" :disabled="busy" @click="emit('confirm')">
          <i v-if="busy" class="fa-solid fa-spinner animate-spin text-[11px]" />
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
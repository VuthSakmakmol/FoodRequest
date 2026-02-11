<script setup>
import { defineProps } from 'vue'

defineOptions({ name: 'InfoRow' })

defineProps({
  label: { type: String, default: '' },
  value: { type: String, default: '' },
  hint: { type: String, default: '' },
})
</script>

<template>
  <div class="ui-card !rounded-2xl px-3 py-2">
    <div
      class="ui-label !text-[10px] !font-extrabold !tracking-[0.28em] uppercase"
      :class="hint ? 'cursor-help' : ''"
      :title="hint || ''"
    >
      {{ label }}
    </div>

    <!-- ✅ uses your CSS tokens (works in light + dark) -->
    <div
      class="mt-1 text-[13px] font-semibold truncate"
      :style="{ color: 'rgb(var(--ui-fg) / 0.95)' }"
    >
      {{ value }}
    </div>
  </div>
</template>

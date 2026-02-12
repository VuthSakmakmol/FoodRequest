<!-- src/views/expat/admin/profiles/components/InfoRow.vue -->
<script setup>
defineOptions({ name: 'InfoRow' })

defineProps({
  label: { type: String, default: '' },
  value: { type: [String, Number], default: '—' },
  hint: { type: String, default: '' },
})
</script>

<template>
  <div class="ui-card !rounded-2xl px-3 py-2">
    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">
      {{ label }}
      <span v-if="hint" class="ml-2 text-[10px] font-semibold text-ui-muted normal-case tracking-normal">· {{ hint }}</span>
    </div>
    <div class="mt-1 text-[12px] font-extrabold text-ui-fg">
      {{ value ?? '—' }}
    </div>
  </div>
</template>

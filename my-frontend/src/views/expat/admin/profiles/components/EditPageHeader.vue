<script setup>
defineOptions({ name: 'EditPageHeader' })

defineProps({
  employeeId: { type: String, default: '' },
  isDirty: { type: Boolean, default: false },
  joinDateChanged: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  hasProfile: { type: Boolean, default: false },
})

defineEmits(['back', 'reset', 'openLogs', 'openRenew', 'openPassword', 'save', 'refresh'])
</script>

<template>
  <header class="ui-hero-gradient border-x-0 border-t-0 px-4 py-3">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <!-- Left -->
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <!-- Icon box (token-based, no dark: classes) -->
          <span
            class="inline-flex h-8 w-8 items-center justify-center rounded-xl ring-1 shadow-sm"
            :style="{
              background: 'rgba(255,255,255,0.16)',
              color: 'rgba(255,255,255,0.95)',
              boxShadow: '0 6px 14px rgba(0,0,0,0.10)',
              borderColor: 'rgba(255,255,255,0.22)',
            }"
          >
            <i class="fa-solid fa-pen-to-square text-[12px]" />
          </span>

          <div class="min-w-0">
            <div class="ui-hero-title !text-white">Leave Profile Edit</div>
          </div>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span
            v-if="isDirty"
            class="ui-badge !bg-white/15 !text-white !border-white/25"
          >
            Unsaved changes
          </span>

          <span
            v-if="joinDateChanged"
            class="ui-badge !bg-white/12 !text-white !border-white/25"
          >
            Join date changed → recalc
          </span>
        </div>
      </div>

      <!-- Right / Actions -->
      <div class="w-full lg:w-auto">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center lg:justify-end">
          <button type="button" class="ui-hero-btn" @click="$emit('back')">
            <i class="fa-solid fa-arrow-left text-[11px]" />
            Back
          </button>

          <button
            type="button"
            class="ui-hero-btn"
            :disabled="loading || saving || !hasProfile || !isDirty"
            @click="$emit('reset')"
          >
            <i class="fa-solid fa-rotate-left text-[11px]" />
            Reset
          </button>

          <button
            type="button"
            class="ui-hero-btn"
            :disabled="loading || !hasProfile"
            @click="$emit('openLogs')"
          >
            <i class="fa-regular fa-folder-open text-[11px]" />
            Logs
          </button>

          <button
            type="button"
            class="ui-hero-btn"
            :disabled="loading || !hasProfile"
            @click="$emit('openRenew')"
          >
            <i class="fa-solid fa-arrows-rotate text-[11px]" />
            Renew
          </button>

          <button
            type="button"
            class="ui-hero-btn"
            :disabled="loading || !hasProfile"
            @click="$emit('openPassword')"
          >
            <i class="fa-solid fa-key text-[11px]" />
            Password
          </button>

          <button
            type="button"
            class="ui-hero-btn ui-hero-btn-primary"
            :disabled="loading || saving || !hasProfile || !isDirty"
            @click="$emit('save')"
          >
            <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
            Save
            <span v-if="joinDateChanged" class="ml-1 ui-badge !bg-white/15 !text-white !border-white/25">+recalc</span>
          </button>

          <button
            type="button"
            class="ui-hero-btn"
            :disabled="loading"
            @click="$emit('refresh')"
          >
            <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
            Refresh
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

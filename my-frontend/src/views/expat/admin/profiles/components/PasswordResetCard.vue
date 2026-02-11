<script setup>
defineOptions({ name: 'PasswordResetCard' })

defineProps({
  open: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  show: { type: Boolean, default: false },
  password: { type: String, default: '' },
  confirm: { type: String, default: '' },
  error: { type: String, default: '' },
  employeeId: { type: String, default: '' },
  employeeName: { type: String, default: '' },
})

defineEmits([
  'update:show',
  'update:password',
  'update:confirm',
  'clear',
  'close',
  'submit',
])
</script>

<template>
  <section v-if="open" class="ui-card overflow-hidden">
    <!-- Header -->
    <div class="section-head section-head--amber">
      <div class="min-w-0">
        <div class="section-title flex items-center gap-2">
          <span
            class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 text-amber-700
                   shadow-sm ring-1 ring-white/60 dark:bg-white/10 dark:text-amber-200 dark:ring-white/10"
          >
            <i class="fa-solid fa-key text-[13px]" />
          </span>
          <span class="truncate">Reset password</span>
        </div>


      </div>

      <!-- Actions -->
      <div class="mt-3 flex w-full flex-col gap-2 sm:mt-0 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          class="ui-btn ui-btn-ghost ui-btn-sm w-full sm:w-auto"
          :disabled="submitting"
          @click="$emit('clear')"
        >
          <i class="fa-solid fa-eraser text-[11px]" />
          Clear
        </button>

        <button
          type="button"
          class="ui-btn ui-btn-soft ui-btn-sm w-full sm:w-auto"
          :disabled="submitting"
          @click="$emit('close')"
        >
          <i class="fa-solid fa-xmark text-[11px]" />
          Close
        </button>

        <button
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm w-full sm:w-auto"
          :disabled="submitting"
          @click="$emit('submit')"
        >
          <i class="fa-solid" :class="submitting ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
          Save password
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="p-3 lg:p-4">
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <!-- Left / Inputs -->
        <div class="lg:col-span-8 space-y-3">
          <!-- New Password -->
          <div class="ui-card !rounded-2xl p-3 sm:p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">New password</div>
              </div>

              <span
                class="hidden sm:inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-bold
                       bg-amber-50 text-amber-800 ring-1 ring-amber-100
                       dark:bg-amber-400/10 dark:text-amber-200 dark:ring-white/10"
              >
                <i class="fa-solid fa-shield-halved text-[11px]" />
                Strong policy
              </span>
            </div>

            <div class="mt-3 relative">
              <span
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted"
              >
                <i class="fa-solid fa-lock text-[12px]" />
              </span>

              <input
                :value="password"
                @input="$emit('update:password', $event.target.value)"
                :type="show ? 'text' : 'password'"
                class="ui-input w-full pl-10 pr-14"
                placeholder="Type strong password…"
                :disabled="submitting"
                autocomplete="new-password"
              />

              <button
                type="button"
                :disabled="submitting"
                @click="$emit('update:show', !show)"
                :title="show ? 'Hide' : 'Show'"
                class="absolute right-2 top-1/2 -translate-y-1/2
                      h-7 w-7 rounded-xl
                      inline-flex items-center justify-center
                      bg-white/70 ring-1 ring-ui-border/70
                      hover:bg-white
                      dark:bg-white/10 dark:hover:bg-white/15 dark:ring-white/10
                      transition"
              >
                <i class="fa-solid leading-none text-[14px]" :class="show ? 'fa-eye-slash' : 'fa-eye'" />
              </button>
            </div>
          </div>

          <!-- Confirm -->
          <div class="ui-card !rounded-2xl p-3 sm:p-4">
            <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase">Confirm password</div>
            <div class="mt-3 relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-muted">
                <i class="fa-solid fa-circle-check text-[12px]" />
              </span>

              <input
                :value="confirm"
                @input="$emit('update:confirm', $event.target.value)"
                :type="show ? 'text' : 'password'"
                class="ui-input w-full pl-10"
                placeholder="Re-type password…"
                :disabled="submitting"
                autocomplete="new-password"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div
        v-if="error"
        class="mt-3 ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
               dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
      >
        <div class="flex items-start gap-2">
          <i class="fa-solid fa-triangle-exclamation mt-[2px]" />
          <div class="min-w-0">
            <span class="font-semibold">Failed:</span>
            <span class="break-words">{{ error }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

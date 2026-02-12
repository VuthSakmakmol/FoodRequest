<!-- src/views/expat/admin/profiles/components/PasswordResetCard.vue -->
<script setup>
defineOptions({ name: 'PasswordResetCard' })

const props = defineProps({
  open: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  show: { type: Boolean, default: false },
  password: { type: String, default: '' },
  confirm: { type: String, default: '' },
  error: { type: String, default: '' },
  employeeId: { type: String, default: '' },
  employeeName: { type: String, default: '' },
})

const emit = defineEmits([
  'update:show',
  'update:password',
  'update:confirm',
  'clear',
  'close',
  'submit',
])
</script>

<template>
  <section class="ui-card overflow-hidden">
    <div class="section-head section-head--slate">

      <div class="flex items-center gap-2">
        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('close'); $emit('submit');" style="display:none" />
        <button v-if="!open" type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="$emit('clear'); $emit('update:password',''); $emit('update:confirm',''); $emit('update:show', false); $emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('close');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('clear'); $emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('submit');" style="display:none" />

        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('clear'); $emit('close'); $emit('submit');"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close'); $emit('update:password',''); $emit('update:confirm','');"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button v-if="!open" type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="$emit('close')" style="display:none" />
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close')"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close')"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close')"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close')"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="!open"
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close')"
          style="display:none"
        />
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close')"
          v-if="open"
        >
          <i class="fa-solid fa-xmark text-[11px]" /> Close
        </button>

        <button
          v-else
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          @click="$emit('close'); $emit('submit');"
          style="display:none"
        />
      </div>
    </div>

    <div class="p-3 lg:p-4">
      <div v-if="!open" class="text-[11px] text-ui-muted">
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="lg:col-span-2 space-y-2">
          <div class="ui-label">New password (13+ strong)</div>
          <div class="relative">
            <input
              class="ui-input w-full pr-12"
              :type="show ? 'text' : 'password'"
              autocomplete="new-password"
              :value="password"
              @input="$emit('update:password', $event.target.value)"
              placeholder="Enter strong password…"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 ui-btn ui-btn-ghost ui-btn-xs"
              @click="$emit('update:show', !show)"
              :title="show ? 'Hide password' : 'Show password'"
            >
              <i class="fa-solid" :class="show ? 'fa-eye-slash' : 'fa-eye'"></i>
            </button>
          </div>

          <div class="ui-label mt-2">Confirm password</div>
          <input
            class="ui-input w-full"
            :type="show ? 'text' : 'password'"
            autocomplete="new-password"
            :value="confirm"
            @input="$emit('update:confirm', $event.target.value)"
            placeholder="Confirm…"
          />

          <div class="mt-2 text-[10px] text-ui-muted">
            Must include at least 3 of: uppercase, lowercase, number, symbol.
          </div>

          <div
            v-if="error"
            class="mt-2 ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                   dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            <span class="font-semibold">Error:</span> {{ error }}
          </div>
        </div>

        <div class="space-y-2">
          <button type="button" class="ui-btn ui-btn-ghost w-full" :disabled="submitting" @click="$emit('clear')">
            <i class="fa-solid fa-broom text-[11px]" /> Clear
          </button>

          <button type="button" class="ui-btn ui-btn-primary w-full" :disabled="submitting" @click="$emit('submit')">
            <i class="fa-solid" :class="submitting ? 'fa-circle-notch fa-spin' : 'fa-key'" />
            {{ submitting ? 'Saving…' : 'Set new password' }}
          </button>

          <button type="button" class="ui-btn ui-btn-soft w-full" :disabled="submitting" @click="$emit('close')">
            <i class="fa-solid fa-xmark text-[11px]" /> Close panel
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* optional: section head gradient for slate */
:deep(.section-head--slate) {
  background: linear-gradient(90deg, rgba(100, 116, 139, 0.12), rgba(255, 255, 255, 0));
}
:deep(.dark) .section-head--slate {
  background: linear-gradient(90deg, rgba(100, 116, 139, 0.18), rgba(2, 6, 23, 0));
}
</style>

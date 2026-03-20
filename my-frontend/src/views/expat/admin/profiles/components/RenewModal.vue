<!-- src/views/expat/admin/profiles/components/RenewModal.vue -->
<script setup>
import { ref, watch, computed } from 'vue'
import dayjs from 'dayjs'

defineOptions({ name: 'RenewModal' })

const props = defineProps({
  open: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  error: { type: String, default: '' },

  currentContractEndDate: { type: String, default: '' },
  newContractDate: { type: String, default: '' },

  clearOldLeave: { type: Boolean, default: true },
  note: { type: String, default: '' },

  employeeId: { type: String, default: '' },
  employeeName: { type: String, default: '' },
})

const emit = defineEmits([
  'close',
  'submit',
  'update:clearOldLeave',
  'update:note',
])

const confirmOpen = ref(false)

const displayCurrentEndDate = computed(() => {
  if (!props.currentContractEndDate) return '—'
  const d = dayjs(props.currentContractEndDate)
  return d.isValid() ? d.format('YYYY-MM-DD') : props.currentContractEndDate
})

const displayNewContractDate = computed(() => {
  if (!props.newContractDate) return '—'
  const d = dayjs(props.newContractDate)
  return d.isValid() ? d.format('YYYY-MM-DD') : props.newContractDate
})

function askConfirm() {
  if (props.submitting) return
  confirmOpen.value = true
}

function closeConfirm() {
  if (props.submitting) return
  confirmOpen.value = false
}

function confirmSubmit() {
  if (props.submitting) return
  confirmOpen.value = false
  emit('submit')
}

watch(
  () => props.open,
  (v) => {
    if (!v) confirmOpen.value = false
  }
)
</script>

<template>
  <transition name="modal-fade">
    <div v-if="open" class="ui-modal-backdrop" @click.self="$emit('close')">
      <div class="ui-modal max-h-[calc(100vh-3rem)] w-full max-w-2xl flex flex-col overflow-hidden">
        <div class="ui-hero rounded-b-none px-4 py-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-[14px] font-extrabold text-ui-fg">Renew contract</div>
              <div class="text-[11px] text-ui-muted">
                {{ employeeId || '—' }} · {{ employeeName || '—' }}
              </div>
            </div>

            <button
              type="button"
              class="ui-btn ui-btn-ghost ui-btn-sm"
              :disabled="submitting"
              @click="$emit('close')"
            >
              <i class="fa-solid fa-xmark text-xs" />
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-3 space-y-4">
          <div class="grid gap-3 sm:grid-cols-1">
            <div>
              <div class="ui-label">New contract start date</div>
              <div class="ui-card !rounded-2xl px-4 py-4">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[15px] font-extrabold text-ui-fg">
                      {{ displayNewContractDate }}
                    </div>
                    <div class="mt-1 text-[11px] text-ui-muted">
                      Auto-generated from previous contract end date + 1 day.
                    </div>
                  </div>

                  <div
                    class="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl
                           bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
                  >
                    <i class="fa-solid fa-calendar-check text-sm" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            class="ui-card !rounded-2xl px-4 py-4 border"
            :class="
              clearOldLeave
                ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-700/50 dark:bg-emerald-950/20'
                : 'border-amber-200 bg-amber-50/70 dark:border-amber-700/50 dark:bg-amber-950/20'
            "
          >
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="ui-label !mb-0">Clear unused AL?</div>

                  <span
                    class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                    :class="
                      clearOldLeave
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                    "
                  >
                    {{ clearOldLeave ? 'ON · CLEAR TO 0' : 'OFF · CARRY FORWARD' }}
                  </span>
                </div>

                <div class="mt-2 text-[13px] font-bold text-ui-fg">
                  {{ clearOldLeave ? 'Yes, clear unused AL to 0' : 'No, carry AL forward' }}
                </div>

                <div class="mt-1 text-[11px] leading-5 text-ui-muted">
                  <span v-if="clearOldLeave">
                    Positive AL will be cleared. Negative AL debt will remain.
                  </span>
                  <span v-else>
                    Remaining AL will be carried into the new contract.
                  </span>
                </div>
              </div>

              <div class="shrink-0">
                <button
                  type="button"
                  :disabled="submitting"
                  class="group relative inline-flex h-[54px] w-[120px] items-center rounded-full border-2 px-2 transition-all duration-200"
                  :class="
                    clearOldLeave
                      ? 'border-emerald-300 bg-emerald-500/15 dark:border-emerald-600 dark:bg-emerald-500/10'
                      : 'border-slate-300 bg-slate-200/70 dark:border-slate-600 dark:bg-slate-800/80'
                  "
                  @click="$emit('update:clearOldLeave', !clearOldLeave)"
                >
                  <span
                    class="absolute left-2 right-2 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-[0.18em]"
                  >
                    <span
                      :class="clearOldLeave ? 'text-emerald-700 dark:text-emerald-200' : 'text-ui-muted'"
                    >
                      On
                    </span>
                    <span
                      :class="!clearOldLeave ? 'text-slate-700 dark:text-slate-200' : 'text-ui-muted'"
                    >
                      Off
                    </span>
                  </span>

                  <span
                    class="relative z-[1] flex h-10 w-10 items-center justify-center rounded-full shadow-md transition-all duration-200"
                    :class="
                      clearOldLeave
                        ? 'translate-x-[64px] bg-emerald-600 text-white dark:bg-emerald-500'
                        : 'translate-x-0 bg-white text-slate-700 dark:bg-slate-200 dark:text-slate-900'
                    "
                  >
                    <i
                      class="fa-solid text-[13px]"
                      :class="clearOldLeave ? 'fa-check' : 'fa-arrow-right'"
                    />
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div>
            <div class="ui-label">Note (optional)</div>
            <textarea
              :value="note"
              @input="$emit('update:note', $event.target.value)"
              rows="3"
              class="ui-input w-full"
              placeholder="Example: annual contract renewal"
            />
          </div>

          <div
            v-if="error"
            class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                   dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            <span class="font-semibold">Failed:</span> {{ error }}
          </div>
        </div>

        <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
          <button
            type="button"
            class="ui-btn ui-btn-ghost"
            :disabled="submitting"
            @click="$emit('close')"
          >
            Cancel
          </button>

          <button
            type="button"
            class="ui-btn ui-btn-primary"
            :disabled="submitting"
            @click="askConfirm"
          >
            <i class="fa-solid fa-arrows-rotate" />
            Renew
          </button>
        </div>

        <transition name="modal-fade">
          <div
            v-if="confirmOpen"
            class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
          >
            <div class="ui-card w-full max-w-md !rounded-2xl p-4 shadow-2xl">
              <div class="flex items-start gap-3">
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl
                         bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <i class="fa-solid fa-triangle-exclamation" />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="text-[14px] font-extrabold text-ui-fg">Are you sure?</div>
                  <div class="mt-1 text-[12px] text-ui-muted leading-5">
                    You are about to renew this contract for
                    <span class="font-semibold text-ui-fg">{{ employeeId || '—' }}</span>
                    <span v-if="employeeName"> · {{ employeeName }}</span>.
                  </div>

                  <div class="mt-3 ui-card !rounded-xl bg-ui-bg-2/70 px-3 py-2 text-[11px]">
                    <div>
                      <span class="font-semibold">Current end date:</span>
                      {{ displayCurrentEndDate }}
                    </div>
                    <div class="mt-1">
                      <span class="font-semibold">New start date:</span>
                      {{ displayNewContractDate }}
                    </div>
                    <div class="mt-1">
                      <span class="font-semibold">AL option:</span>
                      {{ clearOldLeave ? 'Clear unused AL' : 'Carry AL forward' }}
                    </div>
                  </div>

                  <div class="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      class="ui-btn ui-btn-ghost"
                      :disabled="submitting"
                      @click="closeConfirm"
                    >
                      No
                    </button>

                    <button
                      type="button"
                      class="ui-btn ui-btn-primary"
                      :disabled="submitting"
                      @click="confirmSubmit"
                    >
                      <i
                        class="fa-solid"
                        :class="submitting ? 'fa-circle-notch fa-spin' : 'fa-check'"
                      />
                      {{ submitting ? 'Saving…' : 'Yes, renew' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </transition>
</template>
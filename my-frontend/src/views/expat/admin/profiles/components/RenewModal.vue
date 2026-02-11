<script setup>
import dayjs from 'dayjs'

defineOptions({ name: 'RenewModal' })

defineProps({
  open: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  error: { type: String, default: '' },
  newContractDate: { type: String, default: '' },
  clearOldLeave: { type: Boolean, default: true },
  note: { type: String, default: '' },

  employeeId: { type: String, default: '' },
  employeeName: { type: String, default: '' },
})

defineEmits([
  'close',
  'submit',
  'update:newContractDate',
  'update:clearOldLeave',
  'update:note',
])
</script>

<template>
  <transition name="modal-fade">
    <div v-if="open" class="ui-modal-backdrop" @click.self="$emit('close')">
      <div class="ui-modal max-h-[calc(100vh-3rem)] w-full max-w-2xl flex flex-col overflow-hidden">
        <div class="ui-hero rounded-b-none px-4 py-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-[14px] font-extrabold text-ui-fg">Renew contract</div>
              <div class="text-[11px] text-ui-muted">{{ employeeId }} · {{ employeeName || '—' }}</div>
            </div>
            <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="submitting" @click="$emit('close')">
              <i class="fa-solid fa-xmark text-xs" />
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-3 space-y-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <div class="ui-label">New contract start date</div>
              <input
                :value="newContractDate"
                @input="$emit('update:newContractDate', $event.target.value)"
                type="date"
                class="ui-date w-full"
              />
            </div>

            <div>
              <div class="ui-label">Clear unused AL?</div>
              <div class="ui-card !rounded-2xl px-3 py-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[12px] font-extrabold text-ui-fg">
                      {{ clearOldLeave ? 'Yes (clear AL to 0)' : 'No (carry AL forward)' }}
                    </div>
                    <div class="mt-1 text-[11px] text-ui-muted">
                      ON: positive AL cleared, negative debt remains. OFF: carry everything.
                    </div>
                  </div>

                  <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="$emit('update:clearOldLeave', !clearOldLeave)">
                    <i class="fa-solid" :class="clearOldLeave ? 'fa-toggle-on' : 'fa-toggle-off'" />
                  </button>
                </div>
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
              placeholder="Example: renewed contract for 3 months"
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
          <button type="button" class="ui-btn ui-btn-ghost" :disabled="submitting" @click="$emit('close')">Cancel</button>

          <button type="button" class="ui-btn ui-btn-primary" :disabled="submitting" @click="$emit('submit')">
            <i class="fa-solid" :class="submitting ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'" />
            {{ submitting ? 'Saving…' : 'Renew' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

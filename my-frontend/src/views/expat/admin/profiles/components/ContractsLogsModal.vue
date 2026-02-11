<script setup>
import dayjs from 'dayjs'

defineOptions({ name: 'ContractsLogsModal' })

const props = defineProps({
  open: { type: Boolean, default: false },
  employeeId: { type: String, default: '' },
  employeeName: { type: String, default: '' },
  contractHistory: { type: Array, default: () => [] },
  fmt: { type: Function, default: (v) => String(v ?? '') },
})

defineEmits(['close'])

function ymd(v) {
  const s = String(v || '').trim()
  return s || '—'
}
function dt(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD HH:mm')
}
function getCarry(c, k) {
  return c?.closeSnapshot?.carry?.[k] ?? c?.carry?.[k] ?? 0
}
</script>

<template>
  <transition name="modal-fade">
    <div v-if="open" class="fixed inset-0 z-[90]">
      <!-- backdrop -->
      <div class="absolute inset-0 bg-black/55" @click.self="$emit('close')" />

      <!-- simple fullscreen panel -->
      <div class="absolute inset-0 bg-ui-bg text-ui-fg">
        <!-- close -->
        <button
          type="button"
          class="ui-btn ui-btn-ghost ui-btn-sm fixed top-3 right-3 z-[95] bg-ui-card/80 border border-ui-border/60"
          @click="$emit('close')"
          title="Close"
        >
          <i class="fa-solid fa-xmark text-sm" />
        </button>

        <!-- content -->
        <div class="h-full overflow-y-auto ui-scrollbar px-2 sm:px-4 lg:px-6 py-4">
          <div class="mb-3">
            <div class="text-[13px] font-extrabold">Contract logs</div>
            <div class="text-[11px] text-ui-muted">
              {{ employeeId || '—' }} · {{ employeeName || '—' }} · Total: {{ contractHistory.length }}
            </div>
          </div>

          <!-- empty -->
          <div v-if="!contractHistory.length" class="ui-card !rounded-2xl p-4 text-[12px] text-ui-muted">
            No contract logs yet.
          </div>

          <!-- list -->
          <div v-else class="space-y-2">
            <div
              v-for="(c, idx) in contractHistory"
              :key="c._id || c.createdAt || idx"
              class="ui-card !rounded-2xl p-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="ui-badge !text-[11px] !px-2 !py-1 font-mono">
                    #{{ c.contractNo ?? idx + 1 }}
                  </span>
                  <div class="text-[11px] text-ui-muted truncate">
                    {{ ymd(c.startDate) }} → {{ ymd(c.endDate) }}
                  </div>
                </div>
                <div class="text-[11px] text-ui-muted font-mono">
                  {{ dt(c.closedAt || c.openedAt) }}
                </div>
              </div>

              <!-- carry -->
              <div class="mt-2">
                <div class="text-[11px] font-extrabold text-ui-fg/90 mb-1">Carry</div>
                <div class="flex flex-wrap gap-2">
                  <span class="ui-badge !text-[11px] !px-2 !py-1">AL: {{ fmt(getCarry(c, 'AL')) }}</span>
                  <span class="ui-badge !text-[11px] !px-2 !py-1">SP: {{ fmt(getCarry(c, 'SP')) }}</span>
                  <span class="ui-badge !text-[11px] !px-2 !py-1">MC: {{ fmt(getCarry(c, 'MC')) }}</span>
                  <span class="ui-badge !text-[11px] !px-2 !py-1">MA: {{ fmt(getCarry(c, 'MA')) }}</span>
                  <span class="ui-badge !text-[11px] !px-2 !py-1">UL: {{ fmt(getCarry(c, 'UL')) }}</span>
                </div>
              </div>

              <!-- balances -->
              <div class="mt-2">
                <div class="text-[11px] font-extrabold text-ui-fg/90 mb-1">Balances</div>
                <div v-if="Array.isArray(c?.closeSnapshot?.balances)" class="flex flex-wrap gap-2">
                  <span
                    v-for="b in c.closeSnapshot.balances"
                    :key="String(b.leaveTypeCode) + String(c.openedAt || c.createdAt || idx)"
                    class="ui-badge !text-[11px] !px-2 !py-1"
                  >
                    {{ String(b.leaveTypeCode).toUpperCase() }}:
                    <span class="font-mono">U{{ fmt(b.used) }}</span> /
                    <span class="font-mono">R{{ fmt(b.remaining) }}</span>
                  </span>
                </div>
                <div v-else class="text-[11px] text-ui-muted/70">—</div>
              </div>

              <!-- note / by -->
              <div class="mt-2 text-[11px] text-ui-muted">
                <span class="font-extrabold text-ui-fg/80">By:</span>
                <span class="font-mono ml-1">{{ c.closedBy || c.openedBy || '—' }}</span>
                <span class="mx-2 opacity-50">•</span>
                <span class="font-extrabold text-ui-fg/80">Note:</span>
                <span class="ml-1">{{ c.note || '—' }}</span>
              </div>
            </div>
          </div>

          <div class="h-6" />
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.16s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>

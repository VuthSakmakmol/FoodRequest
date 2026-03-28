<script setup>
defineProps({
  open: Boolean,
  item: Object,
  prettyStops: Function,
  assigneeName: Function,
  responseLabel: Function,
  statusBadgeClass: Function,
  ackBadgeClass: Function,
})

defineEmits(['update:open', 'open-ticket', 'unassign'])
</script>

<template>
  <teleport to="body">
    <div v-if="open && item" class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-3">
      <div class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 class="text-sm font-semibold">Booking details</h3>
          <button class="text-sm" @click="$emit('update:open', false)">✕</button>
        </div>

        <div class="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 text-xs">
          <div><strong>Date:</strong> {{ item.tripDate }}</div>
          <div><strong>Time:</strong> {{ item.timeStart }} – {{ item.timeEnd }}</div>
          <div><strong>Category:</strong> {{ item.category }}</div>
          <div><strong>Pax:</strong> {{ item.passengers || 1 }}</div>
          <div class="sm:col-span-2"><strong>Requester:</strong> {{ item.employee?.name || '—' }}</div>
          <div class="sm:col-span-2"><strong>Destination:</strong> {{ prettyStops(item.stops || []) }}</div>
          <div class="sm:col-span-2"><strong>Purpose:</strong> {{ item.purpose || '—' }}</div>
          <div><strong>Assigned:</strong> {{ assigneeName(item) || 'Unassigned' }}</div>
          <div><strong>Response:</strong>
            <span class="ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="ackBadgeClass(responseLabel(item))">
              {{ responseLabel(item) }}
            </span>
          </div>
          <div><strong>Status:</strong>
            <span class="ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="statusBadgeClass(item.status)">
              {{ item.status }}
            </span>
          </div>

          <div v-if="item.ticketUrl" class="sm:col-span-2">
            <button
              class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600"
              @click="$emit('open-ticket', item.ticketUrl)"
            >
              Open Ticket
            </button>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            v-if="assigneeName(item)"
            class="rounded-lg border border-amber-500 bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-400"
            @click="$emit('unassign', item)"
          >
            Unassign
          </button>
          <button class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600" @click="$emit('update:open', false)">
            Close
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
<script setup>
defineProps({
  loading: Boolean,
  rows: Array,
  selectedDate: String,
  focusId: String,
  updating: Object,
  nextStatuses: Function,
  canChangeStatus: Function,
  canForceComplete: Function,
  statusBadgeClass: Function,
  ackBadgeClass: Function,
  statusButtonClass: Function,
  prettyStops: Function,
  assigneeName: Function,
  responseLabel: Function,
  paxDisplay: Function,
})

defineEmits([
  'open-ticket',
  'edit',
  'assign',
  'details',
  'cancel',
  'status',
  'force-complete',
])
</script>

<template>
  <div class="mobile-list">
    <div
      v-if="loading"
      class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500
             dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      Loading bookings…
    </div>

    <div v-else-if="!rows.length" class="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
      No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
    </div>

    <div
      v-for="item in rows"
      v-else
      :key="item._id"
      class="booking-card"
      :class="{ 'ring-2 ring-amber-400': focusId === String(item._id) }"
    >
      <div class="bc-top">
        <div>
          <div class="bc-date">{{ item.tripDate || selectedDate }}</div>
          <div class="bc-time mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
        </div>

        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="statusBadgeClass(item.status)">
          {{ item.status }}
        </span>
      </div>

      <div class="bc-middle">
        <div class="bc-requester">
          <div class="bc-req-name">{{ item.employee?.name || '—' }}</div>
          <div class="bc-req-meta text-[11px] text-slate-500 dark:text-slate-400">
            {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
          </div>
        </div>

        <div class="bc-assignee">
          <span
            v-if="assigneeName(item)"
            class="assignee-chip inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            :class="item.category === 'Messenger' ? 'bg-orange-500 text-white' : 'bg-indigo-500 text-white'"
          >
            {{ assigneeName(item) }}
          </span>
          <span
            v-else
            class="assignee-chip inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100"
          >
            Unassigned
          </span>
        </div>
      </div>

      <div class="bc-body">
        <div class="lbl">Destination</div>
        <div class="bc-itinerary">
          {{ prettyStops(item.stops) }}
          <button
            v-if="item.ticketUrl"
            type="button"
            class="ml-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100
                   dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            @click.stop="$emit('open-ticket', item.ticketUrl)"
          >
            Ticket
          </button>
        </div>

        <div class="lbl mt-2">Purpose</div>
        <div class="purpose-text-mobile">{{ item.purpose || '—' }}</div>

        <div class="lbl mt-2">Driver / Messenger response</div>
        <div>
          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="ackBadgeClass(responseLabel(item))">
            {{ responseLabel(item) }}
          </span>
        </div>
      </div>

      <div class="bc-bottom">
        <div class="text-[11px] text-slate-600 dark:text-slate-300">
          Pax: <strong>{{ paxDisplay(item.passengers) }}</strong>
        </div>

        <div class="bc-actions">
          <button type="button" class="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300" @click.stop="$emit('edit', item)">
            Edit
          </button>

          <button
            v-for="s in nextStatuses(item.status)"
            :key="s"
            type="button"
            :class="[statusButtonClass(s), 'disabled:opacity-50']"
            :disabled="!canChangeStatus(item, s) || !!updating[item._id]"
            @click.stop="String(s).toUpperCase() === 'CANCELLED' ? $emit('cancel', item) : $emit('status', item, s)"
          >
            {{ s }}
          </button>

          <button
            v-if="canForceComplete(item)"
            type="button"
            class="inline-flex items-center rounded-full border border-green-500 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50
                   dark:border-green-500 dark:bg-green-900/30 dark:text-green-200 dark:hover:bg-green-900/40"
            :disabled="!!updating[item._id]"
            @click.stop="$emit('force-complete', item)"
          >
            COMPLETE
          </button>

          <button type="button" class="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300" @click.stop="$emit('assign', item)">
            Assign
          </button>

          <button type="button" class="text-[11px] font-semibold text-slate-700 hover:underline dark:text-slate-200" @click.stop="$emit('details', item)">
            Details
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
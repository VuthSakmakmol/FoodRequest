<script setup>
const props = defineProps({
  loading: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  selectedDate: { type: String, default: '' },
  focusId: { type: String, default: '' },
  updating: { type: Object, default: () => ({}) },
  nextStatuses: { type: Function, required: true },
  canChangeStatus: { type: Function, required: true },
  canForceComplete: { type: Function, required: true },
  statusBadgeClass: { type: Function, required: true },
  ackBadgeClass: { type: Function, required: true },
  statusButtonClass: { type: Function, required: true },
  prettyStops: { type: Function, required: true },
  assigneeName: { type: Function, required: true },
  responseLabel: { type: Function, required: true },
  paxDisplay: { type: Function, required: true },
})

const emit = defineEmits([
  'open-ticket',
  'edit',
  'assign',
  'details',
  'cancel',
  'status',
  'force-complete',
])

function isBusy(item) {
  return !!props.updating?.[item?._id]
}

function formatTimeRange(item) {
  return `${item?.timeStart || '--:--'} - ${item?.timeEnd || '--:--'}`
}

function isFocused(item) {
  return String(item?._id || '') === String(props.focusId || '')
}

function assignedText(item) {
  const name = props.assigneeName(item)
  return name || 'Unassigned'
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="loading"
      class="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      Loading schedule...
    </div>

    <div
      v-else-if="!rows.length"
      class="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      No bookings found for {{ selectedDate || 'this date' }}.
    </div>

    <article
      v-for="item in rows"
      :key="item._id"
      :class="[
        'overflow-hidden rounded-2xl border bg-white shadow-sm transition',
        isFocused(item)
          ? 'border-sky-400 ring-2 ring-sky-200 dark:border-sky-500 dark:ring-sky-900/40'
          : 'border-slate-200 dark:border-slate-700',
        'dark:bg-slate-900',
      ]"
    >
      <!-- top -->
      <div class="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {{ item.tripDate || selectedDate || '—' }}
            </p>
            <p class="text-base font-bold text-slate-900 dark:text-slate-100">
              {{ formatTimeRange(item) }}
            </p>
          </div>

          <div class="shrink-0">
            <span
              :class="[
                'inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
                statusBadgeClass(item.status),
              ]"
            >
              {{ item.status || '—' }}
            </span>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <span
            class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {{ item.category || 'Car' }}
          </span>

          <span
            :class="[
              'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
              ackBadgeClass(responseLabel(item)),
            ]"
          >
            {{ responseLabel(item) }}
          </span>

          <span
            class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            Pax: {{ paxDisplay(item.pax) }}
          </span>
        </div>
      </div>

      <!-- body -->
      <div class="space-y-3 px-4 py-3">
        <div>
          <p class="text-base font-semibold leading-tight text-slate-900 dark:text-slate-100">
            {{ item.employee?.name || 'Unknown employee' }}
          </p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {{ item.employee?.department || '—' }}<span v-if="item.employeeId"> • ID {{ item.employeeId }}</span>
          </p>
        </div>

        <div class="grid grid-cols-1 gap-3">
          <div>
            <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Destination
            </p>
            <p class="mt-1 text-sm text-slate-800 dark:text-slate-100 break-words">
              {{ prettyStops(item.stops || []) }}
            </p>
          </div>

          <div v-if="item.purpose">
            <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Purpose
            </p>
            <p class="mt-1 text-sm text-slate-800 dark:text-slate-100 break-words">
              {{ item.purpose }}
            </p>
          </div>

          <div>
            <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Driver / Messenger
            </p>
            <p class="mt-1 text-sm text-slate-800 dark:text-slate-100">
              {{ assignedText(item) }}
            </p>
          </div>
        </div>

        <div
          v-if="item.ticketUrl"
          class="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60"
        >
          <button
            type="button"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            @click="emit('open-ticket', item.ticketUrl)"
          >
            Open ticket
          </button>
        </div>
      </div>

      <!-- main actions -->
      <div class="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            @click="emit('edit', item)"
          >
            Edit
          </button>

          <button
            type="button"
            class="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
            @click="emit('assign', item)"
          >
            Assign
          </button>

          <button
            type="button"
            class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            @click="emit('details', item)"
          >
            Details
          </button>

          <button
            type="button"
            class="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200"
            @click="emit('cancel', item)"
          >
            Cancel
          </button>
        </div>

        <!-- status actions -->
        <div
          v-if="nextStatuses(item.status).length"
          class="mt-3"
        >
          <p class="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Status actions
          </p>

          <div class="flex flex-wrap gap-2">
            <button
              v-for="next in nextStatuses(item.status)"
              :key="next"
              type="button"
              :disabled="isBusy(item) || !canChangeStatus(item, next)"
              :class="[
                statusButtonClass(next),
                'disabled:cursor-not-allowed disabled:opacity-50',
              ]"
              @click="emit('status', item, next)"
            >
              {{ next }}
            </button>

            <button
              v-if="canForceComplete(item)"
              type="button"
              class="inline-flex items-center rounded-full border border-green-500 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200"
              :disabled="isBusy(item)"
              @click="emit('force-complete', item)"
            >
              Force complete
            </button>
          </div>
        </div>
      </div>
    </article>
  </div>
</template>
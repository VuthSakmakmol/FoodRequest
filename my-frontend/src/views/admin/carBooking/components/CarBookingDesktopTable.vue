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
  categoryBadgeClass: Function,
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
  <div class="overflow-x-auto">
    <table class="min-w-full border-collapse text-[13px]">
      <thead>
        <tr class="bg-slate-100 dark:bg-slate-800">
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Time</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Category</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Requester</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Destination</th>
          <th class="border border-slate-300 px-2 py-2 text-center font-semibold dark:border-slate-700">Pax</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Purpose</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Assigned</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Driver / Messenger Resp.</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700">Status</th>
          <th class="border border-slate-300 px-2 py-2 text-left font-semibold dark:border-slate-700 w-72">Actions</th>
        </tr>
      </thead>

      <tbody>
        <tr v-if="loading" class="bg-white dark:bg-slate-900">
          <td colspan="10" class="border border-slate-300 px-2 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
            Loading bookings…
          </td>
        </tr>

        <template v-else>
          <tr v-for="item in rows" :key="item._id"
            :class="[
              'bg-white hover:bg-sky-50 transition-colors dark:bg-slate-900 dark:hover:bg-slate-800',
              item.tripDate === selectedDate ? 'bg-amber-50/60 dark:bg-amber-900/40' : '',
              focusId === String(item._id) ? 'ring-2 ring-amber-400' : '',
            ]"
          >
            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <div class="mono">{{ item.timeStart }} – {{ item.timeEnd }}</div>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="categoryBadgeClass(item.category)">
                {{ item.category || 'Car' }}
              </span>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <div class="font-semibold">{{ item.employee?.name || '—' }}</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ item.employee?.department || '—' }} • ID {{ item.employeeId }}
              </div>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <div class="text-[12px]">
                {{ prettyStops(item.stops) }}
                <button
                  v-if="item.ticketUrl"
                  type="button"
                  class="ml-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  @click.stop="$emit('open-ticket', item.ticketUrl)"
                >
                  Ticket
                </button>
              </div>
            </td>

            <td class="border border-slate-300 px-2 py-2 text-center align-top dark:border-slate-700">
              {{ paxDisplay(item.passengers) }}
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <div class="text-[12px]">{{ item.purpose || '—' }}</div>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <span
                v-if="assigneeName(item)"
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold assignee-chip"
                :class="item.category === 'Messenger' ? 'bg-orange-500 text-white' : 'bg-indigo-500 text-white'"
              >
                {{ assigneeName(item) }}
              </span>
              <span
                v-else
                class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100 assignee-chip"
              >
                Unassigned
              </span>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="ackBadgeClass(responseLabel(item))">
                {{ responseLabel(item) }}
              </span>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="statusBadgeClass(item.status)">
                {{ item.status }}
              </span>
            </td>

            <td class="border border-slate-300 px-2 py-2 align-top dark:border-slate-700">
              <div class="mb-1 flex flex-wrap gap-1">
                <button
                  v-for="s in nextStatuses(item.status)"
                  :key="s"
                  type="button"
                  :class="[statusButtonClass(s), 'disabled:opacity-50']"
                  :disabled="!canChangeStatus(item, s) || !!updating[item._id]"
                  @click="String(s).toUpperCase() === 'CANCELLED' ? $emit('cancel', item) : $emit('status', item, s)"
                >
                  {{ s }}
                </button>

                <button
                  v-if="canForceComplete(item)"
                  type="button"
                  class="inline-flex items-center rounded-full border border-green-500 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50
                         dark:border-green-500 dark:bg-green-900/30 dark:text-green-200 dark:hover:bg-green-900/40"
                  :disabled="!!updating[item._id]"
                  @click="$emit('force-complete', item)"
                >
                  COMPLETE
                </button>
              </div>

              <div class="mt-1 flex flex-wrap gap-2 text-[11px]">
                <button type="button" class="font-semibold text-sky-700 hover:underline dark:text-sky-300" @click="$emit('edit', item)">
                  Edit
                </button>
                <button type="button" class="font-semibold text-emerald-700 hover:underline dark:text-emerald-300" @click="$emit('assign', item)">
                  Assign
                </button>
                <button type="button" class="font-semibold text-slate-700 hover:underline dark:text-slate-200" @click="$emit('details', item)">
                  Details
                </button>
              </div>
            </td>
          </tr>

          <tr v-if="!rows.length">
            <td colspan="10" class="border border-slate-300 px-2 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
              No bookings<span v-if="selectedDate"> on {{ selectedDate }}</span>.
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
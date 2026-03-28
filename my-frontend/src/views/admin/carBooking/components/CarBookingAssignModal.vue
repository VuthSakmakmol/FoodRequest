<script setup>
defineProps({
  open: Boolean,
  assignRole: String,
  selectedLoginId: String,
  lockedRole: String,
  people: {
    type: Array,
    default: () => [],
  },
  busyMap: {
    type: Object,
    required: true,
  },
  loading: Boolean,
  error: String,
})

defineEmits([
  'update:open',
  'update:assignRole',
  'update:selectedLoginId',
  'save',
])

function busyInfo(busyMap, loginId) {
  return busyMap?.get?.(String(loginId))
}
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-3">
      <div class="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 class="text-sm font-semibold">Assign booking</h3>
          <button class="text-sm" @click="$emit('update:open', false)">✕</button>
        </div>

        <div class="space-y-4 px-4 py-4">
          <div v-if="error" class="rounded-lg border border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-100">
            {{ error }}
          </div>

          <div v-if="lockedRole !== 'MESSENGER'" class="space-y-1">
            <label class="block text-[11px] font-medium">Role</label>
            <select
              :value="assignRole"
              class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-900"
              @change="$emit('update:assignRole', $event.target.value)"
            >
              <option value="DRIVER">DRIVER</option>
              <option value="MESSENGER">MESSENGER</option>
            </select>
          </div>

          <div class="space-y-2">
            <label class="block text-[11px] font-medium">Select person</label>

            <label
              v-for="p in people"
              :key="p.loginId"
              class="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
            >
              <div class="min-w-0">
                <div class="font-semibold">{{ p.name }}</div>
                <div class="text-slate-500 dark:text-slate-400">{{ p.loginId }}</div>
              </div>

              <div class="flex items-center gap-2">
                <span
                  v-if="busyInfo(busyMap, p.loginId)?.busy"
                  class="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-200"
                >
                  Busy
                </span>
                <input
                  type="radio"
                  name="assignee"
                  :checked="selectedLoginId === p.loginId"
                  @change="$emit('update:selectedLoginId', p.loginId)"
                />
              </div>
            </label>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600" @click="$emit('update:open', false)">
            Close
          </button>
          <button
            class="rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            :disabled="loading"
            @click="$emit('save')"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
<!-- src/views/bookingRoom/user/sections/BookingRoomRequestTypeSection.vue -->
<script setup>
defineOptions({ name: 'BookingRoomRequestTypeSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },
  BOOKING_ROOM_NAMES: {
    type: Array,
    default: () => [],
  },
  BOOKING_ROOM_MATERIALS: {
    type: Array,
    default: () => [],
  },
  isMaterialOn: {
    type: Function,
    required: true,
  },
  materialText: {
    type: Function,
    required: true,
  },
})

const emit = defineEmits(['toggle-material'])

function onToggleMaterial(item) {
  emit('toggle-material', item)
}

function toggleRoomRequired() {
  props.form.roomRequired = !props.form.roomRequired
  if (!props.form.roomRequired) props.form.roomName = ''
}

function toggleMaterialRequired() {
  props.form.materialRequired = !props.form.materialRequired
  if (!props.form.materialRequired) props.form.materials = []
}

function requestTypeText() {
  if (props.form.roomRequired && props.form.materialRequired) return 'Room + Material'
  if (props.form.roomRequired) return 'Room Only'
  if (props.form.materialRequired) return 'Material Only'
  return '—'
}
</script>

<template>
  <section
    class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
    <!-- Header -->
    <header
      class="flex items-center justify-between rounded-t-2xl border-b border-slate-200
             bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-4 py-2.5 text-white
             dark:border-slate-700"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-flex h-7 w-7 items-center justify-center rounded-xl
                 bg-white/90 text-sky-700 text-sm shadow-sm"
        >
          <i class="fa-solid fa-layer-group" />
        </span>

        <div class="space-y-0.5">
          <h2 class="text-[11px] uppercase tracking-[0.24em] text-slate-100/80">
            Request Type
          </h2>
        </div>
      </div>
    </header>

    <!-- Body -->
    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-2.5
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
        <div class="space-y-4">
          <!-- Main controls -->
          <div class="grid gap-3 xl:grid-cols-12">
            <!-- Room -->
            <div
              class="rounded-xl border border-slate-200 bg-white/90 p-3
                     dark:border-slate-700 dark:bg-slate-950/70 xl:col-span-6"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <i class="fa-solid fa-door-open text-[12px] text-sky-500" />
                    <h3
                      class="text-[11px] font-semibold uppercase tracking-[0.2em]
                             text-slate-600 dark:text-slate-300"
                    >
                      Meeting Room
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex min-w-[116px] items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition"
                  :class="props.form.roomRequired
                    ? 'border-sky-500 bg-sky-500 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'"
                  @click="toggleRoomRequired"
                >
                  <i
                    class="fa-solid"
                    :class="props.form.roomRequired ? 'fa-toggle-on' : 'fa-toggle-off'"
                  />
                  {{ props.form.roomRequired ? 'Required' : 'Off' }}
                </button>
              </div>

              <div class="mt-3 space-y-1">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                  Room Name
                </label>
                <select
                  v-model="props.form.roomName"
                  class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                         text-slate-900 shadow-sm
                         focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                         disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400
                         dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100
                         dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                  :disabled="!props.form.roomRequired"
                >
                  <option value="">Select room</option>
                  <option
                    v-for="room in props.BOOKING_ROOM_NAMES"
                    :key="room"
                    :value="room"
                  >
                    {{ room }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Material -->
            <div
              class="rounded-xl border border-slate-200 bg-white/90 p-3
                     dark:border-slate-700 dark:bg-slate-950/70 xl:col-span-6"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <i class="fa-solid fa-tv text-[12px] text-sky-500" />
                    <h3
                      class="text-[11px] font-semibold uppercase tracking-[0.2em]
                             text-slate-600 dark:text-slate-300"
                    >
                      IT Material
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex min-w-[116px] items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition"
                  :class="props.form.materialRequired
                    ? 'border-sky-500 bg-sky-500 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'"
                  @click="toggleMaterialRequired"
                >
                  <i
                    class="fa-solid"
                    :class="props.form.materialRequired ? 'fa-toggle-on' : 'fa-toggle-off'"
                  />
                  {{ props.form.materialRequired ? 'Required' : 'Off' }}
                </button>
              </div>

              <div class="mt-3 space-y-1">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                  Materials
                </label>

                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="item in props.BOOKING_ROOM_MATERIALS"
                    :key="item"
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition
                           disabled:cursor-not-allowed disabled:opacity-50"
                    :class="props.isMaterialOn(item)
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'"
                    :disabled="!props.form.materialRequired"
                    @click="onToggleMaterial(item)"
                  >
                    <i
                      class="fa-solid text-[10px]"
                      :class="props.isMaterialOn(item) ? 'fa-circle-check' : 'fa-circle'"
                    />
                    {{ item }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
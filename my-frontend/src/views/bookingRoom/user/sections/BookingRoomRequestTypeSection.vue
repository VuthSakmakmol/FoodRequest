<script setup>
import { computed, watch } from 'vue'

defineOptions({ name: 'BookingRoomRequestTypeSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },

  // rooms from parent / availability API
  BOOKING_ROOM_NAMES: {
    type: Array,
    default: () => [],
  },

  // materials from parent / availability API
  BOOKING_ROOM_MATERIALS: {
    type: Array,
    default: () => [],
  },

  loadingAvailability: {
    type: Boolean,
    default: false,
  },
})

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function arr(v) {
  return Array.isArray(v) ? v : []
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return (h * 60) + m
}

const canShowAvailability = computed(() => {
  const date = s(props.form.bookingDate)
  const timeStart = s(props.form.timeStart)
  const timeEnd = s(props.form.timeEnd)

  if (!date || !timeStart || !timeEnd) return false

  const startMin = toMinutes(timeStart)
  const endMin = toMinutes(timeEnd)

  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false
  return endMin > startMin
})

const activeRooms = computed(() =>
  arr(props.BOOKING_ROOM_NAMES).filter((x) => x && x.isActive !== false)
)

const activeMaterials = computed(() =>
  arr(props.BOOKING_ROOM_MATERIALS).filter((x) => x && x.isActive !== false)
)

function selectedMaterial(code) {
  const target = up(code)
  return arr(props.form.materials).find((x) => up(x?.materialCode) === target) || null
}

function isMaterialOn(code) {
  return !!selectedMaterial(code)
}

function isRoomOn(room) {
  return s(props.form.roomId) === s(room?._id)
}

function requestTypeText() {
  if (props.form.roomRequired && props.form.materialRequired) return 'Room + Material'
  if (props.form.roomRequired) return 'Room Only'
  if (props.form.materialRequired) return 'Material Only'
  return '—'
}

function toggleRoomRequired() {
  props.form.roomRequired = !props.form.roomRequired

  if (!props.form.roomRequired) {
    props.form.roomId = ''
    props.form.roomCode = ''
    props.form.roomName = ''
  }
}

function toggleMaterialRequired() {
  props.form.materialRequired = !props.form.materialRequired

  if (!props.form.materialRequired) {
    props.form.materials = []
  }
}

function roomAvailabilityLabel(room) {
  return room?.isAvailable === false ? 'NOT AVAILABLE' : 'AVAILABLE'
}

function roomAvailabilityClass(room) {
  return room?.isAvailable === false
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
}

function materialAvailabilityClass(item) {
  const availableQty = Math.max(0, Number(item?.availableQty ?? item?.totalQty ?? 0))
  return availableQty <= 0
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
}

function onSelectRoom(room) {
  if (!props.form.roomRequired) return
  if (!canShowAvailability.value) return
  if (!room || room.isAvailable === false) return

  if (isRoomOn(room)) {
    props.form.roomId = ''
    props.form.roomCode = ''
    props.form.roomName = ''
    return
  }

  props.form.roomId = s(room._id)
  props.form.roomCode = up(room.code)
  props.form.roomName = s(room.name)
}

function toggleMaterial(item) {
  if (!props.form.materialRequired) return
  if (!canShowAvailability.value) return

  const code = up(item?.code)
  if (!code) return

  const availableQty = Math.max(0, Number(item?.availableQty ?? item?.totalQty ?? 0))
  if (availableQty <= 0) return

  const foundIndex = arr(props.form.materials).findIndex(
    (x) => up(x?.materialCode) === code
  )

  if (foundIndex >= 0) {
    props.form.materials.splice(foundIndex, 1)
    return
  }

  props.form.materials.push({
    materialId: s(item?._id),
    materialCode: up(item?.code),
    materialName: s(item?.name),
    qty: 1,
  })
}

function increaseQty(item) {
  const picked = selectedMaterial(item?.code)
  if (!picked) return

  const availableQty = Math.max(0, Number(item?.availableQty ?? item?.totalQty ?? 0))
  const current = Math.max(0, Number(picked.qty || 0))

  if (current >= availableQty) return
  picked.qty = current + 1
}

function decreaseQty(item) {
  const picked = selectedMaterial(item?.code)
  if (!picked) return

  const current = Math.max(0, Number(picked.qty || 0))
  if (current <= 1) {
    toggleMaterial(item)
    return
  }

  picked.qty = current - 1
}

function materialQtyText(code) {
  const found = selectedMaterial(code)
  return found ? Number(found.qty || 0) : 0
}

/* auto clear selected room if it becomes unavailable after date/time change */
watch(
  activeRooms,
  (rooms) => {
    if (!props.form.roomRequired || !s(props.form.roomId)) return

    const found = rooms.find((x) => s(x._id) === s(props.form.roomId))
    if (!found || found.isAvailable === false) {
      props.form.roomId = ''
      props.form.roomCode = ''
      props.form.roomName = ''
    }
  },
  { deep: true }
)

/* auto adjust material selection if availability changes */
watch(
  activeMaterials,
  (materials) => {
    if (!props.form.materialRequired || !Array.isArray(props.form.materials)) return

    const next = []

    for (const picked of props.form.materials) {
      const found = materials.find((m) => up(m.code) === up(picked?.materialCode))
      const availableQty = Math.max(0, Number(found?.availableQty ?? found?.totalQty ?? 0))

      if (!found || availableQty <= 0) continue

      next.push({
        materialId: s(found._id || picked?.materialId),
        materialCode: up(found.code || picked?.materialCode),
        materialName: s(found.name || picked?.materialName),
        qty: Math.min(Math.max(1, Number(picked?.qty || 1)), availableQty),
      })
    }

    props.form.materials = next
  },
  { deep: true }
)

/* clear selection when user turns off the section */
watch(
  () => props.form.roomRequired,
  (on) => {
    if (!on) {
      props.form.roomId = ''
      props.form.roomCode = ''
      props.form.roomName = ''
    }
  }
)

watch(
  () => props.form.materialRequired,
  (on) => {
    if (!on) {
      props.form.materials = []
    }
  }
)

/* also clear room/material if date/time is not ready */
watch(
  canShowAvailability,
  (ok) => {
    if (ok) return

    props.form.roomId = ''
    props.form.roomCode = ''
    props.form.roomName = ''
    props.form.materials = []
  }
)
</script>

<template>
  <section
    class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-700 dark:bg-slate-900"
  >
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

      <div
        class="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1
               text-[11px] font-semibold text-white"
      >
        {{ requestTypeText() }}
      </div>
    </header>

    <div
      class="rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-2.5
             dark:border-slate-700 dark:bg-slate-950/80"
    >
      <div
        class="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm
               dark:border-slate-700 dark:bg-slate-950/90"
      >
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

            <div class="mt-3">
              <div class="mb-2 flex items-center justify-between gap-2">
                <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                  Rooms
                </label>

                <span
                  v-if="loadingAvailability && canShowAvailability"
                  class="text-[11px] text-slate-500 dark:text-slate-400"
                >
                  Checking...
                </span>
              </div>

              <div
                v-if="!canShowAvailability"
                class="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-center text-[12px]
                       text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300"
              >
                Please select booking date and time first to check available room and material.
              </div>

              <div
                v-else-if="!activeRooms.length"
                class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-[12px]
                       text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
              >
                No active rooms found.
              </div>

              <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-3">
                <button
                  v-for="room in activeRooms"
                  :key="room._id"
                  type="button"
                  class="h-20 rounded-2xl border p-2 text-left transition"
                  :class="[
                    isRoomOn(room)
                      ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-400 dark:border-sky-600 dark:bg-sky-950/20'
                      : room.isAvailable === false
                        ? 'cursor-not-allowed border-rose-200 bg-rose-50 opacity-80 dark:border-rose-900/40 dark:bg-rose-950/20'
                        : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/40 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-sky-700 dark:hover:bg-sky-950/10'
                  ]"
                  :disabled="!props.form.roomRequired || !canShowAvailability || room.isAvailable === false"
                  @click="onSelectRoom(room)"
                >
                  <div class="flex h-full flex-col justify-between">
                    <div class="min-w-0">
                      <div
                        class="truncate text-[12px] font-bold"
                        :class="room.isAvailable === false
                          ? 'text-rose-700 dark:text-rose-300'
                          : 'text-slate-800 dark:text-slate-100'"
                      >
                        {{ room.name || room.code }}
                      </div>

                      <div
                        class="truncate text-[10px]"
                        :class="room.isAvailable === false
                          ? 'text-rose-500 dark:text-rose-400'
                          : 'text-slate-500 dark:text-slate-400'"
                      >
                        {{ room.code || '—' }}
                      </div>
                    </div>

                    <div class="flex items-center justify-between gap-1">
                      <span
                        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold"
                        :class="roomAvailabilityClass(room)"
                      >
                        <i v-if="room.isAvailable === false" class="fa-solid fa-lock text-[9px]" />
                        {{ roomAvailabilityLabel(room) }}
                      </span>

                      <i
                        v-if="isRoomOn(room)"
                        class="fa-solid fa-circle-check text-[12px] text-sky-500"
                      />
                    </div>
                  </div>
                </button>
              </div>
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

            <div class="mt-3 space-y-2">
              <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                Materials
              </label>

              <div
                v-if="!canShowAvailability"
                class="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-center text-[12px]
                       text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300"
              >
                Please select booking date and time first to check available room and material.
              </div>

              <div
                v-else-if="!activeMaterials.length"
                class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-[12px]
                       text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
              >
                No active materials found.
              </div>

              <div v-else class="grid gap-2 sm:grid-cols-2">
                <div
                  v-for="item in activeMaterials"
                  :key="item._id"
                  class="rounded-xl border p-2.5 transition"
                  :class="isMaterialOn(item.code)
                    ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/20'
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60'"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] transition"
                          :class="isMaterialOn(item.code)
                            ? 'border-sky-500 bg-sky-500 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'"
                          :disabled="!props.form.materialRequired || !canShowAvailability || Number(item.availableQty ?? item.totalQty ?? 0) <= 0"
                          @click="toggleMaterial(item)"
                        >
                          <i
                            class="fa-solid"
                            :class="isMaterialOn(item.code) ? 'fa-check' : 'fa-plus'"
                          />
                        </button>

                        <div class="min-w-0">
                          <div class="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                            {{ item.name || item.code }}
                          </div>
                          <div class="text-[11px] text-slate-500 dark:text-slate-400">
                            {{ item.code }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="isMaterialOn(item.code)"
                      class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1
                             dark:border-slate-700 dark:bg-slate-950"
                    >
                      <button
                        type="button"
                        class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-[11px]
                               text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        @click="decreaseQty(item)"
                      >
                        <i class="fa-solid fa-minus" />
                      </button>

                      <span class="min-w-[24px] text-center text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                        {{ materialQtyText(item.code) }}
                      </span>

                      <button
                        type="button"
                        class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-[11px]
                               text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50
                               dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        :disabled="materialQtyText(item.code) >= Number(item.availableQty ?? item.totalQty ?? 0)"
                        @click="increaseQty(item)"
                      >
                        <i class="fa-solid fa-plus" />
                      </button>
                    </div>
                  </div>

                  <div class="mt-2 flex items-center justify-between gap-2">
                    <span
                      class="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold"
                      :class="materialAvailabilityClass(item)"
                    >
                      {{ Number(item.availableQty ?? item.totalQty ?? 0) > 0 ? 'AVAILABLE' : 'OUT OF STOCK' }}
                    </span>

                    <span class="text-[11px] text-slate-600 dark:text-slate-300">
                      {{ Number(item.availableQty ?? item.totalQty ?? 0) }}/{{ Number(item.totalQty || 0) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="props.form.materialRequired && props.form.materials?.length && canShowAvailability"
              class="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2
                     dark:border-emerald-900/40 dark:bg-emerald-950/20"
            >
              <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                Selected Materials
              </div>

              <div class="mt-2 flex flex-wrap gap-2">
                <span
                  v-for="item in props.form.materials"
                  :key="item.materialCode"
                  class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px]
                         font-medium text-emerald-800 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-200"
                >
                  <i class="fa-solid fa-paperclip text-[10px]" />
                  {{ item.materialName || item.materialCode }} x{{ Number(item.qty || 0) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
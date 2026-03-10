<script setup>
import { computed } from 'vue'

defineOptions({ name: 'BookingRoomRequestTypeSection' })

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },

  // now expect ARRAY OF ROOM OBJECTS from backend
  // [{ _id, code, name, isActive }]
  BOOKING_ROOM_NAMES: {
    type: Array,
    default: () => [],
  },

  // now expect ARRAY OF MATERIAL OBJECTS from backend
  // [{ _id, code, name, totalQty, isActive }]
  BOOKING_ROOM_MATERIALS: {
    type: Array,
    default: () => [],
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

const activeRooms = computed(() =>
  arr(props.BOOKING_ROOM_NAMES).filter((x) => x && x.isActive !== false)
)

const activeMaterials = computed(() =>
  arr(props.BOOKING_ROOM_MATERIALS).filter((x) => x && x.isActive !== false)
)

function selectedRoomId() {
  return s(props.form.roomId)
}

function selectedMaterial(code) {
  const target = up(code)
  return arr(props.form.materials).find((x) => up(x?.materialCode) === target) || null
}

function isMaterialOn(code) {
  return !!selectedMaterial(code)
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

function onChangeRoom(roomId) {
  const picked = activeRooms.value.find((x) => s(x._id) === s(roomId))

  if (!picked) {
    props.form.roomId = ''
    props.form.roomCode = ''
    props.form.roomName = ''
    return
  }

  props.form.roomId = s(picked._id)
  props.form.roomCode = up(picked.code)
  props.form.roomName = s(picked.name)
}

function toggleMaterial(item) {
  if (!props.form.materialRequired) return

  const code = up(item?.code)
  if (!code) return

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

  const stock = Math.max(0, Number(item?.totalQty || 0))
  const current = Math.max(0, Number(picked.qty || 0))

  if (current >= stock) return
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

            <div class="mt-3 space-y-1">
              <label class="block text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                Room Name
              </label>

              <select
                :value="selectedRoomId()"
                class="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                       text-slate-900 shadow-sm
                       focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                       disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100
                       dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                :disabled="!props.form.roomRequired"
                @change="onChangeRoom($event.target.value)"
              >
                <option value="">Select room</option>
                <option
                  v-for="room in activeRooms"
                  :key="room._id"
                  :value="room._id"
                >
                  {{ room.name }} {{ room.code ? `(${room.code})` : '' }}
                </option>
              </select>
            </div>

            <div
              v-if="props.form.roomRequired && (props.form.roomName || props.form.roomCode)"
              class="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-[12px]
                     text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200"
            >
              <div><span class="font-semibold">Selected:</span> {{ props.form.roomName || '—' }}</div>
              <div><span class="font-semibold">Code:</span> {{ props.form.roomCode || '—' }}</div>
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
                v-if="!activeMaterials.length"
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
                          :disabled="!props.form.materialRequired"
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
                            {{ item.code }} • Stock {{ Number(item.totalQty || 0) }}
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
                        :disabled="materialQtyText(item.code) >= Number(item.totalQty || 0)"
                        @click="increaseQty(item)"
                      >
                        <i class="fa-solid fa-plus" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="props.form.materialRequired && props.form.materials?.length"
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
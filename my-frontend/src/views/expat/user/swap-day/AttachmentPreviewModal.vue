<!-- src/views/expat/user/swap-day/AttachmentPreviewModal.vue -->
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AttachmentPreviewModal' })

const { showToast } = useToast()

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  requestId: { type: String, default: '' },

  title: { type: String, default: 'Attachments' },
  subtitle: { type: String, default: '' },

  items: { type: Array, default: () => [] },

  fetchContentPath: { type: Function, required: true },
  deletePath: { type: Function, default: null },
  canDelete: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'deleted', 'refresh'])

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function s(v) {
  return String(v ?? '').trim()
}

function isImage(item) {
  const ct = s(item?.contentType).toLowerCase()
  const name = s(item?.filename).toLowerCase()
  return (
    ct.startsWith('image/') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp')
  )
}
function isPdf(item) {
  const ct = s(item?.contentType).toLowerCase()
  const name = s(item?.filename).toLowerCase()
  return ct.includes('pdf') || name.endsWith('.pdf')
}

function revokeUrl(url) {
  try {
    if (url) URL.revokeObjectURL(url)
  } catch {}
}

function clearAllPreviews() {
  Object.values(previewUrlMap.value || {}).forEach(revokeUrl)
  previewUrlMap.value = {}
  previewLoadingMap.value = {}
  previewErrorMap.value = {}
}

/* ─────────────────────────────
   Preview cache maps (key = attId)
───────────────────────────── */
const selectedAttId = ref('')
const previewUrlMap = ref({}) // { [attId]: blobUrl }
const previewLoadingMap = ref({}) // { [attId]: boolean }
const previewErrorMap = ref({}) // { [attId]: string }

const selectedItem = computed(() =>
  (props.items || []).find((x) => s(x?.attId) === s(selectedAttId.value))
)

/** ✅ template-safe getters */
const previewUrl = computed(() => previewUrlMap.value?.[selectedAttId.value] || '')
const previewLoading = computed(() => !!previewLoadingMap.value?.[selectedAttId.value])
const previewError = computed(() => previewErrorMap.value?.[selectedAttId.value] || '')

/* ─────────────────────────────
   Robust error extraction (blob/json/text)
───────────────────────────── */
async function readBlobMessage(blob) {
  try {
    if (!blob) return ''
    // blob might be JSON or plain text
    const text = await blob.text()
    if (!text) return ''
    try {
      const j = JSON.parse(text)
      return j?.message || j?.error || ''
    } catch {
      return text.slice(0, 300)
    }
  } catch {
    return ''
  }
}

async function ensurePreview(attId) {
  const id = s(attId)
  const item = (props.items || []).find((x) => s(x?.attId) === id)
  if (!props.requestId || !item?.attId) return ''

  // cached
  if (previewUrlMap.value?.[id]) return previewUrlMap.value[id]
  if (previewLoadingMap.value?.[id]) return ''

  previewLoadingMap.value = { ...previewLoadingMap.value, [id]: true }
  previewErrorMap.value = { ...previewErrorMap.value, [id]: '' }

  try {
    const path = props.fetchContentPath(props.requestId, item.attId)

    const res = await api.get(path, { responseType: 'blob' })

    const contentType =
      res.headers?.['content-type'] ||
      res.headers?.['Content-Type'] ||
      item.contentType ||
      'application/octet-stream'

    const blob = new Blob([res.data], { type: contentType })

    const url = URL.createObjectURL(blob)

    // safety: if replacing existing url for same id, revoke old
    if (previewUrlMap.value?.[id]) revokeUrl(previewUrlMap.value[id])

    previewUrlMap.value = { ...previewUrlMap.value, [id]: url }
    return url
  } catch (e) {
    let msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      ''

    // axios with responseType blob => error payload often Blob
    if (!msg && e?.response?.data instanceof Blob) {
      msg = await readBlobMessage(e.response.data)
    }

    previewErrorMap.value = { ...previewErrorMap.value, [id]: msg || 'Preview failed.' }
    return ''
  } finally {
    previewLoadingMap.value = { ...previewLoadingMap.value, [id]: false }
  }
}

async function selectFile(attId) {
  selectedAttId.value = s(attId)
  if (selectedAttId.value) await ensurePreview(selectedAttId.value)
}

/* ─────────────────────────────
   Fullscreen
───────────────────────────── */
const fullOpen = ref(false)
function openFullscreen() {
  if (!selectedAttId.value) return
  fullOpen.value = true
}
function closeFullscreen() {
  fullOpen.value = false
}

/* ─────────────────────────────
   Delete confirm
───────────────────────────── */
const delOpen = ref(false)
const deleting = ref(false)
const delTarget = ref({ attId: '', filename: '' })

function askDelete(item) {
  if (!props.canDelete || !props.deletePath) return
  delTarget.value = { attId: s(item?.attId), filename: s(item?.filename) }
  delOpen.value = true
}
function closeDelete() {
  delOpen.value = false
  delTarget.value = { attId: '', filename: '' }
}

async function confirmDelete() {
  if (!props.deletePath) return
  const attId = s(delTarget.value?.attId)
  if (!props.requestId || !attId) return

  deleting.value = true
  try {
    const path = props.deletePath(props.requestId, attId)
    await api.delete(path)

    // cleanup cache
    revokeUrl(previewUrlMap.value?.[attId])
    const next = { ...(previewUrlMap.value || {}) }
    delete next[attId]
    previewUrlMap.value = next

    const nextL = { ...(previewLoadingMap.value || {}) }
    delete nextL[attId]
    previewLoadingMap.value = nextL

    const nextE = { ...(previewErrorMap.value || {}) }
    delete nextE[attId]
    previewErrorMap.value = nextE

    // if deleted selected, clear selection (watcher will reselect)
    if (s(selectedAttId.value) === attId) selectedAttId.value = ''

    showToast({ type: 'success', message: 'Attachment deleted.' })
    emit('deleted', { attId })
    emit('refresh')
    closeDelete()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || e?.message || 'Delete failed.' })
  } finally {
    deleting.value = false
  }
}

/* ─────────────────────────────
   Watchers
───────────────────────────── */
watch(
  () => open.value,
  async (v) => {
    if (!v) {
      fullOpen.value = false
      delOpen.value = false
      selectedAttId.value = ''
      clearAllPreviews()
      return
    }

    const first = (props.items || [])[0]
    selectedAttId.value = first?.attId ? s(first.attId) : ''
    if (selectedAttId.value) await ensurePreview(selectedAttId.value)
  }
)

watch(
  () => props.items,
  async (items) => {
    if (!open.value) return
    const list = Array.isArray(items) ? items : []
    if (!list.length) {
      selectedAttId.value = ''
      return
    }
    const exists = list.some((x) => s(x?.attId) === s(selectedAttId.value))
    if (!exists) {
      selectedAttId.value = s(list[0]?.attId)
      if (selectedAttId.value) await ensurePreview(selectedAttId.value)
    }
  },
  { deep: true }
)

onBeforeUnmount(() => clearAllPreviews())
</script>

<template>
  <!-- Main Modal -->
  <div v-if="open" class="ui-modal-backdrop">
    <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
            {{ title }}
          </div>
          <div v-if="subtitle" class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {{ subtitle }}
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" :disabled="!selectedAttId" @click="openFullscreen">
            <i class="fa-solid fa-expand text-[11px]" />
            Fullscreen
          </button>

          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="open = false">
            <i class="fa-solid fa-xmark text-[11px]" />
            Close
          </button>
        </div>
      </div>

      <div class="grid md:grid-cols-[320px_1fr] gap-0">
        <!-- Left list -->
        <div class="border-r border-slate-200 dark:border-slate-800 p-3">
          <div v-if="!items.length" class="text-[11px] text-slate-500 dark:text-slate-400">
            No files attached.
          </div>

          <div v-else class="space-y-2">
            <button
              v-for="f in items"
              :key="f.attId"
              type="button"
              class="w-full text-left rounded-2xl border px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900/40"
              :class="selectedAttId === f.attId
                ? 'border-sky-300 bg-sky-50 dark:border-sky-700/60 dark:bg-sky-950/40'
                : 'border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/30'"
              @click="selectFile(f.attId)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ f.filename }}
                  </div>
                  <div class="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                    {{ f.uploadedAt ? dayjs(f.uploadedAt).format('YYYY-MM-DD HH:mm') : '' }}
                  </div>
                </div>

                <button
                  v-if="canDelete && deletePath"
                  class="ui-btn ui-btn-ghost ui-btn-xs"
                  type="button"
                  title="Delete"
                  @click.stop="askDelete(f)"
                >
                  <i class="fa-solid fa-trash text-[11px]" />
                </button>
              </div>
            </button>
          </div>
        </div>

        <!-- Right preview -->
        <div class="p-3">
          <div v-if="!selectedAttId" class="h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
            Select a file
          </div>

          <template v-else>
            <div
              v-if="previewLoading"
              class="h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400"
            >
              Loading preview…
            </div>

            <div
              v-else-if="previewError"
              class="h-[520px] grid place-items-center text-[12px] text-rose-500"
            >
              {{ previewError }}
            </div>

            <template v-else>
              <div class="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40 overflow-hidden">
                <iframe
                  v-if="isPdf(selectedItem) && previewUrl"
                  :src="previewUrl"
                  class="w-full h-[520px]"
                  style="border:0;"
                />
                <img
                  v-else-if="isImage(selectedItem) && previewUrl"
                  :src="previewUrl"
                  class="w-full h-[520px] object-contain bg-white dark:bg-slate-950/40"
                />
                <div v-else class="h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
                  Preview not available
                </div>
              </div>

              <div class="mt-2">
                <button class="ui-btn ui-btn-soft w-full" type="button" :disabled="!previewUrl" @click="openFullscreen">
                  <i class="fa-solid fa-expand text-[11px]" />
                  Fullscreen preview
                </button>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- Fullscreen overlay -->
  <div v-if="fullOpen" class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm">
    <div class="absolute inset-0 p-3">
      <div class="h-full w-full rounded-2xl bg-white dark:bg-slate-950 overflow-hidden border border-white/10">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Fullscreen preview</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {{ selectedItem?.filename || '' }}
            </div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeFullscreen">
            <i class="fa-solid fa-xmark text-[11px]" />
            Close
          </button>
        </div>

        <iframe
          v-if="isPdf(selectedItem) && previewUrl"
          :src="previewUrl"
          class="w-full h-[calc(100%-52px)]"
          style="border:0;"
        />
        <img
          v-else-if="isImage(selectedItem) && previewUrl"
          :src="previewUrl"
          class="w-full h-[calc(100%-52px)] object-contain bg-white dark:bg-slate-950"
        />
        <div v-else class="h-[calc(100%-52px)] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
          No preview
        </div>
      </div>
    </div>
  </div>

  <!-- Delete confirm -->
  <div v-if="delOpen" class="ui-modal-backdrop">
    <div class="ui-modal p-4">
      <div class="flex items-start gap-3">
        <div
          class="grid h-10 w-10 place-items-center rounded-2xl border"
          style="border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));"
        >
          <i class="fa-solid fa-trash" />
        </div>

        <div class="flex-1">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Delete this file?</div>
          <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
            Are you sure you want to delete:
            <span class="font-extrabold">{{ delTarget.filename }}</span>
          </div>
        </div>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="ui-btn ui-btn-ghost" :disabled="deleting" @click="closeDelete">Close</button>
        <button type="button" class="ui-btn ui-btn-rose" :disabled="deleting" @click="confirmDelete">
          <i v-if="deleting" class="fa-solid fa-spinner animate-spin text-[11px]" />
          Delete
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-modal-xl {
  width: min(1100px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
}
</style>
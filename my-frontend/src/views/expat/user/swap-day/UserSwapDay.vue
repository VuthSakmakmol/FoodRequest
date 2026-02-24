<!-- src/views/expat/user/swap-day/UserSwapDay.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

import { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

import AttachmentPreviewModal from './AttachmentPreviewModal.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

defineOptions({ name: 'UserSwapDay' })

const { showToast } = useToast()
const router = useRouter()
const route = useRoute()
const auth = useAuth()

/* ───────────────── mode ───────────────── */
const id = computed(() => String(route.params?.id || '').trim())
const isEdit = computed(() => !!id.value)

/* ───────────────── state ───────────────── */
const loading = ref(false)
const saving = ref(false)

const form = ref({
  requestStart: '',
  requestEnd: '',
  compStart: '',
  compEnd: '',
  reason: '',
})

/** existing attachments from backend (must contain attId) */
const existingAttachments = ref([]) // [{ attId,fileId,filename,contentType,uploadedAt,size,uploadedBy,note }]

/** new selected files (queue) */
const queuedFiles = ref([]) // File[]

/** status (from backend) for permission (pending only) */
const status = ref('') // e.g. PENDING_MANAGER, APPROVED...
const isPending = computed(() => String(status.value || '').toUpperCase().includes('PENDING'))

/* ───────────────── dirty tracking ───────────────── */
const initialSnapshot = ref('')
const isDirty = computed(() => JSON.stringify(form.value) !== initialSnapshot.value || queuedFiles.value.length > 0)

/* ───────────────── dialogs ───────────────── */
const confirmLeaveOpen = ref(false)
const confirmSaveOpen = ref(false)
const confirmBusy = ref(false)

/* ───────────────── attachments modal ───────────────── */
const filesOpen = ref(false)
const filesItems = computed(() => existingAttachments.value || [])

async function fetchAttachments(requestId) {
  const rid = String(requestId || '').trim()
  if (!rid) return
  try {
    const res = await api.get(`/leave/swap-working-day/${rid}/evidence`)
    existingAttachments.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    existingAttachments.value = []
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load attachments.' })
  }
}

function openFilesModal() {
  filesOpen.value = true
}

/* ───────────────── date helpers ─────────────────
   ✅ When "From" changes, auto set "To" = "From" (both sections)
   ✅ If "To" becomes earlier than "From", clamp it back.
*/
const requestEndManuallyEdited = ref(false)
const compEndManuallyEdited = ref(false)

function onRequestEndInput() {
  requestEndManuallyEdited.value = true
}
function onCompEndInput() {
  compEndManuallyEdited.value = true
}

watch(
  () => form.value.requestStart,
  (v) => {
    if (!v) return
    form.value.requestEnd = v
    requestEndManuallyEdited.value = false
  }
)

watch(
  () => form.value.compStart,
  (v) => {
    if (!v) return
    form.value.compEnd = v
    compEndManuallyEdited.value = false
  }
)

watch(
  () => form.value.requestEnd,
  (v) => {
    if (!v || !form.value.requestStart) return
    const s = dayjs(form.value.requestStart)
    const e = dayjs(v)
    if (s.isValid() && e.isValid() && e.isBefore(s, 'day')) {
      form.value.requestEnd = form.value.requestStart
      requestEndManuallyEdited.value = false
    }
  }
)

watch(
  () => form.value.compEnd,
  (v) => {
    if (!v || !form.value.compStart) return
    const s = dayjs(form.value.compStart)
    const e = dayjs(v)
    if (s.isValid() && e.isValid() && e.isBefore(s, 'day')) {
      form.value.compEnd = form.value.compStart
      compEndManuallyEdited.value = false
    }
  }
)

function calcDays(start, end) {
  if (!start || !end) return 0
  const s = dayjs(start)
  const e = dayjs(end)
  if (!s.isValid() || !e.isValid()) return 0
  return e.diff(s, 'day') + 1
}

const requestDays = computed(() => calcDays(form.value.requestStart, form.value.requestEnd))
const compDays = computed(() => calcDays(form.value.compStart, form.value.compEnd))
const isDurationValid = computed(() => requestDays.value > 0 && requestDays.value === compDays.value)

const canSubmit = computed(() => {
  return !!form.value.requestStart && !!form.value.compStart && isDurationValid.value
})

/* ───────────────── file picking ───────────────── */

function isAllowed(file) {
  const t = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  return (
    t.includes('pdf') ||
    t.startsWith('image/') ||
    name.endsWith('.pdf') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp')
  )
}

function pickFile(e) {
  const files = Array.from(e.target.files || [])
  for (const f of files) {
    if (!isAllowed(f)) {
      showToast({ type: 'error', message: 'Only PDF or image allowed.' })
      continue
    }
    if (f.size > 5 * 1024 * 1024) {
      showToast({ type: 'error', message: 'Max file size 5MB.' })
      continue
    }
    queuedFiles.value.push(f)
  }
  e.target.value = ''
}

function removeQueued(idx) {
  queuedFiles.value.splice(idx, 1)
}

/* ───────────────── load edit ───────────────── */
async function loadForEdit() {
  if (!isEdit.value) {
    status.value = 'PENDING_MANAGER'
    initialSnapshot.value = JSON.stringify(form.value)
    return
  }

  loading.value = true
  try {
    const res = await api.get(`/leave/swap-working-day/${id.value}`)
    const d = res.data || {}

    form.value = {
      requestStart: d.requestStartDate || '',
      requestEnd: d.requestEndDate || d.requestStartDate || '',
      compStart: d.offStartDate || '',
      compEnd: d.offEndDate || d.offStartDate || '',
      reason: d.reason || '',
    }

    status.value = d.status || ''
    await fetchAttachments(id.value)

    initialSnapshot.value = JSON.stringify(form.value)
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load request.' })
    router.push({ name: 'leave-user-swap-day' })
  } finally {
    loading.value = false
  }
}

onMounted(loadForEdit)

/* ───────────────── upload queued files ───────────────── */
async function uploadQueuedFiles(requestId) {
  const rid = String(requestId || '').trim()
  if (!rid) return
  if (!queuedFiles.value.length) return

  const fd = new FormData()
  for (const f of queuedFiles.value) fd.append('files', f) // ✅ field name: "files"

  // ✅ IMPORTANT: do NOT set multipart header manually
  await api.post(`/leave/swap-working-day/${rid}/evidence`, fd)

  queuedFiles.value = []
  await fetchAttachments(rid)
}

/* ───────────────── submit/save ───────────────── */
function askPrimary() {
  if (saving.value) return

  if (!canSubmit.value) {
    showToast({ type: 'error', message: 'Duration mismatch or missing fields.' })
    return
  }

  // ✅ NEW: submit immediately (no confirm)
  if (!isEdit.value) {
    doSubmitNew()
    return
  }

  // ✅ EDIT: confirm save
  confirmSaveOpen.value = true
}

async function doSubmitNew() {
  let createdId = null
  saving.value = true
  confirmBusy.value = true
  try {
    const payload = {
      requestStartDate: form.value.requestStart,
      requestEndDate: form.value.requestEnd || form.value.requestStart,
      offStartDate: form.value.compStart,
      offEndDate: form.value.compEnd || form.value.compStart,
      reason: form.value.reason,
    }

    const res = await api.post('/leave/swap-working-day', payload)
    createdId = res.data?._id

    // ✅ Upload evidence if any (do NOT auto-cancel if upload fails)
    if (createdId && queuedFiles.value.length) {
      try {
        await uploadQueuedFiles(createdId)
      } catch (e2) {
        // Request exists — show warning and go edit so user can retry upload
        showToast({
          type: 'warning',
          message: e2?.response?.data?.message || 'Request created, but evidence upload failed. You can upload again in Edit.',
        })
        router.push({ name: 'leave-user-swap-day-edit', params: { id: createdId } })
        return
      }
    }

    showToast({ type: 'success', message: 'Swap working day submitted.' })
    router.push({ name: 'leave-user-swap-day' })
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Submit failed.' })
  } finally {
    saving.value = false
    confirmBusy.value = false
  }
}

async function doSaveEdit() {
  if (!isEdit.value) return
  saving.value = true
  confirmBusy.value = true
  try {
    const payload = {
      requestStartDate: form.value.requestStart,
      requestEndDate: form.value.requestEnd || form.value.requestStart,
      offStartDate: form.value.compStart,
      offEndDate: form.value.compEnd || form.value.compStart,
      reason: form.value.reason,
    }

    await api.put(`/leave/swap-working-day/${id.value}`, payload)

    // ✅ upload in edit too (only if still allowed; backend will enforce lock)
    if (queuedFiles.value.length) {
      await uploadQueuedFiles(id.value)
    }

    showToast({ type: 'success', message: 'Changes saved.' })
    initialSnapshot.value = JSON.stringify(form.value)
    confirmSaveOpen.value = false
    router.push({ name: 'leave-user-swap-day' })
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Save failed.' })
  } finally {
    saving.value = false
    confirmBusy.value = false
  }
}

/* ───────────────── cancel/leave ───────────────── */
function askLeave() {
  if (isDirty.value) confirmLeaveOpen.value = true
  else router.back()
}
function confirmLeave() {
  confirmLeaveOpen.value = false
  router.back()
}

/* ───────────────── REALTIME (optional) ─────────────────
   If someone approves while user is on edit page:
   - update status
   - lock UI
*/
let offUpdated = null
let offCreated = null

function applyRealtime(doc) {
  if (!isEdit.value) return
  if (!doc?._id) return
  if (String(doc._id) !== String(id.value)) return

  const newStatus = doc.status || ''
  if (newStatus && newStatus !== status.value) {
    status.value = newStatus
    if (!String(newStatus).toUpperCase().includes('PENDING')) {
      showToast({ type: 'warning', message: `This request is now ${newStatus}. Editing is locked.` })
    }
  }
}

onMounted(() => {
  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_USER' })
    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()
    if (empId) subscribeEmployeeIfNeeded(empId)
    if (loginId) subscribeUserIfNeeded(loginId)
  } catch {}

  offUpdated = onSocket('swap:req:updated', applyRealtime)
  offCreated = onSocket('swap:req:created', applyRealtime)
})

onBeforeUnmount(() => {
  try {
    if (typeof offUpdated === 'function') offUpdated()
    if (typeof offCreated === 'function') offCreated()
  } catch {}
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex items-end justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-extrabold">
                {{ isEdit ? 'Edit Swap Working Day' : 'New Swap Working Day' }}
              </div>
              <div v-if="isEdit" class="mt-0.5 text-[11px] text-white/85">
                Status: <span class="font-extrabold">{{ status || '—' }}</span>
              </div>
            </div>

            <div class="flex gap-2">
              <button class="ui-hero-btn" type="button" @click="askLeave">
                <i class="fa-solid fa-arrow-left text-[11px]" />
                Back
              </button>

              <!-- <button
                class="ui-hero-btn ui-hero-btn-primary"
                type="button"
                :disabled="saving || !canSubmit || (isEdit && !isPending)"
                :title="isEdit && !isPending ? 'Only pending request can be edited.' : ''"
                @click="askPrimary"
              >
                <i v-if="saving" class="fa-solid fa-spinner animate-spin text-[11px]" />
                {{ isEdit ? 'Save' : 'Submit' }}
              </button> -->
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="p-4 space-y-4">
          <div v-if="loading" class="ui-skeleton h-14 w-full" />

          <template v-else>
            <!-- ✅ Row 1: Dates together -->
            <div class="grid gap-3 lg:grid-cols-2">
              <!-- Request working date -->
              <div class="ui-card p-4 space-y-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="ui-section-title">Swap (Sunday or Holiday)</div>
                  <span class="ui-badge ui-badge-info">{{ requestDays }} day(s)</span>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="ui-field">
                    <label class="ui-label">From</label>
                    <input type="date" v-model="form.requestStart" class="ui-date" :disabled="isEdit && !isPending" />
                  </div>

                  <div class="ui-field">
                    <label class="ui-label">To</label>
                    <input
                      type="date"
                      v-model="form.requestEnd"
                      class="ui-date"
                      :disabled="isEdit && !isPending"
                      @input="onRequestEndInput"
                    />
                  </div>
                </div>
              </div>

              <!-- Compensatory day off -->
              <div class="ui-card p-4 space-y-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="ui-section-title">To (Working Day)</div>

                  <span :class="isDurationValid ? 'ui-badge ui-badge-success' : 'ui-badge ui-badge-danger'">
                    {{ compDays }} day(s)
                  </span>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="ui-field">
                    <label class="ui-label">From</label>
                    <input type="date" v-model="form.compStart" class="ui-date" :disabled="isEdit && !isPending" />
                  </div>

                  <div class="ui-field">
                    <label class="ui-label">To</label>
                    <input
                      type="date"
                      v-model="form.compEnd"
                      class="ui-date"
                      :disabled="isEdit && !isPending"
                      @input="onCompEndInput"
                    />
                  </div>
                </div>

                <div v-if="form.compStart && form.requestStart && !isDurationValid" class="text-[11px] text-rose-600 font-semibold">
                  Compensatory days must equal request days.
                </div>
              </div>
            </div>

            <!-- ✅ Row 2: Reason + Attachments together -->
            <div class="grid gap-3 lg:grid-cols-2">
              <!-- Reason -->
              <div class="ui-card p-4 space-y-2">
                <div class="ui-section-title">Reason</div>
                <textarea
                  v-model="form.reason"
                  rows="5"
                  class="ui-textarea"
                  placeholder="Explain why you swap working day..."
                  :disabled="isEdit && !isPending"
                />
              </div>

              <!-- Attachments (NEW + EDIT) -->
              <div class="ui-card p-4 space-y-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="ui-section-title">Attachments</div>

                  <button
                    class="ui-btn ui-btn-soft ui-btn-sm"
                    type="button"
                    :disabled="!isEdit || (!existingAttachments.length && !queuedFiles.length)"
                    @click="openFilesModal"
                    title="Preview / manage attachments"
                  >
                    <i class="fa-solid fa-paperclip text-[11px]" />
                    Preview ({{ existingAttachments?.length || 0 }})
                  </button>
                </div>

                <!-- upload input -->
                <input
                  id="fileInputSwap"
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  class="hidden"
                  :disabled="isEdit && !isPending"
                  @change="pickFile"
                />

                <div class="flex flex-wrap gap-2">
                  <label
                    for="fileInputSwap"
                    class="ui-btn ui-btn-soft cursor-pointer"
                    :class="(isEdit && !isPending) ? 'opacity-60 pointer-events-none' : ''"
                  >
                    <i class="fa-solid fa-upload" />
                    Add Files
                  </label>

                  <button
                    v-if="isEdit"
                    class="ui-btn ui-btn-soft"
                    type="button"
                    @click="openFilesModal"
                    :disabled="!existingAttachments.length"
                  >
                    <i class="fa-solid fa-eye text-[11px]" />
                    View Existing
                  </button>
                </div>

                <!-- queued list -->
                <div v-if="queuedFiles.length" class="space-y-2">
                  <div class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
                    Selected (will upload when you {{ isEdit ? 'Save' : 'Submit' }})
                  </div>

                  <div v-for="(f, idx) in queuedFiles" :key="idx" class="flex items-center justify-between ui-frame p-2">
                    <div class="min-w-0">
                      <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                        {{ f.name }}
                      </div>
                      <div class="text-[10px] text-slate-500 dark:text-slate-400">
                        {{ Math.ceil((f.size || 0) / 1024) }} KB
                      </div>
                    </div>

                    <button
                      class="ui-btn ui-btn-ghost ui-btn-xs"
                      type="button"
                      :disabled="isEdit && !isPending"
                      @click="removeQueued(idx)"
                      title="Remove"
                    >
                      <i class="fa-solid fa-xmark" />
                    </button>
                  </div>
                </div>

                <!-- existing quick info -->
                <div v-if="existingAttachments.length" class="ui-frame p-3">
                  <div class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
                    Existing files: {{ existingAttachments.length }}
                  </div>
                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Click “Preview” to view/delete (pending only).
                  </div>
                </div>

                <div v-else class="text-[11px] text-slate-500 dark:text-slate-400">
                  No existing attachments.
                </div>
              </div>
            </div>

            <!-- footer buttons -->
            <div class="flex justify-end gap-2">
              <button class="ui-btn ui-btn-ghost" type="button" @click="askLeave">Cancel</button>

              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="saving || !canSubmit || (isEdit && !isPending)"
                @click="askPrimary"
              >
                <i v-if="saving" class="fa-solid fa-spinner animate-spin text-[11px]" />
                {{ isEdit ? 'Save' : 'Submit' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- ✅ Attachment Preview Modal -->
  <AttachmentPreviewModal
    v-model="filesOpen"
    :request-id="isEdit ? id : ''"
    title="Attachments"
    :subtitle="form.requestStart ? `${form.requestStart} → ${form.requestEnd || form.requestStart}` : ''"
    :items="filesItems"
    :fetch-content-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}/content`"
    :delete-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}`"
    :can-delete="isEdit && isPending"
    @refresh="() => fetchAttachments(id)"
  />

  <!-- Confirm leave -->
  <ConfirmDialog
    v-model="confirmLeaveOpen"
    title="Discard changes?"
    message="You have unsaved changes. Are you sure you want to leave?"
    confirm-text="Yes, leave"
    cancel-text="Stay"
    tone="warning"
    @confirm="confirmLeave"
  />

  <!-- Confirm save (edit) -->
  <ConfirmDialog
    v-model="confirmSaveOpen"
    :busy="confirmBusy"
    title="Save changes?"
    message="Are you sure you want to save these changes?"
    confirm-text="Yes, save"
    cancel-text="No"
    tone="primary"
    @confirm="doSaveEdit"
  />
</template>
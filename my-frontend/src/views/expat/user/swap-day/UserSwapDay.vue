<!-- src/views/expat/user/swap-day/UserSwapDay.vue
  ✅ Attachments REMOVED completely
  ✅ Supports new backend lock rule:
     - can edit ONLY when status is PENDING_* AND approvals have NO activity (actedAt/APPROVED/REJECTED)
  ✅ Works with new approval modes MANAGER_ONLY / GM_ONLY automatically (backend handles flow)
  ✅ Realtime: if approval starts while user is editing → UI locks instantly
  ✅ UI: same layout style, responsive, professional
-->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

import { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'
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

/** status + approvals (for lock logic) */
const status = ref('') // PENDING_MANAGER, APPROVED...
const approvals = ref([]) // [{level,loginId,status,actedAt,note}]

const isPending = computed(() => String(status.value || '').toUpperCase().includes('PENDING'))

const hasApprovalActivity = computed(() => {
  const arr = Array.isArray(approvals.value) ? approvals.value : []
  return arr.some((a) => {
    const st = String(a?.status || '').toUpperCase()
    return !!a?.actedAt || st === 'APPROVED' || st === 'REJECTED'
  })
})

/** ✅ FINAL permission (matches backend rule) */
const canEditNow = computed(() => isPending.value && !hasApprovalActivity.value)

/* ───────────────── dirty tracking ───────────────── */
const initialSnapshot = ref('')
const isDirty = computed(() => JSON.stringify(form.value) !== initialSnapshot.value)

/* ───────────────── dialogs ───────────────── */
const confirmLeaveOpen = ref(false)
const confirmSaveOpen = ref(false)
const confirmBusy = ref(false)

/* ───────────────── date helpers ─────────────────
   ✅ When "From" changes, auto set "To" = "From" (both sections)
   ✅ If "To" becomes earlier than "From", clamp it back.
*/
function onRequestEndInput() {}
function onCompEndInput() {}

watch(
  () => form.value.requestStart,
  (v) => {
    if (!v) return
    form.value.requestEnd = v
  }
)

watch(
  () => form.value.compStart,
  (v) => {
    if (!v) return
    form.value.compEnd = v
  }
)

watch(
  () => form.value.requestEnd,
  (v) => {
    if (!v || !form.value.requestStart) return
    const s0 = dayjs(form.value.requestStart)
    const e0 = dayjs(v)
    if (s0.isValid() && e0.isValid() && e0.isBefore(s0, 'day')) {
      form.value.requestEnd = form.value.requestStart
    }
  }
)

watch(
  () => form.value.compEnd,
  (v) => {
    if (!v || !form.value.compStart) return
    const s0 = dayjs(form.value.compStart)
    const e0 = dayjs(v)
    if (s0.isValid() && e0.isValid() && e0.isBefore(s0, 'day')) {
      form.value.compEnd = form.value.compStart
    }
  }
)

function calcDays(start, end) {
  if (!start || !end) return 0
  const s0 = dayjs(start)
  const e0 = dayjs(end)
  if (!s0.isValid() || !e0.isValid()) return 0
  return e0.diff(s0, 'day') + 1
}

const requestDays = computed(() => calcDays(form.value.requestStart, form.value.requestEnd))
const compDays = computed(() => calcDays(form.value.compStart, form.value.compEnd))
const isDurationValid = computed(() => requestDays.value > 0 && requestDays.value === compDays.value)

const canSubmit = computed(() => {
  return !!form.value.requestStart && !!form.value.compStart && isDurationValid.value
})

/* ───────────────── load edit ───────────────── */
async function loadForEdit() {
  if (!isEdit.value) {
    // new request
    status.value = 'PENDING_MANAGER'
    approvals.value = []
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
    approvals.value = Array.isArray(d.approvals) ? d.approvals : []

    initialSnapshot.value = JSON.stringify(form.value)

    // If already locked, inform user once
    if (!canEditNow.value) {
      showToast({ type: 'info', message: 'This request is locked because approval has started.' })
    }
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load request.' })
    router.push({ name: 'leave-user-swap-day' })
  } finally {
    loading.value = false
  }
}

onMounted(loadForEdit)

/* ───────────────── submit/save ───────────────── */
function askPrimary() {
  if (saving.value) return

  if (!canSubmit.value) {
    showToast({ type: 'error', message: 'Duration mismatch or missing fields.' })
    return
  }

  // ✅ EDIT lock check (matches backend)
  if (isEdit.value && !canEditNow.value) {
    showToast({ type: 'warning', message: 'This request is locked because approval has started.' })
    return
  }

  // ✅ New: submit immediately (no confirm)
  if (!isEdit.value) {
    doSubmitNew()
    return
  }

  // ✅ Edit: confirm save
  confirmSaveOpen.value = true
}

async function doSubmitNew() {
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

    await api.post('/leave/swap-working-day', payload)

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

  // ✅ double-check lock right before saving
  if (!canEditNow.value) {
    showToast({ type: 'warning', message: 'This request is locked because approval has started.' })
    confirmSaveOpen.value = false
    return
  }

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

/* ───────────────── leave / discard ───────────────── */
function askLeave() {
  if (isDirty.value) confirmLeaveOpen.value = true
  else router.back()
}
function confirmLeave() {
  confirmLeaveOpen.value = false
  router.back()
}

/* ───────────────── REALTIME ─────────────────
   If approval starts while user is on edit page:
   - update status + approvals
   - lock UI
*/
let offUpdated = null
let offCreated = null

function applyRealtime(doc) {
  if (!isEdit.value) return
  if (!doc?._id) return
  if (String(doc._id) !== String(id.value)) return

  const nextStatus = doc.status || ''
  const nextApprovals = Array.isArray(doc.approvals) ? doc.approvals : approvals.value

  const wasEditable = canEditNow.value

  if (nextStatus) status.value = nextStatus
  approvals.value = nextApprovals

  if (wasEditable && !canEditNow.value) {
    showToast({ type: 'warning', message: 'Approval has started. Editing is now locked.' })
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
                {{ isEdit ? 'Edit Swap Working Day' : 'Swap Working Day' }}
              </div>
              <div v-if="isEdit" class="mt-0.5 text-[11px] text-white/85">
                Status: <span class="font-extrabold">{{ status || '—' }}</span>
                <span v-if="!canEditNow" class="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-extrabold text-white/90">
                  LOCKED
                </span>
              </div>
            </div>

            <div class="flex gap-2">
              <button class="ui-hero-btn" type="button" @click="askLeave">
                <i class="fa-solid fa-arrow-left text-[11px]" />
                Back
              </button>
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="p-4 space-y-4">
          <div v-if="loading" class="ui-skeleton h-14 w-full" />

          <template v-else>
            <!-- Row 1: Dates -->
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
                    <input type="date" v-model="form.requestStart" class="ui-date" :disabled="isEdit && !canEditNow" />
                  </div>

                  <div class="ui-field">
                    <label class="ui-label">To</label>
                    <input
                      type="date"
                      v-model="form.requestEnd"
                      class="ui-date"
                      :disabled="isEdit && !canEditNow"
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
                    <input type="date" v-model="form.compStart" class="ui-date" :disabled="isEdit && !canEditNow" />
                  </div>

                  <div class="ui-field">
                    <label class="ui-label">To</label>
                    <input
                      type="date"
                      v-model="form.compEnd"
                      class="ui-date"
                      :disabled="isEdit && !canEditNow"
                      @input="onCompEndInput"
                    />
                  </div>
                </div>

                <div v-if="form.compStart && form.requestStart && !isDurationValid" class="text-[11px] text-rose-600 font-semibold">
                  Working day days must equal request days.
                </div>
              </div>
            </div>

            <!-- Row 2: Reason -->
            <div class="grid gap-3 lg:grid-cols-2">
              <div class="ui-card p-4 space-y-2">
                <div class="ui-section-title">Reason</div>
                <textarea
                  v-model="form.reason"
                  rows="5"
                  class="ui-textarea"
                  placeholder="Explain why you swap working day..."
                  :disabled="isEdit && !canEditNow"
                />
              </div>

              <!-- Right side: small info card -->
              <div class="ui-card p-4 space-y-2">
                <div class="ui-section-title">Info</div>
                <div class="ui-frame p-3 text-[11px] text-slate-700 dark:text-slate-200">
                  <div class="font-extrabold">Rules</div>
                  <ul class="mt-1 list-disc pl-4 space-y-1 text-slate-600 dark:text-slate-300">
                    <li>Swap dates must be non-working days (Sunday/Holiday).</li>
                    <li>Working day dates must be working days.</li>
                    <li>Total days must match on both sides.</li>
                    <li v-if="isEdit">Editing is locked once approval starts.</li>
                  </ul>
                </div>

                <div v-if="isEdit && !canEditNow" class="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
                  This request is locked because approval has started.
                </div>
              </div>
            </div>

            <!-- footer buttons -->
            <div class="flex justify-end gap-2">
              <button class="ui-btn ui-btn-ghost" type="button" @click="askLeave">Cancel</button>

              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="saving || !canSubmit || (isEdit && !canEditNow)"
                :title="isEdit && !canEditNow ? 'Locked after approval started.' : ''"
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
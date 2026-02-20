<!-- src/views/expat/user/swap-day/UserMySwapDay.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import { useToast } from '@/composables/useToast'
import { useRouter } from 'vue-router'
import { useAuth } from '@/store/auth'

import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'

import AttachmentPreviewModal from './AttachmentPreviewModal.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

import { swapWorkingDayApi } from '@/utils/swapWorkingDay.api'

defineOptions({ name: 'UserMySwapDay' })

const { showToast } = useToast()
const router = useRouter()
const auth = useAuth()

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const statusFilter = ref('ALL')

/* responsive */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* attachments modal state */
const filesOpen = ref(false)
const filesRequest = ref(null)
const filesItems = ref([])

/* cancel confirm */
const cancelOpen = ref(false)
const cancelBusy = ref(false)
const cancelTarget = ref(null)

/* detail modal */
const viewOpen = ref(false)
const viewItem = ref(null)

const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

function up(v) {
  return String(v ?? '').trim().toUpperCase()
}

function statusBadgeUiClass(s) {
  const st = up(s)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function fmtDateTime(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD HH:mm')
}

function fmtYmd(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD')
}

function compactText(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ✅ Business rule (UI):
 * requester cannot edit/cancel when there is ANY approved step (any level)
 * - Also allow only while status is pending.
 */
function hasAnyApprovedStep(item) {
  const steps = Array.isArray(item?.approvals) ? item.approvals : []
  return steps.some((s) => up(s?.status) === 'APPROVED')
}

function canEditOrCancel(item) {
  const st = up(item?.status)
  if (!st.startsWith('PENDING')) return false
  if (hasAnyApprovedStep(item)) return false
  return true
}

/* ───────────────── FETCH ───────────────── */
async function fetchData() {
  try {
    loading.value = true
    const data = await swapWorkingDayApi.myList()
    rows.value = Array.isArray(data) ? data : []
  } catch (e) {
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Failed to load swap requests',
    })
  } finally {
    loading.value = false
  }
}

/* ───────────────── DETAIL ───────────────── */
function openDetail(item) {
  viewItem.value = item
  viewOpen.value = true
}
function closeDetail() {
  viewOpen.value = false
  viewItem.value = null
}

/* keep detail modal synced with latest data */
watch(
  () => rows.value,
  (list) => {
    if (!viewOpen.value || !viewItem.value?._id) return
    const found = (list || []).find((x) => String(x._id) === String(viewItem.value._id))
    if (found) viewItem.value = found
  },
  { deep: true }
)

/* ───────────────── CANCEL (with confirm) ───────────────── */
function askCancel(item) {
  if (!canEditOrCancel(item)) {
    showToast({ type: 'warning', message: 'This request cannot be cancelled after any approval.' })
    return
  }
  cancelTarget.value = item
  cancelOpen.value = true
}

async function confirmCancel() {
  const item = cancelTarget.value
  if (!item?._id) return
  cancelBusy.value = true
  try {
    await swapWorkingDayApi.cancel(item._id)
    showToast({ type: 'success', message: 'Swap request cancelled.' })
    cancelOpen.value = false
    cancelTarget.value = null
    await fetchData()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Cancel failed.' })
  } finally {
    cancelBusy.value = false
  }
}

/* ───────────────── OPEN FILES MODAL ───────────────── */
async function openFiles(item) {
  filesRequest.value = item
  filesItems.value = []
  try {
    const data = await swapWorkingDayApi.listEvidence(item._id)
    filesItems.value = Array.isArray(data) ? data : item.attachments || []
  } catch (e) {
    filesItems.value = item.attachments || []
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load attachments list' })
  } finally {
    filesOpen.value = true
  }
}

async function refreshFilesAgain() {
  const req = filesRequest.value
  if (!req?._id) return
  try {
    const res = await swapWorkingDayApi.listEvidence(req._id)
    filesItems.value = Array.isArray(res.data) ? res.data : []
    const idx = rows.value.findIndex((r) => String(r._id) === String(req._id))
    if (idx >= 0) rows.value[idx].attachments = filesItems.value
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Refresh attachments failed' })
  }
}

/* ───────────────── FILTERED LIST ───────────────── */
const filteredRows = computed(() => {
  let result = [...rows.value]

  if (statusFilter.value !== 'ALL') {
    result = result.filter((r) => up(r.status) === up(statusFilter.value))
  }

  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    result = result.filter((r) => {
      const hay = [r.reason, r.status, r.requestStartDate, r.requestEndDate, r.offStartDate, r.offEndDate]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }

  result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return result
})

/* ───────────────── REALTIME ─────────────────
   Backend emits:
   - swap:req:created
   - swap:req:updated
*/
function upsertRow(doc) {
  if (!doc?._id) return

  const idx = rows.value.findIndex((x) => String(x._id) === String(doc._id))
  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  // keep modals synced
  if (filesRequest.value?._id && String(filesRequest.value._id) === String(doc._id)) {
    filesRequest.value = { ...filesRequest.value, ...doc }
  }
  if (viewItem.value?._id && String(viewItem.value._id) === String(doc._id)) {
    viewItem.value = { ...viewItem.value, ...doc }
  }
}

function onSwapCreated(doc) {
  upsertRow(doc)
}
function onSwapUpdated(doc) {
  upsertRow(doc)
}

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  // join correct rooms
  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_USER' })

    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()

    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (loginId) await subscribeUserIfNeeded(loginId)
  } catch {}

  await fetchData()

  socket.on('swap:req:created', onSwapCreated)
  socket.on('swap:req:updated', onSwapUpdated)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)

  socket.off('swap:req:created', onSwapCreated)
  socket.off('swap:req:updated', onSwapUpdated)
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div class="text-sm font-extrabold">My Swap Working Day</div>
            </div>

            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[260px_200px_auto] md:items-end">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Reason, date, status..."
                    class="w-full bg-transparent text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="statusFilter"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                >
                  <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select>
              </div>

              <button class="ui-btn ui-btn-primary" type="button" @click="router.push({ name: 'leave-user-swap-day-new' })">
                <i class="fa-solid fa-plus text-[11px]" />
                New Request
              </button>
            </div>
          </div>
        </div>

        <div class="p-3">
          <div v-if="loading" class="ui-skeleton h-14 w-full" />

          <div v-else-if="!filteredRows.length" class="ui-frame p-4 text-center text-[12px] text-slate-500">
            No swap requests found.
          </div>

          <!-- ✅ MOBILE CARDS -->
          <div v-else-if="isMobile" class="space-y-2">
            <article v-for="item in filteredRows" :key="item._id" class="ui-card p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Created:
                    <span class="font-extrabold text-slate-900 dark:text-slate-50">{{ fmtDateTime(item.createdAt) }}</span>
                  </div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Work:
                    <span class="font-extrabold">{{ fmtYmd(item.requestStartDate) }} → {{ fmtYmd(item.requestEndDate) }}</span>
                  </div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Swap:
                    <span class="font-extrabold">{{ fmtYmd(item.offStartDate) }} → {{ fmtYmd(item.offEndDate) }}</span>
                  </div>
                </div>

                <div class="shrink-0 text-right space-y-2">
                  <span :class="statusBadgeUiClass(item.status)">
                    {{ STATUS_LABEL[item.status] || item.status }}
                  </span>

                  <div class="flex items-center justify-end gap-2">
                    <!-- Detail -->
                    <button class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn" type="button" title="Detail" @click="openDetail(item)">
                      <i class="fa-solid fa-eye text-[12px]" />
                    </button>

                    <!-- Files -->
                    <button
                      v-if="item.attachments?.length"
                      class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                      type="button"
                      title="Attachments"
                      @click="openFiles(item)"
                    >
                      <i class="fa-solid fa-paperclip text-[12px]" />
                      <span class="ml-1">{{ item.attachments.length }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div class="mt-2 ui-frame p-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div class="font-extrabold text-slate-700 dark:text-slate-200">Reason</div>
                <div class="mt-0.5">{{ item.reason ? compactText(item.reason) : '—' }}</div>
              </div>

              <div class="mt-3 flex justify-end gap-2">
                <template v-if="canEditOrCancel(item)">
                  <button class="ui-btn ui-btn-rose ui-btn-xs" type="button" @click="askCancel(item)">Cancel</button>
                  <button
                    class="ui-btn ui-btn-primary ui-btn-xs"
                    type="button"
                    @click="router.push({ name: 'leave-user-swap-day-edit', params: { id: item._id } })"
                  >
                    Edit
                  </button>
                </template>

                <span v-else class="text-[11px] text-slate-400">—</span>
              </div>
            </article>
          </div>

          <!-- ✅ DESKTOP TABLE -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table">
              <thead>
                <tr>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Work Date</th>
                  <th class="ui-th">Swap Date</th>
                  <th class="ui-th text-center">File</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th">Reason</th>
                  <th class="ui-th text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-for="item in filteredRows" :key="item._id" class="ui-tr-hover">
                  <td class="ui-td">
                    {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td">{{ item.requestStartDate }} → {{ item.requestEndDate }}</td>

                  <td class="ui-td">{{ item.offStartDate }} → {{ item.offEndDate }}</td>

                  <!-- File column -->
                  <td class="ui-td text-center">
                    <button
                      v-if="item.attachments?.length"
                      class="ui-btn ui-btn-soft ui-btn-xs"
                      type="button"
                      @click="openFiles(item)"
                      title="Preview attachments"
                    >
                      <i class="fa-solid fa-paperclip text-[11px]" />
                      <span class="ml-1">{{ item.attachments.length }}</span>
                    </button>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(item.status)">
                      {{ STATUS_LABEL[item.status] || item.status }}
                    </span>
                  </td>

                  <td class="ui-td truncate" :title="compactText(item.reason)">
                    {{ item.reason ? compactText(item.reason) : '—' }}
                  </td>

                  <!-- Actions -->
                  <td class="ui-td text-center">
                    <div class="flex justify-center gap-2">
                      <button
                        class="ui-btn ui-btn-soft ui-btn-xs ui-icon-btn"
                        type="button"
                        title="Detail"
                        aria-label="Detail"
                        @click="openDetail(item)"
                      >
                        <i class="fa-solid fa-eye text-[11px]" />
                      </button>

                      <template v-if="canEditOrCancel(item)">
                        <button class="ui-btn ui-btn-rose ui-btn-xs" type="button" @click="askCancel(item)">Cancel</button>

                        <button
                          class="ui-btn ui-btn-primary ui-btn-xs"
                          type="button"
                          @click="router.push({ name: 'leave-user-swap-day-edit', params: { id: item._id } })"
                        >
                          Edit
                        </button>
                      </template>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  </div>

  <!-- ✅ DETAIL MODAL -->
  <div v-if="viewOpen" class="ui-modal-backdrop">
    <div class="ui-modal p-0 overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Swap Request Detail</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Created: {{ fmtDateTime(viewItem?.createdAt) }}</div>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="viewItem?.attachments?.length"
            class="ui-btn ui-btn-soft ui-btn-xs"
            type="button"
            @click="openFiles(viewItem)"
            title="Attachments"
          >
            <i class="fa-solid fa-paperclip text-[11px]" />
            Attachments
          </button>

          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeDetail">
            <i class="fa-solid fa-xmark text-[11px]" />
            Close
          </button>
        </div>
      </div>

      <div class="p-4 space-y-3">
        <div class="ui-frame p-3">
          <div class="grid gap-3 md:grid-cols-2">
            <div>
              <div class="ui-label">Status</div>
              <span :class="statusBadgeUiClass(viewItem?.status)">
                {{ STATUS_LABEL[viewItem?.status] || viewItem?.status }}
              </span>
            </div>

            <div class="text-right md:text-left">
              <div class="ui-label">Editable?</div>
              <div class="text-[12px] font-extrabold">
                <span v-if="canEditOrCancel(viewItem)" class="text-emerald-600 dark:text-emerald-400">Yes</span>
                <span v-else class="text-slate-500 dark:text-slate-400">No</span>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="ui-card p-3">
            <div class="ui-section-title">Request Working Date</div>
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
              {{ fmtYmd(viewItem?.requestStartDate) }} → {{ fmtYmd(viewItem?.requestEndDate) }}
            </div>
          </div>

          <div class="ui-card p-3">
            <div class="ui-section-title">Compensatory Day Off</div>
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
              {{ fmtYmd(viewItem?.offStartDate) }} → {{ fmtYmd(viewItem?.offEndDate) }}
            </div>
          </div>
        </div>

        <div class="ui-card p-3">
          <div class="ui-section-title">Reason</div>
          <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
            {{ viewItem?.reason || '—' }}
          </div>
        </div>

        <div class="ui-card p-3">
          <div class="ui-section-title">Approvals</div>
          <div class="mt-2 grid gap-2">
            <div
              v-for="(s, idx) in (Array.isArray(viewItem?.approvals) ? viewItem.approvals : [])"
              :key="idx"
              class="ui-frame p-2 flex items-center justify-between text-[11px]"
            >
              <div class="font-extrabold text-slate-700 dark:text-slate-200">{{ s.level }} · {{ s.loginId }}</div>
              <div class="flex items-center gap-2">
                <span
                  class="ui-badge"
                  :class="up(s.status)==='APPROVED' ? 'ui-badge-success' : (up(s.status)==='REJECTED' ? 'ui-badge-danger' : 'ui-badge-warning')"
                >
                  {{ s.status }}
                </span>
                <span class="text-slate-500 dark:text-slate-400">{{ s.actedAt ? fmtDateTime(s.actedAt) : '—' }}</span>
              </div>
            </div>

            <div v-if="!(Array.isArray(viewItem?.approvals) && viewItem.approvals.length)" class="text-[11px] text-slate-500">—</div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button class="ui-btn ui-btn-ghost" type="button" @click="closeDetail">Close</button>

          <template v-if="canEditOrCancel(viewItem)">
            <button class="ui-btn ui-btn-rose" type="button" @click="askCancel(viewItem)">Cancel</button>
            <button
              class="ui-btn ui-btn-primary"
              type="button"
              @click="router.push({ name: 'leave-user-swap-day-edit', params: { id: viewItem._id } })"
            >
              Edit
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- Attachment Preview Modal -->
  <AttachmentPreviewModal
    v-model="filesOpen"
    :request-id="filesRequest?._id"
    title="Attachments"
    :subtitle="filesRequest ? `${filesRequest.requestStartDate} → ${filesRequest.requestEndDate}` : ''"
    :items="filesItems"
    :fetch-content-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}/content`"
    :delete-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}`"
    :can-delete="canEditOrCancel(filesRequest)"
    @refresh="refreshFilesAgain()"
  />

  <!-- Confirm cancel -->
  <ConfirmDialog
    v-model="cancelOpen"
    tone="danger"
    :busy="cancelBusy"
    title="Cancel this request?"
    message="Are you sure you want to cancel this swap working day request?"
    confirm-text="Yes, cancel"
    cancel-text="No"
    @confirm="confirmCancel"
  />
</template>

<style scoped>
.ui-icon-btn {
  padding-left: 0.55rem !important;
  padding-right: 0.55rem !important;
}
</style>
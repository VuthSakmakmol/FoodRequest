<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useRouter } from 'vue-router'

import AttachmentPreviewModal from './AttachmentPreviewModal.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

defineOptions({ name: 'UserMySwapDay' })

const { showToast } = useToast()
const router = useRouter()

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const statusFilter = ref('ALL')

/* attachments modal state */
const filesOpen = ref(false)
const filesRequest = ref(null)
const filesItems = ref([])

/* cancel confirm */
const cancelOpen = ref(false)
const cancelBusy = ref(false)
const cancelTarget = ref(null)

const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

function statusBadgeUiClass(s) {
  const st = String(s || '').toUpperCase()
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

async function fetchData() {
  try {
    loading.value = true
    const res = await api.get('/leave/swap-working-day/my')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load swap requests' })
  } finally {
    loading.value = false
  }
}

/* ───────────────── CANCEL (with confirm) ───────────────── */
function askCancel(item) {
  cancelTarget.value = item
  cancelOpen.value = true
}

async function confirmCancel() {
  const item = cancelTarget.value
  if (!item?._id) return
  cancelBusy.value = true
  try {
    await api.post(`/leave/swap-working-day/${item._id}/cancel`)
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
    const res = await api.get(`/leave/swap-working-day/${item._id}/evidence`)
    filesItems.value = Array.isArray(res.data) ? res.data : (item.attachments || [])
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
    const res = await api.get(`/leave/swap-working-day/${req._id}/evidence`)
    filesItems.value = Array.isArray(res.data) ? res.data : []
    const idx = rows.value.findIndex((r) => String(r._id) === String(req._id))
    if (idx >= 0) rows.value[idx].attachments = filesItems.value
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Refresh attachments failed' })
  }
}

const filteredRows = computed(() => {
  let result = [...rows.value]
  if (statusFilter.value !== 'ALL') result = result.filter((r) => r.status === statusFilter.value)

  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    result = result.filter(
      (r) => (r.reason || '').toLowerCase().includes(q) || (r.status || '').toLowerCase().includes(q)
    )
  }
  return result
})

onMounted(fetchData)
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
                    placeholder="Reason or status..."
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

              <button class="ui-btn ui-btn-primary" @click="router.push({ name: 'leave-user-swap-day-new' })">
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

          <div v-else class="ui-table-wrap">
            <table class="ui-table">
              <thead>
                <tr>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Work Date</th>
                  <th class="ui-th">Swap Date</th>
                  <th class="ui-th">File</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th">Reason</th>
                  <th class="ui-th">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-for="item in filteredRows" :key="item._id" class="ui-tr-hover">
                  <td class="ui-td">
                    {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td">
                    {{ item.requestStartDate }} → {{ item.requestEndDate }}
                  </td>

                  <td class="ui-td">
                    {{ item.offStartDate }} → {{ item.offEndDate }}
                  </td>

                  <!-- ✅ ONLY FILE COLUMN (click to preview) -->
                  <td class="ui-td">
                    <button
                      v-if="item.attachments?.length"
                      class="ui-btn ui-btn-soft ui-btn-xs"
                      @click="openFiles(item)"
                      title="Preview attachments"
                    >
                      {{ item.attachments.length }} file(s)
                    </button>
                    <span v-else>—</span>
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(item.status)">
                      {{ STATUS_LABEL[item.status] || item.status }}
                    </span>
                  </td>

                  <td class="ui-td truncate">
                    {{ item.reason || '—' }}
                  </td>

                  <!-- ✅ Actions: remove Files button -->
                  <td class="ui-td">
                    <div class="flex justify-center gap-2">
                      <button
                        v-if="String(item.status || '').includes('PENDING')"
                        class="ui-btn ui-btn-rose ui-btn-xs"
                        @click="askCancel(item)"
                      >
                        Cancel
                      </button>

                      <button
                        v-if="String(item.status || '').includes('PENDING')"
                        class="ui-btn ui-btn-primary ui-btn-xs"
                        @click="router.push({ name:'leave-user-swap-day-edit', params:{ id:item._id } })"
                      >
                        Edit
                      </button>
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

  <!-- Attachment Preview Modal -->
  <AttachmentPreviewModal
    v-model="filesOpen"
    :request-id="filesRequest?._id"
    title="Attachments"
    :subtitle="filesRequest ? `${filesRequest.requestStartDate} → ${filesRequest.requestEndDate}` : ''"
    :items="filesItems"
    :fetch-content-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}/content`"
    :delete-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}`"
    :can-delete="String(filesRequest?.status || '').includes('PENDING')"
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
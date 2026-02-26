<!-- src/views/expat/user/forgetScan/UserForgetScan.vue
  ✅ Backend supports ONLY forgotType (single)
  ✅ UI uses tick chips (can choose one or both)
  ✅ If choose both -> frontend submits TWO requests (FORGET_IN + FORGET_OUT)
  ✅ Edit = single request only (one forgotType)
  ✅ No crash from ref unwrapping
  ✅ Realtime: forgetscan:req:created / forgetscan:req:updated
-->

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'

import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'
import api from '@/utils/api'

defineOptions({ name: 'UserForgetScan' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const statusFilter = ref('All')

/* responsive */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* create modal */
const createOpen = ref(false)
const createBusy = ref(false)
const form = ref({
  forgotDate: '',
  forgotTypes: [], // ✅ UI only: ['FORGET_IN','FORGET_OUT']
  reason: '',
})

/* edit modal (single request only) */
const editOpen = ref(false)
const editBusy = ref(false)
const editError = ref('')
const editItem = ref(null)
const editForm = ref({
  forgotDate: '',
  forgotType: [], // ✅ backend field
  reason: '',
})

/* detail modal */
const viewOpen = ref(false)
const viewItem = ref(null)

/* cancel confirm */
const cancelOpen = ref(false)
const cancelBusy = ref(false)
const cancelTarget = ref(null)

/* ───────────────── CONSTANTS ───────────────── */
const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

const TYPE_OPTIONS = [
  { value: 'FORGET_IN', label: 'Forget IN' },
  { value: 'FORGET_OUT', label: 'Forget OUT' },
]

/* ───────────────── HELPERS ───────────────── */
function up(v) {
  return String(v ?? '').trim().toUpperCase()
}
function compactText(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
}
function fmtDateTime(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD HH:mm')
}
function fmtYmd(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD')
}

function statusBadgeUiClass(s) {
  const st = up(s)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function typeBadgeUiClass(t) {
  const tt = up(t)
  if (tt === 'FORGET_OUT') return 'ui-badge ui-badge-indigo'
  return 'ui-badge ui-badge-info'
}

function typeLabel(v) {
  const t = up(v)
  if (t === 'FORGET_IN') return 'Forget IN'
  if (t === 'FORGET_OUT') return 'Forget OUT'
  return v || '—'
}

/* ✅ safe for template ref unwrapping */
function unwrapObj(maybeRef) {
  return maybeRef?.value ?? maybeRef ?? {}
}

function isTypeChecked(maybeRefOrObj, typeValue) {
  const obj = unwrapObj(maybeRefOrObj)
  const v = up(typeValue)
  const arr = Array.isArray(obj?.forgotTypes) ? obj.forgotTypes : []
  return arr.some((x) => up(x) === v)
}

function toggleTypeInForm(maybeRefOrObj, typeValue) {
  const obj = unwrapObj(maybeRefOrObj)
  const v = up(typeValue)

  const arr = Array.isArray(obj?.forgotTypes) ? obj.forgotTypes : []
  const idx = arr.findIndex((x) => up(x) === v)

  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(v)

  // stable order
  obj.forgotTypes = ['FORGET_IN', 'FORGET_OUT'].filter((x) => arr.includes(x))
}

function typesToText(arr) {
  const a = Array.isArray(arr) ? arr : []
  if (!a.length) return '—'
  return a.map(typeLabel).join(' + ')
}

function isPending(item) {
  const st = up(item?.status)
  return st === 'PENDING_MANAGER' || st === 'PENDING_GM' || st === 'PENDING_COO'
}

/** requester cannot cancel after ANY approved step exists */
function hasAnyApprovedStep(item) {
  const steps = Array.isArray(item?.approvals) ? item.approvals : []
  return steps.some((s) => up(s?.status) === 'APPROVED')
}
function canCancel(item) {
  if (!isPending(item)) return false
  if (hasAnyApprovedStep(item)) return false
  return true
}

/** Edit allowed only if NO one acted yet */
function canEdit(item) {
  if (!isPending(item)) return false
  const approvals = Array.isArray(item?.approvals) ? item.approvals : []
  const anyApproved = approvals.some((a) => up(a?.status) === 'APPROVED')
  const anyRejected = approvals.some((a) => up(a?.status) === 'REJECTED')
  const anyActed = approvals.some((a) => !!a?.actedAt)
  return !(anyApproved || anyRejected || anyActed)
}

/* ───────────────── FETCH ───────────────── */
async function fetchData() {
  try {
    loading.value = true
    const res = await api.get('/leave/forget-scan/my')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Failed to load forget scan requests',
    })
  } finally {
    loading.value = false
  }
}

/* ───────────────── CREATE ───────────────── */
function openCreate() {
  form.value = { forgotDate: '', forgotTypes: [], reason: '' }
  createOpen.value = true
}
function closeCreate() {
  if (createBusy.value) return
  createOpen.value = false
}

function validateCreate(v) {
  const d = String(v?.forgotDate || '').trim()
  const types = Array.isArray(v?.forgotTypes) ? v.forgotTypes.map(up).filter(Boolean) : []
  const r = compactText(v?.reason)

  if (!d) return 'Forgot date is required.'
  if (!types.length) return 'Please tick Forget IN and/or Forget OUT.'
  if (!types.every((t) => ['FORGET_IN', 'FORGET_OUT'].includes(t))) return 'Invalid type selection.'
  if (!r || r.length < 3) return ''
  return ''
}

async function submitCreate() {
  const err = validateCreate(form.value)
  if (err) {
    showToast({ type: 'warning', message: err })
    return
  }

  createBusy.value = true
  try {
    const payload = {
      forgotDate: String(form.value.forgotDate || '').trim(),
      forgotTypes: [...new Set((form.value.forgotTypes || []).map(up).filter(Boolean))],
      reason: compactText(form.value.reason),
    }

    const res = await api.post('/leave/forget-scan', payload)
    if (res?.data?._id) upsertRow(res.data)

    showToast({
      type: 'success',
      message: payload.forgotTypes.length === 2 ? 'Forget IN + OUT submitted (one request).' : 'Forget scan submitted.',
    })

    createOpen.value = false
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Submit failed.' })
  } finally {
    createBusy.value = false
  }
}

/* ───────────────── EDIT (single request only) ───────────────── */
function openEdit(item) {
  if (!item?._id) return
  if (!canEdit(item)) {
    showToast({ type: 'info', message: 'This request cannot be edited after any approval action.' })
    return
  }
  editItem.value = item
  editError.value = ''
  editForm.value = {
    forgotDate: String(item.forgotDate || '').trim(),
    forgotTypes: Array.isArray(item.forgotTypes) ? item.forgotTypes.map(up) : [],
    reason: String(item.reason || ''),
  }
  editOpen.value = true
}

function closeEdit(force = false) {
  if (editBusy.value && !force) return
  editOpen.value = false
  editError.value = ''
  editItem.value = null
}

function validateEdit(v) {
  const d = String(v?.forgotDate || '').trim()
  const types = Array.isArray(v?.forgotTypes) ? v.forgotTypes.map(up).filter(Boolean) : []
  const r = compactText(v?.reason)

  if (!d) return 'Forgot date is required.'
  if (!types.length) return 'Please tick Forget IN and/or Forget OUT.'
  if (!types.every((t) => ['FORGET_IN', 'FORGET_OUT'].includes(t))) return 'Invalid type selection.'
  if (!r || r.length < 3) return ''
  return ''
}

async function submitEdit() {
  if (!editItem.value?._id) return

  const err = validateEdit(editForm.value)
  if (err) {
    editError.value = err
    showToast({ type: 'warning', message: err })
    return
  }

  if (!canEdit(editItem.value)) {
    showToast({ type: 'warning', message: 'This request cannot be edited after any approval action.' })
    closeEdit()
    return
  }

  editBusy.value = true
  editError.value = ''
  try {
  const payload = {
    forgotDate: String(editForm.value.forgotDate || '').trim(),
    forgotTypes: [...new Set((editForm.value.forgotTypes || []).map(up).filter(Boolean))],
    reason: compactText(editForm.value.reason),
  }
  await api.patch(`/leave/forget-scan/${editItem.value._id}`, payload)


    const res = await api.patch(`/leave/forget-scan/${editItem.value._id}`, payload)

    const doc = res?.data
    if (doc?._id) upsertRow(doc)
    else await fetchData()

    showToast({ type: 'success', message: 'Request updated.' })
    closeEdit(true)
  } catch (e) {
    const msg = e?.response?.data?.message || 'Update failed.'
    editError.value = msg
    showToast({ type: 'error', message: msg })
  } finally {
    editBusy.value = false
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

/* ───────────────── CANCEL ───────────────── */
function askCancel(item) {
  if (!canCancel(item)) {
    showToast({
      type: 'warning',
      message: 'This request cannot be cancelled after any approval.',
    })
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
    await api.post(`/leave/forget-scan/${item._id}/cancel`)
    showToast({ type: 'success', message: 'Request cancelled.' })
    cancelOpen.value = false
    cancelTarget.value = null
    await fetchData()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Cancel failed.' })
  } finally {
    cancelBusy.value = false
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
    const hay = [r.forgotDate, (r.forgotTypes || []).join(','), r.forgotKey, r.status, r.reason]
      .map((x) => String(x || '').toLowerCase())
      .join(' ')
      return hay.includes(q)
    })
  }

  result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return result
})

/* ───────────────── REALTIME ───────────────── */
function upsertRow(doc) {
  if (!doc?._id) return
  const id = String(doc._id)

  const idx = rows.value.findIndex((x) => String(x._id) === id)
  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  if (viewItem.value?._id && String(viewItem.value._id) === id) {
    viewItem.value = { ...viewItem.value, ...doc }
  }

  if (editItem.value?._id && String(editItem.value._id) === id) {
    editItem.value = { ...editItem.value, ...doc }
    if (editOpen.value) {
      editForm.value = {
        forgotDate: String(editItem.value.forgotDate || '').trim(),
        forgotType: up(editItem.value.forgotType || 'FORGET_IN'),
        reason: String(editItem.value.reason || ''),
      }
    }
  }
}

function onReqCreated(doc) {
  upsertRow(doc)
}
function onReqUpdated(doc) {
  upsertRow(doc)
}

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_USER' })

    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const lid = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()

    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (lid) await subscribeUserIfNeeded(lid)
  } catch {}

  await fetchData()

  socket.on('forgetscan:req:created', onReqCreated)
  socket.on('forgetscan:req:updated', onReqUpdated)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  socket.off('forgetscan:req:created', onReqCreated)
  socket.off('forgetscan:req:updated', onReqUpdated)
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div class="text-sm font-extrabold">My Forget Scan</div>

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

              <button class="ui-btn ui-btn-primary" type="button" @click="openCreate">
                <i class="fa-solid fa-plus text-[11px]" />
                New Request
              </button>
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="p-3">
          <div v-if="loading" class="ui-skeleton h-14 w-full" />

          <div v-else-if="!filteredRows.length" class="ui-frame p-4 text-center text-[12px] text-slate-500">
            No forget scan requests found.
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
                    Forgot Date:
                    <span class="font-extrabold">{{ fmtYmd(item.forgotDate) }}</span>
                  </div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Type:
                    <span class="font-extrabold">{{ typesToText(item.forgotTypes) }}</span>
                  </div>
                </div>

                <div class="shrink-0 text-right space-y-2">
                  <span :class="statusBadgeUiClass(item.status)">
                    {{ STATUS_LABEL[item.status] || item.status }}
                  </span>

                  <div class="flex items-center justify-end gap-2">
                    <button class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn" type="button" title="Detail" @click="openDetail(item)">
                      <i class="fa-solid fa-eye text-[12px]" />
                    </button>

                    <button
                      v-if="canEdit(item)"
                      class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                      type="button"
                      title="Edit"
                      @click="openEdit(item)"
                    >
                      <i class="fa-solid fa-pen-to-square text-[12px]" />
                    </button>
                  </div>
                </div>
              </div>

              <div class="mt-2 ui-frame p-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div class="font-extrabold text-slate-700 dark:text-slate-200">Reason</div>
                <div class="mt-0.5">{{ item.reason ? compactText(item.reason) : '—' }}</div>
              </div>

              <div class="mt-3 flex justify-end gap-2">
                <button v-if="canCancel(item)" class="ui-btn ui-btn-rose ui-btn-xs" type="button" @click="askCancel(item)">
                  Cancel
                </button>
                <button v-if="canEdit(item)" class="ui-btn ui-btn-primary ui-btn-xs" type="button" @click="openEdit(item)">
                  Edit
                </button>
                <span v-else-if="!canCancel(item)" class="text-[11px] text-slate-400">—</span>
              </div>
            </article>
          </div>

          <!-- ✅ DESKTOP TABLE -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table">
              <thead>
                <tr>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Forgot Date</th>
                  <th class="ui-th">Type</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th">Reason</th>
                  <th class="ui-th text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-for="item in filteredRows" :key="item._id" class="ui-tr-hover">
                  <td class="ui-td">{{ fmtDateTime(item.createdAt) }}</td>
                  <td class="ui-td">{{ item.forgotDate || '—' }}</td>

                  <td class="ui-td">
                    {{ typesToText(item.forgotTypes) }}
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(item.status)">
                      {{ STATUS_LABEL[item.status] || item.status }}
                    </span>
                  </td>

                  <td class="ui-td truncate" :title="compactText(item.reason)">
                    {{ item.reason ? compactText(item.reason) : '—' }}
                  </td>

                  <td class="ui-td text-center">
                    <div class="flex justify-center gap-2">
                      <button class="ui-btn ui-btn-soft ui-btn-xs ui-icon-btn" type="button" title="Detail" @click="openDetail(item)">
                        <i class="fa-solid fa-eye text-[11px]" />
                      </button>

                      <button
                        v-if="canEdit(item)"
                        class="ui-btn ui-btn-soft ui-btn-xs ui-icon-btn"
                        type="button"
                        title="Edit"
                        @click="openEdit(item)"
                      >
                        Edit
                      </button>

                      <button v-if="canCancel(item)" class="ui-btn ui-btn-rose ui-btn-xs" type="button" @click="askCancel(item)">
                        Cancel
                      </button>

                      <span v-if="!canEdit(item) && !canCancel(item)" class="text-[11px] text-slate-400">—</span>
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

  <!-- ✅ CREATE MODAL -->
  <div v-if="createOpen" class="ui-modal-backdrop">
    <div class="ui-modal p-0 overflow-hidden max-w-xl">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">New Forget Scan</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">
            Choose date, type(s), and reason. (Selecting both will create 2 requests.)
          </div>
        </div>
        <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" :disabled="createBusy" @click="closeCreate">
          <i class="fa-solid fa-xmark text-[11px]" />
          Close
        </button>
      </div>

      <div class="p-4 space-y-3">
        <div class="ui-card p-3 space-y-3">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-field">
              <label class="ui-label">Forgot Date</label>
              <input type="date" v-model="form.forgotDate" class="ui-date" :disabled="createBusy" />
            </div>

            <div class="ui-field">
              <label class="ui-label">Forgot Type</label>

              <div class="mt-1 flex flex-wrap gap-2">
                <button
                  v-for="opt in TYPE_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="tick-chip"
                  :class="isTypeChecked(form, opt.value) ? 'tick-chip-on' : ''"
                  :disabled="createBusy"
                  @click="toggleTypeInForm(form, opt.value)"
                >
                  <span class="tick-dot">
                    <i v-if="isTypeChecked(form, opt.value)" class="fa-solid fa-check text-[10px]" />
                  </span>
                  <span class="font-extrabold text-[11px]">{{ opt.label }}</span>
                </button>
              </div>

              <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                You can tick one or both.
              </div>
            </div>
          </div>

          <div class="ui-field">
            <label class="ui-label">Reason</label>
            <textarea
              v-model="form.reason"
              rows="4"
              class="ui-textarea"
              placeholder="Explain briefly..."
              :disabled="createBusy"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button class="ui-btn ui-btn-ghost" type="button" :disabled="createBusy" @click="closeCreate">
            Cancel
          </button>

          <button class="ui-btn ui-btn-primary" type="button" :disabled="createBusy" @click="submitCreate">
            <i v-if="createBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            Submit
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ✅ EDIT MODAL (single request only) -->
  <div v-if="editOpen" class="ui-modal-backdrop">
    <div class="ui-modal p-0 overflow-hidden max-w-xl">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Edit Forget Scan</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">Edit is single request (one type).</div>
        </div>
        <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" :disabled="editBusy" @click="closeEdit">
          <i class="fa-solid fa-xmark text-[11px]" />
          Close
        </button>
      </div>

      <div class="p-4 space-y-3">
        <div class="ui-card p-3 space-y-3">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-field">
              <label class="ui-label">Forgot Date</label>
              <input type="date" v-model="editForm.forgotDate" class="ui-date" :disabled="editBusy" />
            </div>

            <div class="ui-field">
              <label class="ui-label">Forgot Type</label>
              <select v-model="editForm.forgotType" class="ui-select" :disabled="editBusy">
                <option value="FORGET_IN">Forget IN</option>
                <option value="FORGET_OUT">Forget OUT</option>
              </select>
              <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                To create both IN+OUT, use “New Request”.
              </div>
            </div>
          </div>

          <div class="ui-field">
            <label class="ui-label">Reason</label>
            <textarea
              v-model="editForm.reason"
              rows="4"
              class="ui-textarea"
              placeholder="Explain briefly..."
              :disabled="editBusy"
            />
          </div>

          <div v-if="editError" class="text-[11px] font-extrabold text-rose-600 dark:text-rose-400">
            {{ editError }}
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button class="ui-btn ui-btn-ghost" type="button" :disabled="editBusy" @click="closeEdit">
            Cancel
          </button>

          <button class="ui-btn ui-btn-primary" type="button" :disabled="editBusy" @click="submitEdit">
            <i v-if="editBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            Save changes
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ✅ DETAIL MODAL -->
  <div v-if="viewOpen" class="ui-modal-backdrop">
    <div class="ui-modal p-0 overflow-hidden max-w-3xl">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Forget Scan Detail</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Created: {{ fmtDateTime(viewItem?.createdAt) }}
          </div>
        </div>

        <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeDetail">
          <i class="fa-solid fa-xmark text-[11px]" />
          Close
        </button>
      </div>

      <div class="p-4 space-y-3">
        <div class="ui-frame p-3">
          <div class="grid gap-3 md:grid-cols-3">
            <div>
              <div class="ui-label">Status</div>
              <span :class="statusBadgeUiClass(viewItem?.status)">
                {{ STATUS_LABEL[viewItem?.status] || viewItem?.status || '—' }}
              </span>
            </div>

            <div>
              <div class="ui-label">Type</div>
              <span :class="typeBadgeUiClass(viewItem?.forgotType)">{{ typeLabel(viewItem?.forgotType) }}</span>
            </div>

            <div class="md:text-right">
              <div class="ui-label">Forgot Date</div>
              <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ viewItem?.forgotDate || '—' }}
              </div>
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
              <div class="font-extrabold text-slate-700 dark:text-slate-200">
                {{ s.level }} · {{ s.loginId }}
              </div>
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

            <div v-if="!(Array.isArray(viewItem?.approvals) && viewItem.approvals.length)" class="text-[11px] text-slate-500">
              —
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button class="ui-btn ui-btn-ghost" type="button" @click="closeDetail">Close</button>

          <button v-if="canEdit(viewItem)" class="ui-btn ui-btn-primary" type="button" @click="openEdit(viewItem)">
            Edit
          </button>

          <button v-if="canCancel(viewItem)" class="ui-btn ui-btn-rose" type="button" @click="askCancel(viewItem)">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDialog
    v-model="cancelOpen"
    tone="danger"
    :busy="cancelBusy"
    title="Cancel this request?"
    message="Are you sure you want to cancel this forget scan request?"
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

/* tick chips */
.tick-chip {
  @apply inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2
         text-slate-700 hover:bg-slate-50 active:translate-y-[0.5px]
         disabled:opacity-50 disabled:cursor-not-allowed
         dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900/40;
}
.tick-chip-on {
  @apply border-sky-300 bg-sky-50 text-sky-800
         dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200;
}
.tick-dot {
  @apply grid place-items-center rounded-lg border border-slate-200 bg-white
         dark:border-slate-800 dark:bg-slate-950/40;
  width: 22px;
  height: 22px;
}
.tick-chip-on .tick-dot {
  @apply border-sky-300 bg-white dark:border-sky-700/60 dark:bg-slate-950/40;
}
</style>
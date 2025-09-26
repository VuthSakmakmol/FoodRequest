<!-- src/views/admin/AdminFoodCalendar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import Swal from 'sweetalert2'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'

/* ───────── constants ───────── */
const auth = useAuth()
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const COLOR = { NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }

/* ───────── state ───────── */
const month = ref(dayjs().month()) // 0..11
const year  = ref(dayjs().year())
const loading = ref(false)

const rows = ref([])          // normalized
const byDate = ref(new Map()) // 'YYYY-MM-DD' -> rows[]
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const drawer = ref(false)

const rowDialog = ref(false)
const activeRow = ref(null)

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const fmtDateTime = d => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—')
const fmtTimeRange = r => (r?.eatTimeStart || r?.eatTimeEnd)
  ? [r.eatTimeStart || '', r.eatTimeEnd || ''].filter(Boolean).join(' – ')
  : '—'
const asArray = v => (Array.isArray(v) ? v : [])

const normalize = o => {
  const eat = o?.eatDate || o?.serveDate || null
  return {
    ...o,
    _id: String(o?._id || ''),
    requestId: String(o?.requestId || ''),
    orderType: o?.orderType || '',
    quantity: Number(o?.quantity || 0),
    meals: asArray(o?.meals),
    location: o?.location || {},
    menuChoices: asArray(o?.menuChoices),
    menuCounts: asArray(o?.menuCounts),
    dietary: asArray(o?.dietary),
    dietaryCounts: asArray(o?.dietaryCounts),
    specialInstructions: o?.specialInstructions || '',
    dietaryOther: o?.dietaryOther || '',
    cancelReason: o?.cancelReason || '',
    recurring: o?.recurring || {},
    status: o?.status || 'NEW',
    statusHistory: asArray(o?.statusHistory),
    notified: o?.notified || {},
    stepDates: o?.stepDates || {},
    orderDate: o?.orderDate || null,
    eatDate: eat,
    serveDate: o?.serveDate || null,
    createdAt: o?.createdAt || null,
    updatedAt: o?.updatedAt || null,
    employee: o?.employee || {},
  }
}

function rebuildByDate(list = rows.value) {
  const m = new Map()
  for (const r of list) {
    const key = fmtDate(r.eatDate) || fmtDate(r.serveDate)
    if (!key) continue
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(r)
  }
  byDate.value = m
}
function dateList(dateStr) {
  return (byDate.value.get(dateStr) || []).slice().sort((a,b) => {
    // optional stable ordering by time, then status, then name
    const tA = (a.eatTimeStart || '') + (a.eatTimeEnd || '')
    const tB = (b.eatTimeStart || '') + (b.eatTimeEnd || '')
    return tA.localeCompare(tB) || a.status.localeCompare(b.status) || (a.employee?.name||'').localeCompare(b.employee?.name||'')
  })
}
const dayHasOrders = (dateStr) => dateList(dateStr).length > 0

/* ───────── month grid ───────── */
const monthStart = computed(() => dayjs().year(year.value).month(month.value).date(1))
const monthEnd   = computed(() => monthStart.value.endOf('month'))
const gridDays = computed(() => {
  const start = monthStart.value.startOf('week')   // Sunday start
  const end   = monthEnd.value.endOf('week')
  const days = []
  let d = start
  while (d.isBefore(end) || d.isSame(end, 'day')) {
    days.push({
      date: d.format('YYYY-MM-DD'),
      inMonth: d.month() === month.value,
      isSun: d.day() === 0
    })
    d = d.add(1, 'day')
  }
  while (days.length < 42) {
    const last = dayjs(days[days.length - 1].date).add(1, 'day')
    days.push({ date: last.format('YYYY-MM-DD'), inMonth: last.month() === month.value, isSun: last.day() === 0 })
  }
  return days
})

/* ───────── load (robust) ───────── */
async function loadMonth() {
  loading.value = true
  try {
    const from = monthStart.value.startOf('week').format('YYYY-MM-DD')
    const to   = monthEnd.value.endOf('week').format('YYYY-MM-DD')
    const p = new URLSearchParams()
    p.set('from', from); p.set('to', to)
    console.log('[Calendar] fetch with range', Object.fromEntries(p))

    let { data } = await api.get(`/admin/food-requests?${p.toString()}`)
    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    console.log('[Calendar] result (range) count:', list?.length)

    if (!Array.isArray(list) || list.length === 0) {
      console.warn('[Calendar] empty with range, retry without date params…')
      const resp2 = await api.get(`/admin/food-requests`)
      data = resp2.data
      list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
      console.log('[Calendar] result (no-range) count:', list?.length)
    }

    rows.value = (list || []).map(normalize)
    rebuildByDate()
  } catch (e) {
    console.error('[Calendar] loadMonth error:', e)
    rows.value = []
    rebuildByDate([])
  } finally { loading.value = false }
}

/* ───────── status updates (kept simple) ───────── */
const nextSteps = (s) => {
  switch (s) {
    case 'NEW': return ['ACCEPTED','CANCELED']
    case 'ACCEPTED': return ['COOKING','CANCELED']
    case 'COOKING': return ['READY','CANCELED']
    case 'READY': return ['DELIVERED','CANCELED']
    default: return []
  }
}
async function updateStatus(row, target) {
  if (!row?._id) return
  let reason = ''
  if (target === 'CANCELED') {
    const { value } = await Swal.fire({
      icon: 'warning',
      title: 'Cancel Request',
      input: 'select',
      inputOptions: {
        'not_have': 'Not have',
        'not_enough': 'Not enough',
        'direct_message': 'Please directly message instead',
        'out_of_stock': 'Out of stock',
        'off_hours': 'Not work hour',
        'other': 'Other'
      },
      inputPlaceholder: 'Select a reason',
      showCancelButton: true,
      confirmButtonText: 'Submit',
      cancelButtonText: 'Back',
      inputValidator: (v) => !v && 'Reason required'
    })
    if (!value) return
    reason = value
  }
  try {
    const url = `/admin/food-requests/${encodeURIComponent(row._id)}/status`
    const { data: updated } = await api.patch(url, { status: target, reason })
    upsertRow(updated)
    Swal.fire({ icon:'success', title:'Updated', timer:900, showConfirmButton:false })
  } catch (e) {
    Swal.fire({ icon:'error', title:'Failed', text: e?.response?.data?.message || e.message || 'Request failed' })
  }
}

/* ───────── realtime ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(x => x._id === d._id)
  if (i === -1) rows.value.push(d)
  else rows.value[i] = d
  rebuildByDate()
}
function removeRowById(id) {
  const i = rows.value.findIndex(x => x._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  rebuildByDate()
}

/* ───────── ui actions ───────── */
function openDay(dateStr) {
  selectedDate.value = dateStr
  drawer.value = true
}
function openRow(r) {
  activeRow.value = r
  rowDialog.value = true
}
function goToday() {
  const now = dayjs()
  year.value = now.year()
  month.value = now.month()
  selectedDate.value = now.format('YYYY-MM-DD')
}
function prevMonth() {
  const d = monthStart.value.subtract(1, 'month')
  year.value = d.year(); month.value = d.month()
}
function nextMonth() {
  const d = monthStart.value.add(1, 'month')
  year.value = d.year(); month.value = d.month()
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  await loadMonth()
  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id||'')))
})
onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
})

watch([month, year], () => loadMonth())

/* step labels for detail table */
const STEP_LABEL = {
  newAt: 'NEW',
  acceptedAt: 'ACCEPTED',
  cookingAt: 'COOKING',
  readyAt: 'READY',
  deliveredAt: 'DELIVERED',
  canceledAt: 'CANCELED',
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card elevation="1" class="rounded-lg">
      <!-- simple toolbar -->
      <v-toolbar flat density="comfortable">
        <v-btn icon="mdi-chevron-left" variant="text" @click="prevMonth" />
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          {{ monthStart.format('MMMM YYYY') }}
        </v-toolbar-title>
        <v-btn icon="mdi-chevron-right" variant="text" @click="nextMonth" />
        <v-spacer />
        <v-btn :loading="loading" color="primary" class="mr-2" @click="loadMonth">Refresh</v-btn>
        <v-btn color="secondary" variant="tonal" @click="goToday">Today</v-btn>
      </v-toolbar>

      <v-divider />

      <!-- week header -->
      <div class="grid grid-cols-7 text-center py-2 weekhdr">
        <div v-for="(d,idx) in DOW" :key="d" :class="{ 'sun-hdr': idx===0 }">{{ d }}</div>
      </div>

      <!-- calendar grid -->
      <div class="grid grid-cols-7 gap-2 px-2 pb-3">
        <div
          v-for="d in gridDays"
          :key="d.date"
          class="daycell"
          :class="{
            'out-month': !d.inMonth,
            'is-today': d.date === fmtDate(new Date()),
            'is-sun': d.isSun,
            'has-orders': dayHasOrders(d.date)
          }"
          @click="openDay(d.date)"
        >
          <div class="dayhdr">
            <span class="num">{{ dayjs(d.date).date() }}</span>
            <v-chip v-if="dayHasOrders(d.date)" size="x-small" color="success" label variant="flat">
              {{ dateList(d.date).reduce((s,r)=>s+Number(r.quantity||0),0) }}
            </v-chip>
          </div>

          <!-- (minimal hint list) -->
          <div v-if="dayHasOrders(d.date)" class="mini-list">
            <div
              v-for="r in dateList(d.date).slice(0,3)"
              :key="r._id"
              class="mini-row"
            >
              <span class="txt">
                {{ r.employee?.name || '—' }} ({{ r.quantity }})
              </span>
            </div>
            <div v-if="dateList(d.date).length > 3" class="more">+{{ dateList(d.date).length - 3 }} more…</div>
          </div>
        </div>
      </div>
    </v-card>

    <!-- right drawer: day list -->
    <v-navigation-drawer v-model="drawer" location="right" width="520" temporary>
      <v-toolbar flat>
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          {{ dayjs(selectedDate).format('ddd, MMM D, YYYY') }}
        </v-toolbar-title>
        <v-spacer />
        <v-chip color="primary" label size="small" variant="flat">
          Total {{ dateList(selectedDate).reduce((s,r)=>s+Number(r.quantity||0),0) }}
        </v-chip>
      </v-toolbar>
      <v-divider />

      <v-list lines="two" class="py-0">
        <v-list-item
          v-for="r in dateList(selectedDate)"
          :key="r._id"
          :title="`${r.employee?.employeeId || ''} — ${r.employee?.name || ''}`"
          :subtitle="`${r.employee?.department || '—'} · ${r.orderType || '—'} · Time: ${fmtTimeRange(r)}`"
          link
          @click="openRow(r)"
        >
          <template #prepend>
            <v-chip :color="COLOR[r.status]" label size="small" class="mr-2">{{ r.status }}</v-chip>
          </template>
          <template #append>
            <v-chip size="small" label>Qty: {{ r.quantity }}</v-chip>
          </template>
        </v-list-item>

        <v-list-item v-if="!dateList(selectedDate).length">
          <v-list-item-title class="text-medium-emphasis">No requests on this day.</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <!-- full row detail dialog -->
    <v-dialog v-model="rowDialog" max-width="880">
      <v-card>
        <v-toolbar flat>
          <v-toolbar-title class="text-subtitle-1 font-weight-bold">
            Request {{ activeRow?.requestId || '' }}
          </v-toolbar-title>
          <v-spacer />
          <v-chip v-if="activeRow" :color="COLOR[activeRow.status]" label size="small" class="mr-2">
            {{ activeRow.status }}
          </v-chip>
          <v-btn icon="mdi-close" variant="text" @click="rowDialog = false" />
        </v-toolbar>

        <v-divider />

        <v-card-text class="pt-4">
          <v-row dense>
            <v-col cols="12" md="6">
              <div class="text-subtitle-2 mb-2">Employee</div>
              <div class="text-body-2">
                <b>{{ activeRow?.employee?.employeeId }}</b> — {{ activeRow?.employee?.name }}<br>
                Dept: {{ activeRow?.employee?.department || '—' }}
              </div>

              <div class="text-subtitle-2 mt-4 mb-2">Order</div>
              <div class="text-body-2">
                Type: {{ activeRow?.orderType || '—' }}<br>
                Meals: <span v-if="asArray(activeRow?.meals).length">{{ activeRow?.meals.join(', ') }}</span><span v-else>—</span><br>
                Quantity: <b>{{ activeRow?.quantity }}</b><br>
                Order date: {{ fmtDateTime(activeRow?.orderDate) }}<br>
                Eat date: {{ fmtDate(activeRow?.eatDate) || fmtDate(activeRow?.serveDate) || '—' }}<br>
                Time: {{ fmtTimeRange(activeRow) }}
              </div>

              <div class="text-subtitle-2 mt-4 mb-2">Location</div>
              <div class="text-body-2">
                Kind: {{ activeRow?.location?.kind || '—' }}<br>
                Other: {{ activeRow?.location?.other || '—' }}
              </div>

              <div class="text-subtitle-2 mt-4 mb-2">Notes</div>
              <div class="text-body-2">
                Special: {{ activeRow?.specialInstructions || '—' }}<br>
                Dietary other: {{ activeRow?.dietaryOther || '—' }}<br>
                Cancel reason: {{ activeRow?.cancelReason || '—' }}
              </div>

              <div class="text-subtitle-2 mt-4 mb-2">Recurring</div>
              <div class="text-body-2" v-if="activeRow?.recurring?.enabled">
                Enabled: Yes<br>
                Frequency: {{ activeRow?.recurring?.frequency || '—' }}<br>
                End date: {{ fmtDate(activeRow?.recurring?.endDate) || '—' }}<br>
                Skip holidays: {{ activeRow?.recurring?.skipHolidays ? 'Yes' : 'No' }}<br>
                Parent: {{ activeRow?.recurring?.parentId || '—' }}
              </div>
              <div class="text-body-2" v-else>Not recurring</div>
            </v-col>

            <v-col cols="12" md="6">
              <div class="text-subtitle-2 mb-2">Menu counts</div>
              <v-table density="compact" class="mb-4">
                <thead>
                  <tr><th>Choice</th><th class="text-right">Count</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(mc, i) in asArray(activeRow?.menuCounts)" :key="'mc'+i">
                    <td>{{ mc.choice }}</td>
                    <td class="text-right">{{ mc.count }}</td>
                  </tr>
                  <tr v-if="!asArray(activeRow?.menuCounts).length">
                    <td colspan="2" class="text-medium-emphasis">No explicit menu counts</td>
                  </tr>
                </tbody>
              </v-table>

              <div class="text-subtitle-2 mb-2">Dietary counts</div>
              <v-table density="compact" class="mb-4">
                <thead>
                  <tr><th>Allergen</th><th>Menu</th><th class="text-right">Count</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(dc, i) in asArray(activeRow?.dietaryCounts)" :key="'dc'+i">
                    <td>{{ dc.allergen }}</td>
                    <td>{{ dc.menu || 'Standard' }}</td>
                    <td class="text-right">{{ dc.count }}</td>
                  </tr>
                  <tr v-if="!asArray(activeRow?.dietaryCounts).length">
                    <td colspan="3" class="text-medium-emphasis">No explicit dietary counts</td>
                  </tr>
                </tbody>
              </v-table>

              <div class="text-subtitle-2 mb-2">Status history</div>
              <v-list density="compact" class="mb-3">
                <v-list-item
                  v-for="(h, i) in asArray(activeRow?.statusHistory)"
                  :key="'hst'+i"
                  :title="h.status"
                  :subtitle="`${fmtDateTime(h.at)}${h.by ? ' · by '+h.by : ''}`"
                />
                <v-list-item v-if="!asArray(activeRow?.statusHistory).length">
                  <v-list-item-title class="text-medium-emphasis">No history</v-list-item-title>
                </v-list-item>
              </v-list>

              <div class="text-subtitle-2 mb-2">Step timestamps</div>
              <v-table density="compact">
                <thead>
                  <tr><th>Step</th><th>Timestamp</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(label, key) in STEP_LABEL" :key="'stp'+key">
                    <td>{{ label }}</td>
                    <td>{{ fmtDateTime(activeRow?.stepDates?.[key]) }}</td>
                  </tr>
                </tbody>
              </v-table>

              <div class="text-subtitle-2 mt-4 mb-2">Telegram notify</div>
              <div class="text-body-2">
                Delivered at: {{ fmtDateTime(activeRow?.notified?.deliveredAt) }}
              </div>

              <div class="text-subtitle-2 mt-4 mb-2">System</div>
              <div class="text-body-2">
                Created: {{ fmtDateTime(activeRow?.createdAt) }}<br>
                Updated: {{ fmtDateTime(activeRow?.updatedAt) }}
              </div>
            </v-col>
          </v-row>

          <div class="mt-4">
            <v-chip v-for="m in asArray(activeRow?.menuChoices)" :key="'m'+m" class="mr-1 mb-1" size="small" color="primary" variant="tonal">{{ m }}</v-chip>
            <v-chip v-for="a in asArray(activeRow?.dietary)" :key="'a'+a" class="mr-1 mb-1" size="small" color="warning" variant="tonal">{{ a }}</v-chip>
          </div>
        </v-card-text>

        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-menu v-if="activeRow">
            <template #activator="{ props }">
              <v-btn variant="tonal" color="primary" v-bind="props">Change Status</v-btn>
            </template>
            <v-list>
              <v-list-item v-for="s in nextSteps(activeRow.status)" :key="s" @click="updateStatus(activeRow, s)">
                <v-list-item-title><v-icon size="small" class="mr-1">mdi-arrow-right</v-icon>{{ s }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
          <v-btn color="secondary" variant="text" @click="rowDialog=false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.weekhdr { font-weight: 600; }
.sun-hdr { color: #dc2626; } /* Sunday header red */

/* layout helpers */
.grid { display: grid; }
.grid-cols-7 { grid-template-columns: repeat(7, minmax(0, 1fr)); }

/* day cell base: WHITE (no orders) */
.daycell {
  min-height: 150px;
  background: #fff;                 /* white for no-order days */
  border: 1px solid rgba(0,0,0,.08);
  border-radius: 12px;
  padding: .5rem .6rem;
  cursor: pointer;
  display: flex; flex-direction: column;
  transition: box-shadow .15s ease, transform .05s ease, background .15s ease, border-color .15s ease;
}
.daycell:hover { box-shadow: 0 2px 10px rgba(0,0,0,.08); }

/* TODAY ring */
.is-today {
  border-color: var(--v-theme-primary);
  box-shadow: inset 0 0 0 1.5px var(--v-theme-primary);
}

/* OUT OF MONTH dim */
.out-month { opacity: .45; }

/* SUNDAY: red date number (but keep background rule) */
.is-sun .dayhdr .num { color: #dc2626; }

/* HAS ORDERS: soft green background (always green even on Sunday) */
.has-orders {
  background: rgba(22,163,74,.12);          /* green */
  border-color: rgba(22,163,74,.28);
}
.has-orders:hover { background: rgba(22,163,74,.16); }

.dayhdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:.25rem; }
.dayhdr .num { font-weight: 800; font-size: 1rem; color: #111; }

.mini-list { margin-top:.25rem; }
.mini-row { display:flex; align-items:center; font-size:.9rem; line-height:1.2; margin-bottom:.2rem; }
.more { font-size:.85rem; color: rgba(0,0,0,.6); }

@media (min-width: 1600px) {
  .daycell { min-height: 190px; }
}
</style>

<!-- src/views/admin/AdminFoodRequests.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useDisplay } from 'vuetify'
import * as XLSX from 'xlsx'            // ← NEW: Excel export

const { mdAndUp } = useDisplay()
const auth = useAuth()

/* ───────── state ───────── */
const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ALL')
const fromDate = ref('')
const toDate = ref('')
const showFilterDialog = ref(false)

const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

const statuses = ['ACTIVE','ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const COLOR = { NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({
  ...o,
  _id: String(o?._id || ''),
  requestId: String(o?.requestId || ''), // kept in data; no longer shown
  orderType: o?.orderType || '',
  quantity: Number(o?.quantity || 0),
  menuChoices: Array.isArray(o?.menuChoices) ? o.menuChoices : [],
  menuCounts: Array.isArray(o?.menuCounts) ? o.menuCounts : [],
  dietary: Array.isArray(o?.dietary) ? o.dietary : [],
  dietaryCounts: Array.isArray(o?.dietaryCounts) ? o.dietaryCounts : [],
})

/* ───────── MENU / DIETARY math ───────── */
function sumNonStandard(r) {
  return (r.menuCounts || [])
    .filter(x => x?.choice && x.choice !== 'Standard')
    .reduce((s, x) => s + Number(x.count || 0), 0)
}
function standardAuto(r) {
  return Math.max(Number(r.quantity || 0) - sumNonStandard(r), 0)
}
function menuMap(r) {
  const m = new Map()
  for (const it of (r.menuCounts || [])) {
    if (!it?.choice) continue
    const n = Number(it.count || 0)
    if (!n) continue
    m.set(it.choice, (m.get(it.choice) || 0) + n)
  }
  if (!m.has('Standard')) {
    const nonStd = Array.from(m.entries())
      .filter(([k]) => k !== 'Standard')
      .reduce((s, [, v]) => s + v, 0)
    const std = Math.max(Number(r.quantity || 0) - nonStd, 0)
    if (std > 0) m.set('Standard', std)
  }
  for (const [k, v] of m.entries()) if (!v) m.delete(k)
  return m
}
function dietaryByMenu(r) {
  const g = new Map()
  for (const d of (r.dietaryCounts || [])) {
    const menu = d?.menu || 'Standard'
    const allergen = d?.allergen
    const cnt = Number(d?.count || 0)
    if (!allergen || !cnt) continue
    if (!g.has(menu)) g.set(menu, new Map())
    const inner = g.get(menu)
    inner.set(allergen, (inner.get(allergen) || 0) + cnt)
  }
  return g
}

/* ───────── derived validations ───────── */
function totals(r) {
  const m = menuMap(r)
  const totalMenus = Array.from(m.values()).reduce((a, b) => a + b, 0)
  const leftoverMenus = Number(r.quantity || 0) - totalMenus
  const g = dietaryByMenu(r)
  const perMenuDietaryLeft = new Map()
  for (const [menu, cnt] of m.entries()) {
    const sumDiet = Array.from((g.get(menu) || new Map()).values()).reduce((a, b) => a + b, 0)
    perMenuDietaryLeft.set(menu, cnt - sumDiet)
  }
  return { totalMenus, leftoverMenus, perMenuDietaryLeft }
}

/* ───────── expand/collapse ───────── */
const expanded = ref(new Set())
const isExpanded = id => expanded.value.has(id)
function toggleExpanded(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

/* ───────── CRUD / data load ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (status.value === 'ACTIVE' && ['DELIVERED','CANCELED'].includes(d.status)) {
    if (i !== -1) rows.value.splice(i, 1)
    expanded.value.delete(d._id)
    return
  }
  if (i === -1) rows.value.unshift(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(id)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (q.value.trim()) params.set('q', q.value.trim())
    if (status.value && status.value !== 'ALL' && status.value !== 'ACTIVE') params.set('status', status.value)
    if (fromDate.value) params.set('from', fromDate.value)
    if (toDate.value) params.set('to', toDate.value)

    const { data } = await api.get(`/admin/food-requests?${params.toString()}`)
    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    if (status.value === 'ACTIVE') list = list.filter(r => !['DELIVERED','CANCELED'].includes(r.status))
    rows.value = list.map(normalize)
    page.value = 1
  } finally { loading.value = false }
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  await load()
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
watch([q, status, fromDate, toDate], () => { page.value = 1; load() })

/* ───────── paging ───────── */
const totalItems = computed(() => rows.value.length)
const totalPages = computed(() => perPage.value === 'All' ? 1 : Math.max(1, Math.ceil(totalItems.value / perPage.value)))
const pagedRows = computed(() => {
  if (perPage.value === 'All') return rows.value
  const start = (page.value - 1) * perPage.value
  return rows.value.slice(start, start + perPage.value)
})

/* ───────── workflow ───────── */
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
  if (!row?._id) {
    await Swal.fire({ icon:'error', title:'Missing _id', text:'This row has no Mongo _id. Cannot update.' })
    return
  }
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
  const before = { ...row }
  try {
    const url = `/admin/food-requests/${encodeURIComponent(row._id)}/status`
    const { data: updated } = await api.patch(url, { status: target, reason })
    upsertRow(updated)
    await Swal.fire({ icon:'success', title:'Updated', timer:900, showConfirmButton:false })
  } catch (e) {
    upsertRow(before)
    await Swal.fire({ icon:'error', title:'Failed', text: e?.response?.data?.message || e.message || 'Request failed' })
  }
}

/* ───────── mobile helpers ───────── */
function resetFilters() {
  q.value = ''
  status.value = 'ALL'
  fromDate.value = ''
  toDate.value = ''
  page.value = 1
  load()
}

/* ───────── Export to Excel ───────── */
const exporting = ref(false)

function toMainRow(r) {
  return {
    _id: r._id,
    RequestID: r.requestId || '',
    Status: r.status || '',
    OrderType: r.orderType || '',
    Quantity: r.quantity || 0,
    EmployeeID: r.employee?.employeeId || '',
    Name: r.employee?.name || '',
    Department: r.employee?.department || '',
    OrderDate: fmtDate(r.orderDate),
    EatDate: fmtDate(r.eatDate),
    Time: [r.eatTimeStart, r.eatTimeEnd].filter(Boolean).join(' – '),
    MenuChoices: Array.isArray(r.menuChoices) ? r.menuChoices.join(', ') : '',
    DietarySelected: Array.isArray(r.dietary) ? r.dietary.join(', ') : '',
    DietaryOther: r.dietaryOther || '',
    SpecialInstructions: r.specialInstructions || '',
    Recurring: r?.recurring?.enabled
      ? `${r.recurring.frequency}${r.recurring.endDate ? ' until ' + fmtDate(r.recurring.endDate) : ''}${r.recurring.skipHolidays ? ' (skip holidays)' : ''}`
      : ''
  }
}

function buildMenuRows(list) {
  const out = []
  for (const r of list) {
    const m = menuMap(r)
    for (const [menuName, count] of m.entries()) {
      out.push({
        RequestID: r.requestId || '',
        Status: r.status || '',
        EatDate: fmtDate(r.eatDate),
        Menu: menuName,
        Count: count
      })
    }
  }
  return out
}

function buildDietaryRows(list) {
  const out = []
  for (const r of list) {
    const g = dietaryByMenu(r)
    for (const [menuName, inner] of g.entries()) {
      for (const [allergen, count] of inner.entries()) {
        out.push({
          RequestID: r.requestId || '',
          Status: r.status || '',
          EatDate: fmtDate(r.eatDate),
          Menu: menuName,
          Allergen: allergen,
          Count: count
        })
      }
    }
  }
  return out
}

async function exportExcel() {
  try {
    exporting.value = true
    const list = rows.value // export all filtered rows currently loaded
    const wb = XLSX.utils.book_new()

    // Sheet 1: Requests
    const main = list.map(toMainRow)
    const wsMain = XLSX.utils.json_to_sheet(main)
    XLSX.utils.book_append_sheet(wb, wsMain, 'Requests')

    // Sheet 2: Menus
    const menuRows = buildMenuRows(list)
    const wsMenus = XLSX.utils.json_to_sheet(menuRows)
    XLSX.utils.book_append_sheet(wb, wsMenus, 'Menus')

    // Sheet 3: Dietary
    const dietRows = buildDietaryRows(list)
    const wsDiet = XLSX.utils.json_to_sheet(dietRows)
    XLSX.utils.book_append_sheet(wb, wsDiet, 'Dietary')

    // Auto-width columns (simple heuristic)
    for (const ws of [wsMain, wsMenus, wsDiet]) {
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
      const colWidths = data[0]?.map((_, c) =>
        ({ wch: Math.min(50, Math.max(...data.map(row => String(row?.[c] ?? '').length), 8)) })
      ) || []
      ws['!cols'] = colWidths
    }

    const rangeText = [
      fromDate.value ? `from_${fromDate.value}` : '',
      toDate.value ? `to_${toDate.value}` : '',
      status.value && status.value !== 'ALL' ? `status_${status.value}` : ''
    ].filter(Boolean).join('_')
    const stamp = dayjs().format('YYYYMMDD_HHmmss')
    const fname = `FoodRequests_${rangeText || 'all'}_${stamp}.xlsx`

    XLSX.writeFile(wb, fname)
  } catch (err) {
    console.error(err)
    await Swal.fire({ icon: 'error', title: 'Export failed', text: err?.message || 'Unknown error' })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card elevation="1" class="rounded-lg">
      <!-- Toolbar -->
      <v-toolbar flat density="comfortable" class="px-2">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">Food Requests</v-toolbar-title>
        <v-spacer />

        <!-- Desktop/tablet inline filters -->
        <template v-if="mdAndUp">
          <v-text-field v-model="q" density="compact" placeholder="Search"
                        hide-details variant="outlined" class="mr-2" @keyup.enter="load" style="max-width: 220px" />
          <v-select v-model="status" :items="statuses" density="compact" label="Status"
                    hide-details variant="outlined" class="mr-2" style="max-width: 160px" />
          <v-text-field v-model="fromDate" type="date" density="compact" label="From"
                        hide-details variant="outlined" class="mr-2" style="max-width: 150px" />
          <v-text-field v-model="toDate" type="date" density="compact" label="To"
                        hide-details variant="outlined" class="mr-2" style="max-width: 150px" />
          <v-select v-model="perPage" :items="perPageOptions" density="compact" label="Rows"
                    hide-details variant="outlined" style="max-width: 120px" class="mr-2" />
          <v-btn :loading="loading" color="primary" class="mr-2" @click="load">Refresh</v-btn>

          <!-- NEW: Export button -->
          <v-btn :loading="exporting" color="success" variant="flat" @click="exportExcel">
            <v-icon start>mdi-file-excel</v-icon> Export Excel
          </v-btn>
        </template>

        <!-- Mobile: compact controls -->
        <template v-else>
          <v-text-field v-model="q" density="compact" placeholder="Search"
                        hide-details variant="outlined" class="mr-2" style="max-width: 50vw" @keyup.enter="load" />
          <v-btn color="primary" variant="flat" class="mr-2" @click="showFilterDialog = true">
            Filters
          </v-btn>
          <!-- Mobile export -->
          <v-btn :loading="exporting" color="success" variant="flat" @click="exportExcel">
            <v-icon start>mdi-file-excel</v-icon> Export
          </v-btn>
        </template>
      </v-toolbar>

      <!-- Mobile Filters dialog -->
      <v-dialog v-model="showFilterDialog" fullscreen transition="dialog-bottom-transition">
        <v-card>
          <v-toolbar density="comfortable" color="primary" class="text-white">
            <v-btn icon variant="text" class="text-white" @click="showFilterDialog=false">
              <v-icon>mdi-close</v-icon>
            </v-btn>
            <v-toolbar-title>Filters</v-toolbar-title>
            <v-spacer />
            <v-btn variant="text" class="text-white" @click="resetFilters">
              <v-icon start>mdi-restore</v-icon> Reset
            </v-btn>
          </v-toolbar>

          <v-card-text>
            <v-row dense>
              <v-col cols="12">
                <v-select v-model="status" :items="statuses" label="Status"
                          variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="fromDate" type="date" label="From"
                              variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="toDate" type="date" label="To"
                              variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select v-model="perPage" :items="perPageOptions" label="Rows per page"
                          variant="outlined" density="comfortable" hide-details />
              </v-col>
            </v-row>
          </v-card-text>

          <v-card-actions class="px-4 pb-4">
            <v-btn color="grey" variant="tonal" @click="showFilterDialog=false">Close</v-btn>
            <v-spacer />
            <v-btn color="primary" @click="showFilterDialog=false; load()">Apply</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-divider />

      <v-card-text class="pa-0">
        <div class="table-wrap">
          <v-table density="comfortable" class="min-width-table">
            <thead>
              <tr>
                <th>Status</th>
                <th style="width: 320px;">Actions</th>
                <!-- Requester column (replacing old Req ID) -->
                <th>Requester (ID &amp; Name)</th>
                <th>Order Date</th>
                <th>Eat Date</th>
                <th>Time</th>
                <!-- Hide on very small screens to reduce clutter -->
                <th class="d-none d-sm-table-cell">Dept</th>
                <th class="d-none d-md-table-cell">Type</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in pagedRows" :key="r._id">
                <tr>
                  <td>
                    <v-chip :color="COLOR[r.status]" size="small" label>{{ r.status }}</v-chip>
                  </td>
                  <td>
                    <div class="mb-2">
                      <v-btn
                        v-for="s in nextSteps(r.status)" :key="s"
                        size="small" class="mr-1 mb-1"
                        :color="s==='CANCELED' ? 'red' : (s==='DELIVERED' ? 'green' : 'primary')"
                        variant="tonal"
                        :disabled="!r._id"
                        @click="updateStatus(r, s)"
                      >{{ s }}</v-btn>
                    </div>
                    <v-btn size="small" variant="text" color="secondary" @click="toggleExpanded(r._id)">
                      {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                    </v-btn>
                  </td>
                  <td>{{ r.employee?.employeeId || '—' }} — {{ r.employee?.name || '—' }}</td>
                  <td>{{ fmtDate(r.orderDate) }}</td>
                  <td>{{ fmtDate(r.eatDate) }}</td>
                  <td>{{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span></td>
                  <td class="d-none d-sm-table-cell">{{ r.employee?.department || '—' }}</td>
                  <td class="d-none d-md-table-cell">{{ r.orderType }}</td>
                  <td>{{ r.quantity }}</td>
                </tr>

                <!-- Details row -->
                <tr v-if="isExpanded(r._id)" class="details-row">
                  <td colspan="9">
                    <v-expand-transition>
                      <div class="px-3 py-2">
                        <div class="tree">
                          <div class="tree-node root">
                            <div class="node-label"><strong>Quantity</strong> {{ r.quantity }}</div>
                            <div class="children">
                              <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
                                <div class="tree-node">
                                  <div class="node-label"><span class="arrow">→</span><strong>{{ menuName }}</strong> ×{{ menuCnt }}</div>
                                  <div class="children" v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length">
                                    <div class="tree-node leaf"
                                         v-for="[allergen, aCnt] in Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries())"
                                         :key="menuName + '_' + allergen">
                                      <div class="node-label"><span class="arrow small">↳</span>{{ allergen }} ×{{ aCnt }}</div>
                                    </div>
                                  </div>
                                </div>
                              </template>
                            </div>
                          </div>

                          <div class="mt-2 text-caption">
                            <template v-if="totals(r).leftoverMenus === 0">
                              <span class="ok">✔ Menu totals match quantity</span>
                            </template>
                            <template v-else>
                              <span class="warn">⚠ Menu totals {{ totals(r).totalMenus }} differ from quantity {{ r.quantity }} (Δ {{ totals(r).leftoverMenus }})</span>
                            </template>
                          </div>
                          <div class="mt-1 text-caption">
                            <span v-for="[menuName, left] in totals(r).perMenuDietaryLeft.entries()"
                                  :key="'chk_'+menuName"
                                  class="mr-3"
                                  :class="left >= 0 ? 'ok' : 'warn'">
                              {{ menuName }}: dietary Δ {{ left }}
                            </span>
                          </div>

                          <div class="mt-2 text-caption text-medium-emphasis" v-if="r.menuChoices?.length">
                            Selected menus: {{ r.menuChoices.join(', ') }}
                          </div>
                          <div class="mt-1 text-caption" v-if="r.dietaryOther">
                            Other dietary note: {{ r.dietaryOther }}
                          </div>
                          <div class="mt-1 text-caption" v-if="r.specialInstructions">
                            Special instruction: {{ r.specialInstructions }}
                          </div>
                          <div class="mt-1 text-caption" v-if="r.recurring?.enabled">
                            Recurring: {{ r.recurring.frequency }}<span v-if="r.recurring.endDate"> until {{ fmtDate(r.recurring.endDate) }}</span><span v-if="r.recurring.skipHolidays"> (skip holidays)</span>
                          </div>
                        </div>
                      </div>
                    </v-expand-transition>
                  </td>
                </tr>
              </template>

              <tr v-if="!pagedRows.length">
                <td colspan="9" class="text-center py-6 text-medium-emphasis">No requests found.</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>

      <v-divider />
      <div class="d-flex flex-wrap align-center justify-space-between px-4 py-3 gap-2">
        <div class="text-caption text-medium-emphasis">
          Showing
          <b>{{ perPage === 'All' ? 1 : Math.min((page - 1) * perPage + 1, totalItems) }}</b>
          -
          <b>{{ perPage === 'All' ? totalItems : Math.min(page * perPage, totalItems) }}</b>
          of <b>{{ totalItems }}</b>
        </div>
        <v-select v-if="!mdAndUp" v-model="perPage" :items="perPageOptions" density="compact"
                  label="Rows" hide-details variant="outlined" style="max-width: 140px" />
        <v-pagination v-if="perPage !== 'All'" v-model="page" :length="totalPages" :total-visible="7" density="comfortable" />
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.table-wrap{ overflow-x:auto; display:block; }

/* Make inputs a bit tighter */
:deep(.v-field__input){ min-height: 36px; }

/* Table min widths; shrink a bit on phones */
.min-width-table th,.min-width-table td{ min-width:120px; white-space:nowrap; }
@media (max-width: 600px){
  .min-width-table th,.min-width-table td{ min-width: 90px; }
  .v-toolbar{ padding-left: .5rem; padding-right: .5rem; }
}

/* Details tree */
.details-row{ background: rgba(0,0,0,0.02); }
.tree{ font-size:.96rem; line-height:1.4; }
.tree .node-label{ display:inline-flex; align-items:center; gap:.4rem; padding:.2rem .5rem; border-radius:.5rem; }
.tree .root>.node-label{ background: rgba(16,185,129,.12); }
.tree .tree-node .node-label{ background: rgba(59,130,246,.10); }
.tree .leaf .node-label{ background: rgba(234,179,8,.12); }
.arrow{ font-weight:700; } .arrow.small{ opacity:.9; }
.children{ margin-left:1.2rem; padding-left:.6rem; border-left:2px dashed rgba(0,0,0,.15); margin-top:.35rem; }
.ok{ color:#16a34a; } .warn{ color:#dc2626; }

/* Display utility for table cells on small screens */
.d-none{ display:none !important; }
@media (min-width: 600px){ .d-sm-table-cell{ display: table-cell !important; } }
@media (min-width: 960px){ .d-md-table-cell{ display: table-cell !important; } }
</style>

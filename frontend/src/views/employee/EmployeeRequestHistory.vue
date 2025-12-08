<!-- src/views/employee/foodBooking/EmployeeFoodBooking.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/utils/api'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'
import * as XLSX from 'xlsx'
import { useDisplay } from 'vuetify'

const route = useRoute()
const { mdAndUp } = useDisplay()
const isMobile = computed(() => !mdAndUp.value)

/* ───────── state ───────── */
const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ALL')
const statuses = ['ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* 🔹 Single-day date filter (eat date) */
const todayStr = dayjs().format('YYYY-MM-DD')
const filterDate = ref(todayStr)

/* pagination */
const page = ref(1)
const itemsPerPage = ref(10)
const itemsPerPageOptions = [10, 20, 50, 100, 'All']

/* expand/collapse per row */
const expanded = ref(new Set())
const isExpanded = id => expanded.value.has(id)
function toggleExpanded(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

/* ───────── focus & highlight from calendar ───────── */
const focusId = ref(route.query.focus ? String(route.query.focus) : '')
const focusDate = ref(route.query.date ? String(route.query.date) : '')

function applyFocusDateFilter() {
  if (focusDate.value) {
    filterDate.value = focusDate.value
  }
}

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({ ...o, _id: String(o?._id || '') })
const dateVal = d => (d ? dayjs(d).valueOf() : 0)
const sortKey = r => Math.max(dateVal(r.orderDate), dateVal(r.createdAt), dateVal(r.eatDate))

function passFilters(doc) {
  if (!doc) return false
  if (employeeId.value && String(doc?.employee?.employeeId) !== String(employeeId.value)) return false
  if (status.value !== 'ALL' && doc.status !== status.value) return false
  if (q.value.trim()) {
    const rx = new RegExp(q.value.trim(), 'i')
    const hay = [
      doc.requestId,
      doc.orderType,
      (doc.menuChoices || []).join(', '),
      doc?.location?.kind,
      doc?.employee?.name,
      doc.specialInstructions,
      (doc.dietary || []).join(', ')
    ].filter(Boolean).join(' ')
    if (!rx.test(hay)) return false
  }
  return true
}
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (passFilters(d)) {
    if (i === -1) rows.value.unshift(d)
    else rows.value[i] = d
    rows.value = rows.value.slice().sort((a, b) => sortKey(b) - sortKey(a))
  } else if (i !== -1) {
    rows.value.splice(i, 1)
    expanded.value.delete(String(d._id))
  }
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(String(id))
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (employeeId.value) params.set('employeeId', employeeId.value)
    if (status.value !== 'ALL') params.set('status', status.value)
    if (q.value.trim()) params.set('q', q.value.trim())
    if (filterDate.value) {
      params.set('from', filterDate.value)
      params.set('to', filterDate.value) // single-day window
    }
    const { data } = await api.get(`/public/food-requests?${params.toString()}`)
    const list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    rows.value = list.map(normalize).sort((a, b) => sortKey(b) - sortKey(a))
    page.value = 1
  } finally { loading.value = false }
}

/* ───────── computed ───────── */
const filteredRows = computed(() => {
  // date already filtered at backend (from=to=filterDate)
  return rows.value.slice().sort((a, b) => sortKey(b) - sortKey(a))
})
const pagedRows = computed(() => {
  if (itemsPerPage.value === 'All') return filteredRows.value
  const start = (page.value - 1) * itemsPerPage.value
  return filteredRows.value.slice(start, start + itemsPerPage.value)
})
const pageCount = computed(() => {
  if (itemsPerPage.value === 'All') return 1
  return Math.ceil(filteredRows.value.length / itemsPerPage.value) || 1
})



/* ───────── sockets ───────── */
function registerSocket() {
  socket.on('foodRequest:created', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({
      toast:true,
      icon:'success',
      title:'New request submitted',
      position:'top',
      timer:1200,
      showConfirmButton:false
    })
  })
  socket.on('foodRequest:updated', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
  })
  socket.on('foodRequest:statusChanged', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({
      toast:true,
      icon:'info',
      title:`Status: ${doc.status}`,
      position:'top',
      timer:1200,
      showConfirmButton:false
    })
  })
  socket.on('foodRequest:deleted', ({ _id }) => {
    removeRowById(String(_id || ''))
    Swal.fire({
      toast:true,
      icon:'warning',
      title:'Request deleted',
      position:'top',
      timer:1200,
      showConfirmButton:false
    })
  })
}
function unregisterSocket() {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
}

/* ───────── lifecycle ───────── */
async function focusOnRowIfNeeded() {
  if (!focusId.value) return

  const idx = filteredRows.value.findIndex(r => r._id === focusId.value)
  if (idx === -1) return

  if (itemsPerPage.value !== 'All') {
    const per = Number(itemsPerPage.value) || 20
    page.value = Math.floor(idx / per) + 1
  } else {
    page.value = 1
  }

  await nextTick()

  setTimeout(() => {
    const el = document.querySelector(`[data-row-id="${focusId.value}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-row')
      setTimeout(() => el.classList.remove('highlight-row'), 5000)
    }
  }, 300)
}

onMounted(async () => {
  subscribeEmployeeIfNeeded()
  applyFocusDateFilter()
  await load()
  registerSocket()
  await focusOnRowIfNeeded()
})
onBeforeUnmount(() => { unregisterSocket() })

watch([q, status, filterDate], () => {
  page.value = 1
  load()
})

/* ───────── MENU/DIETARY helpers ───────── */
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
</script>

<template>
  <v-container fluid class="pa-2 employee-reqhistory-page">
    <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
      <!-- Desktop hero with filters inline -->
      <div class="hero" v-if="mdAndUp">
        <v-text-field
          v-model="q"
          density="compact"
          placeholder="Search (type, menu, note, requester)"
          clearable
          hide-details
          variant="outlined"
          class="hf-field hf-search"
          @keyup.enter="load"
        >
          <template #prepend-inner>
            <v-icon icon="mdi-magnify" size="18" />
          </template>
        </v-text-field>

        <v-select
          v-model="status"
          :items="statuses"
          density="compact"
          label="Status"
          hide-details
          variant="outlined"
          class="hf-field hf-status"
        />

        <v-text-field
          v-model="filterDate"
          type="date"
          density="compact"
          label="Eat Date"
          hide-details
          variant="outlined"
          class="hf-field hf-date"
        />
        
      </div>

      <div class="px-3 pb-3 pt-3">
        <v-card class="rounded-lg soft-card" elevation="1">
          <!-- Mobile: filters inline (1 step) -->
          <v-sheet v-if="!mdAndUp" class="px-3 pt-3 pb-3 mobile-hero">
            <v-row dense>
              <v-col cols="12">
                <v-text-field
                  v-model="q"
                  density="compact"
                  placeholder="Search (type, menu, note, requester)"
                  clearable
                  hide-details
                  variant="outlined"
                  @keyup.enter="load"
                >
                  <template #prepend-inner>
                    <v-icon icon="mdi-magnify" size="18" />
                  </template>
                </v-text-field>
              </v-col>
              <v-col cols="12">
                <v-select
                  v-model="status"
                  :items="statuses"
                  label="Status"
                  density="compact"
                  hide-details
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12">
                <v-text-field
                  v-model="filterDate"
                  type="date"
                  label="Eat Date"
                  density="compact"
                  hide-details
                  variant="outlined"
                />
              </v-col>
            </v-row>
          </v-sheet>

          <v-card-text class="pa-0">
            <!-- MOBILE: CARD LIST -->
            <div v-if="isMobile" class="mobile-list-wrap">
              <v-skeleton-loader
                v-if="loading"
                type="card@3"
                class="mb-2"
              />
              <template v-else>
                <div v-if="!pagedRows.length" class="text-center py-6 text-medium-emphasis">
                  No requests found.
                </div>
                <div v-else class="req-card-list">
                  <v-card
                    v-for="r in pagedRows"
                    :key="r._id"
                    class="req-card"
                    rounded="xl"
                    elevation="2"
                    :data-row-id="r._id"
                  >
                    <v-card-text class="py-3 px-3">
                      <!-- top: status + dates/time -->
                      <div class="card-top">
                        <div>
                          <v-chip
                            :color="{
                              NEW:'grey',
                              ACCEPTED:'primary',
                              COOKING:'orange',
                              READY:'teal',
                              DELIVERED:'green',
                              CANCELED:'red'
                            }[r.status]"
                            size="small"
                            label
                          >
                            <span>{{ r.status }}</span>
                          </v-chip>
                          <div class="text-caption text-medium-emphasis mt-1">
                            {{ fmtDate(r.orderDate) }} → {{ fmtDate(r.eatDate) }}
                          </div>
                        </div>
                        <div class="text-right">
                          <div class="card-time">
                            {{ r.eatTimeStart || '—' }}
                            <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                          </div>
                          <div class="text-caption text-medium-emphasis">
                            {{ r.orderType }}
                          </div>
                        </div>
                      </div>

                      <v-divider class="my-2" />

                      <!-- meals / qty -->
                      <div class="card-row">
                        <div class="lbl">Meal(s)</div>
                        <div class="val">
                          {{ (r.meals || []).join(', ') || '—' }}
                          <div class="text-caption text-medium-emphasis">
                            Qty: {{ r.quantity }}
                          </div>
                        </div>
                      </div>

                      <!-- location -->
                      <div class="card-row">
                        <div class="lbl">Location</div>
                        <div class="val">
                          {{ r?.location?.kind || '—' }}
                          <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
                        </div>
                      </div>

                      <!-- requester -->
                      <div class="card-row">
                        <div class="lbl">Requester</div>
                        <div class="val">
                          {{ r?.employee?.name || '—' }}
                          <div class="text-caption text-medium-emphasis">
                            ID {{ r?.employee?.employeeId || '—' }} • {{ r?.employee?.department || '—' }}
                          </div>
                        </div>
                      </div>

                      <!-- actions: details toggle -->
                      <div class="card-actions-row">
                        <v-btn
                          size="small"
                          variant="text"
                          color="primary"
                          @click="toggleExpanded(r._id)"
                        >
                          <v-icon
                            :icon="isExpanded(r._id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                            size="18"
                            class="mr-1"
                          />
                          {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                        </v-btn>
                      </div>

                      <!-- details tree inside card -->
                      <v-expand-transition>
                        <div v-if="isExpanded(r._id)" class="mt-2 card-details-tree">
                          <div class="tree">
                            <div class="tree-node root">
                              <div class="node-label two-lines">
                                <div class="en">
                                  <strong>Qty</strong> {{ r.quantity }}
                                </div>
                              </div>
                              <div class="children">
                                <template
                                  v-for="[menuName, menuCnt] in menuMap(r)"
                                  :key="menuName"
                                >
                                  <div class="tree-node">
                                    <div class="node-label two-lines">
                                      <div class="en">
                                        <span class="arrow">→</span>
                                        <strong>{{ menuName }}</strong> ×{{ menuCnt }}
                                      </div>
                                    </div>
                                    <div
                                      class="children"
                                      v-if="
                                        Array.from(
                                          (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                        ).length
                                      "
                                    >
                                      <div
                                        class="tree-node leaf"
                                        v-for="[allergen, aCnt] in Array.from(
                                          (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                        )"
                                        :key="menuName + '_' + allergen"
                                      >
                                        <div class="node-label two-lines">
                                          <div class="en">
                                            <span class="arrow small">↳</span>
                                            {{ allergen }} ×{{ aCnt }}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                              </div>
                            </div>
                          </div>
                        </div>
                      </v-expand-transition>
                    </v-card-text>
                  </v-card>
                </div>
              </template>
            </div>

            <!-- DESKTOP/TABLE -->
            <div v-else class="table-wrap">
              <v-table density="comfortable" class="min-width-table align-left comfy-cells row-hover">
                <thead>
                  <tr>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Status</div>
                      </div>
                    </th>
                    <th style="width: 120px;">
                      <div class="hdr-2l">
                        <div class="en">Details</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Requester (ID & Name)</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Order Date</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Eat Date</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Time</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Order Type</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Meal(s)</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Qty</div>
                      </div>
                    </th>
                    <th>
                      <div class="hdr-2l">
                        <div class="en">Location</div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="r in pagedRows" :key="r._id">
                    <tr :data-row-id="r._id">
                      <td>
                        <v-chip
                          :color="{
                            NEW:'grey',
                            ACCEPTED:'primary',
                            COOKING:'orange',
                            READY:'teal',
                            DELIVERED:'green',
                            CANCELED:'red'
                          }[r.status]"
                          size="small"
                          label
                        >
                          <span>{{ r.status }}</span>
                        </v-chip>
                      </td>
                      <td>
                        <v-btn
                          size="small"
                          variant="text"
                          color="secondary"
                          @click="toggleExpanded(r._id)"
                        >
                          <v-icon
                            :icon="isExpanded(r._id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                            size="18"
                            class="mr-1"
                          />
                          {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                        </v-btn>
                      </td>
                      <td>
                        {{ r?.employee?.employeeId || '—' }}
                        <span v-if="r?.employee?.name"> — {{ r.employee.name }}</span>
                      </td>
                      <td>{{ fmtDate(r.orderDate) }}</td>
                      <td>{{ fmtDate(r.eatDate) }}</td>
                      <td>
                        {{ r.eatTimeStart || '—' }}
                        <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                      </td>

                      <td>
                        <div class="cell-2l">
                          <div class="en">{{ r.orderType }}</div>
                        </div>
                      </td>

                      <td>
                        <div class="cell-2l">
                          <div class="en">{{ (r.meals || []).join(', ') }}</div>
                        </div>
                      </td>

                      <td>{{ r.quantity }}</td>
                      <td>
                        {{ r?.location?.kind }}
                        <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
                      </td>
                    </tr>

                    <tr v-if="isExpanded(r._id)" class="details-row">
                      <td colspan="10">
                        <v-expand-transition>
                          <div class="px-3 py-2">
                            <div class="tree">
                              <div class="tree-node root">
                                <div class="node-label two-lines">
                                  <div class="en">
                                    <strong>Qty</strong> {{ r.quantity }}
                                  </div>
                                </div>
                                <div class="children">
                                  <template
                                    v-for="[menuName, menuCnt] in menuMap(r)"
                                    :key="menuName"
                                  >
                                    <div class="tree-node">
                                      <div class="node-label two-lines">
                                        <div class="en">
                                          <span class="arrow">→</span>
                                          <strong>{{ menuName }}</strong> ×{{ menuCnt }}
                                        </div>
                                      </div>
                                      <div
                                        class="children"
                                        v-if="
                                          Array.from(
                                            (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                          ).length
                                        "
                                      >
                                        <div
                                          class="tree-node leaf"
                                          v-for="[allergen, aCnt] in Array.from(
                                            (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                          )"
                                          :key="menuName + '_' + allergen"
                                        >
                                          <div class="node-label two-lines">
                                            <div class="en">
                                              <span class="arrow small">↳</span>
                                              {{ allergen }} ×{{ aCnt }}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </template>
                                </div>
                              </div>
                            </div>
                          </div>
                        </v-expand-transition>
                      </td>
                    </tr>
                  </template>

                  <tr v-if="!rows.length && !loading">
                    <td colspan="10" class="text-center py-6 text-medium-emphasis">
                      No requests found.
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </div>

            <!-- pagination -->
            <div
              class="d-flex flex-wrap gap-2 justify-space-between align-center pa-3"
            >
              <v-select
                v-model="itemsPerPage"
                :items="itemsPerPageOptions"
                density="compact"
                label="Rows per page"
                hide-details
                variant="outlined"
                style="max-width:140px"
              />
              <v-pagination v-model="page" :length="pageCount" :total-visible="7" />
            </div>
          </v-card-text>
        </v-card>
      </div>
    </v-sheet>
  </v-container>
</template>

<style scoped>
.employee-reqhistory-page {}

/* section shell */
.section {
  border: 1px solid rgba(100,116,139,.18);
  background: linear-gradient(180deg, rgba(134,136,231,.06), rgba(16,185,129,.05));
  border-radius: 12px;
}

/* header with gradient */
.hero {
  display:flex;
  align-items:flex-start;
  gap: 16px;
  padding: 14px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color:#000000;
  border-bottom: 1px solid rgba(255,255,255,.25);
}

/* filters in header (desktop) */
.hf-field {
  min-width: 200px;
}
.hf-search {
  min-width: 220px;
  max-width: 260px;
}
.hf-status {
  max-width: 170px;
}
.hf-date {
  max-width: 150px;
}
.hf-icon {
  margin-left: 4px;
}

/* inner card */
.soft-card {
  border: 1px solid rgba(209,218,229,.14);
  border-radius: 12px;
  background: rgba(255,255,255,.97);
}

/* highlight when focused from calendar */
.highlight-row {
  animation: rowFlash 5s ease-in-out;
}
@keyframes rowFlash {
  0%   { background-color: #fef9c3; }
  50%  { background-color: #fef08a; }
  100% { background-color: transparent; }
}

/* wrapper */
.table-wrap{
  overflow-x:auto;
  display:block;
}

/* Inputs a bit tighter */
:deep(.v-field__input){
  min-height: 36px;
}

.hf-icon-btn {
  background: rgba(255,255,255,0.18) !important;
  border-radius: 999px;
  box-shadow: 0 1px 4px rgba(15,23,42,0.35);
}
.hf-icon-btn :deep(.v-icon) {
  color: #050505 !important;
}

.min-width-table th,
.min-width-table td{
  min-width:120px;
  white-space:nowrap;
}

/* bilingual-style helpers still ok but now only EN used */
.hdr-2l .en{
  font-weight:600;
}

/* two-line table cells */
.cell-2l{
  display:flex;
  flex-direction:column;
  line-height:1.1;
}

/* status chip two-line (only EN now) */
.chip-2l{
  display:flex;
  flex-direction:column;
  line-height:1;
}

/* details */
.details-row{
  background: rgba(0,0,0,0.02);
}
.tree{
  font-size:.96rem;
  line-height:1.4;
}
.tree .node-label{
  display:inline-flex;
  align-items:center;
  gap:.4rem;
  padding:.2rem .5rem;
  border-radius:.5rem;
}
.tree .root > .node-label{
  background: rgba(16,185,129,.12);
}
.tree .tree-node .node-label{
  background: rgba(59,130,246,.10);
}
.tree .leaf .node-label{
  background: rgba(234,179,8,.12);
}
.arrow{
  font-weight:700;
}
.arrow.small{
  opacity:.9;
}
.children{
  margin-left:1.2rem;
  padding-left:.6rem;
  border-left:2px dashed rgba(0,0,0,.15);
  margin-top:.35rem;
}

/* Left alignment + comfy spacing + hover */
.align-left :deep(table thead th),
.align-left :deep(table tbody td){
  text-align: left !important;
}

.comfy-cells :deep(table tbody td){
  vertical-align: top;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}

.comfy-cells :deep(table thead th){
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}

.row-hover :deep(table tbody tr:not(.details-row):hover){
  background: rgba(59,130,246,0.08);
  transition: background 120ms ease;
}

/* Keep inner components from centering inside cells */
.min-width-table :deep(td > *){
  justify-content: flex-start !important;
  text-align: left !important;
}

/* spacing helpers */
.mr-1 { margin-right: .25rem; }
.ml-1 { margin-left: .25rem; }

/* phone tweaks */
@media (max-width: 960px){
  .hero {
    flex-direction:column;
    align-items:flex-start;
  }
}
@media (max-width: 600px){
  .section {
    border-left:none;
    border-right:none;
    border-radius:0;
  }
  .hero {
    padding: 10px 12px;
  }
  .min-width-table th,
  .min-width-table td{
    min-width: 90px;
  }
  .table-wrap{
    -webkit-overflow-scrolling: touch;
  }
}

/* mobile hero background */
.mobile-hero {
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  border-bottom: 1px solid rgba(255,255,255,.25);
}

/* ---------- MOBILE CARD LAYOUT ---------- */
.mobile-list-wrap{
  padding: 8px 8px 4px;
}
.req-card-list{
  display:flex;
  flex-direction:column;
  gap:10px;
}
.req-card{
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: radial-gradient(circle at top left, #eff6ff 0, #ffffff 38%, #f8fafc 100%);
  box-shadow: 0 10px 24px rgba(15,23,42,0.14);
}
.card-top{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:8px;
}
.card-time{
  font-size:.9rem;
  font-weight:600;
}
.card-row{
  display:flex;
  align-items:flex-start;
  gap:8px;
  margin-top:6px;
}
.card-row .lbl{
  min-width:82px;
  font-size:.78rem;
  color:#64748b;
  padding-top:2px;
}
.card-row .val{
  font-weight:500;
  font-size:.9rem;
}
.card-actions-row{
  margin-top:10px;
}
.card-details-tree{
  margin-top:4px;
}
</style>

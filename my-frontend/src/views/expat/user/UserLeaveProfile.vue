<!-- src/views/expat/user/UserLeaveProfile.vue
  ✅ Compact summary for RequestLeave.vue
  ✅ Shows:
      - Name
      - Remaining AL + SP (1 row, compact) ✅
      - Used leave for ALL types (even used = 0) ✅
      - Contract history
  ✅ Uses your tailwind.css UI classes (ui-card/ui-frame/ui-badge/ui-divider...)
  ✅ Endpoint: /leave/user/profile
-->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'UserLeaveProfile' })

const { showToast } = useToast()

const loading = ref(false)
const error = ref('')
const data = ref({ profile: null, employee: null })

const profile = computed(() => data.value?.profile || null)

/* ✅ Prefer directory name if available, fallback to profile.name */
const name = computed(() => {
  const empName = String(data.value?.employee?.name || '').trim()
  if (empName) return empName
  return String(profile.value?.name || '').trim() || '—'
})

/* ───────────────── helpers ───────────────── */

function fmtYMD(v) {
  const s = String(v || '').trim()
  if (!s) return '—'
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD') : '—'
}

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/* ✅ USED for ALL leave types (even used = 0) */
const usedLeaves = computed(() => {
  const arr = Array.isArray(profile.value?.balances) ? profile.value.balances : []
  return arr
    .map((x) => ({
      leaveTypeCode: String(x?.leaveTypeCode || '').trim().toUpperCase(),
      used: num(x?.used),
    }))
    .filter((x) => x.leaveTypeCode)
})

/* Optional: stable order */
const ORDER = ['AL', 'SP', 'MC', 'MA', 'UL']
const usedLeavesSorted = computed(() => {
  const mapIndex = (c) => {
    const i = ORDER.indexOf(String(c || '').toUpperCase())
    return i === -1 ? 999 : i
  }
  return [...usedLeaves.value].sort((a, b) => mapIndex(a.leaveTypeCode) - mapIndex(b.leaveTypeCode))
})

/* ✅ Balance rows to compute remaining AL/SP
   - Uses backend remaining if provided
   - Else remaining = balance - used (balance/total/entitled/available/accrued)
*/
const balanceRows = computed(() => {
  const arr = Array.isArray(profile.value?.balances) ? profile.value.balances : []
  return arr
    .map((x) => {
      const leaveTypeCode = String(x?.leaveTypeCode || '').trim().toUpperCase()
      const used = num(x?.used)

      const balanceCandidate =
        x?.balance ??
        x?.total ??
        x?.entitled ??
        x?.available ??
        x?.accrued ??
        null

      const balance = num(balanceCandidate)
      const remaining = x?.remaining != null ? num(x.remaining) : num(balance - used)

      return { leaveTypeCode, used, balance, remaining }
    })
    .filter((r) => r.leaveTypeCode)
})

const remainingAL = computed(() => {
  const r = balanceRows.value.find((x) => x.leaveTypeCode === 'AL')
  return r ? num(r.remaining) : 0
})

const remainingSP = computed(() => {
  const r = balanceRows.value.find((x) => x.leaveTypeCode === 'SP')
  return r ? num(r.remaining) : 0
})

/* Contracts */
const contracts = computed(() => (Array.isArray(profile.value?.contracts) ? profile.value.contracts : []))

/* ───────────────── API ───────────────── */
async function fetchProfile() {
  loading.value = true
  error.value = ''
  try {
    const { data: res } = await api.get('/leave/user/profile')
    data.value = res || { profile: null, employee: null }
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load profile'
    showToast({ type: 'error', title: 'Profile', message: error.value })
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchProfile()
})
</script>

<template>
  <section class="ui-card">
    <!-- Header -->
    <div class="ui-hero-gradient rounded-t-2xl">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[11px] font-extrabold uppercase tracking-[0.20em] text-white/90">
            Leave Profile
          </div>
          <div class="truncate text-[14px] font-extrabold text-white">
            {{ name }}
          </div>
        </div>

        <button
          type="button"
          class="ui-btn ui-btn-xs ui-btn-ghost border border-white/30 text-white hover:bg-white/10"
          @click="fetchProfile"
          :disabled="loading"
        >
          <i class="fa-solid fa-rotate text-[10px]" :class="loading ? 'animate-spin' : ''"></i>
          <span class="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </div>

    <div class="p-3 sm:p-4">
      <!-- Error -->
      <div
        v-if="error"
        class="mb-3 rounded-xl border px-3 py-2 text-[11px]"
        style="border-color: rgb(var(--ui-danger) / 0.45); background: rgb(var(--ui-danger) / 0.08); color: rgb(var(--ui-danger));"
      >
        {{ error }}
      </div>

      <!-- Loading skeleton -->
      <div v-if="loading" class="space-y-2">
        <div class="ui-skeleton h-4 w-44"></div>
        <div class="ui-skeleton h-16 w-full"></div>
      </div>

      <template v-else>
        <!-- ✅ Remaining (AL/SP) — 1 row, compact cards -->
        <div class="flex items-center justify-between">
          <div>
            <div class="ui-section-title">Remaining</div>
            <div class="ui-section-desc">AL & SP</div>
          </div>
          <span class="ui-badge ui-badge-info">Remain</span>
        </div>

        <!-- ✅ 1 row always: 2 columns -->
        <div class="mt-2 grid grid-cols-2 gap-2">
          <!-- AL -->
          <div class="ui-frame px-2 py-1.5">
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-extrabold" style="color: rgb(var(--ui-muted));">AL</div>
              <i class="fa-solid fa-leaf text-[9px]" style="color: rgb(var(--ui-success));"></i>
            </div>
            <div class="mt-0.5 font-mono text-[14px] font-extrabold" style="color: rgb(var(--ui-fg) / 0.95);">
              {{ remainingAL }}
            </div>
            <div class="mt-0.5 text-[10px]" style="color: rgb(var(--ui-muted));">days</div>
          </div>

          <!-- SP -->
          <div class="ui-frame px-2 py-1.5">
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-extrabold" style="color: rgb(var(--ui-muted));">SP</div>
              <i class="fa-solid fa-hand-holding-heart text-[9px]" style="color: rgb(var(--ui-primary));"></i>
            </div>
            <div class="mt-0.5 font-mono text-[14px] font-extrabold" style="color: rgb(var(--ui-fg) / 0.95);">
              {{ remainingSP }}
            </div>
            <div class="mt-0.5 text-[10px]" style="color: rgb(var(--ui-muted));">days</div>
          </div>
        </div>

        <!-- ✅ Keep your original Used Leave section (ALL types) -->
        <div class="ui-divider my-3"></div>

        <div class="flex items-center justify-between">
          <div>
            <div class="ui-section-title">Used Leave</div>
            <div class="ui-section-desc">All types</div>
          </div>
          <span class="ui-badge ui-badge-info">Types: {{ usedLeavesSorted.length }}</span>
        </div>

        <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div
            v-for="r in usedLeavesSorted"
            :key="r.leaveTypeCode"
            class="ui-frame px-2 py-1.5"
          >
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-extrabold" style="color: rgb(var(--ui-muted));">
                {{ r.leaveTypeCode }}
              </div>
              <i class="fa-solid fa-chart-column text-[9px]" style="color: rgb(var(--ui-primary));"></i>
            </div>
            <div class="mt-0.5 font-mono text-[13px] font-extrabold" style="color: rgb(var(--ui-fg) / 0.95);">
              {{ num(r.used) }}
            </div>
          </div>

          <div
            v-if="!usedLeavesSorted.length"
            class="ui-frame px-2 py-1.5 text-[11px]"
            style="color: rgb(var(--ui-muted));"
          >
            No balances found.
          </div>
        </div>

        <!-- Contract history -->
        <div class="ui-divider my-3"></div>

        <div class="flex items-center justify-between">
          <div>
            <div class="ui-section-title">Contracts</div>
            <div class="ui-section-desc">History</div>
          </div>
          <span class="ui-badge ui-badge-indigo"># {{ contracts.length }}</span>
        </div>

        <div class="mt-2 space-y-2">
          <div
            v-for="c in contracts"
            :key="String(c.contractNo)"
            class="ui-frame px-2 py-1.5"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="text-[12px] font-extrabold" style="color: rgb(var(--ui-fg) / 0.95);">
                    Contract #{{ c.contractNo }}
                  </div>
                  <span class="ui-badge" :class="c.closedAt ? 'ui-badge-info' : 'ui-badge-success'">
                    {{ c.closedAt ? 'CLOSED' : 'ACTIVE' }}
                  </span>
                </div>

                <div class="mt-0.5 text-[11px]" style="color: rgb(var(--ui-muted));">
                  <span class="font-mono">{{ fmtYMD(c.startDate) }}</span>
                  <span class="mx-1 opacity-60">→</span>
                  <span class="font-mono">{{ fmtYMD(c.endDate) }}</span>
                  <span v-if="c.note" class="ml-2 opacity-70">• {{ c.note }}</span>
                </div>
              </div>

              <div class="text-right text-[10px]" style="color: rgb(var(--ui-muted));">
                <div>Opened</div>
                <div class="font-mono font-extrabold" style="color: rgb(var(--ui-fg) / 0.92);">
                  {{ c.openedBy || '—' }}
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="!contracts.length"
            class="ui-frame px-2 py-1.5 text-[11px]"
            style="color: rgb(var(--ui-muted));"
          >
            No contract history found.
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* no local styles — rely on global ui-* */
</style>

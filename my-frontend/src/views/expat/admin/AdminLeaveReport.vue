<!-- src/views/expat/admin/AdminLeaveReport.vue -->
<script setup>
import { ref } from 'vue'
import AdminManagerAndGmReport from './components/AdminManagerAndGmReport.vue'
import AdminGmAndCooReport from './components/AdminGmAndCooReport.vue'

defineOptions({ name: 'AdminLeaveReport' })

const tab = ref('MANAGER_GM') // MANAGER_GM | GM_COO
</script>

<template>
  <div class="w-full min-h-[calc(100vh-48px)]">
    <div class="w-full rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500 px-4 py-3 text-white">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Admin Leave Report</p>
            <p class="text-[11px] text-emerald-50/90">
              Split by approval mode: <span class="font-semibold">Manager + GM</span> and <span class="font-semibold">GM + COO</span>
            </p>
          </div>

          <!-- Tabs -->
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm transition
                     border border-white/25"
              :class="tab === 'MANAGER_GM' ? 'bg-white text-emerald-700' : 'bg-white/10 text-white hover:bg-white/15'"
              @click="tab = 'MANAGER_GM'"
            >
              <i class="fa-solid fa-user-tie mr-2 text-[11px]" />
              Manager + GM
            </button>

            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-sm transition
                     border border-white/25"
              :class="tab === 'GM_COO' ? 'bg-white text-emerald-700' : 'bg-white/10 text-white hover:bg-white/15'"
              @click="tab = 'GM_COO'"
            >
              <i class="fa-solid fa-user-shield mr-2 text-[11px]" />
              GM + COO
            </button>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="p-2 sm:p-3 lg:p-4 xl:p-5">
        <AdminManagerAndGmReport v-if="tab === 'MANAGER_GM'" />
        <AdminGmAndCooReport v-else />
      </div>
    </div>
  </div>
</template>

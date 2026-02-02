<!-- src/views/expat/admin/AdminLeaveReport.vue -->
<script setup>
import { ref } from 'vue'
import AdminManagerAndGmReport from './components/AdminManagerAndGmReport.vue'
import AdminGmAndCooReport from './components/AdminGmAndCooReport.vue'

defineOptions({ name: 'AdminLeaveReport' })

const tab = ref('MANAGER_GM') // MANAGER_GM | GM_COO
</script>

<template>
  <!-- Full screen -->
  <div class="ui-page min-h-screen w-full">
    <div class="w-full min-h-screen flex flex-col">
      <!-- ✅ FORCE color header (global class) -->
      <div class="ui-hero-gradient rounded-t-2xl rounded-b-none">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">
              Expat Leave
            </p>
            <p class="text-sm font-semibold text-white">Admin Leave Report</p>
            <p class="text-[11px] text-emerald-50/90">
              Split by approval mode:
              <span class="font-semibold">Manager + GM</span>
              and
              <span class="font-semibold">GM + COO</span>
            </p>
          </div>

          <!-- ✅ Tabs: use global pills so LIGHT mode never turns white/gray -->
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="ui-tabpill"
              :class="tab === 'MANAGER_GM' ? 'ui-tabpill-active' : 'ui-tabpill-inactive'"
              @click="tab = 'MANAGER_GM'"
            >
              <i class="fa-solid fa-user-tie text-[11px]" />
              Manager + GM
            </button>

            <button
              type="button"
              class="ui-tabpill"
              :class="tab === 'GM_COO' ? 'ui-tabpill-active' : 'ui-tabpill-inactive'"
              @click="tab = 'GM_COO'"
            >
              <i class="fa-solid fa-user-shield text-[11px]" />
              GM + COO
            </button>
          </div>
        </div>
      </div>

      <!-- Body (scroll like AdminExpatProfile) -->
      <div class="flex-1 overflow-y-auto ui-scrollbar px-3 sm:px-4 lg:px-6 py-3">
        <AdminManagerAndGmReport v-if="tab === 'MANAGER_GM'" />
        <AdminGmAndCooReport v-else />
      </div>
    </div>
  </div>
</template>

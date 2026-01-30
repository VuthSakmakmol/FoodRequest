<!-- src/views/GreetingPage.vue -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const servicesRef = ref(null)

/* Small helper */
const go = (name) => router.push({ name })

/* Always target employee layout for actions */
const goFood = () => go('employee-request')
const goCar  = () => go('employee-car-booking')

/* Login button → go to login page (from there they choose role/layout by account) */
const goLogin = () => go('admin-login')

/* Leave Request (Expat) → dedicated leave login */
const goLeave = () => go('leave-login')

/* Scroll to services; if missing, fallback to employee food page */
const scrollToServices = () => {
  if (servicesRef.value) {
    servicesRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else {
    goFood()
  }
}
</script>

<template>
  <div
    class="min-h-screen flex flex-col bg-gradient-to-b from-sky-50 via-slate-50 to-emerald-50
           dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 transition-colors"
  >
    <!-- HERO -->
    <header
      class="relative overflow-hidden px-4 sm:px-8 py-10 sm:py-14
             bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500
             text-white shadow-lg"
    >
      <!-- subtle radial accent -->
      <div
        class="pointer-events-none absolute inset-0 opacity-40 mix-blend-screen
               bg-[radial-gradient(circle_at_0%_0%,rgba(248,250,252,0.5),transparent_55%),radial-gradient(circle_at_100%_0%,rgba(224,231,255,0.5),transparent_55%)]"
      />

      <div class="relative z-10 max-w-6xl mx-auto grid gap-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] items-center">
        <!-- Left: content -->
        <div>
          <p class="text-[11px] sm:text-xs uppercase tracking-[0.38em] text-sky-100/90 mb-3">
            Trax Apparel Cambodia
          </p>

          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight mb-3">
            <span class="bg-gradient-to-r from-white via-amber-200 to-rose-200 bg-clip-text text-transparent">
              Trax Requestor System
            </span>
          </h1>

          <p class="text-sm sm:text-base text-sky-50/95 max-w-xl">
            Order meals, book transportation, and manage expat leave —
            all in one place.
            <span class="block mt-1 text-xs sm:text-sm text-sky-100 km-font">
              សេវាកម្មស្នើសុំទាំងអស់ នៅក្នុងប្រព័ន្ធតែមួយ។
            </span>
          </p>

          <!-- CTA buttons -->
          <div class="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              @click="goLogin"
              class="inline-flex items-center gap-2 rounded-xl bg-white text-slate-900 text-sm font-semibold px-4 py-2.5
                     shadow-[0_14px_35px_rgba(15,23,42,0.35)] hover:bg-slate-50 active:scale-[0.99] transition"
            >
              <font-awesome-icon icon="user" class="text-sky-500" />
              <span>Login</span>
            </button>

            <button
              type="button"
              @click="scrollToServices"
              class="inline-flex items-center gap-1.5 rounded-xl border border-sky-100/70 text-sky-50 text-xs sm:text-sm font-medium px-3 py-2
                     bg-white/10 hover:bg-white/15 backdrop-blur-sm transition"
            >
              <span>Explore services</span>
            </button>
          </div>

          <!-- quick badges -->
          <div class="mt-4 flex flex-wrap gap-2 text-[11px] sm:text-xs">
            <div class="inline-flex items-center gap-1.5 rounded-full bg-sky-900/30 px-3 py-1 border border-sky-100/30">
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              <span>Real-time updates</span>
            </div>
            <div class="inline-flex items-center gap-1.5 rounded-full bg-indigo-900/30 px-3 py-1 border border-indigo-100/30">
              <span class="h-1.5 w-1.5 rounded-full bg-amber-300" />
              <span>English / ខ្មែរ</span>
            </div>
            <div class="inline-flex items-center gap-1.5 rounded-full bg-emerald-900/30 px-3 py-1 border border-emerald-100/30">
              <span class="h-1.5 w-1.5 rounded-full bg-sky-300" />
              <span>Secure access</span>
            </div>
          </div>
        </div>

        <!-- Right: simple “dashboard” style preview -->
        <div class="hidden md:block">
          <div
            class="relative rounded-2xl bg-slate-950/10 backdrop-blur-md border border-sky-100/30
                   shadow-[0_18px_60px_rgba(15,23,42,0.55)] p-4"
          >
            <div class="flex items-center justify-between mb-3">
              <div>
                <p class="text-xs text-sky-100/80">Today</p>
                <p class="text-sm font-semibold text-white">Requests overview</p>
              </div>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-slate-900/40 px-3 py-1 text-[11px]">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                Live
              </span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-[11px]">
              <div class="rounded-xl bg-slate-950/40 border border-sky-100/15 px-3 py-2">
                <p class="text-sky-100/70 mb-1">Food orders</p>
                <p class="text-base font-bold text-white">128</p>
                <p class="text-[10px] text-emerald-200 mt-0.5">+12 today</p>
              </div>
              <div class="rounded-xl bg-slate-950/40 border border-emerald-100/15 px-3 py-2">
                <p class="text-sky-100/70 mb-1">Vehicle Reservation</p>
                <p class="text-base font-bold text-white">36</p>
                <p class="text-[10px] text-emerald-200 mt-0.5">3 in progress</p>
              </div>
              <div class="rounded-xl bg-slate-950/40 border border-amber-100/15 px-3 py-2">
                <p class="text-sky-100/70 mb-1">Leave (expat)</p>
                <p class="text-base font-bold text-white">9</p>
                <p class="text-[10px] text-amber-200 mt-0.5">2 pending</p>
              </div>
            </div>

            <div class="mt-3 text-[10px] text-sky-100/80 flex items-center justify-between">
              <span>Powered by Trax IT</span>
              <span>Real-time dashboard sample</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- MAIN CONTENT -->
    <main class="flex-1">
      <!-- SERVICES SECTION -->
      <section ref="servicesRef" class="px-4 sm:px-8 py-6 sm:py-8">
        <div class="max-w-6xl mx-auto">
          <div class="mb-4 sm:mb-6">
            <h2 class="text-lg sm:text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Choose what you want to do today
            </h2>
            <p class="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Food booking, Vehicle Reservation, meeting rooms (soon), and expat leave.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <!-- Food Booking -->
            <button
              type="button"
              @click="goFood"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-sky-300 hover:shadow-xl hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-600
                     dark:hover:border-sky-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden"
            >
              <div class="flex gap-4 items-center p-4 sm:p-5">
                <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-rose-400 text-slate-900 shadow-md">
                  <font-awesome-icon icon="utensils" class="text-lg" />
                </div>

                <div class="flex-1 space-y-1">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-50">
                      Food Booking
                    </span>
                    <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 text-[11px] font-medium">
                      Canteen
                    </span>
                  </div>
                  <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                    Request meals, see order history, and track daily menu.
                    <span class="block mt-0.5 text-[11px] text-slate-500 km-font">
                      កក់អាហារ និងតាមដានការកក់របស់បុគ្គលិក។
                    </span>
                  </p>
                  <div class="flex flex-wrap gap-3 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Less than 1 minute</span>
                    <span>Telegram alert</span>
                  </div>
                </div>

                <div class="hidden sm:block text-slate-400 group-hover:text-sky-500 transition">
                  <font-awesome-icon icon="home" class="text-sm" />
                </div>
              </div>
            </button>

            <!-- Car Booking -->
            <button
              type="button"
              @click="goCar"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-emerald-300 hover:shadow-xl hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-600
                     dark:hover:border-emerald-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden"
            >
              <div class="flex gap-4 items-center p-4 sm:p-5">
                <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-sky-400 text-slate-900 shadow-md">
                  <font-awesome-icon icon="car" class="text-lg" />
                </div>

                <div class="flex-1 space-y-1">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-50">
                      Vehicle Reservation
                    </span>
                    <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 text-[11px] font-medium">
                      Transportation
                    </span>
                  </div>
                  <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                    Book company car or messenger, share destinations and time.
                    <span class="block mt-0.5 text-[11px] text-slate-500 km-font">
                      កក់ឡានក្រុមហ៊ុន ឬ messenger សម្រាប់ដឹកឯកសារ។
                    </span>
                  </p>
                  <div class="flex flex-wrap gap-3 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Driver &amp; Messenger app</span>
                  </div>
                </div>

                <div class="hidden sm:block text-slate-400 group-hover:text-emerald-500 transition">
                  <font-awesome-icon icon="home" class="text-sm" />
                </div>
              </div>
            </button>

            <!-- Leave Request for Expat -->
            <button
              type="button"
              @click="goLeave"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-amber-300 hover:shadow-xl hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-600
                     dark:hover:border-amber-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden"
            >
              <div class="flex gap-4 items-center p-4 sm:p-5">
                <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-sky-400 text-slate-900 shadow-md">
                  <span class="text-sm font-semibold">LV</span>
                </div>

                <div class="flex-1 space-y-1">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-50">
                      Leave Request (Expat)
                    </span>
                    <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 text-[11px] font-medium">
                      Expat Portal
                    </span>
                  </div>
                  <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                    Submit and track leave requests for expatriate employees.
                    <span class="block mt-0.5 text-[11px] text-slate-500">
                      Annual leave, sick leave, unpaid leave and more.
                    </span>
                  </p>
                  <div class="flex flex-wrap gap-3 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Login required</span>
                    <span>Manager Telegram alert</span>
                  </div>
                </div>

                <div class="hidden sm:block text-slate-400 group-hover:text-amber-500 transition">
                  <font-awesome-icon icon="home" class="text-sm" />
                </div>
              </div>
            </button>

            <!-- Booking Meeting Room (coming soon) -->
            <div
              class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80
                     dark:bg-slate-900/60 dark:border-slate-700/80
                     text-left p-4 sm:p-5 flex gap-4 items-center opacity-80"
            >
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-emerald-400 text-slate-900 shadow-md">
                <span class="text-sm font-semibold">MR</span>
              </div>
              <div class="flex-1 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-100">
                    Booking Meeting Room
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                    In development
                  </span>
                </div>
                <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                  Book meeting rooms for internal discussions and visitors.
                  <span class="block mt-0.5 text-[11px] text-slate-500">Coming soon.</span>
                </p>
              </div>
            </div>

            <!-- OT Approve (in development) -->
            <div
              class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80
                     dark:bg-slate-900/60 dark:border-slate-700/80
                     text-left p-4 sm:p-5 flex gap-4 items-center opacity-80"
            >
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-rose-400 to-amber-400 text-slate-900 shadow-md">
                <span class="text-sm font-semibold">OT</span>
              </div>
              <div class="flex-1 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-100">
                    OT Approve
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                    In development
                  </span>
                </div>
                <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                  Approve overtime requests with role-based workflow.
                  <span class="block mt-0.5 text-[11px] text-slate-500">Coming soon.</span>
                </p>
              </div>
            </div>

            <!-- Factory Security (in development) -->
            <div
              class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80
                     dark:bg-slate-900/60 dark:border-slate-700/80
                     text-left p-4 sm:p-5 flex gap-4 items-center opacity-80"
            >
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-400 to-emerald-400 text-slate-900 shadow-md">
                <span class="text-sm font-semibold">FS</span>
              </div>
              <div class="flex-1 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-100">
                    Factory Security
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                    In development
                  </span>
                </div>
                <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                  Visitor logs, gate pass, and security approvals.
                  <span class="block mt-0.5 text-[11px] text-slate-500">Coming soon.</span>
                </p>
              </div>
            </div>

            <!-- Auto Email for New comer (in development) -->
            <div
              class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80
                     dark:bg-slate-900/60 dark:border-slate-700/80
                     text-left p-4 sm:p-5 flex gap-4 items-center opacity-80"
            >
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-400 text-slate-900 shadow-md">
                <span class="text-sm font-semibold">AE</span>
              </div>
              <div class="flex-1 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-100">
                    Auto Email for New comer
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                    In development
                  </span>
                </div>
                <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                  Send onboarding emails automatically when a new employee is created.
                  <span class="block mt-0.5 text-[11px] text-slate-500">Coming soon.</span>
                </p>
              </div>
            </div>

            <!-- Stationary management (in development) -->
            <div
              class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80
                     dark:bg-slate-900/60 dark:border-slate-700/80
                     text-left p-4 sm:p-5 flex gap-4 items-center opacity-80"
            >
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-amber-400 text-slate-900 shadow-md">
                <span class="text-sm font-semibold">SM</span>
              </div>
              <div class="flex-1 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm sm:text-base font-semibold text-slate-700 dark:text-slate-100">
                    Stationary management
                  </span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                    In development
                  </span>
                </div>
                <p class="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300">
                  Request office supplies and track stock levels by department.
                  <span class="block mt-0.5 text-[11px] text-slate-500">Coming soon.</span>
                </p>
              </div>
            </div>

            
          </div>
        </div>
      </section>

      <!-- Feature strip -->
      <section class="px-4 sm:px-8 pb-6 sm:pb-8">
        <div class="max-w-6xl mx-auto">
          <div class="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:bg-slate-900/80 dark:border-slate-700">
            <div class="grid gap-2 sm:grid-cols-2 text-xs sm:text-sm">
              <div class="inline-flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 shadow-sm border border-slate-200 dark:bg-slate-800 dark:border-slate-600">
                <span class="h-1.5 w-1.5 rounded-full bg-sky-500" />
                <span>Telegram alerts for key roles (Admin, Chef, Driver, Messenger)</span>
              </div>
              <div class="inline-flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 shadow-sm border border-slate-200 dark:bg-slate-800 dark:border-slate-600">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>Data stored securely in the company’s infrastructure</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- FOOTER -->
    <footer class="border-t border-slate-200 bg-slate-50/90 dark:border-slate-800 dark:bg-slate-950/90">
      <div
        class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-center gap-2 text-[11px] sm:text-xs
               text-slate-600 dark:text-slate-400"
      >
        <span>© {{ new Date().getFullYear() }} Trax Apparel Cambodia</span>
        <span class="opacity-40">•</span>
        <a href="mailto:it@traxapparel.com" class="underline-offset-2 hover:underline">
          IT Support: it@traxapparel.com
        </a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.km-font {
  font-family: "Kantumruy Pro", system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Khmer OS Siemreap",
    sans-serif;
}
</style>

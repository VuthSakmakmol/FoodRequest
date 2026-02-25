<!-- src/views/GreetingPage.vue -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const servicesRef = ref(null)

const go = (name) => router.push({ name })

const goFood = () => go('employee-request')
const goCar  = () => go('employee-car-booking')
const goLogin = () => go('admin-login')

const goLeaveRequest = () => go('leave-start-request')
const goSwapDay      = () => go('leave-start-swap-day')
const goForgetScan   = () => go('leave-start-forget-scan')

const scrollToServices = () => {
  if (servicesRef.value) servicesRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  else goFood()
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
      <div
        class="pointer-events-none absolute inset-0 opacity-40 mix-blend-screen
               bg-[radial-gradient(circle_at_0%_0%,rgba(248,250,252,0.5),transparent_55%),radial-gradient(circle_at_100%_0%,rgba(224,231,255,0.5),transparent_55%)]"
      />

      <div
        class="relative z-10 max-w-6xl mx-auto grid gap-8
               md:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] items-center"
      >
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
            <span class="block mt-1 text-xs sm:text-sm text-sky-100 font-kh" lang="km">
              សេវាកម្មស្នើសុំទាំងអស់ នៅក្នុងប្រព័ន្ធតែមួយ។
            </span>
          </p>

          <div class="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              @click="goLogin"
              class="inline-flex items-center gap-2 rounded-xl bg-white text-slate-900 text-sm font-semibold px-4 py-2.5
                     shadow-[0_14px_35px_rgba(15,23,42,0.35)] hover:bg-slate-50 active:scale-[0.99] transition"
            >
              <i class="fa-solid fa-user text-sky-500"></i>
              <span>Login</span>
            </button>

            <button
              type="button"
              @click="scrollToServices"
              class="inline-flex items-center gap-1.5 rounded-xl border border-sky-100/70 text-sky-50 text-xs sm:text-sm font-medium px-3 py-2
                     bg-white/10 hover:bg-white/15 backdrop-blur-sm transition"
            >
              <span>Explore services</span>
              <i class="fa-solid fa-arrow-down text-[12px] opacity-90"></i>
            </button>
          </div>

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

        <!-- Right preview -->
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
              </div>
              <div class="rounded-xl bg-slate-950/40 border border-emerald-100/15 px-3 py-2">
                <p class="text-sky-100/70 mb-1">Vehicle Reservation</p>
                <p class="text-base font-bold text-white">36</p>
              </div>
              <div class="rounded-xl bg-slate-950/40 border border-amber-100/15 px-3 py-2">
                <p class="text-sky-100/70 mb-1">Leave (expat)</p>
                <p class="text-base font-bold text-white">9</p>
              </div>
            </div>

            <div class="mt-3 text-[10px] text-sky-100/80 flex items-center justify-between">
              <span>Powered by Trax IT</span>
              <span>Dashboard sample</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- MAIN -->
    <main class="flex-1">
      <!-- SERVICES -->
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

          <!-- ✅ 1 col mobile / 2 col sm / 3 col lg -->
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <!-- Card template: icon + title + status -->

            <!-- Food Booking -->
            <button
              type="button"
              @click="goFood"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-sky-300 hover:shadow-lg hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-700
                     dark:hover:border-sky-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden w-full h-[98px]"
            >
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-utensils text-[22px]"></i>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      Food Booking
                    </p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2.5 py-1 text-[11px] font-semibold">
                      Canteen
                    </span>
                  </div>
                </div>
              </div>
            </button>

            <!-- Vehicle Reservation -->
            <button
              type="button"
              @click="goCar"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-emerald-300 hover:shadow-lg hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-700
                     dark:hover:border-emerald-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden w-full h-[98px]"
            >
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-sky-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-car text-[22px]"></i>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      Vehicle Reservation
                    </p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2.5 py-1 text-[11px] font-semibold">
                      Transport
                    </span>
                  </div>
                </div>
              </div>
            </button>

            <!-- Leave Request -->
            <button
              type="button"
              @click="goLeaveRequest"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-amber-300 hover:shadow-lg hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-700
                     dark:hover:border-amber-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden w-full h-[98px]"
            >
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-sky-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-calendar-check text-[22px]"></i>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      Leave Request
                    </p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2.5 py-1 text-[11px] font-semibold">
                      Expat
                    </span>
                  </div>
                </div>
              </div>
            </button>

            <!-- Swap Working Day -->
            <button
              type="button"
              @click="goSwapDay"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-indigo-300 hover:shadow-lg hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-700
                     dark:hover:border-indigo-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden w-full h-[98px]"
            >
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-emerald-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-right-left text-[22px]"></i>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      Swap Working Day
                    </p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2.5 py-1 text-[11px] font-semibold">
                      Expat
                    </span>
                  </div>
                </div>
              </div>
            </button>

            <!-- Forget Scan -->
            <button
              type="button"
              @click="goForgetScan"
              class="group text-left rounded-2xl border border-slate-200 bg-white/90
                     hover:border-rose-300 hover:shadow-lg hover:bg-white
                     dark:bg-slate-900/80 dark:border-slate-700
                     dark:hover:border-rose-400/80 dark:hover:bg-slate-900
                     transition overflow-hidden w-full h-[98px]"
            >
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-400 to-amber-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-fingerprint text-[22px]"></i>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      Forget Scan
                    </p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200 px-2.5 py-1 text-[11px] font-semibold">
                      Expat
                    </span>
                  </div>
                </div>
              </div>
            </button>

            <!-- Coming soon cards -->
            <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 dark:bg-slate-900/60 dark:border-slate-700/80 w-full h-[98px] opacity-80">
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-emerald-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-people-roof text-[22px]"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-700 dark:text-slate-100 truncate">Meeting Room</p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2.5 py-1 text-[11px] font-semibold">
                      In dev
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 dark:bg-slate-900/60 dark:border-slate-700/80 w-full h-[98px] opacity-80">
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-400 to-amber-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-clock text-[22px]"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-700 dark:text-slate-100 truncate">OT Approve</p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2.5 py-1 text-[11px] font-semibold">
                      In dev
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 dark:bg-slate-900/60 dark:border-slate-700/80 w-full h-[98px] opacity-80">
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-400 to-emerald-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-shield-halved text-[22px]"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-700 dark:text-slate-100 truncate">Factory Security</p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2.5 py-1 text-[11px] font-semibold">
                      In dev
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 dark:bg-slate-900/60 dark:border-slate-700/80 w-full h-[98px] opacity-80">
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-envelope text-[22px]"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-700 dark:text-slate-100 truncate">Auto Email</p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2.5 py-1 text-[11px] font-semibold">
                      In dev
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 dark:bg-slate-900/60 dark:border-slate-700/80 w-full h-[98px] opacity-80">
              <div class="h-full px-5 py-4 flex items-center gap-4">
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-amber-400 text-slate-900 shadow-md">
                  <i class="fa-solid fa-box-archive text-[22px]"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-base font-extrabold text-slate-700 dark:text-slate-100 truncate">Stationary</p>
                    <span class="shrink-0 inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 px-2.5 py-1 text-[11px] font-semibold">
                      In dev
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <!-- Feature strip -->
      <section class="px-4 sm:px-8 pb-6 sm:pb-8">
        <div class="max-w-6xl mx-auto">
          <div class="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:bg-slate-900/80 dark:border-slate-700">
            <div class="grid grid-cols-2 gap-2 text-[11px] sm:text-sm">
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
          IT Support: sakmakmol.vut@traxapparel.com (0979866163)
        </a>
      </div>
    </footer>
  </div>
</template>
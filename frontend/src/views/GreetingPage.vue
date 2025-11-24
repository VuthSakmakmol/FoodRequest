<!-- src/views/GreetingPage.vue -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const go = (name) => router.push({ name })

const servicesRef = ref(null)
const scrollToServices = () => {
  if (servicesRef.value) {
    servicesRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else {
    // fallback: go to main food request page
    go('employee-request')
  }
}
</script>

<template>
  <div class="page-wrap">
    <!-- HERO -->
    <header class="hero">
      <div class="blob blob-1" />
      <div class="blob blob-2" />

      <div class="hero-content">
        <h1 class="hero-title">
          <span class="grad-text">Trax Requestor System</span>
        </h1>
        <p class="hero-sub">
          Order meals, book transportation, and manage tasks — all in one place.
          <span class="km">សេវាកម្មទាំងអស់ ក្នុងប្រព័ន្ធតែមួយ</span>
        </p>

        <div class="hero-cta">
          <v-btn
            size="large"
            color="white"
            class="cta-btn"
            @click="scrollToServices"
          >
            <i class="fa-solid fa-rocket mr-2" /> Get Started
            <span class="km ml-2">ចាប់ផ្តើម</span>
          </v-btn>
        </div>

        <div class="quick-badges">
          <v-chip size="small" variant="elevated" color="cyan">
            <i class="fa-solid fa-bolt mr-2" /> Real-time
          </v-chip>
          <v-chip size="small" variant="elevated" color="pink">
            <i class="fa-solid fa-language mr-2" /> English / ខ្មែរ
          </v-chip>
          <v-chip size="small" variant="elevated" color="lime">
            <i class="fa-solid fa-shield-halved mr-2" /> Secure
          </v-chip>
        </div>
      </div>


    </header>

    <!-- MAIN CONTENT -->
    <main class="content">
      <!-- SERVICES SECTION -->
      <section ref="servicesRef" class="services">
        <v-container class="py-8">
          <div class="services-header">
            <h2 class="services-title">
              Choose what you want to do today
            </h2>
          </div>

          <v-row class="services-grid" dense>
            <!-- Food Booking -->
            <v-col cols="12" md="6">
              <v-card
                class="service-card"
                rounded="xl"
                elevation="4"
                @click="go('employee-request')"
              >
                <div class="service-card-inner">
                  <div class="icon-pill food">
                    <i class="fa-solid fa-bowl-rice" />
                  </div>
                  <div class="service-text">
                    <div class="service-label-row">
                      <span class="service-label">Food Booking</span>
                      <span class="service-chip">
                        <i class="fa-solid fa-utensils mr-1" /> Canteen
                      </span>
                    </div>
                    <div class="service-subtitle">
                      Request meals, see order history, and track daily menu.
                      <span class="km">
                        កក់បាយ និងតាមដានការកក់របស់បុគ្គលិក។
                      </span>
                    </div>
                    <div class="service-meta">
                      <span><i class="fa-solid fa-clock mr-1" /> Less than 1 min</span>
                      <span><i class="fa-solid fa-bell mr-1" /> Telegram alert</span>
                    </div>
                  </div>
                  <div class="service-arrow">
                    <i class="fa-solid fa-arrow-right-long" />
                  </div>
                </div>
              </v-card>
            </v-col>

            <!-- Car Booking -->
            <v-col cols="12" md="6">
              <v-card
                class="service-card"
                rounded="xl"
                elevation="4"
                @click="go('employee-car-booking')" 
              >
                <div class="service-card-inner">
                  <div class="icon-pill transport">
                    <i class="fa-solid fa-car" />
                  </div>
                  <div class="service-text">
                    <div class="service-label-row">
                      <span class="service-label">Car Booking</span>
                      <span class="service-chip">
                        <i class="fa-solid fa-road mr-1" /> Transportation
                      </span>
                    </div>
                    <div class="service-subtitle">
                      Book company car or messenger, share destinations and time.
                      <span class="km">
                        កក់ឡានក្រុមហ៊ុន ឬ messenger សម្រាប់ដឹកឯកសារ និងទំនិញ។
                      </span>
                    </div>
                    <div class="service-meta">
                      <span><i class="fa-solid fa-circle-nodes mr-1" /> Real-time status</span>
                      <span><i class="fa-solid fa-users mr-1" /> Driver &amp; Messenger app</span>
                    </div>
                  </div>
                  <div class="service-arrow">
                    <i class="fa-solid fa-arrow-right-long" />
                  </div>
                </div>
              </v-card>
            </v-col>
          </v-row>
        </v-container>
      </section>

      <!-- Feature strip (keep) -->
      <v-container class="py-6">
        <v-sheet class="feature-strip" rounded="lg" elevation="1">
          <div class="stripe">
            <div class="chip">
              <i class="fa-brands fa-telegram" /> Telegram Alerts
            </div>
            <div class="chip">
              <i class="fa-solid fa-chart-line" /> Live Dashboard
            </div>
            <div class="chip">
              <i class="fa-solid fa-database" /> Secure Database
            </div>
          </div>
        </v-sheet>
      </v-container>
    </main>

    <!-- FOOTER -->
    <footer class="footer">
      <div class="foot-inner">
        <span>© {{ new Date().getFullYear() }} Trax Apparel Cambodia</span>
        <span class="sep">•</span>
        <a href="mailto:it@traxapparel.com" class="foot-link">
          <i class="fa-solid fa-envelope" /> IT Support
        </a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* --- Layout --- */
.page-wrap {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: linear-gradient(180deg, #f7fbff 0%, #f7fff9 100%);
}

/* --- HERO --- */
.hero {
  position: relative;
  overflow: hidden;
  padding: clamp(20px, 4vw, 40px);
  display: grid;
  grid-template-columns: 1.15fr .85fr;
  gap: clamp(18px, 3vw, 32px);
  align-items: center;
  background:
    radial-gradient(1200px 420px at 10% 0%, rgba(56,189,248,.25), transparent 60%),
    radial-gradient(900px 360px at 100% 20%, rgba(192,132,252,.22), transparent 60%),
    linear-gradient(90deg, #0ea5e9 0%, #6366f1 55%, #a855f7 100%);
  color: #fff;
}
@media (max-width: 1080px) {
  .hero { grid-template-columns: 1fr; }
}

.hero-content { position: relative; z-index: 2; }
.hero-title {
  margin: 0 0 8px;
  font-size: clamp(24px, 3.2vw, 40px);
  font-weight: 900;
  line-height: 1.05;
}
.grad-text {
  background: linear-gradient(90deg, #fff, #fef08a, #fca5a5);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub {
  margin: 8px 0 16px;
  font-size: clamp(14px, 1.4vw, 18px);
  opacity: .95;
}
.hero-sub .km { display: block; opacity: .9; }

.hero-cta { margin: 12px 0 18px; }
.cta-btn {
  font-weight: 700;
  color: #0f172a !important;
  box-shadow: 0 6px 22px rgba(0,0,0,.2);
}
.quick-badges {
  display: flex; gap: 8px; flex-wrap: wrap;
  margin-top: 8px;
}

/* HERO image */
.hero-image { position: relative; z-index: 2; min-height: 240px; }
.img-mask {
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(2,6,23,.35);
  border: 1px solid rgba(255,255,255,.35);
  transform: perspective(800px) rotateY(-6deg) rotateX(2deg);
}

/* Decorative blobs */
.blob {
  position: absolute; filter: blur(40px); opacity: .6; z-index: 1;
}
.blob-1 {
  width: 340px; height: 340px; right: -60px; bottom: -80px;
  background: radial-gradient(circle at 30% 30%, #22d3ee, transparent 60%),
              radial-gradient(circle at 70% 70%, #a78bfa, transparent 60%);
}
.blob-2 {
  width: 260px; height: 260px; left: -40px; top: -40px;
  background: radial-gradient(circle at 70% 30%, #f472b6, transparent 60%),
              radial-gradient(circle at 30% 70%, #34d399, transparent 60%);
}

/* --- Services section --- */
.services {
  margin-top: -12px;
}
.services-header {
  text-align: left;
  margin-bottom: 14px;
}
.badge-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  background: rgba(15,23,42,.04);
  color: #0f172a;
}
.services-title {
  margin: 10px 0 4px;
  font-size: clamp(20px, 2.2vw, 28px);
  font-weight: 700;
  color: #020617;
}
.services-sub {
  margin: 0;
  font-size: 0.92rem;
  color: #6b7280;
  max-width: 520px;
}

.services-grid {
  margin-top: 12px;
}

/* service card */
.service-card {
  cursor: pointer;
  border-radius: 20px;
  background: radial-gradient(circle at 0% 0%, #e0f2fe 0, transparent 55%),
              radial-gradient(circle at 100% 0%, #ede9fe 0, transparent 55%),
              #ffffff;
  border: 1px solid rgba(15,23,42,.06);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
}
.service-card-inner {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 16px;
  padding: 18px 20px;
  align-items: center;
}
.service-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 34px rgba(15,23,42,.16);
  border-color: rgba(59,130,246,.55);
}

.icon-pill {
  width: 54px;
  height: 54px;
  border-radius: 18px;
  display:flex;
  align-items:center;
  justify-content:center;
  color:#fff;
  font-size: 24px;
}
.icon-pill.food {
  background: linear-gradient(135deg,#f97316,#ef4444);
}
.icon-pill.transport {
  background: linear-gradient(135deg,#22c55e,#14b8a6);
}

.service-text {
  display:flex;
  flex-direction:column;
  gap:6px;
}
.service-label-row {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}
.service-label {
  font-weight:800;
  font-size:1.05rem;
  color:#020617;
}
.service-chip {
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:3px 8px;
  border-radius:999px;
  font-size:.75rem;
  font-weight:700;
  background:rgba(15,23,42,.06);
  color:#374151;
}
.service-subtitle {
  font-size:0.9rem;
  color:#4b5563;
}
.service-subtitle .km {
  display:block;
  font-size:0.85rem;
  color:#6b7280;
  margin-top:2px;
}
.service-meta {
  display:flex;
  flex-wrap:wrap;
  gap:12px;
  margin-top:4px;
  font-size:0.8rem;
  color:#6b7280;
}
.service-meta i {
  color:#2563eb;
}

.service-arrow {
  font-size:1.2rem;
  color:#475569;
}

/* Content general */
.content { position: relative; }

/* Feature strip */
.feature-strip {
  margin-top: 8px;
  padding: 14px;
  background: linear-gradient(90deg, rgba(2,6,23,.02), rgba(2,6,23,.04));
  border: 1px solid rgba(2,6,23,.06);
}
.stripe {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.chip {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 12px; font-weight: 700;
  background: #fff; box-shadow: 0 6px 20px rgba(2,6,23,.06);
  border: 1px solid rgba(2,6,23,.06);
}

/* Footer */
.footer {
  padding: 18px;
  background: linear-gradient(180deg, rgba(99,102,241,.08), rgba(14,165,233,.08));
  border-top: 1px solid rgba(2,6,23,.06);
}
.foot-inner {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  flex-wrap: wrap; font-weight: 600; color: #0f172a;
}
.foot-link { color: #0f172a; text-decoration: none; }
.sep { opacity: .5; }

/* Utility */
.km {
  font-family: "Kantumruy Pro", system-ui, -apple-system, Segoe UI, Roboto,
    "Helvetica Neue", Arial, "Noto Sans", "Khmer OS Siemreap", sans-serif;
}
.mr-1 { margin-right: .25rem; }
.mr-2 { margin-right: .5rem; }
.ml-2 { margin-left: .5rem; }

/* Mobile tweaks */
@media (max-width: 768px) {
  .service-card-inner {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
  }
  .service-arrow {
    display:none;
  }
}
</style>

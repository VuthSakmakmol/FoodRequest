<!-- src/views/GreetingPage.vue -->
<script setup>
import { useRouter } from 'vue-router'
const router = useRouter()

const go = (name) => router.push({ name })
</script>

<template>
  <div class="page-wrap">
    <!-- HERO -->
    <header class="hero">
      <div class="hero-content">
        <h1 class="hero-title">
          <span class="grad-text">Welcome to Trax Services</span>
          <small class="km">ស្វាគមន៍មកកាន់ប្រព័ន្ធសេវាកម្ម</small>
        </h1>
        <p class="hero-sub">
          Order meals, book transportation, and manage tasks — all in one place.
          <span class="km">បញ្ជា​អាហារ កក់ឡាន និងគ្រប់គ្រងការងារ — នៅកន្លែងតែមួយ។</span>
        </p>

        <div class="hero-cta">
          <v-btn size="large" color="white" class="cta-btn" @click="go('employee-request')">
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

      <div class="hero-image">
        <!-- You can replace this with your own asset in /public or a CDN -->
        <v-img
          src="https://images.unsplash.com/photo-1553095066-5014bc7b7f2d?q=80&w=1600&auto=format&fit=crop"
          alt="Office teamwork illustration"
          cover
          class="img-mask"
        />
      </div>

      <!-- Decorative blobs -->
      <div class="blob blob-1" />
      <div class="blob blob-2" />
    </header>

    <!-- CARDS -->
    <main class="content">
      <v-container class="py-6">
        <v-row class="greet-grid" align="stretch">
          <!-- Employee -->
          <v-col cols="12" sm="6" md="3">
            <v-card class="greet-card" variant="elevated">
              <div class="card-icon employee">
                <i class="fa-solid fa-user-tie" />
              </div>
              <v-card-title class="card-title">
                Employee <div class="km">បុគ្គលិក</div>
              </v-card-title>
              <v-card-text class="card-text">
                Request meals and book cars quickly.
                <div class="km">ស្នើសុំអាហារ និងកក់ឡានបានរៀបរយ។</div>
              </v-card-text>
              <v-card-actions class="justify-end">
                <v-btn color="primary" variant="flat" @click="go('employee-request')">
                  <i class="fa-solid fa-right-to-bracket mr-2" /> Enter
                  <span class="km ml-2">ចូល</span>
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>

          <!-- Admin -->
          <v-col cols="12" sm="6" md="3">
            <v-card class="greet-card" variant="elevated">
              <div class="card-icon admin">
                <i class="fa-solid fa-shield-heart" />
              </div>
              <v-card-title class="card-title">
                Admin <div class="km">អ្នកគ្រប់គ្រង</div>
              </v-card-title>
              <v-card-text class="card-text">
                Manage requests, schedules, and statuses.
                <div class="km">គ្រប់គ្រងសំណើ កាលវិភាគ និងស្ថានភាព។</div>
              </v-card-text>
              <v-card-actions class="justify-end">
                <v-btn color="deep-purple-accent-3" variant="flat" @click="go('admin-login')">
                  <i class="fa-solid fa-door-open mr-2" /> Sign in
                  <span class="km ml-2">ចូលប្រព័ន្ធ</span>
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>

          <!-- Driver -->
          <v-col cols="12" sm="6" md="3">
            <v-card class="greet-card" variant="elevated">
              <div class="card-icon driver">
                <i class="fa-solid fa-steering-wheel" />
              </div>
              <v-card-title class="card-title">
                Driver <div class="km">អ្នកបើកបរ</div>
              </v-card-title>
              <v-card-text class="card-text">
                View trips and update progress.
                <div class="km">មើលដំណើរ និងអាប់ដេតវឌ្ឍនា។</div>
              </v-card-text>
              <v-card-actions class="justify-end">
                <v-btn color="teal" variant="flat" @click="go('driver-home')">
                  <i class="fa-solid fa-location-arrow mr-2" /> Open
                  <span class="km ml-2">បើក</span>
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>

          <!-- Messenger -->
          <v-col cols="12" sm="6" md="3">
            <v-card class="greet-card" variant="elevated">
              <div class="card-icon messenger">
                <i class="fa-solid fa-motorcycle" />
              </div>
              <v-card-title class="card-title">
                Messenger <div class="km">អ្នកដឹកសារ</div>
              </v-card-title>
              <v-card-text class="card-text">
                Track delivery tasks and confirm arrival.
                <div class="km">តាមដានភារកិច្ច និងបញ្ជាក់ការមកដល់។</div>
              </v-card-text>
              <v-card-actions class="justify-end">
                <v-btn color="orange-darken-2" variant="flat" @click="go('messenger-home')">
                  <i class="fa-solid fa-person-running mr-2" /> Proceed
                  <span class="km ml-2">បន្ត</span>
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>

        <!-- Feature strip -->
        <v-sheet class="feature-strip" rounded="lg" elevation="1">
          <div class="stripe">
            <div class="chip">
              <i class="fa-solid fa-bell" /> Web Notifications
            </div>
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
.hero-title .km {
  display: block;
  font-size: .55em;
  font-weight: 700;
  opacity: .95;
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

/* --- Content --- */
.content { position: relative; margin-top: -16px; }
.greet-grid { row-gap: 18px; }

.greet-card {
  height: 100%;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(2,6,23,.06);
  backdrop-filter: blur(4px);
  background: linear-gradient(180deg, rgba(255,255,255,.9), rgba(255,255,255,.8));
}
.card-title {
  font-weight: 900;
  display: flex; flex-direction: column;
  gap: 2px;
}
.card-title .km { font-size: .78rem; font-weight: 700; opacity: .8; }
.card-text { opacity: .9; }
.card-icon {
  height: 84px;
  display:flex; align-items:center; justify-content:center;
  font-size: 34px; color: #fff;
}
.card-icon.employee  { background: linear-gradient(90deg, #0ea5e9, #60a5fa); }
.card-icon.admin     { background: linear-gradient(90deg, #7c3aed, #a78bfa); }
.card-icon.driver    { background: linear-gradient(90deg, #14b8a6, #22d3ee); }
.card-icon.messenger { background: linear-gradient(90deg, #fb923c, #f97316); }

/* Feature strip */
.feature-strip {
  margin-top: 24px;
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
.km { font-family: "Kantumruy Pro", system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Khmer OS Siemreap", sans-serif; }
.mr-2 { margin-right: .5rem; } .ml-2 { margin-left: .5rem; }
</style>

import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/store/auth'

// Layouts
const EmployeeLayout   = () => import('@/layouts/EmployeeLayout.vue')
const AdminLayout      = () => import('@/layouts/AdminLayout.vue')
const DriverLayout     = () => import('@/layouts/DriverLayout.vue')
const MessengerLayout  = () => import('@/layouts/MessengerLayout.vue')

// Employee pages
const EmployeeHome         = () => import('@/views/employee/EmployeeHome.vue')
const EmployeeRequestHist  = () => import('@/views/employee/EmployeeRequestHistory.vue')
// Car Booking Employee
const EmployeeCarBooking = () => import('@/views/employee/carbooking/EmployeeCarBooking.vue')
const EmployeeCarHistory = () => import('@/views/employee/carbooking/EmployeeCarHistory.vue')

// Admin pages
const AdminLogin           = () => import('@/views/admin/AdminLogin.vue')
const AdminFoodRequests    = () => import('@/views/admin/AdminFoodRequests.vue')
const AdminFoodCalendar    = () => import('@/views/admin/AdminFoodCalendar.vue')
const AdminDashboard       = () => import('@/views/admin/AdminDashboard.vue')

// Driver/Messenger pages
const DriverHome           = () => import('@/modules/driver/Home.vue')
const MessengerHome        = () => import('@/modules/messenger/Home.vue')


function homeByRole(role) {
  switch (role) {
    case 'ADMIN':
    case 'CHEF':      return { name: 'admin-requests' }
    case 'DRIVER':    return { name: 'driver-home' }
    case 'MESSENGER': return { name: 'messenger-home' }
    default:          return { name: 'employee-request' }
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Public login
    { name: 'admin-login', path: '/admin/login', component: AdminLogin, meta: { public: true } },

    // Employee layout (default site)
    {
      path: '/',
      component: EmployeeLayout,
      children: [
        { path: '', redirect: { name: 'employee-request' } },
        { name: 'employee-request',          path: 'employee/request',  component: EmployeeHome },
        { name: 'employee-request-history',  path: 'employee/history',  component: EmployeeRequestHist },

        // Employee carbooking
        { name: 'employee-car-booking',      path: 'employee/car-booking', component: EmployeeCarBooking }, // ✅ new
        { name: 'employee-car-history',     path: 'employee/car-history',   component: EmployeeCarHistory }, // ✅ add this
      ]
    },

    // Admin layout
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresRole: ['ADMIN','CHEF'] },
      children: [
        { name: 'admin-dashboard',     path: 'dashboard',     component: AdminDashboard },
        { name: 'admin-requests',      path: 'requests',      component: AdminFoodRequests },
        { name: 'admin-food-calendar', path: 'food-calendar', component: AdminFoodCalendar },

        //car booking
        
      ]
    },

    // Driver layout
    {
      path: '/driver',
      component: DriverLayout,
      meta: { requiresRole: ['DRIVER'] },
      children: [
        { name: 'driver-home', path: '', component: DriverHome },
      ]
    },

    // Messenger layout
    {
      path: '/messenger',
      component: MessengerLayout,
      meta: { requiresRole: ['MESSENGER'] },
      children: [
        { name: 'messenger-home', path: '', component: MessengerHome },
      ]
    },

    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach((to) => {
  const auth = useAuth()

  // Already logged in and trying to visit login → bounce to home by role
  if (to.name === 'admin-login' && auth.user?.role) {
    return homeByRole(auth.user.role)
  }

  // Public route
  if (to.meta?.public) return true

  // Role-protected routes
  const allowed = to.meta?.requiresRole
  if (allowed) {
    if (!auth.token || !auth.user) {
      return { name: 'admin-login', query: { redirect: to.fullPath } }
    }
    if (!allowed.includes(auth.user.role)) {
      return homeByRole(auth.user.role)
    }
  }

  return true
})

export default router

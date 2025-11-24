// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/store/auth'

// Layouts
const EmployeeLayout  = () => import('@/layouts/EmployeeLayout.vue')
const AdminLayout     = () => import('@/layouts/AdminLayout.vue')
const ChefLayout      = () => import('@/layouts/ChefLayout.vue')
const DriverLayout    = () => import('@/layouts/DriverLayout.vue')
const MessengerLayout = () => import('@/layouts/MessengerLayout.vue')

// Public
const GreetingPage    = () => import('@/views/GreetingPage.vue')

// Employee
const EmployeeHome        = () => import('@/views/employee/EmployeeHome.vue')
const EmployeeRequestHist = () => import('@/views/employee/EmployeeRequestHistory.vue')
const EmployeeCarBooking  = () => import('@/views/employee/carbooking/EmployeeCarBooking.vue')
const EmployeeCarHistory  = () => import('@/views/employee/carbooking/EmployeeCarHistory.vue')
const CarBookingSchedule  = () => import('@/views/employee/carbooking/sections/CarBookingSchedule.vue')

// Admin (Food)
const AdminLogin        = () => import('@/views/admin/AdminLogin.vue')
const AdminFoodRequests = () => import('@/views/admin/AdminFoodRequests.vue')
const AdminFoodCalendar = () => import('@/views/admin/AdminFoodCalendar.vue')
const AdminDashboard    = () => import('@/views/admin/AdminDashboard.vue')

// Admin (Transportation)
const AdminCarBooking   = () => import('@/views/admin/carbooking/AdminCarBooking.vue')
const AdminCarCalendar  = () => import('@/views/admin/carBooking/TransportAdminCalendar.vue')

// Chef (Food only; reuse admin calendar)
const ChefFoodRequests  = () => import('@/views/chef/ChefFoodRequests.vue')
const ChefFoodCalendar  = AdminFoodCalendar // alias reuse

// Driver
const DriverHome        = () => import('@/modules/driver/Home.vue')
const DriverCarBooking  = () => import('@/views/driver/DriverCarBooking.vue')
const DriverCarCalendar  = () => import('@/views/driver/DriverCarCalendar.vue')

// Messenger
const MessengerHome     = () => import('@/modules/messenger/Home.vue')
const MessengerAssignment = () => import('@/views/messenger/MessengerCarBooking.vue')
const MessengerCarCalendar = () => import('@/views/messenger/MessengerCarCalendar.vue')


function homeByRole(role) {
  switch (role) {
    case 'ADMIN':     return { name: 'admin-requests' }
    case 'CHEF':      return { name: 'chef-requests' }           // ⬅️ go straight to Chef list
    case 'DRIVER':    return { name: 'driver-home' }
    case 'MESSENGER': return { name: 'messenger-home' }
    default:          return { name: 'employee-request' }
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Public landing + default redirect
    { name: '/', path: '/greeting', component: GreetingPage, meta: { public: true } },
    { path: '/employee-request', redirect: { name: 'employee-request' }, meta: { public: true } },

    // Public admin login
    { name: 'admin-login', path: '/admin/login', component: AdminLogin, meta: { public: true } },

    // Employee area
    {
      path: '/employee',
      component: EmployeeLayout,
      children: [
        { path: '', redirect: { name: 'employee-request' } },
        { name: 'employee-request',         path: 'request',     component: EmployeeHome },
        { name: 'employee-request-history', path: 'history',     component: EmployeeRequestHist },
        { name: 'employee-car-booking',     path: 'car-booking', component: EmployeeCarBooking },
        { name: 'employee-car-history',     path: 'car-history', component: EmployeeCarHistory },
        { name: 'employee-car-schedule',    path: 'car-schedule',component: CarBookingSchedule},
      ]
    },

    // Admin area (ADMIN only)
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresRole: ['ADMIN'] },
      children: [
        { path: '', redirect: { name: 'admin-requests' } },
        { name: 'admin-dashboard',     path: 'dashboard',     component: AdminDashboard },
        { name: 'admin-requests',      path: 'requests',      component: AdminFoodRequests },
        { name: 'admin-food-calendar', path: 'food-calendar', component: AdminFoodCalendar },
        { name: 'admin-car-booking',   path: 'car-booking',   component: AdminCarBooking },
        { name: 'admin-car-calendar',  path: 'car-calendar',  component: AdminCarCalendar },
      ]
    },

    // Chef area (CHEF only). Full food features, no transportation.
    {
      path: '/chef',
      component: ChefLayout,
      meta: { requiresRole: ['CHEF'] }, // use ['CHEF','ADMIN'] if you want admins to see chef UI too
      children: [
        { path: '', redirect: { name: 'chef-requests' } },
        { name: 'chef-requests',      path: 'requests',      component: ChefFoodRequests },
        { name: 'chef-food-calendar', path: 'food-calendar', component: ChefFoodCalendar },
      ]
    },

    // Driver area
    {
      path: '/driver',
      component: DriverLayout,
      meta: { requiresRole: ['DRIVER'] },
      children: [
        { name: 'driver-home',         path: '',            component: DriverHome },
        { name: 'driver-car-booking',  path: 'car-booking', component: DriverCarBooking },
        { name: 'driver-carlendar',path: 'calendar',    component: DriverCarCalendar },
      ]
    },

    // Messenger
    {
      path: '/messenger',
      component: MessengerLayout,
      meta: { requiresRole: ['MESSENGER'] },
      children: [
        { name: 'messenger-home',       path: '',             component: MessengerHome },
        { name: 'messenger-assignment', path: 'assignment',   component: MessengerAssignment },
        { name: 'messenger-calendar',   path: 'calendar',     component: MessengerCarCalendar },
      ]
    },

    // Fallback -> greeting
    { path: '/:pathMatch(.*)*', redirect: { name: 'greeting' }, meta: { public: true } }
  ]
})

router.beforeEach((to) => {
  const auth = useAuth()

  // If logged in, keep them out of admin-login
  if (to.name === 'admin-login' && auth.user?.role) {
    return homeByRole(auth.user.role)
  }

  // Public routes pass through
  if (to.meta?.public) return true

  // Role-protected routes
  const allowed = to.meta?.requiresRole
  if (allowed) {
    if (!auth.token || !auth.user) {
      return { name: 'greeting' }
    }
    if (!allowed.includes(auth.user.role)) {
      return homeByRole(auth.user.role)
    }
  }

  return true
})

export default router

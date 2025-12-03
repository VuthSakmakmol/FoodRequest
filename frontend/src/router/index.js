// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/store/auth'

// Layouts
const EmployeeLayout  = () => import('@/layouts/EmployeeLayout.vue')
const AdminLayout     = () => import('@/layouts/AdminLayout.vue')
const ChefLayout      = () => import('@/layouts/ChefLayout.vue')
const DriverLayout    = () => import('@/layouts/DriverLayout.vue')
const MessengerLayout = () => import('@/layouts/MessengerLayout.vue')
const ExpatLayout     = () => import('@/layouts/ExpatLayout.vue')

// Public
const GreetingPage    = () => import('@/views/GreetingPage.vue')

// Employee
const EmployeeHome         = () => import('@/views/employee/EmployeeHome.vue')
const EmployeeRequestHist  = () => import('@/views/employee/EmployeeRequestHistory.vue')
const EmployeeFoodCalendar = () => import('@/views/employee/EmployeeFoodCalendar.vue')
const EmployeeCarBooking   = () => import('@/views/employee/carbooking/EmployeeCarBooking.vue')
const EmployeeCarHistory   = () => import('@/views/employee/carbooking/EmployeeCarHistory.vue')
const CarBookingSchedule   = () => import('@/views/employee/carbooking/sections/CarBookingSchedule.vue')

// Admin (Food)
const AdminLogin        = () => import('@/views/admin/AdminLogin.vue')
const AdminFoodRequests = () => import('@/views/admin/AdminFoodRequests.vue')
const AdminFoodCalendar = () => import('@/views/admin/AdminFoodCalendar.vue')
const AdminDashboard    = () => import('@/views/admin/AdminDashboard.vue')

// Admin (Transportation)
const AdminCarBooking   = () => import('@/views/admin/carbooking/AdminCarBooking.vue')
const AdminCarCalendar  = () => import('@/views/admin/carbooking/TransportAdminCalendar.vue')

// Chef
const ChefFoodRequests  = () => import('@/views/chef/ChefFoodRequests.vue')
const ChefFoodCalendar  = () => import('@/views/chef/ChefFoodCalendar.vue')

// Driver
const DriverCarBooking  = () => import('@/views/driver/DriverCarBooking.vue')
const DriverCarCalendar = () => import('@/views/driver/DriverCarCalendar.vue')

// Messenger
const MessengerAssignment  = () => import('@/views/messenger/MessengerCarBooking.vue')
const MessengerCarCalendar = () => import('@/views/messenger/MessengerCarCalendar.vue')

// Expat Leave (split pages)
const ExpatRequestLeave   = () => import('@/views/expat/RequestLeave.vue')
const ExpatMyRequests     = () => import('@/views/expat/MyRequests.vue')
const AdminLeaveTypes     = () => import('@/views/expat/AdminLeaveTypes.vue')
const AdminExpatProfiles  = () => import('@/views/expat/AdminExpatProfiles.vue')
const ManagerLeaveInbox   = () => import('@/views/expat/ManagerLeaveInbox.vue')
const GmLeaveInbox        = () => import('@/views/expat/GmLeaveInbox.vue')
const AdminExpatYearSheet = () => import('@/views/expat/AdminExpatYearSheet.vue')

// 🔹 Decide "home" route by role
function homeByRole(role) {
  switch (role) {
    case 'ADMIN':
    case 'ROOT_ADMIN':
      return { name: 'admin-requests' }

    case 'CHEF':
      return { name: 'chef-requests' }

    case 'DRIVER':
      return { name: 'driver-car-booking' }

    case 'MESSENGER':
      return { name: 'messenger-assignment' }

    // Leave roles
    case 'LEAVE_USER':
    case 'LEAVE_MANAGER':
    case 'LEAVE_GM':
      return { name: 'expat-leave-request' }

    case 'LEAVE_ADMIN':
      // Leave admin lands directly on types master
      return { name: 'expat-leave-admin-types' }

    default:
      return { name: 'employee-request' }
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // 🌟 Public landing
    {
      path: '/',
      name: 'greeting',
      component: GreetingPage,
      meta: { public: true }
    },
    {
      path: '/greeting',
      redirect: { name: 'greeting' },
      meta: { public: true }
    },

    // Public login (food/transport portal)
    {
      name: 'admin-login',
      path: '/admin/login',
      component: AdminLogin,
      meta: { public: true, portal: 'admin' }
    },

    // Public login for Expat Leave portal
    {
      name: 'leave-login',
      path: '/leave/login',
      component: AdminLogin, // reuse same UI
      meta: { public: true, portal: 'leave' }
    },

    // Employee area (public style; employees + guests)
    {
      path: '/employee',
      component: EmployeeLayout,
      children: [
        { path: '', redirect: { name: 'employee-request' } },
        { name: 'employee-request',         path: 'request',       component: EmployeeHome },
        { name: 'employee-request-history', path: 'history',       component: EmployeeRequestHist },
        { name: 'employee-food-calendar',   path: 'food-calendar', component: EmployeeFoodCalendar },
        { name: 'employee-car-booking',     path: 'car-booking',   component: EmployeeCarBooking },
        { name: 'employee-car-history',     path: 'car-history',   component: EmployeeCarHistory },
        { name: 'employee-car-schedule',    path: 'car-schedule',  component: CarBookingSchedule }
      ]
    },

    // Admin area (Food/Transport) – normal admins only
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresRole: ['ADMIN', 'ROOT_ADMIN'] },
      children: [
        { path: '', redirect: { name: 'admin-requests' } },
        { name: 'admin-dashboard',     path: 'dashboard',     component: AdminDashboard },
        { name: 'admin-requests',      path: 'requests',      component: AdminFoodRequests },
        { name: 'admin-food-calendar', path: 'food-calendar', component: AdminFoodCalendar },
        { name: 'admin-car-booking',   path: 'car-booking',   component: AdminCarBooking },
        { name: 'admin-car-calendar',  path: 'car-calendar',  component: AdminCarCalendar }
      ]
    },

    // Chef
    {
      path: '/chef',
      component: ChefLayout,
      meta: { requiresRole: ['CHEF'] },
      children: [
        { path: '', redirect: { name: 'chef-requests' } },
        { name: 'chef-requests',      path: 'requests',      component: ChefFoodRequests },
        { name: 'chef-food-calendar', path: 'food-calendar', component: ChefFoodCalendar }
      ]
    },

    // Driver
    {
      path: '/driver',
      component: DriverLayout,
      meta: { requiresRole: ['DRIVER'] },
      children: [
        { path: '', redirect: { name: 'driver-car-booking' } },
        { name: 'driver-car-booking', path: 'car-booking', component: DriverCarBooking },
        { name: 'driver-carlendar',   path: 'calendar',    component: DriverCarCalendar }
      ]
    },

    // Messenger
    {
      path: '/messenger',
      component: MessengerLayout,
      meta: { requiresRole: ['MESSENGER'] },
      children: [
        { path: '', redirect: { name: 'messenger-assignment' } },
        { name: 'messenger-assignment', path: 'assignment', component: MessengerAssignment },
        { name: 'messenger-calendar',   path: 'calendar',   component: MessengerCarCalendar }
      ]
    },

    // Expat Leave (ONLY leave roles + ADMIN for admin screens)
    {
      path: '/expat',
      component: ExpatLayout,
      children: [
        // redirect old /expat/leave → /expat/leave/request
        {
          path: 'leave',
          redirect: { name: 'expat-leave-request' }
        },
        {
          path: 'leave/request',
          name: 'expat-leave-request',
          component: ExpatRequestLeave,
          meta: {
            requiresRole: [
              'LEAVE_USER',
              'LEAVE_MANAGER',
              'LEAVE_GM',
              'LEAVE_ADMIN',
              'ADMIN', // allow admin/root to test
            ]
          }
        },
        {
          path: 'leave/my-requests',
          name: 'expat-leave-my-requests',
          component: ExpatMyRequests,
          meta: {
            requiresRole: [
              'LEAVE_USER',
              'LEAVE_MANAGER',
              'LEAVE_GM',
              'LEAVE_ADMIN',
              'ADMIN',
            ]
          }
        },
        {
          path: 'leave/admin/types',
          name: 'expat-leave-admin-types',
          component: AdminLeaveTypes,
          meta: {
            requiresRole: ['LEAVE_ADMIN', 'ADMIN']
          }
        },
        {
          path: 'leave/admin/profiles',
          name: 'expat-leave-admin-profiles',
          component: AdminExpatProfiles,
          meta: {
            requiresRole: ['LEAVE_ADMIN', 'ADMIN']
          }
        },
        {
          path: 'leave/manager-inbox',
          name: 'expat-leave-manager-inbox',
          component: ManagerLeaveInbox,
          meta: { requiresRole: ['LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'] }
        },
        {
          path: 'leave/gm-inbox',
          name: 'expat-leave-gm-inbox',
          component: GmLeaveInbox,
          meta: { requiresRole: ['LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'] }
        },
        {
          path: 'leave/profiles/:employeeId/year-sheet',
          name: 'expat-leave-year-sheet',
          component: AdminExpatYearSheet,
          meta: {
            requiresRole: ['LEAVE_ADMIN', 'LEAVE_MANAGER', 'LEAVE_GM', 'ADMIN']
          }
        },
      ]
    },

    // 404 → greeting
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'greeting' },
      meta: { public: true }
    }
  ]
})

// 🔐 Global guard
router.beforeEach((to) => {
  const auth = useAuth()
  const role = auth.user?.role
  const isPublic = to.meta?.public === true
  const requiredRoles = to.meta?.requiresRole || null
  const isEmployeeArea = to.path.startsWith('/employee')

  // 1. Logged in & visiting greeting or any login → send to homeByRole
  if (
    role &&
    (to.name === 'greeting' || to.name === 'admin-login' || to.name === 'leave-login')
  ) {
    const target = homeByRole(role)
    if (target.name !== to.name) {
      return target
    }
    return true
  }

  // 2. Employee area special rules
  if (isEmployeeArea) {
    // Guests → allowed
    if (!auth.token || !role) return true

    // Real employees → allowed
    if (role === 'EMPLOYEE') return true

    // Other roles → back to their own home
    const target = homeByRole(role)
    if (target.name !== to.name) return target
    return true
  }

  // 3. Public routes → always allowed
  if (isPublic) return true

  // 4. Non-public routes require login
  if (!auth.token || !role) {
    if (to.name !== 'greeting') {
      return { name: 'greeting' }
    }
    return true
  }

  // 5. Role-specific restrictions
  if (requiredRoles && !requiredRoles.includes(role)) {
    const target = homeByRole(role)
    if (target.name !== to.name) return target
  }

  return true
})

export default router

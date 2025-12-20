// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/store/auth'

// Layouts
const EmployeeLayout  = () => import('@/layouts/EmployeeLayout.vue')
const AdminLayout     = () => import('@/layouts/AdminLayout.vue')
const ChefLayout      = () => import('@/layouts/ChefLayout.vue')
const DriverLayout    = () => import('@/layouts/DriverLayout.vue')
const MessengerLayout = () => import('@/layouts/MessengerLayout.vue')

// Leave / Expat layouts
const AdminLeaveExpat = () => import('@/layouts/LeaveExpat/AdminLeaveExpat.vue')
const GMLeaveExpat    = () => import('@/layouts/LeaveExpat/GMLeaveExpat.vue')
const MGRLeaveExpat   = () => import('@/layouts/LeaveExpat/MGRLeaveExpat.vue')
const UserLeaveExpat  = () => import('@/layouts/LeaveExpat/UserLeaveExpat.vue')
const ManagerProfile  = () => import('@/views/expat/manager/Profile.vue')
const getMyProfile    = () => import('@/views/expat/generalManager/Profile.vue')

// Public
const GreetingPage    = () => import('@/views/GreetingPage.vue')

// Employee
const EmployeeHome         = () => import('@/views/employee/EmployeeHome.vue')
const EmployeeRequestHist  = () => import('@/views/employee/foodBooking/EmployeeFoodBooking.vue')
const EmployeeFoodCalendar = () => import('@/views/employee/foodBooking/EmployeeFoodCalendar.vue')
const EmployeeCarBooking   = () => import('@/views/employee/carBooking/EmployeeCarBooking.vue')
const EmployeeCarHistory   = () => import('@/views/employee/carBooking/EmployeeCarHistory.vue')
const CarBookingSchedule   = () => import('@/views/employee/carBooking/EmployeeCarCalendar.vue')

// Admin (Food)
const AdminLogin        = () => import('@/views/admin/AdminLogin.vue')
const AdminFoodRequests = () => import('@/views/admin/foodBooking/AdminFoodBooking.vue')
const AdminFoodCalendar = () => import('@/views/admin/foodBooking/AdminFoodCalendar.vue')
const AdminDashboard    = () => import('@/views/admin/AdminDashboard.vue')

// Admin (Transportation)
const AdminCarBooking   = () => import('@/views/admin/carbooking/AdminCarBooking.vue')
const AdminCarCalendar  = () => import('@/views/admin/carbooking/TransportAdminCalendar.vue')

// Chef
const ChefFoodRequests  = () => import('@/views/chef/ChefFoodBooking.vue')
const ChefFoodCalendar  = () => import('@/views/chef/ChefFoodCalendar.vue')

// Driver
const DriverCarBooking  = () => import('@/views/driver/DriverCarBooking.vue')
const DriverCarCalendar = () => import('@/views/driver/DriverCarCalendar.vue')

// Messenger
const MessengerAssignment  = () => import('@/views/messenger/MessengerCarBooking.vue')
const MessengerCarCalendar = () => import('@/views/messenger/MessengerCarCalendar.vue')

// Expat Leave (views)
const ExpatRequestLeave   = () => import('@/views/expat/RequestLeave.vue')
const ExpatMyRequests     = () => import('@/views/expat/MyRequest.vue')
const AdminLeaveTypes     = () => import('@/views/expat/AdminLeaveTypes.vue')
const AdminExpatProfiles  = () => import('@/views/expat/AdminExpatProfile.vue')
const ManagerLeaveInbox   = () => import('@/views/expat/ManagerLeaveInbox.vue')
const GmLeaveInbox        = () => import('@/views/expat/GmLeaveInbox.vue')
const AdminExpatYearSheet = () => import('@/views/expat/AdminExpatYearSheet.vue')
const AdminLeaveProfileEdit =  () => import('@/views/expat/admin/AdminLeaveProfileEdit.vue')
// Replace Day (User)
const UserReplaceDay      = () => import('@/views/expat/user/UserReplaceDay.vue')
const UserReplaceDayList  = () => import('@/views/expat/user/UserReplaceDayList.vue')


// Decide "home" route by role
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

    // Leave roles → go to their dedicated leave layouts
    case 'LEAVE_USER':
      return { name: 'leave-user-request' }

    case 'LEAVE_MANAGER':
      return { name: 'leave-manager-inbox' }

    case 'LEAVE_GM':
      return { name: 'leave-gm-inbox' }

    case 'LEAVE_ADMIN':
      return { name: 'leave-admin-types' }

    default:
      return { name: 'employee-request' }
  }
}

const router = createRouter({
  // Vite-style history (uses base from vite.config if set)
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // Public landing
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

    // Employee area
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

    // Admin area (Food/Transport)
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

    // Leave / Expat – User
    {
      path: '/leave/user',
      component: UserLeaveExpat,
      meta: {
        requiresRole: [
          'LEAVE_USER',
          'LEAVE_MANAGER',
          'LEAVE_GM',
          'LEAVE_ADMIN',
          'ADMIN',
        ]
      },
      children: [
        { path: '', redirect: { name: 'leave-user-request' } },
        {
          path: 'request',
          name: 'leave-user-request',
          component: ExpatRequestLeave
        },
        {
          path: 'my-requests',
          name: 'leave-user-my-requests',
          component: ExpatMyRequests
        },
        {
          path: 'replace-day',
          name: 'leave-user-replace-day',
          component: UserReplaceDay,
          meta: { title: 'Replace Day' }
        },
        {
          path: 'replace-day/list',
          name: 'leave-user-replace-list',
          component: UserReplaceDayList,
          meta: { title: 'My Replace Day Requests' }
        }
      ]
    },

    // Leave / Expat – Manager
    {
      path: '/leave/manager',
      component: MGRLeaveExpat,
      meta: { requiresRole: ['LEAVE_MANAGER', 'LEAVE_ADMIN', 'ADMIN'] },
      children: [
        { path: '', redirect: { name: 'leave-manager-inbox' } },
        {
          path: 'request',
          name: 'leave-manager-request',
          component: ExpatRequestLeave
        },
        {
          path: 'my-requests',
          name: 'leave-manager-my-requests',
          component: ExpatMyRequests
        },
        {
          path: 'inbox',
          name: 'leave-manager-inbox',
          component: ManagerLeaveInbox
        },
        {
          path: 'profile/:employeeId?',
          name: 'leave-manager-profile',
          component: ManagerProfile,
          meta: { title: 'Employee Leave Profile' }
        }
      ]
    },

    // Leave / Expat – GM
    {
      path: '/leave/gm',
      component: GMLeaveExpat,
      meta: { requiresRole: ['LEAVE_GM', 'LEAVE_ADMIN', 'ADMIN'] },
      children: [
        { path: '', redirect: { name: 'leave-gm-inbox' } },
        {
          path: 'request',
          name: 'leave-gm-request',
          component: ExpatRequestLeave
        },
        {
          path: 'my-requests',
          name: 'leave-gm-my-requests',
          component: ExpatMyRequests
        },
        {
          path: 'inbox',
          name: 'leave-gm-inbox',
          component: GmLeaveInbox
        },
        {
          path: 'profile/:employeeId?',
          name: 'leave-gm-profile',
          component: getMyProfile,
          meta: { title: 'Employee leave profile'}
        }
      ]
    },

    // Leave / Expat – Admin
    {
      path: '/leave/admin',
      component: AdminLeaveExpat,
      meta: { requiresRole: ['LEAVE_ADMIN', 'ADMIN'] },
      children: [
        { path: '', redirect: { name: 'leave-admin-types' } },

        {
          path: 'types',
          name: 'leave-admin-types',
          component: AdminLeaveTypes
        },
        {
          path: 'profiles',
          name: 'leave-admin-profiles',
          component: AdminExpatProfiles
        },
        {
          path: 'manager-inbox',
          name: 'leave-admin-manager-inbox',
          component: ManagerLeaveInbox
        },
        {
          path: 'gm-inbox',
          name: 'leave-admin-gm-inbox',
          component: GmLeaveInbox
        },
        {
          path: 'request',
          name: 'leave-admin-request',
          component: ExpatRequestLeave
        },
        {
          path: 'my-requests',
          name: 'leave-admin-my-requests',
          component: ExpatMyRequests
        },
        {
          path: 'profiles/:employeeId/year-sheet',
          name: 'expat-leave-year-sheet',
          component: AdminExpatYearSheet,
          meta: {
            requiresRole: ['LEAVE_ADMIN', 'LEAVE_MANAGER', 'LEAVE_GM', 'ADMIN']
          }
        },
        {
          path: 'profiles/:employeeId/edit',
          name: 'leave-admin-profile-edit',
          component: AdminLeaveProfileEdit,
          meta: {
            requiresRole: ['LEAVE_ADMIN', 'LEAVE_GM', 'LEAVE_MANAGER', 'ADMIN'],
            title: 'Admin Leave Profile Edit',
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

// Global guard
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

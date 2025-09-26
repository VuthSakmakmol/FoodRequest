// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

// ✅ Lazy imports (code-splitting)
const DefaultLayout        = () => import('@/layouts/DefaultLayout.vue')
const EmployeeHome         = () => import('@/views/employee/EmployeeHome.vue')
const EmployeeRequestHist  = () => import('@/views/employee/EmployeeRequestHistory.vue')
const AdminLogin           = () => import('@/views/admin/AdminLogin.vue')
const AdminFoodRequests    = () => import('@/views/admin/AdminFoodRequests.vue')
const AdminFoodCalendar    = () => import('@/views/admin/AdminFoodCalendar.vue')
const AdminDashboard       = () => import('@/views/admin/AdminDashboard.vue') // new

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: DefaultLayout,
      children: [
        // default redirect → employee request
        { path: '', redirect: { name: 'employee-request' } },

        // 👩 Employee pages
        { name: 'employee-request',          path: 'employee/request',  component: EmployeeHome },
        { name:'employee-request-history', path:'employee/history', component: EmployeeRequestHist },

        // 👨‍🍳 Admin pages
        { name: 'admin-login',        path: 'admin/login',        component: AdminLogin },
        { name: 'admin-dashboard',    path: 'admin/dashboard',    component: AdminDashboard,    meta:{ requiresRole:['ADMIN','CHEF'] } },
        { name: 'admin-requests',     path: 'admin/requests',     component: AdminFoodRequests, meta:{ requiresRole:['ADMIN','CHEF'] } },
        { name: 'admin-food-calendar',path: 'admin/food-calendar',component: AdminFoodCalendar, meta:{ requiresRole:['ADMIN','CHEF'] } },
      ]
    }
  ]
})

export default router

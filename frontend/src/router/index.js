// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

// lazy imports
const DefaultLayout        = () => import('@/layouts/DefaultLayout.vue')
const EmployeeHome         = () => import('@/views/employee/EmployeeHome.vue')
const EmployeeRequestHist  = () => import('@/views/employee/EmployeeRequestHistory.vue')
const AdminLogin           = () => import('@/views/admin/AdminLogin.vue')
const AdminFoodRequests    = () => import('@/views/admin/AdminFoodRequests.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      // Parent uses the layout (contains <v-app>, app-bar, sidebar, etc.)
      path: '/',
      component: DefaultLayout,
      children: [
        { path: '', redirect: { name: 'employee-request' } },

        // employee pages
        { name:'employee-request',   path:'employee/request',  component: EmployeeHome },
        { name:'employee-requests',  path:'employee/history',  component: EmployeeRequestHist },

        // admin pages (these will render inside the same layout)
        { name:'admin-login',        path:'admin/login',       component: AdminLogin },
        { name:'admin-requests',     path:'admin/requests',    component: AdminFoodRequests, meta:{ requiresRole:['ADMIN','CHEF'] } },
      ]
    },
  ],
})

export default router

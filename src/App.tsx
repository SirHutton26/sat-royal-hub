import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { RequireRole } from '@/features/auth/RequireRole'
import LoginPage from '@/pages/LoginPage'

const AdminLayout = lazy(() => import('@/pages/admin/admin-layout'))
const AdminDashboard = lazy(() => import('@/pages/admin/admin-dashboard'))
const AdminTeachers = lazy(() => import('@/pages/admin/admin-teachers'))
const AdminClasses = lazy(() => import('@/pages/admin/admin-classes'))
const AdminStudents = lazy(() => import('@/pages/admin/admin-students'))
const AdminAlerts = lazy(() => import('@/pages/admin/admin-alerts')) 
const AdminSubjects = lazy(() => import('@/pages/admin/admin-subjects'))
const AdminExams = lazy(() => import('@/pages/admin/admin-exams'))
const AdminSettings = lazy(() => import('@/pages/admin/admin-settings'))
const AdminStaffAttendance = lazy(() => import('@/pages/admin/admin-staff-attendance'))


const TeacherOnboarding = lazy(() => import('@/pages/teacher/teacher-onboarding'))
const TeacherLayout = lazy(() => import('@/pages/teacher/teacher-layout'))
const TeacherDashboard = lazy(() => import('@/pages/teacher/teacher-dashboard'))
const TeacherClass = lazy(() => import('@/pages/teacher/teacher-class'))
const TeacherAttendance = lazy(() => import('@/pages/teacher/teacher-attendance'))
const TeacherGrades = lazy(() => import('@/pages/teacher/teacher-grades'))
const TeacherAlerts = lazy(() => import('@/pages/teacher/teacher-alerts'))
const TeacherClockIn = lazy(() => import('@/pages/teacher/teacher-clockin'))
const TeacherQuiz = lazy(() => import('@/pages/teacher/teacher-score-bank'))
const TeacherExams = lazy(() => import('@/pages/teacher/teacher-exams'))
const TeacherScoreBank = lazy(() => import('@/pages/teacher/teacher-score-bank'))
const TeacherSba = lazy(() => import('@/pages/teacher/teacher-sba'))
const TeacherSbaPrint = lazy(() => import('@/pages/teacher/teacher-sba-print'))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireRole role="admin" />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="teachers" element={<AdminTeachers />} />
                <Route path="class" element={<AdminClasses />} />
                <Route path="students" element={<AdminStudents />} />
                <Route path="alerts" element={<AdminAlerts />} />
                <Route path="subjects" element={<AdminSubjects />} />
                <Route path="exams" element={<AdminExams />} />
                <Route path="settings" element={<AdminSettings />} />
  <Route path="staff-attendance" element={<AdminStaffAttendance />} />
              </Route>
            </Route>

            <Route element={<RequireRole role="teacher" />}>
            <Route path="/teacher/onboarding" element={<TeacherOnboarding />} />
              <Route path="/teacher" element={<TeacherLayout />}>
              <Route index element={<TeacherDashboard />} />
              <Route path="class" element={<TeacherClass />} />
              <Route path="attendance" element={<TeacherAttendance />} />
              <Route path="grades" element={<TeacherGrades />} />
              <Route path="alerts" element={<TeacherAlerts />} />
              <Route path="clock-in" element={<TeacherClockIn />} />
              <Route path="quiz" element={<TeacherQuiz />} />
              <Route path="exams" element={<TeacherExams />} />
              <Route path="score-bank" element={<TeacherScoreBank />} />
              <Route path="sba" element={<TeacherSba />} /> 
              <Route path="sba-print" element={<TeacherSbaPrint />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
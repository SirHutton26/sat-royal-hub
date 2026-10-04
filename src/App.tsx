import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { RequireRole } from '@/features/auth/RequireRole'
import LoginPage from '@/pages/LoginPage'
import IdleLogout from '@/components/auth/idle-logout'
import TeacherMasterResult from './pages/teacher/TeacherMasterResult'

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
const AdminFees = lazy(() => import('@/pages/admin/admin-fees'))
const AdminArrears = lazy(() => import('@/pages/admin/admin-arrears'))
const AdminDailyRates = lazy(() => import('@/pages/admin/admin-daily-rates'))
const AdminNonStaff = lazy(() => import('@/pages/admin/admin-non-staff'))

const BursarLayout = lazy(() => import('@/pages/bursar/bursar-layout'))
const BursarDashboard = lazy(() => import('@/pages/bursar/bursar-dashboard'))
const BursarRecordPayment = lazy(() => import('@/pages/bursar/bursar-record-payment'))
const BursarReceipts = lazy(() => import('@/pages/bursar/bursar-receipts'))
const BursarStudents = lazy(() => import('@/pages/bursar/bursar-students'))
const BursarReports = lazy(() => import('@/pages/bursar/bursar-reports'))
const BursarAttendance = lazy(() => import('@/pages/bursar/bursar-attendance'))
const BursarDaily = lazy(() => import('@/pages/bursar/bursar-daily'))
const BursarSettings = lazy(() => import('@/pages/bursar/bursar-settings'))
const BursarActivity = lazy(() => import('@/pages/bursar/bursar-activity'))

const TeacherOnboarding = lazy(() => import('@/pages/teacher/teacher-onboarding'))
const TeacherLayout = lazy(() => import('@/pages/teacher/teacher-layout'))
const TeacherDashboard = lazy(() => import('@/pages/teacher/teacher-dashboard'))
const TeacherClass = lazy(() => import('@/pages/teacher/teacher-class'))
const TeacherAttendance = lazy(() => import('@/pages/teacher/teacher-attendance'))
const TeacherMarkAttendance = lazy(() => import('@/pages/teacher/teacher-mark-attendance'))
const TeacherAttendanceRegister = lazy(() => import('@/pages/teacher/teacher-attendance-register'))
const TeacherGrades = lazy(() => import('@/pages/teacher/teacher-grades'))
const TeacherAlerts = lazy(() => import('@/pages/teacher/teacher-alerts'))
const TeacherClockIn = lazy(() => import('@/pages/teacher/teacher-clockin'))
const TeacherQuiz = lazy(() => import('@/pages/teacher/teacher-score-bank'))
const TeacherExams = lazy(() => import('@/pages/teacher/teacher-exams'))
const TeacherScoreBank = lazy(() => import('@/pages/teacher/teacher-score-bank'))
const TeacherSba = lazy(() => import('@/pages/teacher/teacher-sba'))
const TeacherSbaPrint = lazy(() => import('@/pages/teacher/teacher-sba-print'))
const TeacherFees = lazy(() => import('@/pages/teacher/teacher-fees'))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <IdleLogout />
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
                <Route path="fees" element={<AdminFees />} />
                <Route path="fees/arrears" element={<AdminArrears />} />
                <Route path="non-staff" element={<AdminNonStaff />} />
                <Route path="daily-rates" element={<AdminDailyRates />} />
              </Route>
            </Route>

            <Route element={<RequireRole role="bursar" />}>
              <Route path="/bursar/onboarding" element={<TeacherOnboarding />} />
              <Route path="/bursar" element={<BursarLayout />}>
                <Route index element={<BursarDashboard />} />
                <Route path="record-payment" element={<BursarRecordPayment />} />
                <Route path="receipts" element={<BursarReceipts />} />
                <Route path="students" element={<BursarStudents />} />
                <Route path="reports" element={<BursarReports />} />
                <Route path="attendance" element={<BursarAttendance />} />
                <Route path="activity" element={<BursarActivity />} />
                <Route path="daily" element={<BursarDaily />} />
                <Route path="settings" element={<BursarSettings />} />
              </Route>
            </Route>

            <Route element={<RequireRole role="teacher" />}>
              <Route path="/teacher/onboarding" element={<TeacherOnboarding />} />
              <Route path="/teacher" element={<TeacherLayout />}>
                <Route index element={<TeacherDashboard />} />
                <Route path="class" element={<TeacherClass />} />
                <Route path="attendance" element={<TeacherAttendance />} />
                <Route path="attendance/mark" element={<TeacherMarkAttendance />} />
                <Route path="attendance/register" element={<TeacherAttendanceRegister />} />
                <Route path="grades" element={<TeacherGrades />} />
                <Route path="alerts" element={<TeacherAlerts />} />
                <Route path="clock-in" element={<TeacherClockIn />} />
                <Route path="quiz" element={<TeacherQuiz />} />
                <Route path="exams" element={<TeacherExams />} />
                <Route path="score-bank" element={<TeacherScoreBank />} />
                <Route path="sba" element={<TeacherSba />} />
                <Route path="sba/print" element={<TeacherSbaPrint />} />
                <Route path="fees" element={<TeacherFees />} />
                <Route path="/teacher/master-result" element={<TeacherMasterResult />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
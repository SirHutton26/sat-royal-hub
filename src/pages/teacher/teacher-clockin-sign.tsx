import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import StaffClockIn from '@/components/attendance/staff-clock-in'

export default function TeacherClockInSign() {
  return (
    <div>
      <Link to="/teacher/clock-in" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-royal-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <StaffClockIn />
    </div>
  )
}

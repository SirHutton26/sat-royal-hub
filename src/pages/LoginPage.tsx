import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate } from 'react-router-dom'
import { IDLE_NOTICE_KEY } from '@/components/auth/idle-logout'
import { Mail, Lock, Eye, EyeOff, ShieldAlert, X } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').min(6, 'Password must be at least 6 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

/** Where each role lands after signing in */
const HOME_BY_ROLE: Record<string, string> = {
  admin: '/admin',
  teacher: '/teacher',
  bursar: '/bursar',
}

function BrandHeading() {
  return (
    <h1 className="flex items-center justify-center text-3xl font-bold tracking-wide text-white">
      <span>SAT ROYAL H</span>
      <span className="relative inline-block">
        U
        <svg
          viewBox="0 0 24 24"
          className="absolute -right-2 -top-3 h-4 w-4 text-gold-400"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 8V6a3 3 0 0 1 6 0v3H9Zm3 4a1.5 1.5 0 0 1 1 2.6V18a1 1 0 1 1-2 0v-2.4A1.5 1.5 0 0 1 12 13Z" />
        </svg>
      </span>
      <span>B</span>
    </h1>
  )
}

function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-royal-900/40 backdrop-blur-sm">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-gold-400 border-t-transparent" />
        <img src={schoolLogo} alt="" className="h-16 w-16 rounded-full bg-white object-contain p-1" />
      </div>
      <p className="mt-4 text-sm font-medium text-white">Signing in...</p>
    </div>
  )
}

function ForgotPasswordNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-royal-900/40 px-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-[#FFFBEF] p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
        <ShieldAlert className="h-8 w-8 text-royal-600" />
        <h2 className="mt-3 text-lg font-semibold text-royal-900">Reset your password</h2>
        <p className="mt-2 text-sm text-gray-600">
          For account security, password resets are handled by your school administrator.
          Please contact them directly to have your password reset.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-royal-600 py-2 text-sm font-semibold text-white hover:bg-royal-700"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

/** Layered waves — dark navy behind, solid gold in front — anchored to the bottom of the screen */
function WaveBackground() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 overflow-hidden leading-[0]">
      <svg viewBox="0 0 1440 220" className="h-[160px] w-full text-royal-900/40 sm:h-[200px]" preserveAspectRatio="none">
        <path
          fill="currentColor"
          d="M0,96 C240,160 480,32 720,64 C960,96 1200,192 1440,128 L1440,220 L0,220 Z"
        />
      </svg>
      <svg
        viewBox="0 0 1440 220"
        className="-mt-[70px] h-[140px] w-full text-gold-400 sm:-mt-[90px] sm:h-[180px]"
        preserveAspectRatio="none"
      >
        <path
          fill="currentColor"
          d="M0,128 C240,64 480,176 720,144 C960,112 1200,32 1440,96 L1440,220 L0,220 Z"
        />
      </svg>
    </div>
  )
}

export default function LoginPage() {
  const { profile, signIn } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // shown after an automatic sign-out for inactivity (cleared in the effect so StrictMode's double render keeps it)
  const [idleNotice] = useState(() => {
    try {
      return localStorage.getItem(IDLE_NOTICE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.removeItem(IDLE_NOTICE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  // Send active users to their own dashboard. If the role has no home route,
  // stay on this page (redirecting to /login from /login would loop forever).
  const homePath = profile?.is_active ? HOME_BY_ROLE[profile.role] : undefined
  if (homePath) {
    return <Navigate to={homePath} replace />
  }
  const unknownRole = !!profile?.is_active && !homePath

  async function onSubmit(values: LoginFormValues) {
    setBusy(true)
    setAuthError(null)
    const err = await signIn(values.email, values.password)
    if (err) setAuthError(err)
    setBusy(false)
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-royal-700 via-royal-600 to-royal-500 px-4 py-12">
      {/* Soft glow accents */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-gold-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-1/3 h-80 w-80 rounded-full bg-gold-500/15 blur-3xl" />

      <WaveBackground />

      <div className="relative z-10 flex flex-col items-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-gold-400/40 blur-xl" />
          <img
            src={schoolLogo}
            alt=""
            className="h-20 w-20 rounded-full bg-gold-50 object-contain p-2 shadow-lg ring-4 ring-gold-400/50"
          />
        </div>
        <div className="mt-4">
          <BrandHeading />
        </div>
        <div className="mt-3 h-1 w-24 rounded bg-gold-400" />
        <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-royal-100">
          Staff Portal
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="relative z-10 mt-8 w-full max-w-sm rounded-3xl border border-gold-400/30 bg-[#FFFBEF]/95 p-7 shadow-2xl backdrop-blur-md"
      >
        <h2 className="text-xl font-bold text-royal-900">Welcome back</h2>
        <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>

        <div className="mt-5">
          <label htmlFor="email" className="block text-sm font-medium text-royal-900">
            Email
          </label>
          <div className="relative mt-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@school.edu"
              aria-invalid={!!errors.email}
              {...register('email')}
              className={`w-full rounded-xl border bg-[#FFFBEF] py-2.5 pl-10 pr-3 text-sm outline-none transition focus:ring-2 ${
                errors.email
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                  : 'border-gold-400/30 focus:border-royal-500 focus:ring-royal-100'
              }`}
            />
          </div>
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
        </div>

        <div className="mt-4">
          <label htmlFor="password" className="block text-sm font-medium text-royal-900">
            Password
          </label>
          <div className="relative mt-1">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={!!errors.password}
              {...register('password')}
              className={`w-full rounded-xl border bg-[#FFFBEF] py-2.5 pl-10 pr-10 text-sm outline-none transition focus:ring-2 ${
                errors.password
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                  : 'border-gold-400/30 focus:border-royal-500 focus:ring-royal-100'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>

        <div className="mt-3 text-right">
          <button
            type="button"
            onClick={() => setShowForgot(true)}
            className="text-xs font-medium text-royal-600 hover:text-royal-700 hover:underline"
          >
            Forgot password?
          </button>
        </div>

        {unknownRole && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
            Your account role isn&apos;t set up for this portal yet. Please contact the administrator.
          </p>
        )}

        {idleNotice && !authError && (
          <p className="mt-3 rounded-xl bg-gold-400/20 px-3 py-2 text-sm text-royal-900">
            You were signed out after 5 minutes of inactivity. Please sign in again.
          </p>
        )}
        {authError && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{authError}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-royal-600 to-royal-700 py-2.5 font-semibold text-white shadow-md shadow-royal-900/20 transition hover:from-royal-700 hover:to-royal-800 disabled:opacity-60"
        >
          Sign in
        </button>
      </form>

      <p className="relative z-10 mt-6 text-xs text-royal-100/80">© SAT ROYAL BASIC SCHOOL</p>

      {busy && <LoadingOverlay />}
      {showForgot && <ForgotPasswordNotice onClose={() => setShowForgot(false)} />}
    </div>
  )
}
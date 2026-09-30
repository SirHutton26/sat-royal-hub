import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { Camera, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import schoolLogo from '@/assets/school-logo.png'

const MAX_AVATAR_BYTES = 3 * 1024 * 1024

const onboardingSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscores only'),
    phoneNumber: z
      .string()
      .trim()
      .min(7, 'Enter a valid phone number')
      .regex(/^[0-9+\s-]+$/, 'Digits only, e.g. +233 24 000 0000'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

type OnboardingValues = z.infer<typeof onboardingSchema>

export default function TeacherOnboarding() {
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({ resolver: zodResolver(onboardingSchema) })

  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('Image must be under 3 MB')
      return
    }
    setAvatarError(null)
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  async function onSubmit(values: OnboardingValues) {
    if (!profile) return
    setServerError(null)

    let avatarUrl: string | null = profile.avatar_url

    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop() || 'jpg'
      const path = `${profile.id}/avatar.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, avatarFile, { upsert: true })
      if (uploadError) {
        setServerError(uploadError.message)
        return
      }
      avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        username: values.username,
        phone_number: values.phoneNumber,
        avatar_url: avatarUrl,
        onboarding_completed: true,
      })
      .eq('id', profile.id)

    if (profileError) {
      setServerError(
        profileError.code === '23505' ? 'That username is already taken.' : profileError.message
      )
      return
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password: values.password })
    if (passwordError) {
      setServerError(passwordError.message)
      return
    }

    await refreshProfile()
    navigate('/teacher', { replace: true })
  }

  return (
    <div className="min-h-screen bg-royal-600 px-4 py-10">
      <div className="mx-auto max-w-sm">
        <div className="flex flex-col items-center text-white">
          <img src={schoolLogo} alt="" className="h-14 w-14 rounded-full bg-white object-contain p-1" />
          <h1 className="mt-3 text-xl font-bold tracking-wide">Welcome to SAT ROYAL HUB</h1>
          <p className="mt-1 text-center text-sm text-royal-100">
            Let's finish setting up your account.
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="mt-6 space-y-4 rounded-xl bg-white p-6 shadow-lg"
        >
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative h-24 w-24 overflow-hidden rounded-full border-2 border-dashed border-royal-300 bg-royal-50"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-royal-300">
                  <Camera className="h-8 w-8" />
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                Change
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPickAvatar}
              className="hidden"
            />
            <p className="mt-2 text-xs text-gray-500">Profile picture (optional)</p>
            {avatarError && <p className="text-xs text-red-600">{avatarError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Username</label>
            <input
              {...register('username')}
              placeholder="e.g. mensah_k"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            {errors.username && <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Phone number</label>
            <input
              {...register('phoneNumber')}
              placeholder="e.g. +233 24 000 0000"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            {errors.phoneNumber && (
              <p className="mt-1 text-xs text-red-600">{errors.phoneNumber.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">New password</label>
            <input
              type="password"
              {...register('password')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-royal-900">Confirm password</label>
            <input
              type="password"
              {...register('confirmPassword')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100"
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
            )}
          </div>

          {serverError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{serverError}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-royal-600 py-2 text-sm font-semibold text-white transition hover:bg-royal-700 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Setting up...' : 'Finish setup'}
          </button>
        </form>
      </div>
    </div>
  )
}
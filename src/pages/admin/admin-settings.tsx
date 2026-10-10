import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import OfflineDownload from '@/components/offline/offline-download'
import MfaSetup from '@/components/security/mfa-setup'

const MIN_PASSWORD = 8
const inputClass =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-royal-500 focus:ring-2 focus:ring-royal-100'

export default function AdminSettings() {
  const { profile, refreshProfile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  // profile form
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // password form
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name ?? '')
    setUsername(profile.username ?? '')
    setPhone(profile.phone_number ?? '')
  }, [profile])

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return setProfileMsg({ ok: false, text: 'Choose an image file' })
    if (f.size > 3 * 1024 * 1024) return setProfileMsg({ ok: false, text: 'Picture is too big (max 3 MB)' })
    setAvatarFile(f)
    setPreview(URL.createObjectURL(f))
    setProfileMsg(null)
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setProfileMsg(null)
    if (!fullName.trim()) return setProfileMsg({ ok: false, text: 'Enter your full name' })
    if (phone.trim() && phone.replace(/\D/g, '').length < 9) return setProfileMsg({ ok: false, text: 'Enter a valid phone number' })

    setSaving(true)
    let avatarUrl = profile.avatar_url
    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop() || 'jpg'
      const path = `${profile.id}/avatar.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, avatarFile, { upsert: true })
      if (upErr) {
        setSaving(false)
        return setProfileMsg({ ok: false, text: `Could not upload the picture: ${upErr.message}` })
      }
      avatarUrl = `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        username: username.trim() || null,
        phone_number: phone.trim() || null,
        avatar_url: avatarUrl,
      })
      .eq('id', profile.id)
    setSaving(false)
    if (error) {
      return setProfileMsg({ ok: false, text: error.code === '23505' ? 'That username is already taken' : error.message })
    }
    setAvatarFile(null)
    setPreview(null)
    await refreshProfile()
    setProfileMsg({ ok: true, text: 'Profile saved' })
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwMsg(null)
    if (!profile?.email) return setPwMsg({ ok: false, text: 'Your account has no email on file' })
    if (!current) return setPwMsg({ ok: false, text: 'Enter your current password' })
    if (next.length < MIN_PASSWORD) return setPwMsg({ ok: false, text: `New password must be at least ${MIN_PASSWORD} characters` })
    if (next !== confirm) return setPwMsg({ ok: false, text: "New passwords don't match" })
    if (next === current) return setPwMsg({ ok: false, text: 'Choose a password different from your current one' })

    setPwBusy(true)
    // Confirm the current password first, so a borrowed, unlocked device can't change it
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: profile.email, password: current })
    if (verifyErr) {
      setPwBusy(false)
      return setPwMsg({ ok: false, text: 'Your current password is incorrect' })
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: next })
    setPwBusy(false)
    if (updErr) return setPwMsg({ ok: false, text: updErr.message })
    setCurrent('')
    setNext('')
    setConfirm('')
    setPwMsg({ ok: true, text: 'Password changed' })
  }

  const shownAvatar = preview ?? profile?.avatar_url ?? null
  const initial = (profile?.full_name || profile?.email || 'A')[0].toUpperCase()

  const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
    m ? (
      <p className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${m.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
        {m.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {m.text}
      </p>
    ) : null

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-royal-900">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">Your admin profile and password.</p>

      {/* Profile */}
      <form onSubmit={saveProfile} className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold text-royal-900">
          <UserRound className="h-5 w-5" /> Profile
        </h2>

        <div className="mt-4 flex items-center gap-4">
          <div className="relative">
            {shownAvatar ? (
              <img src={shownAvatar} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-royal-600 text-2xl font-bold text-white">{initial}</span>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Change picture"
              className="absolute -bottom-1 -right-1 rounded-full bg-royal-600 p-2 text-white shadow hover:bg-royal-700"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-royal-900">{profile?.full_name || 'Admin'}</p>
            <p className="truncate text-sm text-gray-500">{profile?.email}</p>
            <span className="mt-1 inline-block rounded-full bg-royal-50 px-2.5 py-0.5 text-xs font-semibold text-royal-700">Admin</span>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-royal-900">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </label>
        <label className="mt-4 block text-sm font-medium text-royal-900">
          Username <span className="font-normal text-gray-400">(optional)</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
        </label>
        <label className="mt-4 block text-sm font-medium text-royal-900">
          Phone <span className="font-normal text-gray-400">(optional)</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0244123456" className={inputClass} />
        </label>
        <label className="mt-4 block text-sm font-medium text-royal-900">
          Email
          <input value={profile?.email ?? ''} disabled className={`${inputClass} cursor-not-allowed bg-gray-50 text-gray-500`} />
          <span className="mt-1 block text-xs font-normal text-gray-500">This is your sign-in email and can't be changed here.</span>
        </label>

        <Msg m={profileMsg} />
        <button type="submit" disabled={saving} className="mt-5 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save profile
        </button>
      </form>

      {/* Password */}
      <form onSubmit={changePassword} className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold text-royal-900">
          <KeyRound className="h-5 w-5" /> Change password
        </h2>
        <label className="mt-4 block text-sm font-medium text-royal-900">
          Current password
          <input type={show ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={inputClass} />
        </label>
        <label className="mt-4 block text-sm font-medium text-royal-900">
          New password
          <input type={show ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-gray-500">At least {MIN_PASSWORD} characters.</span>
        </label>
        <label className="mt-4 block text-sm font-medium text-royal-900">
          Confirm new password
          <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputClass} />
        </label>
        <button type="button" onClick={() => setShow(!show)} className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {show ? 'Hide' : 'Show'} passwords
        </button>
        <Msg m={pwMsg} />
        <button type="submit" disabled={pwBusy} className="mt-5 flex items-center gap-2 rounded-lg bg-royal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-royal-700 disabled:opacity-60">
          {pwBusy && <Loader2 className="h-4 w-4 animate-spin" />} Change password
        </button>
      </form>

      <MfaSetup />

      <OfflineDownload />
    </div>
  )
}

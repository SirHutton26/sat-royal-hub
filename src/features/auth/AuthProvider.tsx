import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type Role = 'admin' | 'teacher' | 'bursar'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  role: Role
  is_active: boolean
  username: string | null
  phone_number: string | null
  avatar_url: string | null
  onboarding_completed: boolean
  alerts_last_seen_at: string
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const CACHE_KEY = 'sat-hub-profile'
const PROFILE_COLUMNS =
  'id, email, full_name, role, is_active, username, phone_number, avatar_url, onboarding_completed, alerts_last_seen_at'

function readCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const cached = raw ? (JSON.parse(raw) as Profile) : null
    return cached && cached.id === userId ? cached : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string): Promise<Profile | null> {
    const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single()

    if (data) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      setProfile(data as Profile)
      return data as Profile
    }

    if (!navigator.onLine) {
      const cached = readCachedProfile(userId)
      setProfile(cached)
      return cached
    }

    setProfile(null)
    return null
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession) {
        setProfile(null)
        localStorage.removeItem(CACHE_KEY)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return error.message
    const p = data.user ? await loadProfile(data.user.id) : null
    return p ? null : 'Could not load your account profile. Please try again.'
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    localStorage.removeItem(CACHE_KEY)
  }

  async function refreshProfile() {
    if (session) await loadProfile(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
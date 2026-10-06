import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { checkCred, saveCred, setOfflineUser } from '@/lib/offline-db'
import { flushActivity, logActivity, setActivityUser } from '@/lib/activity'

export type Role = 'admin' | 'teacher' | 'bursar' | 'messenger'

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
  /** true while signed in from this phone's saved login with no connection */
  offline: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const CACHE_KEY = 'sat-hub-profile'
const OFFLINE_FLAG = 'sat-hub-offline-user'
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
  const [offline, setOffline] = useState(false)
  const offlineRef = useRef(false)
  const memCred = useRef<{ email: string; password: string } | null>(null) // memory only, for re-login on reconnect

  function setOfflineMode(on: boolean) {
    offlineRef.current = on
    setOffline(on)
  }

  function enterOffline(p: Profile) {
    setOfflineUser(p.id)
    setProfile(p)
    setSession({ access_token: '', refresh_token: '', expires_in: 0, token_type: 'bearer', user: { id: p.id, email: p.email } } as unknown as Session)
    setOfflineMode(true)
  }

  function clearLocal() {
    setSession(null)
    setProfile(null)
    setOfflineUser(null)
    setOfflineMode(false)
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(OFFLINE_FLAG)
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k)
  }

  async function loadProfile(userId: string): Promise<Profile | null> {
    setOfflineUser(userId)
    const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single()

    if (data) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(OFFLINE_FLAG, userId)
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
      if (data.session) {
        setSession(data.session)
        await loadProfile(data.session.user.id)
      } else if (!navigator.onLine) {
        // Token couldn't refresh without internet: keep a returning user in using the saved profile
        const uid = localStorage.getItem(OFFLINE_FLAG)
        const cached = uid ? readCachedProfile(uid) : null
        if (cached) enterOffline(cached)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) {
        setSession(newSession)
        setOfflineUser(newSession.user.id)
        setOfflineMode(false)
      } else if (!offlineRef.current) {
        setSession(null)
        setProfile(null)
        setOfflineUser(null)
        localStorage.removeItem(CACHE_KEY)
      }
    })

    // Back online while signed in offline: get a real session, or send them to sign in again
    async function onOnline() {
      if (!offlineRef.current) return
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        setSession(data.session)
        setOfflineMode(false)
        await loadProfile(data.session.user.id)
        return
      }
      const c = memCred.current
      if (c) {
        const { data: d, error } = await supabase.auth.signInWithPassword(c)
        if (!error && d.user) {
          setOfflineMode(false)
          await loadProfile(d.user.id)
          return
        }
      }
      setSession(null)
      setProfile(null)
      setOfflineMode(false)
      localStorage.removeItem(OFFLINE_FLAG)
    }
    window.addEventListener('online', onOnline)

    return () => {
      sub.subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [])

  useEffect(() => {
    setActivityUser(session && profile && !offline ? { id: profile.id, name: profile.full_name || profile.email || 'User', role: profile.role } : null)
  }, [session, profile, offline])

  async function offlineSignIn(email: string, password: string) {
    const r = await checkCred(email, password)
    if (r === 'none')
      return 'No internet connection. Sign in online once on this phone first, then you can sign in offline.'
    if (r === 'wrong') return 'Incorrect email or password.'
    const p = r.profile as Profile
    if (!p.is_active) return 'This account is not active.'
    memCred.current = { email, password }
    localStorage.setItem(CACHE_KEY, JSON.stringify(p))
    localStorage.setItem(OFFLINE_FLAG, p.id)
    enterOffline(p)
    return null
  }

  async function signIn(email: string, password: string) {
    const e = email.trim().toLowerCase()
    if (!navigator.onLine) return offlineSignIn(e, password)
    const { data, error } = await supabase.auth.signInWithPassword({ email: e, password })
    if (error) {
      if (error.name === 'AuthRetryableFetchError') return offlineSignIn(e, password)
      return error.message
    }
    const p = data.user ? await loadProfile(data.user.id) : null
    if (p && data.user) {
      await saveCred(e, data.user.id, password, p)
      void supabase.from('activity_log').insert({ user_id: data.user.id, user_name: p.full_name || p.email, user_role: p.role, action: 'login', entity: 'session' })
    }
    return p ? null : 'Could not load your account profile. Please try again.'
  }

  async function signOut() {
    logActivity('logout', 'session')
    await flushActivity()
    setActivityUser(null)
    try {
      await supabase.auth.signOut()
    } catch {
      /* offline: local clean-up below is what matters */
    }
    memCred.current = null
    clearLocal()
  }

  async function refreshProfile() {
    if (session && !offlineRef.current) await loadProfile(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, offline, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: u, error: ue } = await caller.auth.getUser()
    if (ue || !u.user) return json({ error: 'Invalid session' }, 401)

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', u.user.id).single()
    if (!me || me.role !== 'admin' || !me.is_active) return json({ error: 'Only admins can reset passwords' }, 403)

    const { userId, password } = await req.json()
    if (!userId || typeof password !== 'string' || password.length < 6)
      return json({ error: 'userId and a password of at least 6 characters are required' }, 400)

    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return json({ error: error.message }, 400)
    return json({ success: true })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

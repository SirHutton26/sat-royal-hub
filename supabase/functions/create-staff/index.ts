// Creates a sign-in account for a non-teaching staff member with a temporary password.
// Same idea as create-teacher: the admin chooses the password, the staff member changes it on first login.
//
// Deploy:  supabase functions deploy create-staff
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Only a signed-in, active admin may create accounts
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: caller } = await admin.auth.getUser(token)
    if (!caller.user) return json({ error: 'Not signed in' }, 401)
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, is_active')
      .eq('id', caller.user.id)
      .single()
    if (callerProfile?.role !== 'admin' || !callerProfile.is_active) return json({ error: 'Only admins can create staff logins' }, 403)
    if (!(await mfaOk(admin, token, caller.user!.id))) return json({ error: 'Two-step verification required' }, 401)

    const { fullName, email, password, position, phone } = await req.json()
    const mail = String(email ?? '').trim().toLowerCase()
    if (!String(fullName ?? '').trim() || !mail || String(password ?? '').length < 6) {
      return json({ error: 'Name, email and a password of at least 6 characters are required' }, 400)
    }

    // The bursar has the fees portal and the SMS officer has the messaging portal; everyone else uses the staff portal
    const pos = String(position ?? '')
    const role = /^\s*bursar\s*$/i.test(pos)
      ? 'bursar'
      : /^\s*(sms|messenger|sms officer|communications?)\s*$/i.test(pos)
        ? 'messenger'
        : /^\s*head\s*-?\s*(teacher|master|mistress)\s*$/i.test(pos)
          ? 'headteacher'
          : /^\s*store\s*-?\s*keeper\s*$/i.test(pos)
            ? 'storekeeper'
            : 'staff'

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: mail,
      password,
      email_confirm: true,
      user_metadata: { full_name: String(fullName).trim() },
    })
    if (createError || !created.user) {
      const exists = /already|registered|exists/i.test(createError?.message ?? '')
      return json({ error: exists ? 'That email already has a login' : (createError?.message ?? 'Could not create the account') }, exists ? 409 : 400)
    }

    // Works whether or not a trigger already created the profile row
    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      email: mail,
      full_name: String(fullName).trim(),
      role,
      is_active: true,
      phone_number: phone ? String(phone).trim() : null,
      onboarding_completed: false,
    })
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id) // don't leave a half-made account behind
      return json({ error: profileError.message }, 400)
    }

    return json({ id: created.user.id, role })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

/** True unless the account has an authenticator app but this login skipped the code step. */
// deno-lint-ignore no-explicit-any
async function mfaOk(client: any, token: string, userId: string) {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (claims.aal === 'aal2') return true
    const { data } = await client.auth.admin.mfa.listFactors({ userId })
    return !(data?.factors ?? []).some((f: { status: string }) => f.status === 'verified')
  } catch {
    return false
  }
}

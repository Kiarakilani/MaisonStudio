/* ============================================================
   Maison Studio — Supabase client
   Paste your Supabase project URL and anon public key below.
   Project Settings → API in your Supabase dashboard.
   The anon key is public/safe to have in client-side code — it's
   not a secret (unlike the service_role key, never used here).
   ============================================================ */
const MAISON_SUPABASE_URL = 'https://fkoqajrfvgdprohucxlb.supabase.co';
const MAISON_SUPABASE_ANON_KEY = 'sb_publishable_T16yqREo4JxABRYDng5Qdw_e3ONNWW1';

window.maisonSupabase =
  (MAISON_SUPABASE_URL.startsWith('PASTE_') || MAISON_SUPABASE_ANON_KEY.startsWith('PASTE_'))
    ? null
    : supabase.createClient(MAISON_SUPABASE_URL, MAISON_SUPABASE_ANON_KEY);

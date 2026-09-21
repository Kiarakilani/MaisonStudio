/* ============================================================
   Maison Studio — Auth guard
   Include on every page that requires a signed-in user. Redirects
   to auth.html if there's no session. Exposes window.maisonUser
   and window.MaisonAuth.ready() / .signOut() for the page to use.
   If supabase-client.js has no real credentials yet, this becomes
   a no-op so the app keeps working exactly as before (local-only).
   ============================================================ */
window.MaisonAuth = (function () {
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });

  async function init() {
    if (!window.maisonSupabase) {
      // No Supabase project configured yet — behave like the original app.
      readyResolve(null);
      return;
    }
    const { data, error } = await window.maisonSupabase.auth.getSession();
    if (error) {
      console.error('Auth check failed', error);
      readyResolve(null);
      return;
    }
    const session = data && data.session;
    if (!session) {
      const page = location.pathname.split('/').pop() || 'home.html';
      if (page !== 'auth.html' && page !== 'index.html') {
        location.href = 'auth.html?next=' + encodeURIComponent(page);
      }
      return; // navigating away — leave readyPromise unresolved
    }
    window.maisonUser = session.user;

    // Keep window.maisonUser current and bounce to auth.html on sign-out.
    window.maisonSupabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        location.href = 'auth.html';
      } else {
        window.maisonUser = newSession.user;
      }
    });

    readyResolve(session.user);
  }

  init();

  return {
    ready: () => readyPromise,
    async signOut() {
      if (window.maisonSupabase) {
        await window.maisonSupabase.auth.signOut();
      }
      location.href = 'auth.html';
    }
  };
})();

/* ============================================================
   Maison Studio — localStorage <-> Supabase sync shim
   ------------------------------------------------------------
   This file makes NO changes to how any page's own code works:
   every page still calls localStorage.getItem()/.setItem() with
   the exact same keys and JSON shapes it always has. This shim
   intercepts those calls so the data is also kept in sync with
   Supabase, scoped to the signed-in user.

   Include order on every page: supabase-js CDN, supabase-client.js,
   auth-guard.js, then this file. Each page's own <script> block
   should wrap its existing bootstrap calls (the load*()/render*()
   calls that currently run immediately) in:

       MaisonSync.ready().then(function(){
         ...existing bootstrap calls, unchanged...
       });

   If no Supabase project is configured yet (supabase-client.js
   still has placeholder values), this shim does nothing and the
   app behaves exactly like the original local-only version.
   ============================================================ */
window.MaisonSync = (function () {
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });
  let silent = false; // true while we're writing pulled data back into localStorage

  const nativeSetItem = Storage.prototype.setItem;
  const nativeGetItem = Storage.prototype.getItem;

  function silentSet(key, value) {
    silent = true;
    try { nativeSetItem.call(window.localStorage, key, value); }
    finally { silent = false; }
  }

  /* ---------- generic helpers ---------- */
  function safeParse(json, fallback) {
    try { const v = json ? JSON.parse(json) : fallback; return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }

  async function upsertAndPrune(table, userId, rows, keepIds) {
    if (rows.length) {
      const { error } = await window.maisonSupabase.from(table).upsert(rows);
      if (error) { console.error('Sync upsert failed for', table, error); return; }
    }
    const { data: existing, error: selErr } = await window.maisonSupabase
      .from(table).select('id').eq('user_id', userId);
    if (selErr) { console.error('Sync prune select failed for', table, selErr); return; }
    const toDelete = (existing || [])
      .map((r) => r.id)
      .filter((id) => !keepIds.has(id));
    if (toDelete.length) {
      await window.maisonSupabase.from(table).delete().in('id', toDelete);
    }
  }

  /* ---------- table registry: localStorage key -> sync behavior ---------- */
  const REGISTRY = {
    'content-desk-items': arrayTable('content_items', {
      toRow: (it, uid) => ({
        id: it.id, user_id: uid, title: it.title || 'Untitled',
        platform: it.platform || 'Other', format: it.format || '', pillar: it.pillar || '',
        thought: it.thought || '', stage: it.stage || 0, due_date: it.dueDate || null,
        campaign: it.campaign || '', hook: it.hook || '', script: it.script || '',
        caption: it.caption || '', notes: it.notes || '',
        inspiration_link: it.inspirationLink || '', website_link: it.websiteLink || '',
        media: it.media || [], checklist: it.checklist || [], vault_refs: it.vaultRefs || [],
        created_at: it.createdAt || new Date().toISOString(),
        updated_at: it.updatedAt || new Date().toISOString()
      }),
      fromRow: (r) => ({
        id: r.id, title: r.title, platform: r.platform, format: r.format, pillar: r.pillar,
        thought: r.thought, stage: r.stage, dueDate: r.due_date, campaign: r.campaign,
        hook: r.hook, script: r.script, caption: r.caption, notes: r.notes,
        inspirationLink: r.inspiration_link, websiteLink: r.website_link,
        media: r.media || [], checklist: r.checklist || [], vaultRefs: r.vault_refs || [],
        createdAt: r.created_at, updatedAt: r.updated_at
      })
    }),
    'maison-vault-items': arrayTable('vault_items', {
      toRow: (it, uid) => ({
        id: it.id, user_id: uid, text: it.text || '', type: it.type || 'Other',
        pillar: it.pillar || '', notes: it.notes || '', platform: it.platform || '',
        source_url: it.sourceUrl || '', tags: it.tags || [],
        linked_content_ids: it.linkedContentIds || [],
        created_at: it.createdAt || new Date().toISOString(),
        updated_at: it.updatedAt || new Date().toISOString()
      }),
      fromRow: (r) => ({
        id: r.id, text: r.text, type: r.type, pillar: r.pillar, notes: r.notes,
        platform: r.platform, sourceUrl: r.source_url, tags: r.tags || [],
        linkedContentIds: r.linked_content_ids || [],
        createdAt: r.created_at, updatedAt: r.updated_at
      })
    }),
    'maison-planner-activities': arrayTable('planner_activities', {
      toRow: (it, uid) => ({
        id: it.id, user_id: uid, type: it.type, content_id: it.contentId || null,
        action: it.action || null, title: it.title || null, date: it.date,
        start_time: it.startTime || null, end_time: it.endTime || null, notes: it.notes || ''
      }),
      fromRow: (r) => ({
        id: r.id, type: r.type, contentId: r.content_id, action: r.action,
        title: r.title, date: r.date, startTime: r.start_time, endTime: r.end_time,
        notes: r.notes
      })
    }),
    'maison-planner-routines': arrayTable('planner_routines', {
      toRow: (it, uid) => ({ id: it.id, user_id: uid, name: it.name, day: it.day, time: it.time, repeat: it.repeat || 'weekly' }),
      fromRow: (r) => ({ id: r.id, name: r.name, day: r.day, time: r.time, repeat: r.repeat })
    }),
    'maison-goals': arrayTable('goals', {
      toRow: (g, uid) => ({
        id: g.id, user_id: uid, type: g.type, category: g.category || '', name: g.name,
        status: g.status || 'active', platform: g.platform || null, format: g.format || null,
        target: g.target != null ? g.target : null, period: g.period || 'week',
        progress_source: g.progressSource || null, manual_current: g.manualCurrent || 0,
        schedule_note: g.scheduleNote || '', unit_label: g.unitLabel || null,
        current_value: g.currentValue != null ? g.currentValue : null,
        target_value: g.targetValue != null ? g.targetValue : null,
        unit: g.unit || null, target_date: g.targetDate || null,
        is_current_focus: !!g.isCurrentFocus,
        linked_activity_goal_ids: g.linkedActivityGoalIds || [],
        created_at: g.createdAt || new Date().toISOString(),
        updated_at: g.updatedAt || new Date().toISOString()
      }),
      fromRow: (r) => ({
        id: r.id, type: r.type, category: r.category, name: r.name, status: r.status,
        platform: r.platform, format: r.format, target: r.target, period: r.period,
        progressSource: r.progress_source, manualCurrent: r.manual_current,
        scheduleNote: r.schedule_note, unitLabel: r.unit_label, currentValue: r.current_value,
        targetValue: r.target_value, unit: r.unit, targetDate: r.target_date,
        isCurrentFocus: r.is_current_focus,
        linkedActivityGoalIds: r.linked_activity_goal_ids || [],
        createdAt: r.created_at, updatedAt: r.updated_at
      })
    }),
    'maison-content-pillars': stringListTable('content_pillars'),
    'maison-routine-goal-completions': keyedMapTable('routine_goal_completions', {
      parseKey: (k) => { const i = k.lastIndexOf(':'); return { goal_id: k.slice(0, i), week_start: k.slice(i + 1) }; },
      toKey: (r) => r.goal_id + ':' + r.week_start,
      extraCols: (r) => ({ goal_id: r.goal_id, week_start: r.week_start, completed: true })
    }),
    'maison-inbox-status': keyedMapTable('inbox_status', {
      parseKey: (k) => ({ email_id: k }),
      toKey: (r) => r.email_id,
      extraCols: (r, value) => ({ email_id: r.email_id, status: value }),
      valueFromRow: (r) => r.status
    })
  };

  function arrayTable(table, { toRow, fromRow }) {
    return {
      async pull(userId) {
        const { data, error } = await window.maisonSupabase.from(table).select('*').eq('user_id', userId);
        if (error) { console.error('Sync pull failed for', table, error); return null; }
        return (data || []).map(fromRow);
      },
      async push(userId, arr) {
        const rows = arr.map((it) => toRow(it, userId));
        const keepIds = new Set(arr.map((it) => it.id));
        await upsertAndPrune(table, userId, rows, keepIds);
      }
    };
  }

  function stringListTable(table) {
    return {
      async pull(userId) {
        const { data, error } = await window.maisonSupabase
          .from(table).select('*').eq('user_id', userId).order('sort_order');
        if (error) { console.error('Sync pull failed for', table, error); return null; }
        return (data || []).map((r) => r.name);
      },
      async push(userId, names) {
        await window.maisonSupabase.from(table).delete().eq('user_id', userId);
        if (names.length) {
          const rows = names.map((name, i) => ({ user_id: userId, name, sort_order: i }));
          await window.maisonSupabase.from(table).insert(rows);
        }
      }
    };
  }

  function keyedMapTable(table, { parseKey, toKey, extraCols, valueFromRow }) {
    return {
      async pull(userId) {
        const { data, error } = await window.maisonSupabase.from(table).select('*').eq('user_id', userId);
        if (error) { console.error('Sync pull failed for', table, error); return null; }
        const map = {};
        (data || []).forEach((r) => {
          map[toKey(r)] = valueFromRow ? valueFromRow(r) : true;
        });
        return map;
      },
      async push(userId, map) {
        await window.maisonSupabase.from(table).delete().eq('user_id', userId);
        const entries = Object.keys(map || {}).filter((k) => map[k]);
        if (entries.length) {
          const rows = entries.map((k) => Object.assign({ user_id: userId }, extraCols(parseKey(k), map[k])));
          await window.maisonSupabase.from(table).insert(rows);
        }
      }
    };
  }

  /* ---------- home state is special: one localStorage key, two tables ---------- */
  const HOME_KEY = 'maison-home-v2';
  async function pullHome(userId) {
    const [{ data: tasks, error: e1 }, { data: sched, error: e2 }] = await Promise.all([
      window.maisonSupabase.from('home_tasks').select('*').eq('user_id', userId).order('sort_order'),
      window.maisonSupabase.from('home_schedule').select('*').eq('user_id', userId).order('sort_order')
    ]);
    if (e1 || e2) { console.error('Sync pull failed for home state', e1 || e2); return null; }
    const existing = safeParse(nativeGetItem.call(window.localStorage, HOME_KEY), {});
    return {
      tasks: (tasks || []).map((r) => ({
        id: r.id, title: r.title, tag: r.tag, tagLabel: r.tag_label, time: r.time,
        done: r.done, reason: r.reason, urgent: r.urgent, note: r.note
      })),
      schedule: (sched || []).map((r) => ({ id: r.id, time: r.time, what: r.what })),
      emailsCount: existing.emailsCount || 0,
      emailsContext: existing.emailsContext || ''
    };
  }
  async function pushHome(userId, state) {
    const tasks = state.tasks || [];
    const taskRows = tasks.map((t, i) => ({
      id: t.id, user_id: userId, title: t.title, tag: t.tag || null, tag_label: t.tagLabel || null,
      time: t.time || null, done: !!t.done, reason: t.reason || '', urgent: !!t.urgent,
      note: t.note || '', sort_order: i
    }));
    await upsertAndPrune('home_tasks', userId, taskRows, new Set(tasks.map((t) => t.id)));

    const sched = state.schedule || [];
    const schedRows = sched.map((s, i) => ({ id: s.id, user_id: userId, time: s.time, what: s.what, sort_order: i }));
    await upsertAndPrune('home_schedule', userId, schedRows, new Set(sched.map((s) => s.id)));
  }

  /* ---------- pull everything into localStorage (page load) ---------- */
  async function pullAll(userId) {
    for (const key of Object.keys(REGISTRY)) {
      const result = await REGISTRY[key].pull(userId);
      if (result !== null) silentSet(key, JSON.stringify(result));
    }
    const home = await pullHome(userId);
    if (home !== null) silentSet(HOME_KEY, JSON.stringify(home));
  }

  /* ---------- push a single key's new value (on write) ---------- */
  let pushChain = Promise.resolve();
  function queuePush(userId, key, rawValue) {
    pushChain = pushChain.then(async () => {
      try {
        if (key === HOME_KEY) {
          await pushHome(userId, safeParse(rawValue, {}));
        } else if (REGISTRY[key]) {
          const parsed = safeParse(rawValue, key === 'maison-content-pillars' ? [] : (Array.isArray(safeParse(rawValue, [])) ? [] : {}));
          await REGISTRY[key].push(userId, parsed);
        }
      } catch (e) {
        console.error('Sync push failed for', key, e);
      }
    });
  }

  /* ---------- one-time import: if Supabase is empty but local isn't, upload it ---------- */
  async function maybeImportLocalData(userId) {
    const flag = 'maison-supabase-imported-' + userId;
    if (nativeGetItem.call(window.localStorage, flag)) return;

    const { count } = await window.maisonSupabase
      .from('content_items').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (count && count > 0) {
      // Already has server data — nothing to import, just mark done.
      silentSet(flag, '1');
      return;
    }

    for (const key of Object.keys(REGISTRY)) {
      const local = safeParse(nativeGetItem.call(window.localStorage, key), null);
      if (local && (Array.isArray(local) ? local.length : Object.keys(local).length)) {
        await REGISTRY[key].push(userId, local);
      }
    }
    const localHome = safeParse(nativeGetItem.call(window.localStorage, HOME_KEY), null);
    if (localHome) await pushHome(userId, localHome);

    silentSet(flag, '1');
  }

  /* ---------- install the write hook once auth + first pull are done ---------- */
  function installWriteHook(userId) {
    Storage.prototype.setItem = function (key, value) {
      nativeSetItem.call(this, key, value);
      if (this === window.localStorage && !silent && (REGISTRY[key] || key === HOME_KEY)) {
        queuePush(userId, key, value);
      }
    };
  }

  async function init() {
    const user = await window.MaisonAuth.ready();
    if (!user) { readyResolve(); return; } // no Supabase configured — behave like the original app
    await maybeImportLocalData(user.id); // upload existing local data first time only
    await pullAll(user.id);              // then pull the authoritative server copy
    installWriteHook(user.id);
    readyResolve();
  }

  init();

  return { ready: () => readyPromise };
})();

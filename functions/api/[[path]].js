// Ulysses App — Cloudflare Pages Function (D1 API)
// Catch-all handler for /api/*

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function uid() {
  return crypto.randomUUID();
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const segments = params.path || [];
  const path = segments.join('/');
  const method = request.method;
  const DB = env.DB;

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
    });
  }

  // Auth check
  let userId = null;
  let isAdmin = false;
  if (path !== 'auth' && path !== 'init') {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const { results } = await DB.prepare('SELECT value FROM settings WHERE key = ?')
      .bind('session:' + token).all();
    const val = results[0]?.value;
    if (!val) return json({ error: 'Unauthorized' }, 401);

    const parts = val.split('|');
    if (parts.length < 2) {
      await DB.prepare('DELETE FROM settings WHERE key = ?').bind('session:' + token).run();
      return json({ error: 'Unauthorized' }, 401);
    }
    const storedUserId = parts[0];
    const expires = parseInt(parts[1]);
    if (Date.now() > expires) {
      await DB.prepare('DELETE FROM settings WHERE key = ?').bind('session:' + token).run();
      return json({ error: 'Unauthorized' }, 401);
    }
    userId = storedUserId;

    // Lightweight verify endpoint — just confirms session is valid
    if (path === 'verify' && method === 'GET') {
      return json({ ok: true, userId });
    }

    // Only check admin for admin endpoints
    if (path.startsWith('admin')) {
      const { results: uRow } = await DB.prepare('SELECT passwordHash FROM users WHERE id = ?').bind(userId).all();
      if (uRow.length > 0 && uRow[0].passwordHash === env.AUTH_TOKEN) isAdmin = true;
      if (!isAdmin) return json({ error: 'Forbidden' }, 403);
    }
  }

  try {
    const body = method !== 'GET' && method !== 'DELETE'
      ? await request.json().catch(() => ({}))
      : {};


    // --- Admin: User management ---
    if (path === 'admin/users' && method === 'GET') {
      const { results } = await DB.prepare('SELECT id, name, createdAt FROM users ORDER BY createdAt').all();
      return json(results);
    }

    if (path === 'admin/users' && method === 'POST') {
      const { name, password } = body;
      if (!name || !password) return json({ error: 'name and password required' }, 400);
      const passwordHash = await hashPassword(password);
      const { results: existing } = await DB.prepare('SELECT id FROM users WHERE passwordHash = ?').bind(passwordHash).all();
      if (existing.length > 0) return json({ error: 'Password already in use' }, 400);
      const user = { id: uid(), name, passwordHash, createdAt: Date.now() };
      await DB.prepare('INSERT INTO users (id, name, passwordHash, createdAt) VALUES (?, ?, ?, ?)')
        .bind(user.id, user.name, user.passwordHash, user.createdAt).run();
      const group = { id: uid(), parentId: null, name: 'Inbox', sortOrder: 0, createdAt: Date.now(), userId: user.id };
      await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt, userId) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(group.id, group.parentId, group.name, group.sortOrder, group.createdAt, group.userId).run();
      return json({ id: user.id, name: user.name });
    }

    if (segments[0] === 'admin' && segments[1] === 'users' && segments[2] && method === 'DELETE') {
      const delId = segments[2];
      if (delId === userId) return json({ error: 'Cannot delete yourself' }, 400);
      const { results: groups } = await DB.prepare('SELECT id FROM groups WHERE userId = ?').bind(delId).all();
      for (const g of groups) { await deleteGroupRecursive(g.id, DB); }
      const { results: tags } = await DB.prepare('SELECT id FROM tags WHERE userId = ?').bind(delId).all();
      for (const t of tags) { await DB.prepare('DELETE FROM sheet_tags WHERE tagId = ?').bind(t.id).run(); }
      await DB.prepare('DELETE FROM tags WHERE userId = ?').bind(delId).run();
      await DB.prepare('DELETE FROM users WHERE id = ?').bind(delId).run();
      return json({ ok: true });
    }

    if (segments[0] === 'admin' && segments[1] === 'users' && segments[2] && method === 'PUT') {
      const targetId = segments[2];
      const { password } = body;
      if (!password) return json({ error: 'password required' }, 400);
      const newHash = await hashPassword(password);
      const { results: existing } = await DB.prepare('SELECT id FROM users WHERE passwordHash = ? AND id != ?').bind(newHash, targetId).all();
      if (existing.length > 0) return json({ error: 'Password already in use' }, 400);
      await DB.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').bind(newHash, targetId).run();
      return json({ ok: true });
    }

    if (segments[0] === 'admin' && segments[1] === 'users' && segments[2] && method === 'PUT') {
      const targetId = segments[2];
      const { password } = body;
      if (!password) return json({ error: 'password required' }, 400);
      const newHash = await hashPassword(password);
      const { results: existing } = await DB.prepare('SELECT id FROM users WHERE passwordHash = ? AND id != ?').bind(newHash, targetId).all();
      if (existing.length > 0) return json({ error: 'Password already in use' }, 400);
      await DB.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').bind(newHash, targetId).run();
      return json({ ok: true });
    }

    // --- Auth ---
    if (path === 'auth' && method === 'POST') {
      const inputHash = await hashPassword(body.token || '');

      // Ensure users table exists
      await DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, passwordHash TEXT NOT NULL UNIQUE, createdAt INTEGER)').run();
      try { await DB.prepare('ALTER TABLE groups ADD COLUMN userId TEXT DEFAULT NULL').run(); } catch(e){}
      try { await DB.prepare('ALTER TABLE tags ADD COLUMN userId TEXT DEFAULT NULL').run(); } catch(e){}

      // Auto-create admin user if none exist
      const { results: uc } = await DB.prepare('SELECT COUNT(*) as cnt FROM users').all();
      if (uc[0].cnt === 0 && inputHash === env.AUTH_TOKEN) {
        const adminId = crypto.randomUUID();
        await DB.prepare('INSERT INTO users (id, name, passwordHash, createdAt) VALUES (?, ?, ?, ?)')
          .bind(adminId, 'Admin', env.AUTH_TOKEN, Date.now()).run();
        await DB.prepare('UPDATE groups SET userId = ? WHERE userId IS NULL').bind(adminId).run();
        await DB.prepare('UPDATE tags SET userId = ? WHERE userId IS NULL').bind(adminId).run();
      }

      // Look up user
      const { results: users } = await DB.prepare(
        'SELECT id, name FROM users WHERE passwordHash = ?'
      ).bind(inputHash).all();
      if (users.length > 0) {
        const user = users[0];
        const session = crypto.randomUUID();
        const expires = Date.now() + (180 * 24 * 60 * 60 * 1000);
        await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
          .bind('session:' + session, user.id + '|' + expires).run();
        return json({ ok: true, session, expires, userId: user.id, userName: user.name, isAdmin: (inputHash === env.AUTH_TOKEN) });
      }
      return json({ ok: false }, 401);
    }

    // --- Poll: lightweight check for changes ---
    if (path === 'poll' && method === 'GET') {
      const { results } = await DB.prepare(
        `SELECT MAX(s.updatedAt) as lastModified, COUNT(*) as total
         FROM sheets s JOIN groups g ON s.groupId = g.id
         WHERE s.isTrashed = 0 AND g.userId = ?`
      ).bind(userId).all();
      const r = results[0] || {};
      return json({ lastModified: r.lastModified || 0, total: r.total || 0 });
    }

    // --- Bootstrap: single call returns groups + counts + first sheets + tags ---
    if (path === 'bootstrap' && method === 'GET') {
      const url = new URL(request.url);
      const deepSheetId = url.searchParams.get('sheet');

      // Run all queries in parallel
      const [groupsR, countsR, tagsR] = await Promise.all([
        DB.prepare(
          `SELECT g.id, g.parentId as parentId, g.name, g.sortOrder, g.createdAt,
                  g.icon, g.iconColor, g.collapsed, g.section,
                  COALESCE(cnt, 0) as sheetCount
           FROM groups g
           LEFT JOIN (SELECT groupId, COUNT(*) as cnt FROM sheets WHERE isTrashed = 0 GROUP BY groupId) s
           ON g.id = s.groupId WHERE g.userId = ? ORDER BY g.sortOrder`
        ).bind(userId).all(),
        DB.prepare(`SELECT
          (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND g.userId=?) as all_count,
          (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND s.createdAt>? AND g.userId=?) as recent,
          (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND s.favorite=1 AND g.userId=?) as favorites,
          (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=1 AND g.userId=?) as trash
        `).bind(userId, Date.now() - 7*24*60*60*1000, userId, userId, userId).all(),
        DB.prepare(
          `SELECT t.*, COALESCE(c.cnt, 0) as sheetCount
           FROM tags t
           LEFT JOIN (SELECT st.tagId, COUNT(*) as cnt FROM sheet_tags st JOIN sheets s ON st.sheetId = s.id WHERE s.isTrashed = 0 GROUP BY st.tagId) c ON t.id = c.tagId
           WHERE t.userId = ? ORDER BY sheetCount DESC, t.name ASC`
        ).bind(userId).all(),
      ]);

      const groups = groupsR.results;
      const c = countsR.results[0];
      const counts = { all: c.all_count, recent: c.recent, favorites: c.favorites, trash: c.trash };
      const tags = tagsR.results;

      // Fetch ALL non-trashed sheets (one query, all groups) + their tags
      const [allSheetsR, allSheetTagsR] = await Promise.all([
        DB.prepare(
          `SELECT sheets.*, groups.name AS groupName FROM sheets
           LEFT JOIN groups ON sheets.groupId = groups.id
           WHERE sheets.isTrashed = 0 AND groups.userId = ?
           ORDER BY sheets.sortOrder ASC`
        ).bind(userId).all(),
        DB.prepare(
          `SELECT st.sheetId, t.id, t.name, t.color FROM sheet_tags st
           JOIN tags t ON st.tagId = t.id
           JOIN sheets s ON st.sheetId = s.id
           JOIN groups g ON s.groupId = g.id
           WHERE s.isTrashed = 0 AND g.userId = ?`
        ).bind(userId).all(),
      ]);

      const allSheets = allSheetsR.results;

      // Attach tags to sheets
      const tagMap = {};
      for (const row of allSheetTagsR.results) {
        (tagMap[row.sheetId] ||= []).push({ id: row.id, name: row.name, color: row.color });
      }
      for (const sheet of allSheets) {
        sheet.tags = tagMap[sheet.id] || [];
      }

      // Group sheets by groupId for client-side caching
      const sheetsByGroup = {};
      for (const sheet of allSheets) {
        (sheetsByGroup[sheet.groupId] ||= []).push(sheet);
      }

      // Determine first group's sheets (including subgroups)
      let firstGroupId = null;
      let firstGroupSheets = [];
      if (deepSheetId) {
        const ds = allSheets.find(s => s.id === deepSheetId);
        if (ds) {
          firstGroupId = ds.groupId;
        }
      }
      if (!firstGroupId && groups.length > 0) {
        firstGroupId = groups[0].id;
      }

      if (firstGroupId) {
        // Collect firstGroup + descendant IDs from already-loaded groups
        const childMap = {};
        for (const g of groups) {
          if (g.parentId) (childMap[g.parentId] ||= []).push(g.id);
        }
        const groupIds = new Set();
        const stack = [firstGroupId];
        while (stack.length > 0) {
          const id = stack.pop();
          groupIds.add(id);
          if (childMap[id]) stack.push(...childMap[id]);
        }
        firstGroupSheets = allSheets.filter(s => groupIds.has(s.groupId));
      }

      return json({ groups, counts, tags, sheets: firstGroupSheets, sheetsByGroup, firstGroupId });
    }

    // --- Groups ---
    if (path === 'groups' && method === 'GET') {
      const { results } = await DB.prepare(
        `SELECT g.id, g.parentId as parentId, g.name, g.sortOrder, g.createdAt,
                g.icon, g.iconColor, g.collapsed, g.section,
                COALESCE(cnt, 0) as sheetCount
         FROM groups g
         LEFT JOIN (SELECT groupId, COUNT(*) as cnt FROM sheets WHERE isTrashed = 0 GROUP BY groupId) s
         ON g.id = s.groupId WHERE g.userId = ? ORDER BY g.sortOrder`
      ).bind(userId).all();
      // Log for debugging subgroup issue
      const withParent = results.filter(g => g.parentId);
      if (withParent.length > 0) console.log('Groups with parentId:', JSON.stringify(withParent.map(g => ({ id: g.id, name: g.name, parentId: g.parentId }))));
      return json(results);
    }

    if (path === 'groups' && method === 'POST') {
      const { name, parentId } = body;
      console.log('CREATE GROUP body:', JSON.stringify(body), 'parentId:', parentId);
      const pid = parentId || null;
      let sortOrder = 0;
      if (pid) {
        const { results } = await DB.prepare('SELECT COUNT(*) as cnt FROM groups WHERE parentId = ?').bind(pid).all();
        sortOrder = results[0]?.cnt || 0;
      } else {
        const { results } = await DB.prepare('SELECT COUNT(*) as cnt FROM groups WHERE parentId IS NULL').all();
        sortOrder = results[0]?.cnt || 0;
      }
      const section = body.section || null;
      const group = { id: uid(), parentId: pid, name, sortOrder, createdAt: Date.now(), section, userId };
      await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt, section, userId) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(group.id, group.parentId, group.name, group.sortOrder, group.createdAt, group.section, group.userId).run();
      return json(group);
    }

    if (segments[0] === 'groups' && segments[1] && method === 'PUT') {
      const id = segments[1];
      // R2: if name is changing, capture old R2 keys before D1 update
      let oldR2Keys = [];
      let oldR2SheetIds = [];
      if (env.BUCKET && body.name !== undefined) {
        const allGids = await getDescendantGroupIds(id, DB, userId);
        if (allGids.length) {
          const ph = allGids.map(() => '?').join(',');
          const sheets = (await DB.prepare(`SELECT * FROM sheets WHERE groupId IN (${ph}) AND isTrashed = 0`).bind(...allGids).all()).results;
          const { pathMap } = await buildGroupPaths(DB, userId);
          for (const s of sheets) {
            const gp = pathMap[s.groupId];
            if (gp) {
              oldR2Keys.push(userId + '/' + gp + '/' + sanitizeFilename(s.title || 'Untitled') + '.md');
              oldR2SheetIds.push(s.id);
            }
          }
        }
      }
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(body)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      if (sets.length > 0) {
        vals.push(id); vals.push(userId);
        await DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ? AND userId = ?`).bind(...vals).run();
      }
      // R2: move files to new paths (group name changed = different folder)
      if (env.BUCKET && oldR2Keys.length > 0) {
        context.waitUntil((async () => {
          try {
            // Delete old keys (computed before rename)
            for (const key of oldR2Keys) {
              try { await env.BUCKET.delete(key); } catch(e){}
            }
            // Write new keys (computed after rename, with new group path)
            for (const sid of oldR2SheetIds) {
              try {
                const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(sid).all()).results[0];
                if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
              } catch(e){}
            }
          } catch(e){}
        })());
      }
      return json({ ok: true });
    }

    if (segments[0] === 'groups' && segments[1] && method === 'DELETE') {
      const { results: gC } = await DB.prepare('SELECT id FROM groups WHERE id = ? AND userId = ?').bind(segments[1], userId).all();
      if (!gC.length) return json({ error: 'Not found' }, 404);
      // R2-first: delete all .md files in this group tree before D1 delete
      if (env.BUCKET) {
        try {
          const allGids = await getDescendantGroupIds(segments[1], DB, userId);
          if (allGids.length) {
            const ph = allGids.map(() => '?').join(',');
            const sheets = (await DB.prepare(`SELECT * FROM sheets WHERE groupId IN (${ph}) AND isTrashed = 0`).bind(...allGids).all()).results;
            for (const s of sheets) {
              try { await r2DeleteSheet(env.BUCKET, DB, userId, s); } catch(e){}
            }
          }
        } catch(e){}
      }
      await deleteGroupRecursive(segments[1], DB);
      return json({ ok: true });
    }

    // --- Filter Counts (single query) ---
    if (path === 'filter-counts' && method === 'GET') {
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const { results } = await DB.prepare(`SELECT
        (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND g.userId=?) as all_count,
        (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND s.createdAt>? AND g.userId=?) as recent,
        (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND s.favorite=1 AND g.userId=?) as favorites,
        (SELECT COUNT(*) FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=1 AND g.userId=?) as trash
      `).bind(userId, now - sevenDays, userId, userId, userId).all();
      const r = results[0];
      return json({ all: r.all_count, recent: r.recent, favorites: r.favorites, trash: r.trash });
    }

    // --- Sheets ---
    if (path === 'sheets' && method === 'GET') {
      const url = new URL(request.url);
      const groupId = url.searchParams.get('groupId');
      const filter = url.searchParams.get('filter');
      const sort = url.searchParams.get('sort') || 'manual';

      let results;
      if (filter) {
        results = await getFilteredSheets(filter, DB, userId);
      } else if (groupId) {
        let orderBy = 'sortOrder ASC';
        if (sort === 'date') orderBy = 'updatedAt DESC';
        if (sort === 'created') orderBy = 'createdAt DESC';
        if (sort === 'title') orderBy = 'title ASC';
        const allGroupIds = await getDescendantGroupIds(groupId, DB, userId);
        if (!allGroupIds.length) return json([]);
        const ph = allGroupIds.map(() => '?').join(',');
        const r = await DB.prepare(`SELECT sheets.*, groups.name AS groupName FROM sheets LEFT JOIN groups ON sheets.groupId = groups.id WHERE sheets.groupId IN (${ph}) AND sheets.isTrashed = 0 ORDER BY sheets.${orderBy}`)
          .bind(...allGroupIds).all();
        results = r.results;
      } else {
        results = [];
      }

      // Bulk-load tags for all returned sheets (avoids N+1)
      if (results.length > 0) {
        const ids = results.map(s => s.id);
        const placeholders = ids.map(() => '?').join(',');
        const { results: tagRows } = await DB.prepare(
          `SELECT st.sheetId, t.id, t.name, t.color FROM sheet_tags st
           JOIN tags t ON st.tagId = t.id WHERE st.sheetId IN (${placeholders})`
        ).bind(...ids).all();
        const tagMap = {};
        for (const row of tagRows) {
          (tagMap[row.sheetId] ||= []).push({ id: row.id, name: row.name, color: row.color });
        }
        for (const sheet of results) {
          sheet.tags = tagMap[sheet.id] || [];
        }
      }

      return json(results);
    }

    // Search (must be before the generic sheets/:id GET handler)
    if (segments[0] === 'sheets' && segments[1] === 'search' && method === 'GET') {
      const url = new URL(request.url);
      const q = url.searchParams.get('q') || '';
      const like = `%${q}%`;
      const { results } = await DB.prepare(
        'SELECT s.* FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=0 AND g.userId=? AND (s.title LIKE ? OR s.content LIKE ? OR s.notes LIKE ?) ORDER BY s.updatedAt DESC LIMIT 50'
      ).bind(userId, like, like, like).all();
      return json(results);
    }

    if (segments[0] === 'sheets' && segments[1] && !segments[2] && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(segments[1]).all();
      return json(results[0] || null);
    }

    if (path === 'sheets' && method === 'POST') {
      const { groupId, title, content } = body;
      const { results } = await DB.prepare('SELECT COUNT(*) as cnt FROM sheets WHERE groupId = ?').bind(groupId).all();
      const now = Date.now();
      const sheet = {
        id: uid(), groupId, title: title || 'Untitled', content: content || '',
        notes: '', images: '[]', sortOrder: results[0]?.cnt || 0,
        favorite: 0, isTrashed: 0, createdAt: now, updatedAt: now,
      };
      await DB.prepare(
        'INSERT INTO sheets (id, groupId, title, content, notes, images, sortOrder, favorite, isTrashed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(sheet.id, sheet.groupId, sheet.title, sheet.content, sheet.notes, sheet.images, sheet.sortOrder, sheet.favorite, sheet.isTrashed, sheet.createdAt, sheet.updatedAt).run();
      // R2-first: write .md file
      if (env.BUCKET) {
        try {
          const { pathMap } = await buildGroupPaths(DB, userId);
          const gp = pathMap[sheet.groupId];
          if (gp) {
            const fn = sanitizeFilename(sheet.title || 'Untitled') + '.md';
            await env.BUCKET.put(userId + '/' + gp + '/' + fn, toFrontmatter(sheet, [], null),
              { customMetadata: { sheetId: sheet.id, modified: String(now) } });
          }
        } catch(e){}
      }
      return json(sheet);
    }

    if (segments[0] === 'sheets' && segments[1] && !segments[2] && method === 'PUT') {
      const id = segments[1];
      // R2: capture old title before update (needed to delete old .md if title changed)
      let oldTitle = null;
      if (env.BUCKET && body.title !== undefined) {
        const old = (await DB.prepare('SELECT title, groupId FROM sheets WHERE id = ?').bind(id).all()).results[0];
        if (old && old.title !== body.title) oldTitle = old.title;
      }
      const changes = { ...body, updatedAt: Date.now() };
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(changes)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      await DB.prepare(`UPDATE sheets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

      // R2-first: sync .md file on every save (non-blocking for typing speed)
      if (env.BUCKET) {
        context.waitUntil((async () => {
          try {
            const sheet = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all()).results[0];
            if (!sheet || sheet.isTrashed) return;
            // Delete old file if title changed (different filename)
            if (oldTitle) {
              try { await r2DeleteSheet(env.BUCKET, DB, userId, { ...sheet, title: oldTitle }); } catch(e){}
            }
            await r2WriteSheet(env.BUCKET, DB, userId, sheet);
          } catch(e){}
        })());
      }

      return json({ ok: true });
    }

    if (segments[0] === 'sheets' && segments[1] && !segments[2] && method === 'DELETE') {
      const id = segments[1];
      // R2-first: get sheet before deleting (need path info for R2 delete)
      const delSheet = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all()).results[0];
      await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ?').bind(id).run();
      await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(id).run();
      await DB.prepare('DELETE FROM sheets WHERE id = ?').bind(id).run();
      // R2: delete .md file
      if (env.BUCKET && delSheet) {
        try { await r2DeleteSheet(env.BUCKET, DB, userId, delSheet); } catch(e){}
      }
      return json({ ok: true });
    }

    // Trash / Restore
    if (segments[0] === 'sheets' && segments[1] === 'trash' && method === 'POST') {
      const { ids, restore } = body;
      const now = Date.now();
      const val = restore ? 0 : 1;
      // R2: get sheets before trashing (need path info)
      const sheetsForR2 = [];
      if (env.BUCKET) {
        for (const id of ids) {
          const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all()).results[0];
          if (s) sheetsForR2.push(s);
        }
      }
      for (const id of ids) {
        await DB.prepare('UPDATE sheets SET isTrashed = ?, updatedAt = ? WHERE id = ?').bind(val, now, id).run();
      }
      // R2: delete on trash, recreate on restore
      if (env.BUCKET) {
        for (const s of sheetsForR2) {
          try {
            if (restore) {
              s.isTrashed = 0; s.updatedAt = now;
              await r2WriteSheet(env.BUCKET, DB, userId, s);
            } else {
              await r2DeleteSheet(env.BUCKET, DB, userId, s);
            }
          } catch(e){}
        }
      }
      return json({ ok: true });
    }

    // Toggle favorite
    if (segments[0] === 'sheets' && segments[1] === 'favorite' && method === 'POST') {
      const { id } = body;
      const { results } = await DB.prepare('SELECT favorite FROM sheets WHERE id = ?').bind(id).all();
      const current = results[0]?.favorite || 0;
      const newVal = current ? 0 : 1;
      await DB.prepare('UPDATE sheets SET favorite = ? WHERE id = ?').bind(newVal, id).run();
      // R2: update frontmatter with new favorite status
      if (env.BUCKET) {
        context.waitUntil((async () => {
          try {
            const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all()).results[0];
            if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
          } catch(e){}
        })());
      }
      return json({ favorite: !!newVal });
    }

    // Merge sheets
    if (segments[0] === 'sheets' && segments[1] === 'merge' && method === 'POST') {
      const { ids, groupId } = body;
      const sheets = [];
      for (const id of ids) {
        const { results } = await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all();
        if (results[0]) sheets.push(results[0]);
      }
      sheets.sort((a, b) => a.sortOrder - b.sortOrder);
      const merged = sheets.map(s => s.content).join('\n\n---\n\n');
      const title = sheets[0]?.title || 'Merged';
      const now = Date.now();
      const { results: cntR } = await DB.prepare('SELECT COUNT(*) as cnt FROM sheets WHERE groupId = ?').bind(groupId).all();
      const newSheet = {
        id: uid(), groupId, title, content: merged, notes: '', images: '[]',
        sortOrder: cntR[0]?.cnt || 0, favorite: 0, isTrashed: 0, createdAt: now, updatedAt: now,
      };
      await DB.prepare(
        'INSERT INTO sheets (id, groupId, title, content, notes, images, sortOrder, favorite, isTrashed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(newSheet.id, newSheet.groupId, newSheet.title, newSheet.content, newSheet.notes, newSheet.images, newSheet.sortOrder, newSheet.favorite, newSheet.isTrashed, newSheet.createdAt, newSheet.updatedAt).run();
      // Trash originals
      for (const s of sheets) {
        await DB.prepare('UPDATE sheets SET isTrashed = 1, updatedAt = ? WHERE id = ?').bind(now, s.id).run();
      }
      // R2: write merged sheet, delete originals
      if (env.BUCKET) {
        try { await r2WriteSheet(env.BUCKET, DB, userId, newSheet); } catch(e){}
        for (const s of sheets) {
          try { await r2DeleteSheet(env.BUCKET, DB, userId, s); } catch(e){}
        }
      }
      return json({ merged: newSheet, originals: sheets });
    }

    // Reorder sheets
    if (segments[0] === 'sheets' && segments[1] === 'reorder' && method === 'POST') {
      const { ids } = body;
      for (let i = 0; i < ids.length; i++) {
        await DB.prepare('UPDATE sheets SET sortOrder = ? WHERE id = ?').bind(i, ids[i]).run();
      }
      return json({ ok: true });
    }

    // Move sheets to another group
    if (segments[0] === 'sheets' && segments[1] === 'move' && method === 'POST') {
      const { ids, groupId } = body;
      // R2: get sheets at old location before move
      const oldSheets = [];
      if (env.BUCKET) {
        for (const id of ids) {
          const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all()).results[0];
          if (s) oldSheets.push({ ...s });
        }
      }
      const { results: cntR } = await DB.prepare('SELECT COUNT(*) as cnt FROM sheets WHERE groupId = ?').bind(groupId).all();
      let order = cntR[0]?.cnt || 0;
      const now = Date.now();
      for (const id of ids) {
        await DB.prepare('UPDATE sheets SET groupId = ?, sortOrder = ?, updatedAt = ? WHERE id = ?')
          .bind(groupId, order++, now, id).run();
      }
      // R2: delete old files, write new ones at new path
      if (env.BUCKET) {
        for (const old of oldSheets) {
          try { await r2DeleteSheet(env.BUCKET, DB, userId, old); } catch(e){}
        }
        for (const id of ids) {
          try {
            const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(id).all()).results[0];
            if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
          } catch(e){}
        }
      }
      return json({ ok: true });
    }

    // Empty trash
    if (segments[0] === 'sheets' && segments[1] === 'empty-trash' && method === 'POST') {
      const { results: trashed } = await DB.prepare(
        'SELECT s.id FROM sheets s JOIN groups g ON s.groupId=g.id WHERE s.isTrashed=1 AND g.userId=?'
      ).bind(userId).all();
      for (const s of trashed) {
        await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ?').bind(s.id).run();
        await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(s.id).run();
        await DB.prepare('DELETE FROM sheets WHERE id = ?').bind(s.id).run();
      }
      return json({ ok: true });
    }

    // --- Tags ---
    if (path === 'tags' && method === 'GET') {
      const { results } = await DB.prepare(
        `SELECT t.*, COALESCE(c.cnt, 0) as sheetCount
         FROM tags t
         LEFT JOIN (SELECT st.tagId, COUNT(*) as cnt FROM sheet_tags st JOIN sheets s ON st.sheetId = s.id WHERE s.isTrashed = 0 GROUP BY st.tagId) c ON t.id = c.tagId
         WHERE t.userId = ? ORDER BY sheetCount DESC, t.name ASC`
      ).bind(userId).all();
      return json(results);
    }

    if (path === 'tags' && method === 'POST') {
      const { name, color } = body;
      const tag = { id: uid(), name, color: color || '#888', userId };
      await DB.prepare('INSERT INTO tags (id, name, color, userId) VALUES (?, ?, ?, ?)').bind(tag.id, tag.name, tag.color, tag.userId).run();
      return json(tag);
    }

    if (segments[0] === 'tags' && segments[1] && method === 'PUT') {
      const id = segments[1];
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(body)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id); vals.push(userId);
      await DB.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ? AND userId = ?`).bind(...vals).run();
      return json({ ok: true });
    }

    if (segments[0] === 'tags' && segments[1] && method === 'DELETE') {
      const id = segments[1];
      const { results: tC } = await DB.prepare('SELECT id FROM tags WHERE id = ? AND userId = ?').bind(id, userId).all();
      if (!tC.length) return json({ error: 'Not found' }, 404);
      await DB.prepare('DELETE FROM sheet_tags WHERE tagId = ?').bind(id).run();
      await DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    // --- Sheet Tags ---
    if (segments[0] === 'sheet-tags' && segments[1] && method === 'GET') {
      const sheetId = segments[1];
      const { results } = await DB.prepare(
        'SELECT t.* FROM tags t JOIN sheet_tags st ON t.id = st.tagId WHERE st.sheetId = ?'
      ).bind(sheetId).all();
      return json(results);
    }

    if (path === 'sheet-tags' && method === 'POST') {
      const { sheetId, tagId } = body;
      try {
        await DB.prepare('INSERT INTO sheet_tags (id, sheetId, tagId) VALUES (?, ?, ?)')
          .bind(uid(), sheetId, tagId).run();
      } catch (e) {
        // Ignore duplicate
      }
      // R2: update frontmatter with new tag
      if (env.BUCKET) {
        context.waitUntil((async () => {
          try {
            const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(sheetId).all()).results[0];
            if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
          } catch(e){}
        })());
      }
      return json({ ok: true });
    }

    if (segments[0] === 'sheet-tags' && segments[1] && segments[2] && method === 'DELETE') {
      await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ? AND tagId = ?')
        .bind(segments[1], segments[2]).run();
      // R2: update frontmatter without removed tag
      if (env.BUCKET) {
        context.waitUntil((async () => {
          try {
            const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(segments[1]).all()).results[0];
            if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
          } catch(e){}
        })());
      }
      return json({ ok: true });
    }

    // --- Goals ---
    if (segments[0] === 'goals' && segments[1] && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM goals WHERE sheetId = ?').bind(segments[1]).all();
      return json(results[0] || null);
    }

    if (segments[0] === 'goals' && segments[1] && method === 'PUT') {
      const sheetId = segments[1];
      const { targetType, targetValue, mode, deadline } = body;
      const { results } = await DB.prepare('SELECT id FROM goals WHERE sheetId = ?').bind(sheetId).all();
      if (results[0]) {
        await DB.prepare('UPDATE goals SET targetType = ?, targetValue = ?, mode = ?, deadline = ? WHERE sheetId = ?')
          .bind(targetType, targetValue, mode || 'about', deadline || null, sheetId).run();
      } else {
        await DB.prepare('INSERT INTO goals (id, sheetId, targetType, targetValue, mode, deadline) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(uid(), sheetId, targetType, targetValue, mode || 'about', deadline || null).run();
      }
      // R2: update frontmatter with goal
      if (env.BUCKET) {
        context.waitUntil((async () => {
          try {
            const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(sheetId).all()).results[0];
            if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
          } catch(e){}
        })());
      }
      return json({ ok: true });
    }

    if (segments[0] === 'goals' && segments[1] && method === 'DELETE') {
      await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(segments[1]).run();
      // R2: update frontmatter without goal
      if (env.BUCKET) {
        context.waitUntil((async () => {
          try {
            const s = (await DB.prepare('SELECT * FROM sheets WHERE id = ?').bind(segments[1]).all()).results[0];
            if (s && !s.isTrashed) await r2WriteSheet(env.BUCKET, DB, userId, s);
          } catch(e){}
        })());
      }
      return json({ ok: true });
    }

    // --- Settings ---
    if (segments[0] === 'settings' && segments[1] && method === 'GET') {
      const { results } = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(segments[1]).all();
      return json({ value: results[0]?.value || null });
    }

    if (segments[0] === 'settings' && segments[1] && method === 'PUT') {
      await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(segments[1], body.value).run();
      return json({ ok: true });
    }

    // --- R2 Sync ---
    if (segments[0] === 'r2') {
      const BUCKET = env.BUCKET;
      if (!BUCKET) return json({ error: 'R2 bucket not configured' }, 500);

      // Status
      if (segments[1] === 'status' && method === 'GET') {
        const lastSync = (await DB.prepare("SELECT value FROM settings WHERE key = 'r2_last_sync'").all()).results[0]?.value || null;
        return json({ enabled: true, lastSync });
      }

      // Push D1 → R2
      if (segments[1] === 'push' && method === 'POST') {
        const result = await r2Push(DB, BUCKET, userId);
        await DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('r2_last_sync', ?)").bind(new Date().toISOString()).run();
        return json(result);
      }

      // Pull R2 → D1
      if (segments[1] === 'pull' && method === 'POST') {
        const result = await r2Pull(DB, BUCKET, userId);
        await DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('r2_last_sync', ?)").bind(new Date().toISOString()).run();
        return json(result);
      }

      // Full bidirectional sync
      if (segments[1] === 'sync' && method === 'POST') {
        const result = await r2Sync(DB, BUCKET, userId);
        await DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('r2_last_sync', ?)").bind(new Date().toISOString()).run();
        return json(result);
      }
    }

    // --- Backup ---
    if (path === 'backup' && method === 'GET') {
      const groups = (await DB.prepare('SELECT * FROM groups WHERE userId = ? ORDER BY sortOrder').bind(userId).all()).results;
      const gIds = groups.map(g => g.id);
      const gPH = gIds.length ? gIds.map(() => '?').join(',') : "'_'";
      const sheets = gIds.length ? (await DB.prepare('SELECT * FROM sheets WHERE groupId IN (' + gPH + ')').bind(...gIds).all()).results : [];
      const tags = (await DB.prepare('SELECT * FROM tags WHERE userId = ?').bind(userId).all()).results;
      const sIds = sheets.map(s => s.id);
      const sPH = sIds.length ? sIds.map(() => '?').join(',') : "'_'";
      const sheetTags = sIds.length ? (await DB.prepare('SELECT * FROM sheet_tags WHERE sheetId IN (' + sPH + ')').bind(...sIds).all()).results : [];
      const goals = sIds.length ? (await DB.prepare('SELECT * FROM goals WHERE sheetId IN (' + sPH + ')').bind(...sIds).all()).results : [];
      const settings = (await DB.prepare('SELECT * FROM settings').all()).results;
      return json({ version: 2, exportedAt: new Date().toISOString(), groups, sheets, tags, sheetTags, goals, settings });
    }

    if (path === 'backup' && method === 'POST') {
      const data = body;
      if (!data.groups || !data.sheets) return json({ error: 'Invalid backup' }, 400);
      // Clear all tables
      await DB.prepare('DELETE FROM sheet_tags').run();
      await DB.prepare('DELETE FROM goals').run();
      await DB.prepare('DELETE FROM settings').run();
      await DB.prepare('DELETE FROM sheets').run();
      await DB.prepare('DELETE FROM groups').run();
      await DB.prepare('DELETE FROM tags').run();
      // Insert all data
      for (const g of data.groups) {
        await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)')
          .bind(g.id, g.parentId, g.name, g.sortOrder, g.createdAt).run();
      }
      for (const s of data.sheets) {
        await DB.prepare('INSERT INTO sheets (id, groupId, title, content, notes, images, sortOrder, favorite, isTrashed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(s.id, s.groupId, s.title, s.content, s.notes || '', s.images || '[]', s.sortOrder, s.favorite ? 1 : 0, s.isTrashed ? 1 : 0, s.createdAt, s.updatedAt).run();
      }
      for (const t of (data.tags || [])) {
        await DB.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').bind(t.id, t.name, t.color).run();
      }
      for (const st of (data.sheetTags || [])) {
        await DB.prepare('INSERT INTO sheet_tags (id, sheetId, tagId) VALUES (?, ?, ?)').bind(st.id, st.sheetId, st.tagId).run();
      }
      for (const g of (data.goals || [])) {
        await DB.prepare('INSERT INTO goals (id, sheetId, targetType, targetValue, mode, deadline) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(g.id, g.sheetId, g.targetType, g.targetValue, g.mode || 'about', g.deadline || null).run();
      }
      for (const s of (data.settings || [])) {
        await DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(s.key, s.value).run();
      }
      return json({ ok: true });
    }

    // --- Init (create default Inbox if empty + migrate schema) ---
    if (path === 'init' && method === 'POST') {
      // Check if migrations already ran (use a settings flag)
      const { results: mig } = await DB.prepare("SELECT value FROM settings WHERE key = 'migrations_v2'").all();
      if (!mig.length) {
        // Schema migrations: add columns if missing
        const alters = [
          'ALTER TABLE groups ADD COLUMN icon TEXT DEFAULT NULL',
          'ALTER TABLE groups ADD COLUMN iconColor TEXT DEFAULT NULL',
          'ALTER TABLE groups ADD COLUMN collapsed INTEGER DEFAULT 0',
          'ALTER TABLE groups ADD COLUMN section TEXT DEFAULT NULL',
        ];
        for (const sql of alters) {
          try { await DB.prepare(sql).run(); } catch (e) { /* already exists */ }
        }
        await DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrations_v2', '1')").run();
      }

      const { results } = await DB.prepare('SELECT COUNT(*) as cnt FROM groups').all();
      if (results[0].cnt === 0) {
        const group = { id: uid(), parentId: null, name: 'Inbox', sortOrder: 0, createdAt: Date.now(), section: 'notes' };
        await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt, section) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(group.id, group.parentId, group.name, group.sortOrder, group.createdAt, group.section).run();
        return json({ created: true, group });
      }
      return json({ created: false });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// Get group + all descendant group IDs (single query, in-memory traversal)
async function getDescendantGroupIds(groupId, DB, userId) {
  const query = userId
    ? DB.prepare('SELECT id, parentId FROM groups WHERE userId = ?').bind(userId)
    : DB.prepare('SELECT id, parentId FROM groups');
  const { results: allGroups } = await query.all();
  const childMap = {};
  const allIds = new Set(allGroups.map(g => g.id));
  for (const g of allGroups) {
    if (g.parentId) {
      (childMap[g.parentId] ||= []).push(g.id);
    }
  }
  // Verify root group belongs to this user
  if (!allIds.has(groupId)) return [];
  const ids = [];
  const stack = [groupId];
  while (stack.length > 0) {
    const id = stack.pop();
    ids.push(id);
    if (childMap[id]) stack.push(...childMap[id]);
  }
  return ids;
}

// Recursive group delete
async function deleteGroupRecursive(id, DB) {
  // Delete sheets in this group
  const { results: sheets } = await DB.prepare('SELECT id FROM sheets WHERE groupId = ?').bind(id).all();
  for (const s of sheets) {
    await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ?').bind(s.id).run();
    await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(s.id).run();
    await DB.prepare('DELETE FROM sheets WHERE id = ?').bind(s.id).run();
  }
  // Recurse into children
  const { results: children } = await DB.prepare('SELECT id FROM groups WHERE parentId = ?').bind(id).all();
  for (const child of children) {
    await deleteGroupRecursive(child.id, DB);
  }
  await DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
}

// Filtered sheets helper
async function getFilteredSheets(filter, DB, userId) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  let results;
  const joinSelect = 'SELECT sheets.*, groups.name AS groupName FROM sheets LEFT JOIN groups ON sheets.groupId = groups.id';
  const uf = userId ? ' AND groups.userId = ?' : '';

  if (filter.startsWith('tag:')) {
    const tagId = filter.slice(4);
    const r = (await DB.prepare(
      joinSelect + ' INNER JOIN sheet_tags st ON sheets.id = st.sheetId WHERE st.tagId = ? AND sheets.isTrashed = 0' + uf + ' ORDER BY sheets.updatedAt DESC'
    ).bind(...[tagId, userId].filter(Boolean)).all()).results;
    return r;
  }

  switch (filter) {
    case 'all':
      results = (await DB.prepare(joinSelect + ' WHERE sheets.isTrashed = 0' + uf + ' ORDER BY sheets.updatedAt DESC').bind(...(userId ? [userId] : [])).all()).results;
      break;
    case 'recent':
      results = (await DB.prepare(joinSelect + ' WHERE sheets.isTrashed = 0 AND sheets.createdAt > ?' + uf + ' ORDER BY sheets.updatedAt DESC').bind(...[now - sevenDays, userId].filter(Boolean)).all()).results;
      break;
    case 'favorites':
      results = (await DB.prepare(joinSelect + ' WHERE sheets.isTrashed = 0 AND sheets.favorite = 1' + uf + ' ORDER BY sheets.updatedAt DESC').bind(...(userId ? [userId] : [])).all()).results;
      break;
    case 'trash':
      results = (await DB.prepare(joinSelect + ' WHERE sheets.isTrashed = 1' + uf + ' ORDER BY sheets.updatedAt DESC').bind(...(userId ? [userId] : [])).all()).results;
      break;
    default:
      results = [];
  }
  return results;
}

// ==================== R2 Sync Helpers ====================

function sanitizeFilename(name) {
  return (name || 'Untitled').replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function toFrontmatter(sheet, tags, goal) {
  const lines = ['---'];
  lines.push(`id: ${sheet.id}`);
  if (tags && tags.length > 0) {
    lines.push('tags:');
    for (const t of tags) lines.push(`  - ${t.name}`);
  }
  if (sheet.favorite) lines.push('favorite: true');
  if (sheet.notes) lines.push(`notes: ${JSON.stringify(sheet.notes)}`);
  lines.push(`created: ${new Date(sheet.createdAt).toISOString()}`);
  lines.push(`modified: ${new Date(sheet.updatedAt).toISOString()}`);
  if (goal) {
    lines.push('goal:');
    lines.push(`  type: ${goal.targetType}`);
    lines.push(`  target: ${goal.targetValue}`);
    lines.push(`  mode: ${goal.mode || 'about'}`);
    if (goal.deadline) lines.push(`  deadline: ${goal.deadline}`);
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n') + (sheet.content || '');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: text };
  const meta = {};
  const yamlLines = match[1].split('\n');
  let currentKey = null;
  let currentObj = null;
  const tags = [];

  for (const line of yamlLines) {
    if (line.startsWith('  - ') && currentKey === 'tags') {
      tags.push(line.slice(4).trim());
    } else if (line.startsWith('  ') && currentObj) {
      const [k, ...v] = line.trim().split(': ');
      currentObj[k] = v.join(': ');
    } else {
      const colonIdx = line.indexOf(': ');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 2).trim();
        if (key === 'tags') {
          currentKey = 'tags';
          currentObj = null;
        } else if (key === 'goal') {
          currentObj = {};
          meta.goal = currentObj;
          currentKey = 'goal';
        } else {
          currentKey = key;
          currentObj = null;
          // Parse value
          if (val === 'true') meta[key] = true;
          else if (val === 'false') meta[key] = false;
          else if (val.startsWith('"') && val.endsWith('"')) meta[key] = JSON.parse(val);
          else meta[key] = val;
        }
      }
    }
  }
  if (tags.length > 0) meta.tags = tags;
  return { meta, content: match[2] };
}

async function buildGroupPaths(DB, userId) {
  const groups = (await DB.prepare('SELECT * FROM groups WHERE userId = ? ORDER BY sortOrder').bind(userId).all()).results;
  const pathMap = {}; // groupId → "Projects/Group A/Sub"
  const idMap = {};   // "Projects/Group A/Sub" → groupId

  for (const g of groups) {
    const parts = [];
    let cur = g;
    while (cur) {
      parts.unshift(sanitizeFilename(cur.name));
      cur = groups.find(p => p.id === cur.parentId);
    }
    // Prepend section
    const section = g.section === 'projects' ? 'Projects' : 'Notes';
    // Find root group to determine section
    let root = g;
    while (root.parentId) root = groups.find(p => p.id === root.parentId) || root;
    const rootSection = root.section === 'projects' ? 'Projects' : 'Notes';
    const fullPath = rootSection + '/' + parts.join('/');
    pathMap[g.id] = fullPath;
    idMap[fullPath] = g.id;
  }
  return { pathMap, idMap, groups };
}

async function r2Push(DB, BUCKET, userId) {
  const { pathMap } = await buildGroupPaths(DB, userId);
  const groups = (await DB.prepare('SELECT id FROM groups WHERE userId = ?').bind(userId).all()).results;
  const gIds = groups.map(g => g.id);
  if (gIds.length === 0) return { pushed: 0 };

  const gPH = gIds.map(() => '?').join(',');
  const sheets = (await DB.prepare(`SELECT * FROM sheets WHERE groupId IN (${gPH}) AND isTrashed = 0`).bind(...gIds).all()).results;
  const allSheetTags = (await DB.prepare(`SELECT st.sheetId, t.name FROM sheet_tags st JOIN tags t ON st.tagId = t.id WHERE st.sheetId IN (${sheets.length ? sheets.map(() => '?').join(',') : "'_'"})`).bind(...sheets.map(s => s.id)).all()).results;
  const allGoals = (await DB.prepare(`SELECT * FROM goals WHERE sheetId IN (${sheets.length ? sheets.map(() => '?').join(',') : "'_'"})`).bind(...sheets.map(s => s.id)).all()).results;

  // Build tag/goal maps
  const tagMap = {};
  for (const st of allSheetTags) {
    (tagMap[st.sheetId] ||= []).push({ name: st.name });
  }
  const goalMap = {};
  for (const g of allGoals) goalMap[g.sheetId] = g;

  // Track used keys to delete stale files
  const usedKeys = new Set();
  let pushed = 0;

  const prefix = userId + '/';
  for (const sheet of sheets) {
    const groupPath = pathMap[sheet.groupId];
    if (!groupPath) continue;
    const filename = sanitizeFilename(sheet.title || 'Untitled') + '.md';
    const key = prefix + groupPath + '/' + filename;
    usedKeys.add(key);

    const content = toFrontmatter(sheet, tagMap[sheet.sheetId] || [], goalMap[sheet.sheetId]);
    await BUCKET.put(key, content, {
      customMetadata: { sheetId: sheet.id, modified: String(sheet.updatedAt) },
    });
    pushed++;
  }

  // Delete R2 files that no longer have a matching sheet (only this user's files)
  const listed = await listAllR2Objects(BUCKET, prefix);
  for (const obj of listed) {
    if (obj.key.endsWith('.md') && !usedKeys.has(obj.key)) {
      await BUCKET.delete(obj.key);
    }
  }

  return { pushed, deleted: listed.filter(o => o.key.endsWith('.md') && !usedKeys.has(o.key)).length };
}

async function r2Pull(DB, BUCKET, userId) {
  const { pathMap, idMap, groups } = await buildGroupPaths(DB, userId);
  const prefix = userId + '/';
  const listed = await listAllR2Objects(BUCKET, prefix);
  let pulled = 0;
  let created = 0;

  for (const obj of listed) {
    if (!obj.key.endsWith('.md')) continue;

    const objData = await BUCKET.get(obj.key);
    if (!objData) continue;
    const text = await objData.text();
    const { meta, content } = parseFrontmatter(text);

    // Find which group this belongs to (strip userId prefix from path)
    const relKey = obj.key.startsWith(prefix) ? obj.key.slice(prefix.length) : obj.key;
    const parts = relKey.split('/');
    const dirPath = parts.slice(0, -1).join('/');
    let groupId = idMap[dirPath];

    // If group doesn't exist, create it
    if (!groupId && dirPath) {
      groupId = await ensureGroupPath(DB, dirPath, userId, groups, idMap);
    }
    if (!groupId) continue;

    const now = Date.now();
    const modifiedTs = meta.modified ? new Date(meta.modified).getTime() : now;
    const createdTs = meta.created ? new Date(meta.created).getTime() : now;

    if (meta.id) {
      // Update existing sheet
      const existing = (await DB.prepare('SELECT id FROM sheets WHERE id = ?').bind(meta.id).all()).results;
      if (existing.length > 0) {
        const title = extractTitleFromContent(content);
        await DB.prepare('UPDATE sheets SET content = ?, title = ?, notes = ?, favorite = ?, updatedAt = ? WHERE id = ?')
          .bind(content, title, meta.notes || '', meta.favorite ? 1 : 0, modifiedTs, meta.id).run();
        pulled++;
      } else {
        // Sheet with this ID was deleted from D1 but exists in R2 — recreate
        const title = extractTitleFromContent(content);
        await DB.prepare('INSERT INTO sheets (id, groupId, title, content, notes, images, sortOrder, favorite, isTrashed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
          .bind(meta.id, groupId, title, content, meta.notes || '', '[]', 0, meta.favorite ? 1 : 0, createdTs, modifiedTs).run();
        created++;
      }
    } else {
      // New file without ID — create new sheet
      const id = crypto.randomUUID();
      const title = extractTitleFromContent(content);
      await DB.prepare('INSERT INTO sheets (id, groupId, title, content, notes, images, sortOrder, favorite, isTrashed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)')
        .bind(id, groupId, title, content, '', '[]', 0, now, now).run();
      // Re-upload with the ID in frontmatter
      const newMeta = { ...meta, id };
      const newText = toFrontmatter({ id, content, favorite: 0, notes: '', createdAt: now, updatedAt: now }, [], null);
      await BUCKET.put(obj.key, newText, { customMetadata: { sheetId: id, modified: String(now) } });
      created++;
    }

    // Sync tags if present
    if (meta.tags && meta.id) {
      await syncTagsFromR2(DB, meta.id, meta.tags, userId);
    }
  }

  return { pulled, created };
}

async function r2Sync(DB, BUCKET, userId) {
  const { pathMap, idMap, groups } = await buildGroupPaths(DB, userId);

  // 1. Get all D1 sheets
  const allGroups = (await DB.prepare('SELECT id FROM groups WHERE userId = ?').bind(userId).all()).results;
  const gIds = allGroups.map(g => g.id);
  if (gIds.length === 0) return { pushed: 0, pulled: 0, created: 0 };

  const gPH = gIds.map(() => '?').join(',');
  const sheets = (await DB.prepare(`SELECT * FROM sheets WHERE groupId IN (${gPH}) AND isTrashed = 0`).bind(...gIds).all()).results;
  const sheetMap = {};
  for (const s of sheets) sheetMap[s.id] = s;

  // Fetch tags and goals for all sheets
  const sIds = sheets.map(s => s.id);
  const sPH = sIds.length ? sIds.map(() => '?').join(',') : "'_'";
  const allSheetTags = sIds.length ? (await DB.prepare(`SELECT st.sheetId, t.name FROM sheet_tags st JOIN tags t ON st.tagId = t.id WHERE st.sheetId IN (${sPH})`).bind(...sIds).all()).results : [];
  const allGoals = sIds.length ? (await DB.prepare(`SELECT * FROM goals WHERE sheetId IN (${sPH})`).bind(...sIds).all()).results : [];
  const tagMap = {};
  for (const st of allSheetTags) (tagMap[st.sheetId] ||= []).push({ name: st.name });
  const goalMap = {};
  for (const g of allGoals) goalMap[g.sheetId] = g;

  // 2. Get all R2 objects (scoped to this user)
  const prefix = userId + '/';
  const listed = await listAllR2Objects(BUCKET, prefix);
  const r2Map = {}; // sheetId → { key, modified }
  const r2Content = {}; // key → text (fetched on demand)

  for (const obj of listed) {
    if (!obj.key.endsWith('.md')) continue;
    const sheetId = obj.customMetadata?.sheetId;
    if (sheetId) {
      r2Map[sheetId] = { key: obj.key, modified: parseInt(obj.customMetadata?.modified) || obj.uploaded?.getTime() || 0 };
    }
  }

  let pushed = 0, pulled = 0, created = 0;
  const processedR2Keys = new Set();

  // 3. For each D1 sheet, compare with R2
  for (const sheet of sheets) {
    const groupPath = pathMap[sheet.groupId];
    if (!groupPath) continue;
    const filename = sanitizeFilename(sheet.title || 'Untitled') + '.md';
    const expectedKey = prefix + groupPath + '/' + filename;

    const r2Info = r2Map[sheet.id];

    if (r2Info) {
      processedR2Keys.add(r2Info.key);
      if (sheet.updatedAt > r2Info.modified) {
        // D1 is newer → push to R2
        const content = toFrontmatter(sheet, tagMap[sheet.id] || [], goalMap[sheet.id]);
        // If key changed (title rename), delete old and create new
        if (r2Info.key !== expectedKey) await BUCKET.delete(r2Info.key);
        await BUCKET.put(expectedKey, content, { customMetadata: { sheetId: sheet.id, modified: String(sheet.updatedAt) } });
        pushed++;
      } else if (r2Info.modified > sheet.updatedAt) {
        // R2 is newer → pull to D1
        const objData = await BUCKET.get(r2Info.key);
        if (objData) {
          const text = await objData.text();
          const { meta, content } = parseFrontmatter(text);
          const title = extractTitleFromContent(content);
          const modTs = meta.modified ? new Date(meta.modified).getTime() : r2Info.modified;
          await DB.prepare('UPDATE sheets SET content = ?, title = ?, notes = ?, favorite = ?, updatedAt = ? WHERE id = ?')
            .bind(content, title, meta.notes || '', meta.favorite ? 1 : 0, modTs, sheet.id).run();
          if (meta.tags) await syncTagsFromR2(DB, sheet.id, meta.tags, userId);
          pulled++;
        }
      }
      // else: same timestamp, skip
    } else {
      // Only in D1 → push to R2
      const content = toFrontmatter(sheet, tagMap[sheet.id] || [], goalMap[sheet.id]);
      await BUCKET.put(expectedKey, content, { customMetadata: { sheetId: sheet.id, modified: String(sheet.updatedAt) } });
      pushed++;
    }
  }

  // 4. R2 files not in D1 → pull as new sheets
  for (const obj of listed) {
    if (!obj.key.endsWith('.md')) continue;
    if (processedR2Keys.has(obj.key)) continue;
    const sheetId = obj.customMetadata?.sheetId;
    if (sheetId && sheetMap[sheetId]) continue; // already processed

    const objData = await BUCKET.get(obj.key);
    if (!objData) continue;
    const text = await objData.text();
    const { meta, content } = parseFrontmatter(text);

    // Strip userId prefix to get clean group path
    const strippedKey = obj.key.startsWith(prefix) ? obj.key.slice(prefix.length) : obj.key;
    const parts = strippedKey.split('/');
    const dirPath = parts.slice(0, -1).join('/');
    let groupId = idMap[dirPath];
    if (!groupId && dirPath) groupId = await ensureGroupPath(DB, dirPath, userId, groups, idMap);
    if (!groupId) continue;

    const now = Date.now();
    const id = meta.id || crypto.randomUUID();
    const title = extractTitleFromContent(content);
    const modTs = meta.modified ? new Date(meta.modified).getTime() : now;
    const creTs = meta.created ? new Date(meta.created).getTime() : now;

    await DB.prepare('INSERT OR IGNORE INTO sheets (id, groupId, title, content, notes, images, sortOrder, favorite, isTrashed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)')
      .bind(id, groupId, title, content, meta.notes || '', '[]', meta.favorite ? 1 : 0, creTs, modTs).run();

    // Update R2 with ID if it was missing
    if (!meta.id) {
      const newContent = toFrontmatter({ id, content, favorite: meta.favorite ? 1 : 0, notes: meta.notes || '', createdAt: creTs, updatedAt: modTs }, [], null);
      await BUCKET.put(obj.key, newContent, { customMetadata: { sheetId: id, modified: String(modTs) } });
    }
    if (meta.tags) await syncTagsFromR2(DB, id, meta.tags, userId);
    created++;
  }

  return { pushed, pulled, created };
}

/** List all R2 objects (handles pagination, optional prefix for user isolation) */
async function listAllR2Objects(BUCKET, prefix) {
  const objects = [];
  let cursor = undefined;
  do {
    const opts = { cursor, include: ['customMetadata'] };
    if (prefix) opts.prefix = prefix;
    const batch = await BUCKET.list(opts);
    objects.push(...batch.objects);
    cursor = batch.truncated ? batch.cursor : undefined;
  } while (cursor);
  return objects;
}

/** Ensure group path exists, creating groups as needed */
async function ensureGroupPath(DB, dirPath, userId, groups, idMap) {
  if (idMap[dirPath]) return idMap[dirPath];

  const parts = dirPath.split('/');
  const section = parts[0] === 'Projects' ? 'projects' : 'notes';
  let parentId = null;
  let currentPath = parts[0]; // "Projects" or "Notes"

  for (let i = 1; i < parts.length; i++) {
    currentPath += '/' + parts[i];
    if (idMap[currentPath]) {
      parentId = idMap[currentPath];
      continue;
    }
    const id = crypto.randomUUID();
    await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt, userId, section) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .bind(id, parentId, parts[i], Date.now(), userId, i === 1 ? section : null).run();
    idMap[currentPath] = id;
    groups.push({ id, parentId, name: parts[i], section: i === 1 ? section : null });
    parentId = id;
  }
  return parentId;
}

/** Sync tags from R2 frontmatter to D1 */
async function syncTagsFromR2(DB, sheetId, tagNames, userId) {
  // Get existing tags
  const existingTags = (await DB.prepare('SELECT t.id, t.name FROM sheet_tags st JOIN tags t ON st.tagId = t.id WHERE st.sheetId = ?').bind(sheetId).all()).results;
  const existingNames = new Set(existingTags.map(t => t.name));
  const allTags = (await DB.prepare('SELECT * FROM tags WHERE userId = ?').bind(userId).all()).results;

  for (const name of tagNames) {
    if (existingNames.has(name)) continue;
    // Find or create tag
    let tag = allTags.find(t => t.name === name);
    if (!tag) {
      const id = crypto.randomUUID();
      await DB.prepare('INSERT INTO tags (id, name, color, userId) VALUES (?, ?, ?, ?)').bind(id, name, '#888', userId).run();
      tag = { id, name, color: '#888' };
      allTags.push(tag);
    }
    await DB.prepare('INSERT OR IGNORE INTO sheet_tags (id, sheetId, tagId) VALUES (?, ?, ?)').bind(crypto.randomUUID(), sheetId, tag.id).run();
  }
}

function extractTitleFromContent(content) {
  const firstLine = (content || '').split('\n')[0] || '';
  return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
}

// --- R2-first helpers: keep R2 in sync with every D1 mutation ---

async function r2WriteSheet(BUCKET, DB, userId, sheet) {
  if (!BUCKET || !sheet || sheet.isTrashed) return;
  const { pathMap } = await buildGroupPaths(DB, userId);
  const groupPath = pathMap[sheet.groupId];
  if (!groupPath) return;
  const tags = (await DB.prepare(
    'SELECT t.name FROM sheet_tags st JOIN tags t ON st.tagId = t.id WHERE st.sheetId = ?'
  ).bind(sheet.id).all()).results;
  const goal = (await DB.prepare('SELECT * FROM goals WHERE sheetId = ?').bind(sheet.id).all()).results[0];
  const filename = sanitizeFilename(sheet.title || 'Untitled') + '.md';
  const key = userId + '/' + groupPath + '/' + filename;
  const md = toFrontmatter(sheet, tags, goal);
  await BUCKET.put(key, md, { customMetadata: { sheetId: sheet.id, modified: String(sheet.updatedAt) } });
}

async function r2DeleteSheet(BUCKET, DB, userId, sheet) {
  if (!BUCKET || !sheet) return;
  const { pathMap } = await buildGroupPaths(DB, userId);
  const groupPath = pathMap[sheet.groupId];
  if (!groupPath) return;
  const filename = sanitizeFilename(sheet.title || 'Untitled') + '.md';
  const key = userId + '/' + groupPath + '/' + filename;
  await BUCKET.delete(key);
}

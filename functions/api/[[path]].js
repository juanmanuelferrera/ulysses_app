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

  // Auth check (skip for auth endpoint)
  if (path !== 'auth') {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    // Accept valid session token (master password not accepted as bearer token)
    {
      const { results } = await DB.prepare('SELECT value FROM settings WHERE key = ?')
        .bind(`session:${token}`).all();
      const expires = results[0]?.value;
      if (!expires || Date.now() > parseInt(expires)) {
        // Clean up expired session
        if (expires) await DB.prepare('DELETE FROM settings WHERE key = ?').bind(`session:${token}`).run();
        return json({ error: 'Unauthorized' }, 401);
      }
    }
  }

  try {
    const body = method !== 'GET' && method !== 'DELETE'
      ? await request.json().catch(() => ({}))
      : {};

    // --- Auth ---
    // AUTH_TOKEN stores the SHA-256 hash of the password, never the plaintext.
    // Client sends plaintext password → server hashes it → compares with stored hash.
    if (path === 'auth' && method === 'POST') {
      const inputHash = await hashPassword(body.token || '');
      if (inputHash === env.AUTH_TOKEN) {
        // Generate a session token valid for 6 months
        const session = crypto.randomUUID();
        const expires = Date.now() + (180 * 24 * 60 * 60 * 1000); // 6 months
        await DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
          .bind(`session:${session}`, String(expires)).run();
        return json({ ok: true, session, expires });
      }
      return json({ ok: false }, 401);
    }

    // --- Groups ---
    if (path === 'groups' && method === 'GET') {
      const { results } = await DB.prepare(
        `SELECT g.id, g.parentId as parentId, g.name, g.sortOrder, g.createdAt,
                g.icon, g.iconColor, g.collapsed,
                COALESCE(cnt, 0) as sheetCount
         FROM groups g
         LEFT JOIN (SELECT groupId, COUNT(*) as cnt FROM sheets WHERE isTrashed = 0 GROUP BY groupId) s
         ON g.id = s.groupId ORDER BY g.sortOrder`
      ).all();
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
      const group = { id: uid(), parentId: pid, name, sortOrder, createdAt: Date.now() };
      await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)')
        .bind(group.id, group.parentId, group.name, group.sortOrder, group.createdAt).run();
      return json(group);
    }

    if (segments[0] === 'groups' && segments[1] && method === 'PUT') {
      const id = segments[1];
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(body)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      if (sets.length > 0) {
        vals.push(id);
        await DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      }
      return json({ ok: true });
    }

    if (segments[0] === 'groups' && segments[1] && method === 'DELETE') {
      await deleteGroupRecursive(segments[1], DB);
      return json({ ok: true });
    }

    // --- Filter Counts (single query) ---
    if (path === 'filter-counts' && method === 'GET') {
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const { results } = await DB.prepare(`SELECT
        (SELECT COUNT(*) FROM sheets WHERE isTrashed = 0) as all_count,
        (SELECT COUNT(*) FROM sheets WHERE isTrashed = 0 AND createdAt > ?) as recent,
        (SELECT COUNT(*) FROM sheets WHERE isTrashed = 0 AND favorite = 1) as favorites,
        (SELECT COUNT(*) FROM sheets WHERE isTrashed = 1) as trash
      `).bind(now - sevenDays).all();
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
        results = await getFilteredSheets(filter, DB);
      } else if (groupId) {
        let orderBy = 'sortOrder ASC';
        if (sort === 'date') orderBy = 'updatedAt DESC';
        if (sort === 'title') orderBy = 'title ASC';
        const r = await DB.prepare(`SELECT * FROM sheets WHERE groupId = ? AND isTrashed = 0 ORDER BY ${orderBy}`)
          .bind(groupId).all();
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
        'SELECT * FROM sheets WHERE isTrashed = 0 AND (title LIKE ? OR content LIKE ? OR notes LIKE ?) ORDER BY updatedAt DESC LIMIT 50'
      ).bind(like, like, like).all();
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
      return json(sheet);
    }

    if (segments[0] === 'sheets' && segments[1] && !segments[2] && method === 'PUT') {
      const id = segments[1];
      const changes = { ...body, updatedAt: Date.now() };
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(changes)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
      vals.push(id);
      await DB.prepare(`UPDATE sheets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return json({ ok: true });
    }

    if (segments[0] === 'sheets' && segments[1] && !segments[2] && method === 'DELETE') {
      const id = segments[1];
      await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ?').bind(id).run();
      await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(id).run();
      await DB.prepare('DELETE FROM sheets WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    // Trash / Restore
    if (segments[0] === 'sheets' && segments[1] === 'trash' && method === 'POST') {
      const { ids, restore } = body;
      const now = Date.now();
      const val = restore ? 0 : 1;
      for (const id of ids) {
        await DB.prepare('UPDATE sheets SET isTrashed = ?, updatedAt = ? WHERE id = ?').bind(val, now, id).run();
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
      const { results: cntR } = await DB.prepare('SELECT COUNT(*) as cnt FROM sheets WHERE groupId = ?').bind(groupId).all();
      let order = cntR[0]?.cnt || 0;
      const now = Date.now();
      for (const id of ids) {
        await DB.prepare('UPDATE sheets SET groupId = ?, sortOrder = ?, updatedAt = ? WHERE id = ?')
          .bind(groupId, order++, now, id).run();
      }
      return json({ ok: true });
    }

    // Empty trash
    if (segments[0] === 'sheets' && segments[1] === 'empty-trash' && method === 'POST') {
      const { results: trashed } = await DB.prepare('SELECT id FROM sheets WHERE isTrashed = 1').all();
      for (const s of trashed) {
        await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ?').bind(s.id).run();
        await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(s.id).run();
        await DB.prepare('DELETE FROM sheets WHERE id = ?').bind(s.id).run();
      }
      return json({ ok: true });
    }

    // --- Tags ---
    if (path === 'tags' && method === 'GET') {
      const { results } = await DB.prepare('SELECT * FROM tags ORDER BY name').all();
      return json(results);
    }

    if (path === 'tags' && method === 'POST') {
      const { name, color } = body;
      const tag = { id: uid(), name, color: color || '#888' };
      await DB.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').bind(tag.id, tag.name, tag.color).run();
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
      vals.push(id);
      await DB.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return json({ ok: true });
    }

    if (segments[0] === 'tags' && segments[1] && method === 'DELETE') {
      const id = segments[1];
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
      return json({ ok: true });
    }

    if (segments[0] === 'sheet-tags' && segments[1] && segments[2] && method === 'DELETE') {
      await DB.prepare('DELETE FROM sheet_tags WHERE sheetId = ? AND tagId = ?')
        .bind(segments[1], segments[2]).run();
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
      return json({ ok: true });
    }

    if (segments[0] === 'goals' && segments[1] && method === 'DELETE') {
      await DB.prepare('DELETE FROM goals WHERE sheetId = ?').bind(segments[1]).run();
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

    // --- Backup ---
    if (path === 'backup' && method === 'GET') {
      const groups = (await DB.prepare('SELECT * FROM groups ORDER BY sortOrder').all()).results;
      const sheets = (await DB.prepare('SELECT * FROM sheets').all()).results;
      const tags = (await DB.prepare('SELECT * FROM tags').all()).results;
      const sheetTags = (await DB.prepare('SELECT * FROM sheet_tags').all()).results;
      const goals = (await DB.prepare('SELECT * FROM goals').all()).results;
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
      // Schema migrations: add icon columns if missing
      try {
        await DB.prepare('ALTER TABLE groups ADD COLUMN icon TEXT DEFAULT NULL').run();
      } catch (e) { /* column already exists */ }
      try {
        await DB.prepare('ALTER TABLE groups ADD COLUMN iconColor TEXT DEFAULT NULL').run();
      } catch (e) { /* column already exists */ }
      try {
        await DB.prepare('ALTER TABLE groups ADD COLUMN collapsed INTEGER DEFAULT 0').run();
      } catch (e) { /* column already exists */ }

      const { results } = await DB.prepare('SELECT COUNT(*) as cnt FROM groups').all();
      if (results[0].cnt === 0) {
        const group = { id: uid(), parentId: null, name: 'Inbox', sortOrder: 0, createdAt: Date.now() };
        await DB.prepare('INSERT INTO groups (id, parentId, name, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)')
          .bind(group.id, group.parentId, group.name, group.sortOrder, group.createdAt).run();
        return json({ created: true, group });
      }
      return json({ created: false });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
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
async function getFilteredSheets(filter, DB) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  let results;
  const joinSelect = 'SELECT sheets.*, groups.name AS groupName FROM sheets LEFT JOIN groups ON sheets.groupId = groups.id';

  if (filter.startsWith('tag:')) {
    const tagId = filter.slice(4);
    const results = (await DB.prepare(
      joinSelect + ' INNER JOIN sheet_tags st ON sheets.id = st.sheetId WHERE st.tagId = ? AND sheets.isTrashed = 0 ORDER BY sheets.updatedAt DESC'
    ).bind(tagId).all()).results;
    return results;
  }

  switch (filter) {
    case 'all':
      results = (await DB.prepare(`${joinSelect} WHERE sheets.isTrashed = 0 ORDER BY sheets.updatedAt DESC`).all()).results;
      break;
    case 'recent':
      results = (await DB.prepare(`${joinSelect} WHERE sheets.isTrashed = 0 AND sheets.createdAt > ? ORDER BY sheets.updatedAt DESC`).bind(now - sevenDays).all()).results;
      break;
    case 'favorites':
      results = (await DB.prepare(`${joinSelect} WHERE sheets.isTrashed = 0 AND sheets.favorite = 1 ORDER BY sheets.updatedAt DESC`).all()).results;
      break;
    case 'trash':
      results = (await DB.prepare(`${joinSelect} WHERE sheets.isTrashed = 1 ORDER BY sheets.updatedAt DESC`).all()).results;
      break;
    default:
      results = [];
  }
  return results;
}

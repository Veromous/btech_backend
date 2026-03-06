import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { join } from 'path';
import admin from '../firebase';

const router = Router();

// ── SQLite setup ─────────────────────────────────────────────────────────────
const db = new Database(join(__dirname, '../../datacenter.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS discussions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'General',
    authorName  TEXT    NOT NULL,
    authorUid   TEXT    NOT NULL,
    createdAt   INTEGER NOT NULL,
    replyCount  INTEGER NOT NULL DEFAULT 0,
    likeCount   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS replies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discussionId INTEGER NOT NULL,
    body         TEXT    NOT NULL,
    authorName   TEXT    NOT NULL,
    authorUid    TEXT    NOT NULL,
    createdAt    INTEGER NOT NULL,
    FOREIGN KEY (discussionId) REFERENCES discussions(id)
  );
`);

// ── Auth helper ───────────────────────────────────────────────────────────────
const verifyToken = async (authHeader?: string) => {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    try {
        return await admin.auth().verifyIdToken(token);
    } catch {
        return null;
    }
};

// ── GET /discussions ──────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
    try {
        const rows = db
            .prepare('SELECT * FROM discussions ORDER BY createdAt DESC LIMIT 50')
            .all();

        // Return createdAt as { _seconds } to match the frontend interface
        const threads = rows.map((r: any) => ({
            ...r,
            id: String(r.id),
            createdAt: { _seconds: r.createdAt },
        }));

        res.json(threads);
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('GET /discussions error:', msg);
        res.status(500).json({ error: msg });
    }
});

// ── POST /discussions ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
    const decoded = await verifyToken(req.headers.authorization);
    if (!decoded) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const { title, body, category } = req.body as {
        title?: string;
        body?: string;
        category?: string;
    };

    if (!title?.trim() || !body?.trim()) {
        res.status(400).json({ error: 'title and body are required' });
        return;
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO discussions (title, body, category, authorName, authorUid, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            title.trim(),
            body.trim(),
            category?.trim() || 'General',
            decoded.name ?? decoded.email ?? 'Anonymous',
            decoded.uid,
            Math.floor(Date.now() / 1000),
        );

        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('POST /discussions error:', msg);
        res.status(500).json({ error: msg });
    }
});

// ── PUT /discussions/:id/like ─────────────────────────────────────────────────
router.put('/:id/like', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        db.prepare('UPDATE discussions SET likeCount = likeCount + 1 WHERE id = ?').run(id);
        const row: any = db.prepare('SELECT likeCount FROM discussions WHERE id = ?').get(id);
        if (!row) { res.status(404).json({ error: 'Not found' }); return; }
        res.json({ likeCount: row.likeCount });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── PUT /discussions/:id/unlike ───────────────────────────────────────────────
router.put('/:id/unlike', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Clamp at 0 so count never goes negative
        db.prepare('UPDATE discussions SET likeCount = MAX(0, likeCount - 1) WHERE id = ?').run(id);
        const row: any = db.prepare('SELECT likeCount FROM discussions WHERE id = ?').get(id);
        if (!row) { res.status(404).json({ error: 'Not found' }); return; }
        res.json({ likeCount: row.likeCount });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── GET /discussions/:id/replies ──────────────────────────────────────────────
router.get('/:id/replies', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const rows: any[] = db
            .prepare('SELECT * FROM replies WHERE discussionId = ? ORDER BY createdAt ASC')
            .all(id) as any[];
        res.json(rows.map((r: any) => ({ ...r, id: String(r.id), createdAt: { _seconds: r.createdAt } })));
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── POST /discussions/:id/replies ─────────────────────────────────────────────
router.post('/:id/replies', async (req: Request, res: Response) => {
    const decoded = await verifyToken(req.headers.authorization);
    if (!decoded) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { body } = req.body as { body?: string };
    if (!body?.trim()) { res.status(400).json({ error: 'body is required' }); return; }

    const { id } = req.params;
    try {
        const ins = db.prepare(
            'INSERT INTO replies (discussionId, body, authorName, authorUid, createdAt) VALUES (?, ?, ?, ?, ?)'
        );
        const result = ins.run(
            id, body.trim(),
            decoded.name ?? decoded.email ?? 'Anonymous',
            decoded.uid,
            Math.floor(Date.now() / 1000),
        );
        // bump replyCount on parent thread
        db.prepare('UPDATE discussions SET replyCount = replyCount + 1 WHERE id = ?').run(id);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

export default router;

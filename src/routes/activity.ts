import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { join } from 'path';

const router = Router();
const db = new Database(join(__dirname, '../../datacenter.db'));

// ── Schema: per-user interaction events (searches + dataset views) ────────────
// Powers the "Recommended for you" section on the home page.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    uid       TEXT    NOT NULL,
    kind      TEXT    NOT NULL,            -- 'search' | 'view'
    term      TEXT    NOT NULL DEFAULT '', -- search query or viewed dataset name
    category  TEXT    NOT NULL DEFAULT '', -- category context, when known
    datasetId INTEGER,                     -- viewed dataset id, when known
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_events_uid ON user_events (uid, createdAt);
`);

// ── POST /activity/track ──────────────────────────────────────────────────────
// Records a single user interaction. Fire-and-forget from the frontend.
// Body: { uid, kind: 'search'|'view', term?, category?, datasetId? }
router.post('/track', (req: Request, res: Response) => {
    try {
        const { uid, kind, term, category, datasetId } = req.body as {
            uid?: string; kind?: string; term?: string; category?: string; datasetId?: number;
        };

        if (!uid?.trim() || (kind !== 'search' && kind !== 'view')) {
            res.status(400).json({ error: 'uid and a valid kind (search|view) are required' });
            return;
        }

        db.prepare(`
            INSERT INTO user_events (uid, kind, term, category, datasetId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            uid.trim(),
            kind,
            (term ?? '').trim().slice(0, 200),
            (category ?? '').trim(),
            typeof datasetId === 'number' ? datasetId : null,
            Math.floor(Date.now() / 1000),
        );

        res.status(201).json({ ok: true });
    } catch (err) {
        console.error('POST /activity/track error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── GET /activity ────────────────────────────────────────────────────────────
// Returns a merged, chronologically-sorted feed of recent platform events:
//   - New discussion posts
//   - Discussion replies
//   - Datasets published to the catalog
//
// Each item has: { type, title, description, author, timestamp }
router.get('/', (_req: Request, res: Response) => {
    try {
        // 1. Recent discussions
        const discussions: any[] = db.prepare(`
            SELECT title, authorName, createdAt FROM discussions
            ORDER BY createdAt DESC LIMIT 10
        `).all();

        // 2. Recent replies (with parent discussion title)
        const replies: any[] = db.prepare(`
            SELECT r.body, r.authorName, r.createdAt, d.title AS discussionTitle
            FROM replies r
            JOIN discussions d ON r.discussionId = d.id
            ORDER BY r.createdAt DESC LIMIT 10
        `).all();

        // 3. Recent catalog additions (only if the catalog table exists)
        let catalogEntries: any[] = [];
        try {
            catalogEntries = db.prepare(`
                SELECT name, category, region, rowCount FROM catalog
                ORDER BY id DESC LIMIT 10
            `).all();
        } catch {
            // catalog table may not exist yet — that's fine
        }

        // ── Merge into a unified feed ─────────────────────────────────────────
        const feed: {
            type: string;
            title: string;
            description: string;
            author: string;
            timestamp: number;
            icon: string;
        }[] = [];

        for (const d of discussions) {
            feed.push({
                type: 'discussion',
                title: d.title,
                description: 'Started a new discussion',
                author: d.authorName,
                timestamp: d.createdAt,
                icon: '💬',
            });
        }

        for (const r of replies) {
            const snippet = r.body.length > 60 ? r.body.slice(0, 60) + '…' : r.body;
            feed.push({
                type: 'reply',
                title: `Replied to "${r.discussionTitle}"`,
                description: snippet,
                author: r.authorName,
                timestamp: r.createdAt,
                icon: '↩️',
            });
        }

        for (const c of catalogEntries) {
            feed.push({
                type: 'catalog',
                title: c.name,
                description: `Published a ${c.category} dataset · ${c.region} · ${c.rowCount} rows`,
                author: 'DataCenter',
                timestamp: Math.floor(Date.now() / 1000), // catalog doesn't have createdAt yet
                icon: '📊',
            });
        }

        // Sort newest-first, take top 15
        feed.sort((a, b) => b.timestamp - a.timestamp);
        const result = feed.slice(0, 15);

        res.json(result);
    } catch (err) {
        console.error('GET /activity error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

export default router;

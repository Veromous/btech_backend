// Load environment variables FIRST — before any route module is imported, so
// that modules reading process.env at load time (e.g. auth.ts builds its SMTP
// transporter from SMTP_USER/SMTP_PASS) see the populated values.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import discussionRoutes from './routes/discussions';
import datasetRoutes from './routes/datasets';
import catalogRoutes from './routes/catalog';
import activityRoutes from './routes/activity';

const app = express();
const PORT = process.env.PORT ?? 4000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://main.d1vjg3imib3w4w.amplifyapp.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/discussions', discussionRoutes);
app.use('/datasets', datasetRoutes);
app.use('/catalog', catalogRoutes);
app.use('/activity', activityRoutes);

app.get('/', (_req, res) => {
    res.json({ status: 'DataCenter API running' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Backend running at http://localhost:${PORT}`);
});

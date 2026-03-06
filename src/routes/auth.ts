import { Router, Request, Response } from 'express';
import admin from '../firebase';

const router = Router();

// POST /auth/verify
// Receives a Firebase ID token, verifies it, returns decoded user info
router.post('/verify', async (req: Request, res: Response) => {
    const { idToken } = req.body as { idToken?: string };

    if (!idToken) {
        res.status(400).json({ error: 'idToken is required' });
        return;
    }

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);

        res.status(200).json({
            uid: decoded.uid,
            email: decoded.email ?? null,
            name: decoded.name ?? decoded.email ?? 'User',
            photoURL: decoded.picture ?? null,
        });
    } catch (err) {
        console.error('Token verification failed:', err);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
});

// POST /auth/logout
// Stateless acknowledgement (Firebase tokens expire; optionally revoke refresh tokens)
router.post('/logout', async (req: Request, res: Response) => {
    const { uid } = req.body as { uid?: string };

    if (uid) {
        try {
            await admin.auth().revokeRefreshTokens(uid);
        } catch (err) {
            console.error('Token revocation failed:', err);
        }
    }

    res.status(200).json({ message: 'Logged out successfully' });
});

export default router;

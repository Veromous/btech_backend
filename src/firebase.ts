import admin from 'firebase-admin';

if (!admin.apps.length) {
    // Prefer env vars (required for cloud deployment — no JSON file needed).
    // Falls back to the local serviceAccountKey.json for development convenience.
    if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Amplify / most CI systems encode \n as a literal backslash-n in env vars
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
    } else {
        // Local fallback — serviceAccountKey.json is git-ignored and only exists locally
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const serviceAccount = JSON.parse(
            readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf-8')
        );
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        });
    }
}

export default admin;

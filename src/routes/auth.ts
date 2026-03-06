import { Router, Request, Response } from 'express';
import admin from '../firebase';
import nodemailer from 'nodemailer';

const router = Router();

// ── Email transporter (Gmail SMTP) ───────────────────────────────────────────
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

const transporter = smtpUser && smtpPass
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: smtpUser, pass: smtpPass },
    })
    : null;

if (!transporter) {
    console.warn('⚠️  SMTP not configured — welcome emails will be skipped. Set SMTP_USER and SMTP_PASS in .env');
}

// ── Welcome email HTML template ───────────────────────────────────────────────
function buildWelcomeEmail(name: string): string {
    const firstName = name.split(' ')[0];
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to DataCenter</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#000000;padding:32px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">DataCenter</h1>
              <p style="color:#9ca3af;margin:6px 0 0;font-size:13px;">Cameroon's Data Quality Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 12px;font-size:22px;color:#111827;font-weight:700;">
                Welcome aboard, ${firstName}! 🎉
              </h2>
              <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">
                Thank you for creating your DataCenter account. You now have full access to
                Cameroon's growing open data repository — curated, quality-checked, and
                community-driven.
              </p>

              <!-- Features -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td style="padding:10px 14px;background:#f9fafb;border-radius:10px;margin-bottom:8px;display:block;">
                    <span style="font-size:18px;">📊</span>
                    <strong style="font-size:14px;color:#111827;margin-left:8px;">Browse Datasets</strong>
                    <p style="margin:4px 0 0 32px;font-size:13px;color:#6b7280;">Search, filter, and download datasets across Health, Agriculture, Education, Finance, Climate and more.</p>
                  </td>
                </tr>
                <tr><td height="8"></td></tr>
                <tr>
                  <td style="padding:10px 14px;background:#f9fafb;border-radius:10px;">
                    <span style="font-size:18px;">⭐</span>
                    <strong style="font-size:14px;color:#111827;margin-left:8px;">Upload & Analyse</strong>
                    <p style="margin:4px 0 0 32px;font-size:13px;color:#6b7280;">Upload your own CSV, JSON, or Excel files and get an instant data quality report with a score out of 100.</p>
                  </td>
                </tr>
                <tr><td height="8"></td></tr>
                <tr>
                  <td style="padding:10px 14px;background:#f9fafb;border-radius:10px;">
                    <span style="font-size:18px;">💬</span>
                    <strong style="font-size:14px;color:#111827;margin-left:8px;">Join the Discussion</strong>
                    <p style="margin:4px 0 0 32px;font-size:13px;color:#6b7280;">Connect with researchers, share findings, and collaborate in the community forum.</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="http://localhost:5173"
                       style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                      Go to DataCenter →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.6;">
                If you have questions or need help, visit our
                <a href="http://localhost:5173/support" style="color:#000;font-weight:600;">Support page</a>
                and we'll be happy to assist.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                © ${new Date().getFullYear()} DataCenter &nbsp;·&nbsp; Cameroon Open Data Platform<br/>
                <span style="font-size:11px;">You received this email because you created a DataCenter account.</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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

// POST /auth/welcome-email
// Called from the frontend right after a new user registers (any provider)
router.post('/welcome-email', async (req: Request, res: Response) => {
    const { email, name } = req.body as { email?: string; name?: string };

    if (!email) {
        res.status(400).json({ error: 'email is required' });
        return;
    }

    if (!transporter) {
        // SMTP not configured — acknowledge but skip sending
        console.log(`📧 Welcome email skipped (SMTP not configured) for ${email}`);
        res.status(200).json({ message: 'Email skipped — SMTP not configured' });
        return;
    }

    try {
        await transporter.sendMail({
            from: `"DataCenter" <${smtpUser}>`,
            to: email,
            subject: `Welcome to DataCenter, ${(name ?? 'there').split(' ')[0]}! 🎉`,
            html: buildWelcomeEmail(name ?? 'there'),
        });

        console.log(`✅ Welcome email sent to ${email}`);
        res.status(200).json({ message: 'Welcome email sent' });
    } catch (err) {
        console.error('Failed to send welcome email:', err);
        // Don't fail the signup flow — email is non-critical
        res.status(200).json({ message: 'Email could not be sent, but signup succeeded' });
    }
});

export default router;


const nodemailer = require('nodemailer');

/**
 * Sends a password reset email using Resend API or Nodemailer SMTP,
 * with console logging for development / unconfigured environments.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const from = process.env.EMAIL_FROM || 'FlowLedger <noreply@flowledger.app>';
  const subject = 'Reset your FlowLedger password';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1c1917;">
      <h2 style="color:#6366f1;margin-bottom:16px;">FlowLedger Password Reset</h2>
      <p style="font-size:15px;line-height:1.5;margin-bottom:20px;">
        You requested a password reset for your FlowLedger account. Click the button below to set a new password:
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${resetUrl}" style="background-color:#6366f1;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Reset Password
        </a>
      </div>
      <p style="font-size:13px;color:#78716c;line-height:1.4;margin-top:24px;">
        This link is single-use and will expire in 30 minutes. If you did not request this reset, you can safely ignore this email.
      </p>
      <p style="font-size:12px;color:#a8a29e;word-break:break-all;margin-top:16px;">
        Direct link: <a href="${resetUrl}" style="color:#6366f1;">${resetUrl}</a>
      </p>
    </div>
  `;
  const text = `Reset your FlowLedger password: ${resetUrl}\n\nThis link is single-use and expires in 30 minutes. If you did not request this reset, you can ignore this email.`;

  // 1. Resend API if RESEND_API_KEY is configured
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from, to: [to], subject, html, text })
      });
      if (res.ok) {
        return true;
      }
      const errBody = await res.text();
      console.error('Resend API error:', res.status, errBody);
    } catch (err) {
      console.error('Resend error:', err.message);
    }
  }

  // 2. Nodemailer SMTP if SMTP_HOST is configured
  if (process.env.SMTP_HOST) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined
      });
      await transporter.sendMail({ from, to, subject, html, text });
      return true;
    } catch (err) {
      console.error('Nodemailer SMTP error:', err.message);
    }
  }

  // 3. Fallback / Dev / Test logging
  if (process.env.NODE_ENV !== 'production' || (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST)) {
    console.log(`[PASSWORD RESET EMAIL] To: ${to} | Reset Link: ${resetUrl}`);
  }
  return false;
}

module.exports = { sendPasswordResetEmail };

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_ADDR = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;

function getTransporter() {
  if (!transporter && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

async function sendVerificationEmail(to, code) {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    await t.sendMail({
      from: FROM_ADDR,
      to,
      subject: 'ChaosBuilder 邮箱验证码',
      html: `<div style="max-width:480px;margin:40px auto;padding:32px;border-radius:12px;background:#faf9f5;font-family:-apple-system,sans-serif;">
        <h2 style="margin:0 0 8px;color:#3a3530;">ChaosBuilder · 混沌艺术</h2>
        <p style="color:#6b6560;margin-bottom:24px;">您的邮箱验证码为：</p>
        <div style="font-size:32px;font-weight:600;letter-spacing:8px;text-align:center;padding:16px;background:#fff;border-radius:8px;border:1px solid #e0ddd8;color:#c96442;">${code}</div>
        <p style="color:#8a8580;font-size:13px;margin-top:24px;">验证码 10 分钟内有效，请勿泄露给他人。</p></div>`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { sendVerificationEmail, getTransporter };
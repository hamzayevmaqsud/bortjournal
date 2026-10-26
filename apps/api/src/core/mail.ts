/**
 * Отправка писем. Два способа — какой настроен в .env:
 *  - Gmail (или любой SMTP): SMTP_USER — адрес Gmail, SMTP_PASS — пароль приложения
 *    (Аккаунт Google → Безопасность → Двухэтапная проверка → Пароли приложений). Порт по умолчанию 587 (STARTTLS);
 *    SMTP_HOST/SMTP_PORT — если не Gmail;
 *  - Resend: RESEND_API_KEY и MAIL_FROM.
 * MAIL_FROM — от кого письмо; для Gmail по умолчанию «Lumi <SMTP_USER>».
 */
import nodemailer from 'nodemailer';

const env = (k: string) => process.env[k]?.trim() || '';
const smtpOn = () => !!(env('SMTP_USER') && env('SMTP_PASS'));
export const mailEnabled = () => smtpOn() || !!(env('RESEND_API_KEY') && env('MAIL_FROM'));

let transport: nodemailer.Transporter | null = null;
function smtp() {
  if (transport) return transport;
  // 587 + STARTTLS: многие хостинги (Hetzner в том числе) закрывают исходящие 25 и 465; шифрование обязательно и здесь
  const port = Number(env('SMTP_PORT') || 587);
  transport = nodemailer.createTransport({ host: env('SMTP_HOST') || 'smtp.gmail.com', port, secure: port === 465, requireTLS: port !== 465, auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS').replace(/\s+/g, '') }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
  return transport;
}

export async function sendMail(to: string, subject: string, text: string) {
  if (smtpOn()) {
    await smtp().sendMail({ from: env('MAIL_FROM') || `Lumi <${env('SMTP_USER')}>`, to, subject, text });
    return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to, subject, text })
  });
  if (!r.ok) throw new Error(`почта: ${r.status}`);
}

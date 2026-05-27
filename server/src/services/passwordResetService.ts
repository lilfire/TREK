import nodemailer from 'nodemailer';
import { db } from '../db/database';
import { decrypt_api_key } from './apiKeyCrypto';
import { logInfo, logError } from './auditLog';
import { buildEmailHtml, getUserLanguage } from './notifications';

// ── Helpers ────────────────────────────────────────────────────────────────

function getAppSetting(key: string): string | null {
  return (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value || null;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST || getAppSetting('smtp_host');
  const port = process.env.SMTP_PORT || getAppSetting('smtp_port');
  const user = process.env.SMTP_USER || getAppSetting('smtp_user');
  const pass = process.env.SMTP_PASS || decrypt_api_key(getAppSetting('smtp_pass')) || '';
  const from = process.env.SMTP_FROM || getAppSetting('smtp_from');
  if (!host || !port || !from) return null;
  return { host, port: parseInt(port, 10), user: user || '', pass: pass || '', from, secure: parseInt(port, 10) === 465 };
}

// ── Password reset i18n ────────────────────────────────────────────────────

interface PasswordResetStrings { subject: string; greeting: string; body: string; ctaIntro: string; expiry: string; ignore: string }

const PASSWORD_RESET_I18N: Record<string, PasswordResetStrings> = {
  en: { subject: 'Reset your password', greeting: 'Hi', body: 'We received a request to reset the password for your TREK account. Click the button below to set a new password.', ctaIntro: 'Reset password', expiry: 'This link expires in 60 minutes.', ignore: "If you didn't request this, you can safely ignore this email — your password won't change." },
  de: { subject: 'Passwort zurücksetzen', greeting: 'Hallo', body: 'Wir haben eine Anfrage erhalten, das Passwort für dein TREK-Konto zurückzusetzen. Klicke auf den Button unten, um ein neues Passwort festzulegen.', ctaIntro: 'Passwort zurücksetzen', expiry: 'Dieser Link ist 60 Minuten gültig.', ignore: 'Wenn du das nicht warst, ignoriere diese E-Mail — dein Passwort bleibt unverändert.' },
  fr: { subject: 'Réinitialisez votre mot de passe', greeting: 'Bonjour', body: 'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte TREK. Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe.', ctaIntro: 'Réinitialiser le mot de passe', expiry: 'Ce lien expire dans 60 minutes.', ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail — votre mot de passe ne changera pas." },
  es: { subject: 'Restablecer tu contraseña', greeting: 'Hola', body: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de TREK. Haz clic en el botón de abajo para establecer una nueva contraseña.', ctaIntro: 'Restablecer contraseña', expiry: 'Este enlace caduca en 60 minutos.', ignore: 'Si no solicitaste esto, puedes ignorar este correo — tu contraseña no cambiará.' },
  it: { subject: 'Reimposta la tua password', greeting: 'Ciao', body: 'Abbiamo ricevuto una richiesta di reimpostazione della password per il tuo account TREK. Clicca il pulsante qui sotto per impostare una nuova password.', ctaIntro: 'Reimposta password', expiry: 'Questo link scade tra 60 minuti.', ignore: 'Se non hai richiesto questa operazione, ignora questa email — la tua password non cambierà.' },
  nl: { subject: 'Reset je wachtwoord', greeting: 'Hallo', body: 'We hebben een verzoek ontvangen om het wachtwoord voor je TREK-account te resetten. Klik op de knop hieronder om een nieuw wachtwoord in te stellen.', ctaIntro: 'Wachtwoord resetten', expiry: 'Deze link verloopt over 60 minuten.', ignore: 'Als jij dit niet hebt aangevraagd, kun je deze e-mail negeren — je wachtwoord blijft ongewijzigd.' },
  ru: { subject: 'Сброс пароля', greeting: 'Здравствуйте', body: 'Мы получили запрос на сброс пароля вашего аккаунта TREK. Нажмите кнопку ниже, чтобы установить новый пароль.', ctaIntro: 'Сбросить пароль', expiry: 'Ссылка действительна 60 минут.', ignore: 'Если вы не запрашивали сброс — просто проигнорируйте это письмо, пароль останется прежним.' },
  zh: { subject: '重置您的密码', greeting: '您好', body: '我们收到了重置您的 TREK 账户密码的请求。点击下方按钮设置新密码。', ctaIntro: '重置密码', expiry: '此链接将在 60 分钟后失效。', ignore: '如果这不是您本人的请求，可以忽略本邮件 — 您的密码不会改变。' },
  'zh-TW': { subject: '重設您的密碼', greeting: '您好', body: '我們收到了重設您 TREK 帳號密碼的請求。點擊下方按鈕以設定新密碼。', ctaIntro: '重設密碼', expiry: '此連結將於 60 分鐘後失效。', ignore: '若非您本人發起的請求，請忽略此郵件 — 您的密碼不會變更。' },
  hu: { subject: 'Jelszó visszaállítása', greeting: 'Szia', body: 'Kérést kaptunk a TREK-fiókod jelszavának visszaállítására. Kattints az alábbi gombra az új jelszó beállításához.', ctaIntro: 'Jelszó visszaállítása', expiry: 'Ez a link 60 perc után lejár.', ignore: 'Ha nem te kérted ezt, nyugodtan hagyd figyelmen kívül ezt az e-mailt — a jelszavad változatlan marad.' },
  ar: { subject: 'إعادة تعيين كلمة المرور', greeting: 'مرحبا', body: 'تلقينا طلبًا لإعادة تعيين كلمة المرور لحسابك في TREK. انقر على الزر أدناه لتعيين كلمة مرور جديدة.', ctaIntro: 'إعادة تعيين كلمة المرور', expiry: 'تنتهي صلاحية هذا الرابط خلال 60 دقيقة.', ignore: 'إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة — لن تتغير كلمة المرور الخاصة بك.' },
  br: { subject: 'Redefinir sua senha', greeting: 'Olá', body: 'Recebemos um pedido para redefinir a senha da sua conta TREK. Clique no botão abaixo para definir uma nova senha.', ctaIntro: 'Redefinir senha', expiry: 'Este link expira em 60 minutos.', ignore: 'Se você não solicitou isto, pode ignorar este e-mail — sua senha não será alterada.' },
  cs: { subject: 'Obnovení hesla', greeting: 'Ahoj', body: 'Obdrželi jsme žádost o obnovení hesla k tvému účtu TREK. Klikni na tlačítko níže a nastav nové heslo.', ctaIntro: 'Obnovit heslo', expiry: 'Odkaz vyprší za 60 minut.', ignore: 'Pokud jsi o obnovení nežádal/a, tento e-mail ignoruj — heslo zůstane beze změny.' },
  pl: { subject: 'Zresetuj hasło', greeting: 'Cześć', body: 'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta TREK. Kliknij przycisk poniżej, aby ustawić nowe hasło.', ctaIntro: 'Zresetuj hasło', expiry: 'Link wygaśnie za 60 minut.', ignore: 'Jeśli to nie Ty, zignoruj tę wiadomość — Twoje hasło pozostanie bez zmian.' },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPasswordResetHtml(subject: string, strings: PasswordResetStrings, recipient: string, resetUrl: string, lang: string): string {
  const safeGreeting = escapeHtml(`${strings.greeting}, ${recipient}`);
  const safeBody = escapeHtml(strings.body);
  const safeExpiry = escapeHtml(strings.expiry);
  const safeIgnore = escapeHtml(strings.ignore);
  const safeCta = escapeHtml(strings.ctaIntro);
  const block = `
    <p style="margin:0 0 16px 0; font-size:16px;">${safeGreeting},</p>
    <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6;">${safeBody}</p>
    <p style="margin:28px 0;">
      <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:#111827;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">${safeCta}</a>
    </p>
    <p style="margin:0 0 10px 0; font-size:13px; color:#6B7280;">${safeExpiry}</p>
    <p style="margin:0; font-size:13px; color:#6B7280;">${safeIgnore}</p>
  `;
  return buildEmailHtml(subject, block, lang, undefined, true);
}

// ── sendPasswordResetEmail ─────────────────────────────────────────────────

/**
 * Delivers a password-reset link. When SMTP is configured the user
 * receives an email. When it isn't, the link is logged to stdout so
 * the self-hosting admin can hand it off by other means.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  userId: number | null,
): Promise<{ delivered: 'email' | 'log' | 'failed' }> {
  const lang = userId ? getUserLanguage(userId) : 'en';
  const strings = PASSWORD_RESET_I18N[lang] || PASSWORD_RESET_I18N.en;
  const smtpCfg = getSmtpConfig();

  if (!smtpCfg) {
    // eslint-disable-next-line no-console
    console.log(
      `\n===== PASSWORD RESET LINK =====\n` +
      `to: ${to}\n` +
      `url: ${resetUrl}\n` +
      `expires: 60 minutes\n` +
      `(SMTP is not configured — deliver this link to the user manually.)\n` +
      `================================\n`,
    );
    logInfo(`Password reset link issued (no SMTP) for=${to}`);
    return { delivered: 'log' };
  }

  try {
    const skipTls = process.env.SMTP_SKIP_TLS_VERIFY === 'true' || getAppSetting('smtp_skip_tls_verify') === 'true';
    const transporter = nodemailer.createTransport({
      host: smtpCfg.host,
      port: smtpCfg.port,
      secure: smtpCfg.secure,
      auth: smtpCfg.user ? { user: smtpCfg.user, pass: smtpCfg.pass } : undefined,
      ...(skipTls ? { tls: { rejectUnauthorized: false } } : {}),
    });
    await transporter.sendMail({
      from: smtpCfg.from,
      to,
      subject: `TREK — ${strings.subject}`,
      text: `${strings.greeting}, ${to}\n\n${strings.body}\n\n${strings.ctaIntro}: ${resetUrl}\n\n${strings.expiry}\n${strings.ignore}`,
      html: buildPasswordResetHtml(strings.subject, strings, to, resetUrl, lang),
    });
    logInfo(`Password reset email sent to=${to}`);
    return { delivered: 'email' };
  } catch (err) {
    logError(`Password reset email failed to=${to}: ${err instanceof Error ? err.message : err}`);
    return { delivered: 'failed' };
  }
}

import { sendEmail, getUserLanguage, getAppUrl } from './notifications';

// ── RSVP confirmation i18n ─────────────────────────────────────────────────

function getRsvpConfirmationTitle(lang: string, tripTitle: string): string {
  const titles: Record<string, string> = {
    en: `RSVP confirmed — ${tripTitle}`,
    de: `RSVP bestätigt — ${tripTitle}`,
    fr: `RSVP confirmé — ${tripTitle}`,
    es: `RSVP confirmado — ${tripTitle}`,
    nl: `RSVP bevestigd — ${tripTitle}`,
    ru: `RSVP подтверждён — ${tripTitle}`,
    zh: `RSVP 已确认 — ${tripTitle}`,
    'zh-TW': `RSVP 已確認 — ${tripTitle}`,
    ar: `تم تأكيد RSVP — ${tripTitle}`,
    id: `RSVP dikonfirmasi — ${tripTitle}`,
    it: `RSVP confermato — ${tripTitle}`,
    hu: `RSVP megerősítve — ${tripTitle}`,
    cs: `RSVP potvrzeno — ${tripTitle}`,
    pl: `RSVP potwierdzone — ${tripTitle}`,
    br: `RSVP confirmado — ${tripTitle}`,
  };
  return titles[lang] ?? titles.en;
}

interface SetPasswordStrings { intro: string; expiry: string }

const SET_PASSWORD_I18N: Record<string, SetPasswordStrings> = {
  en: { intro: 'You now have a TREK account. Set your password to manage it:', expiry: 'This link expires in 7 days.' },
  de: { intro: 'Du hast jetzt ein TREK-Konto. Lege dein Passwort fest, um es zu verwalten:', expiry: 'Dieser Link ist 7 Tage gültig.' },
  fr: { intro: 'Vous avez maintenant un compte TREK. Définissez votre mot de passe pour le gérer :', expiry: 'Ce lien expire dans 7 jours.' },
  es: { intro: 'Ahora tienes una cuenta de TREK. Establece tu contraseña para gestionarla:', expiry: 'Este enlace caduca en 7 días.' },
  nl: { intro: 'Je hebt nu een TREK-account. Stel je wachtwoord in om het te beheren:', expiry: 'Deze link verloopt over 7 dagen.' },
  ru: { intro: 'Теперь у вас есть аккаунт TREK. Установите пароль, чтобы управлять им:', expiry: 'Ссылка действительна 7 дней.' },
  zh: { intro: '您现在拥有一个 TREK 账户。设置密码以管理它：', expiry: '此链接将在 7 天后失效。' },
  'zh-TW': { intro: '您現在擁有一個 TREK 帳號。設定密碼以管理它：', expiry: '此連結將於 7 天後失效。' },
  ar: { intro: 'لديك الآن حساب في TREK. عيّن كلمة المرور لإدارته:', expiry: 'تنتهي صلاحية هذا الرابط خلال 7 أيام.' },
  id: { intro: 'Anda kini memiliki akun TREK. Atur kata sandi untuk mengelolanya:', expiry: 'Tautan ini kedaluwarsa dalam 7 hari.' },
  it: { intro: 'Ora hai un account TREK. Imposta la password per gestirlo:', expiry: 'Questo link scade tra 7 giorni.' },
  hu: { intro: 'Most már van TREK-fiókod. Állítsd be a jelszavad a kezeléséhez:', expiry: 'Ez a link 7 nap után lejár.' },
  cs: { intro: 'Nyní máš účet TREK. Nastav si heslo pro jeho správu:', expiry: 'Odkaz vyprší za 7 dní.' },
  pl: { intro: 'Masz teraz konto TREK. Ustaw hasło, aby nim zarządzać:', expiry: 'Link wygaśnie za 7 dni.' },
  br: { intro: 'Agora você tem uma conta TREK. Defina sua senha para gerenciá-la:', expiry: 'Este link expira em 7 dias.' },
};

function getSetPasswordSection(lang: string, setPasswordUrl: string): string {
  const strings = SET_PASSWORD_I18N[lang] ?? SET_PASSWORD_I18N.en;
  return `\n\n${strings.intro} ${setPasswordUrl}\n(${strings.expiry})`;
}

function getRsvpConfirmationBody(lang: string, name: string, tripTitle: string, tripId: number, setPasswordUrl?: string): string {
  const appUrl = getAppUrl();
  const link = `${appUrl}/trips/public/${tripId}`;
  const setPasswordSection = setPasswordUrl ? getSetPasswordSection(lang, setPasswordUrl) : '';

  const bodies: Record<string, string> = {
    en: `Hi ${name},\n\nYou are confirmed for the trip: ${tripTitle}.\n\nView it here: ${link}\n\nSee you there!`,
    de: `Hallo ${name},\n\nDeine Teilnahme an der Reise „${tripTitle}" ist bestätigt.\n\nHier anzeigen: ${link}\n\nBis dann!`,
    fr: `Bonjour ${name},\n\nVotre participation au voyage « ${tripTitle} » est confirmée.\n\nVoir ici : ${link}\n\nÀ bientôt !`,
    es: `Hola ${name},\n\nTu participación en el viaje "${tripTitle}" está confirmada.\n\nVer aquí: ${link}\n\n¡Nos vemos!`,
    nl: `Hallo ${name},\n\nJe deelname aan de reis "${tripTitle}" is bevestigd.\n\nBekijk hier: ${link}\n\nTot dan!`,
    ru: `Привет, ${name}!\n\nВы подтверждены для поездки «${tripTitle}».\n\nПосмотреть здесь: ${link}\n\nДо встречи!`,
    zh: `你好 ${name}，\n\n您已确认参加旅行：${tripTitle}。\n\n查看链接：${link}\n\n期待与您相见！`,
    'zh-TW': `您好 ${name}，\n\n您已確認參加行程：${tripTitle}。\n\n查看連結：${link}\n\n期待與您相見！`,
    ar: `مرحبا ${name}،\n\nلقد تم تأكيد مشاركتك في الرحلة: ${tripTitle}.\n\nشاهدها هنا: ${link}\n\nإلى اللقاء!`,
    id: `Halo ${name},\n\nAnda telah dikonfirmasi untuk perjalanan: ${tripTitle}.\n\nLihat di sini: ${link}\n\nSampai jumpa!`,
    it: `Ciao ${name},\n\nLa tua partecipazione al viaggio "${tripTitle}" è confermata.\n\nVedi qui: ${link}\n\nA presto!`,
    hu: `Szia ${name}!\n\nMegerősítést nyert a részvételed a(z) „${tripTitle}" utazáson.\n\nMegnézem itt: ${link}\n\nViszontlátásra!`,
    cs: `Ahoj ${name},\n\nTvoje účast na výletě „${tripTitle}" je potvrzena.\n\nZobrazit zde: ${link}\n\nNa viděnou!`,
    pl: `Cześć ${name},\n\nTwój udział w podróży „${tripTitle}" jest potwierdzony.\n\nZobacz tutaj: ${link}\n\nDo zobaczenia!`,
    br: `Olá ${name},\n\nSua participação na viagem "${tripTitle}" está confirmada.\n\nVeja aqui: ${link}\n\nAté logo!`,
  };
  return (bodies[lang] ?? bodies.en) + setPasswordSection;
}

// ── sendRsvpConfirmationEmail ──────────────────────────────────────────────

export async function sendRsvpConfirmationEmail(
  to: string,
  recipientName: string,
  tripTitle: string,
  tripId: number,
  userId?: number,
  setPasswordUrl?: string,
): Promise<boolean> {
  const lang = userId ? getUserLanguage(userId) : 'en';
  const subject = getRsvpConfirmationTitle(lang, tripTitle);
  const body = getRsvpConfirmationBody(lang, recipientName, tripTitle, tripId, setPasswordUrl);
  return sendEmail(to, subject, body, userId);
}

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

function getRsvpConfirmationBody(lang: string, name: string, tripTitle: string, tripId: number): string {
  const appUrl = getAppUrl();
  const link = `${appUrl}/trips/public/${tripId}`;

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
  return bodies[lang] ?? bodies.en;
}

// ── sendRsvpConfirmationEmail ──────────────────────────────────────────────

export async function sendRsvpConfirmationEmail(
  to: string,
  recipientName: string,
  tripTitle: string,
  tripId: number,
  userId?: number,
): Promise<boolean> {
  const lang = userId ? getUserLanguage(userId) : 'en';
  const subject = getRsvpConfirmationTitle(lang, tripTitle);
  const body = getRsvpConfirmationBody(lang, recipientName, tripTitle, tripId);
  return sendEmail(to, subject, body, userId);
}

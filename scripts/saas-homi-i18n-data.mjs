/* HOMI cost round (2026-10-29): voice messages are free, so the voice copy no longer
 * talks about charges, and a gentle "slow down" replaces any limit wording.
 * [en, ka, ru, tr, ar, he]. Plain and friendly, no dashes. */
export const SAAS_HOMI_STRINGS = {
  voice_no_speech: [
    'I could not hear any words. Try again a little closer to the microphone.',
    'სიტყვები ვერ გავიგე. სცადე თავიდან, მიკროფონთან ცოტა ახლოს.',
    'Я не расслышал слов. Попробуйте ещё раз, чуть ближе к микрофону.',
    'Hiç kelime duyamadım. Mikrofona biraz daha yakın tekrar deneyin.',
    'لم أسمع أي كلمات. حاول مجددًا وأنت أقرب قليلًا من الميكروفون.',
    'לא שמעתי מילים. נסו שוב קרוב יותר למיקרופון.',
  ],
  voice_failed: [
    'The voice message did not go through. Please try again.',
    'ხმოვანი შეტყობინება ვერ გაიგზავნა. სცადე თავიდან.',
    'Голосовое сообщение не отправилось. Попробуйте ещё раз.',
    'Sesli mesaj gönderilemedi. Lütfen tekrar deneyin.',
    'لم تُرسل الرسالة الصوتية. حاول مجددًا من فضلك.',
    'ההודעה הקולית לא נשלחה. נסו שוב.',
  ],
  voice_slow_down: [
    'That was a lot of voice messages very quickly. Take a short break and try again.',
    'ძალიან ბევრი ხმოვანი შეტყობინება ძალიან სწრაფად. ცოტა შეისვენე და თავიდან სცადე.',
    'Слишком много голосовых сообщений подряд. Сделайте небольшую паузу и попробуйте снова.',
    'Çok kısa sürede çok fazla sesli mesaj. Kısa bir ara verip tekrar deneyin.',
    'رسائل صوتية كثيرة جدًا في وقت قصير. خذ استراحة قصيرة ثم حاول مجددًا.',
    'יותר מדי הודעות קוליות בזמן קצר. קחו הפסקה קצרה ונסו שוב.',
  ],
  /* Long dictation: the quiet line once a message runs past one part. */
  voice_keep_talking: [
    'Keep talking, I am writing it all down.',
    'გააგრძელე, ყველაფერს ვიწერ.',
    'Продолжайте, я всё записываю.',
    'Devam edin, her şeyi yazıyorum.',
    'تابع الكلام، أنا أكتب كل شيء.',
    'תמשיכו לדבר, אני רושם הכול.',
  ],
  voice_too_long: [
    'This voice message could not be sent. Please try again.',
    'ეს ხმოვანი შეტყობინება ვერ გაიგზავნა. სცადე თავიდან.',
    'Это голосовое сообщение не удалось отправить. Попробуйте ещё раз.',
    'Bu sesli mesaj gönderilemedi. Lütfen tekrar deneyin.',
    'تعذّر إرسال هذه الرسالة الصوتية. حاول مجددًا من فضلك.',
    'לא הצלחנו לשלוח את ההודעה הקולית. נסו שוב.',
  ],
};

/* Keys whose existing value is replaced: the old copy promised "nothing was charged",
   and "up to 2 minutes" is no longer a limit a person meets (long dictation continues). */
export const SAAS_HOMI_OVERWRITE = new Set(['voice_no_speech', 'voice_failed', 'voice_too_long']);

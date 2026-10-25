/* HOMI voice messages — [en, ka, ru, tr, ar, he].
 * The consent sentence and its two buttons are the owner's Georgian
 * (2026-10-25), used exactly as supplied; the other five carry the same
 * meaning. Price: 0.3 credits per minute = $0.03. */
export const UX_VOICE_STRINGS = {
  voice_record: ['Record a voice message', 'ხმოვანი შეტყობინების ჩაწერა', 'Записать голосовое сообщение', 'Sesli mesaj kaydet', 'تسجيل رسالة صوتية', 'הקלטת הודעה קולית'],
  voice_message_label: ['Voice message', 'ხმოვანი შეტყობინება', 'Голосовое сообщение', 'Sesli mesaj', 'رسالة صوتية', 'הודעה קולית'],
  voice_hold_hint: ['Let go to send', 'გაუშვი და გაიგზავნება', 'Отпустите, чтобы отправить', 'Göndermek için bırakın', 'اترك الزر للإرسال', 'שחררו כדי לשלוח'],
  voice_tap_hint: ['Recording. Tap send when you finish.', 'იწერება. როცა დაასრულებ, დააჭირე გაგზავნას.', 'Идёт запись. Когда закончите, нажмите «Отправить».', 'Kaydediliyor. Bitirince gönder’e dokunun.', 'جارٍ التسجيل. اضغط إرسال عند الانتهاء.', 'מקליטים. כשתסיימו, הקישו על שליחה.'],
  voice_time_left: ['{{seconds}} seconds left', 'დარჩა {{seconds}} წამი', 'Осталось {{seconds}} сек.', '{{seconds}} saniye kaldı', 'تبقّى {{seconds}} ثانية', 'נותרו {{seconds}} שניות'],
  voice_cancel: ['Cancel recording', 'ჩაწერის გაუქმება', 'Отменить запись', 'Kaydı iptal et', 'إلغاء التسجيل', 'ביטול ההקלטה'],
  voice_send: ['Send voice message', 'ხმოვანის გაგზავნა', 'Отправить голосовое', 'Sesli mesajı gönder', 'إرسال الرسالة الصوتية', 'שליחת ההודעה הקולית'],
  voice_transcribing: ['Turning your voice into text…', 'შენს ხმას ტექსტად ვაქცევ…', 'Превращаю ваш голос в текст…', 'Sesinizi yazıya çeviriyorum…', 'أحوّل صوتك إلى نص…', 'הופך את הקול שלכם לטקסט…'],
  voice_no_speech: ['I could not hear any words. Try again a little closer to the microphone. Nothing was charged.', 'სიტყვები ვერ გავიგე. სცადე თავიდან, მიკროფონთან ცოტა ახლოს. არაფერი ჩამოგეჭრა.', 'Я не расслышал слов. Попробуйте ещё раз, чуть ближе к микрофону. Ничего не списано.', 'Hiç kelime duyamadım. Mikrofona biraz daha yakın tekrar deneyin. Ücret alınmadı.', 'لم أسمع أي كلمات. حاول مجددًا وأنت أقرب قليلًا من الميكروفون. لم يُخصم شيء.', 'לא שמעתי מילים. נסו שוב קרוב יותר למיקרופון. לא חויבתם.'],
  voice_too_short: ['That was very short. Hold the microphone a little longer, or tap it once and speak.', 'ძალიან მოკლე იყო. მიკროფონს ცოტა დიდხანს დააჭირე, ან ერთხელ დააჭირე და ილაპარაკე.', 'Слишком коротко. Удерживайте микрофон чуть дольше или нажмите один раз и говорите.', 'Çok kısaydı. Mikrofonu biraz daha uzun basılı tutun ya da bir kez dokunup konuşun.', 'كان قصيرًا جدًا. اضغط على الميكروفون لفترة أطول قليلًا، أو اضغط مرة واحدة وتحدّث.', 'זה היה קצר מאוד. החזיקו את המיקרופון קצת יותר, או הקישו פעם אחת ודברו.'],
  voice_too_long: ['A voice message can be up to 2 minutes. Please record a shorter one.', 'ხმოვანი შეტყობინება 2 წუთამდე შეიძლება. ჩაწერე უფრო მოკლე.', 'Голосовое сообщение может длиться до 2 минут. Запишите покороче.', 'Sesli mesaj en fazla 2 dakika olabilir. Daha kısa bir tane kaydedin.', 'يمكن أن تصل الرسالة الصوتية إلى دقيقتين. سجّل رسالة أقصر من فضلك.', 'הודעה קולית יכולה להיות עד 2 דקות. הקליטו הודעה קצרה יותר.'],
  voice_failed: ['The voice message did not go through. Try again, nothing was charged.', 'ხმოვანი შეტყობინება ვერ გაიგზავნა. სცადე თავიდან, არაფერი ჩამოგეჭრა.', 'Голосовое сообщение не отправилось. Попробуйте ещё раз, ничего не списано.', 'Sesli mesaj gönderilemedi. Tekrar deneyin, ücret alınmadı.', 'لم تُرسل الرسالة الصوتية. حاول مجددًا، لم يُخصم شيء.', 'ההודעה הקולית לא נשלחה. נסו שוב, לא חויבתם.'],
  voice_retry: ['Try again', 'თავიდან ცდა', 'Ещё раз', 'Tekrar dene', 'أعد المحاولة', 'לנסות שוב'],
  voice_play: ['Play voice message', 'ხმოვანის მოსმენა', 'Прослушать', 'Dinle', 'تشغيل الرسالة', 'השמעת ההודעה'],
  voice_pause: ['Pause', 'პაუზა', 'Пауза', 'Duraklat', 'إيقاف مؤقت', 'השהיה'],
  voice_transcript_label: ['Text of your message', 'შეტყობინების ტექსტი', 'Текст сообщения', 'Mesajınızın metni', 'نص رسالتك', 'הטקסט של ההודעה'],
  voice_ok: ['Got it', 'გასაგებია', 'Понятно', 'Anladım', 'حسنًا', 'הבנתי'],

  voice_consent_title: ['Voice messages', 'ხმოვანი შეტყობინებები', 'Голосовые сообщения', 'Sesli mesajlar', 'الرسائل الصوتية', 'הודעות קוליות'],
  voice_consent_body: [
    'For easy voice communication, one minute costs only 0.3 credits ($0.03).',
    'კომფორტული ხმოვანი კომუნიკაციისთვის წუთის ღირებულება მხოლოდ 0.3 კრედიტია (0.03$).',
    'Для удобного голосового общения минута стоит всего 0.3 кредита ($0.03).',
    'Rahat sesli iletişim için dakikası yalnızca 0.3 kredi ($0.03).',
    'للتواصل الصوتي المريح، تكلفة الدقيقة 0.3 رصيد فقط (0.03$).',
    'לתקשורת קולית נוחה, דקה עולה רק 0.3 קרדיטים (‎$0.03).',
  ],
  voice_consent_accept: ['I agree', 'ვეთანხმები', 'Согласен', 'Kabul ediyorum', 'أوافق', 'אני מסכים'],
  voice_consent_decline: ['I will keep typing', 'გავაგრძელებ მიმოწერით', 'Продолжу текстом', 'Yazarak devam edeceğim', 'سأتابع بالكتابة', 'אמשיך בכתיבה'],

  voice_topup_title: ['Add credits to talk by voice', 'ხმით სასაუბროდ ბალანსი შეავსე', 'Пополните баланс для голосовых', 'Sesli konuşmak için kredi ekleyin', 'أضف رصيدًا للتحدث بالصوت', 'הוסיפו קרדיטים כדי לדבר בקול'],
  voice_topup_body: [
    'Simple voice communication needs credits on your balance. One minute is 0.3 credits ($0.03). You can top up from just $1.',
    'მარტივი ხმოვანი კომუნიკაციისთვის ბალანსზე კრედიტები გჭირდება. ერთი წუთი 0.3 კრედიტია (0.03$). ბალანსის შევსება სულ რაღაც 1$-დან შეგიძლია.',
    'Для простого голосового общения нужны кредиты на балансе. Минута стоит 0.3 кредита ($0.03). Пополнить можно всего от $1.',
    'Basit sesli iletişim için bakiyenizde kredi olmalı. Bir dakika 0.3 kredi ($0.03). Yalnızca $1’dan başlayarak yükleyebilirsiniz.',
    'يحتاج التواصل الصوتي البسيط إلى رصيد في حسابك. الدقيقة الواحدة 0.3 رصيد (0.03$). يمكنك الشحن ابتداءً من 1$ فقط.',
    'לתקשורת קולית פשוטה צריך קרדיטים ביתרה. דקה אחת היא 0.3 קרדיטים (‎$0.03). אפשר להטעין החל מ־‎$1 בלבד.',
  ],
  voice_price_chip: ['1 minute = 0.3 credits', '1 წუთი = 0.3 კრედიტი', '1 минута = 0.3 кредита', '1 dakika = 0.3 kredi', 'دقيقة واحدة = 0.3 رصيد', 'דקה אחת = 0.3 קרדיטים'],
  voice_topup_min_chip: ['From $1', '1$-დან', 'От $1', '$1’dan başlayarak', 'ابتداءً من 1$', 'החל מ־‎$1'],
  voice_topup_action: ['Top up balance', 'ბალანსის შევსება', 'Пополнить баланс', 'Bakiye yükle', 'شحن الرصيد', 'הטענת יתרה'],
  voice_topup_later: ['Not now', 'ახლა არა', 'Не сейчас', 'Şimdi değil', 'ليس الآن', 'לא עכשיו'],

  voice_denied_title: ['The microphone is blocked', 'მიკროფონი დაბლოკილია', 'Микрофон заблокирован', 'Mikrofon engelli', 'الميكروفون محظور', 'המיקרופון חסום'],
  voice_denied_body: ['Allow microphone access for homatch.live in your browser settings, then tap the microphone again. You can always keep typing.', 'ბრაუზერის პარამეტრებში homatch.live-ს მიკროფონზე წვდომა მიეცი და მიკროფონს თავიდან დააჭირე. წერა ყოველთვის შეგიძლია.', 'Разрешите homatch.live доступ к микрофону в настройках браузера и снова нажмите на микрофон. Писать текстом можно всегда.', 'Tarayıcı ayarlarından homatch.live için mikrofon izni verin ve mikrofona tekrar dokunun. Yazarak devam etmek her zaman mümkün.', 'اسمح لـ homatch.live باستخدام الميكروفون من إعدادات المتصفح، ثم اضغط على الميكروفون مجددًا. يمكنك دائمًا متابعة الكتابة.', 'אפשרו ל־homatch.live גישה למיקרופון בהגדרות הדפדפן והקישו שוב על המיקרופון. תמיד אפשר להמשיך לכתוב.'],
  voice_no_device_title: ['No microphone found', 'მიკროფონი ვერ მოიძებნა', 'Микрофон не найден', 'Mikrofon bulunamadı', 'لم يُعثر على ميكروفون', 'לא נמצא מיקרופון'],
  voice_no_device_body: ['Connect a microphone and try again, or keep typing.', 'შეაერთე მიკროფონი და სცადე თავიდან, ან გააგრძელე წერა.', 'Подключите микрофон и попробуйте снова или продолжайте писать.', 'Bir mikrofon bağlayıp tekrar deneyin ya da yazmaya devam edin.', 'وصّل ميكروفونًا وحاول مجددًا، أو تابع الكتابة.', 'חברו מיקרופון ונסו שוב, או המשיכו לכתוב.'],
  voice_unsupported_title: ['Voice messages are not available here', 'აქ ხმოვანი შეტყობინება ვერ ჩაიწერება', 'Голосовые здесь недоступны', 'Sesli mesaj burada kullanılamıyor', 'الرسائل الصوتية غير متاحة هنا', 'הודעות קוליות לא זמינות כאן'],
  voice_unsupported_body: ['This browser cannot record voice messages. Try an up to date Chrome, Safari or Firefox, or keep typing.', 'ეს ბრაუზერი ხმას ვერ იწერს. სცადე Chrome, Safari ან Firefox-ის ახალი ვერსია, ან გააგრძელე წერა.', 'Этот браузер не умеет записывать голос. Попробуйте свежий Chrome, Safari или Firefox или продолжайте писать.', 'Bu tarayıcı ses kaydedemiyor. Güncel Chrome, Safari veya Firefox deneyin ya da yazmaya devam edin.', 'لا يستطيع هذا المتصفح تسجيل الصوت. جرّب إصدارًا حديثًا من Chrome أو Safari أو Firefox، أو تابع الكتابة.', 'הדפדפן הזה לא יכול להקליט קול. נסו Chrome, Safari או Firefox מעודכנים, או המשיכו לכתוב.'],
  voice_unavailable_title: ['Voice messages are paused', 'ხმოვანი შეტყობინებები დროებით შეჩერებულია', 'Голосовые временно приостановлены', 'Sesli mesajlar şu an duraklatıldı', 'الرسائل الصوتية متوقفة مؤقتًا', 'הודעות קוליות מושהות כרגע'],
  voice_unavailable_body: ['Please write your message for now. Voice will be back soon.', 'ჯერჯერობით შეტყობინება დაწერე. ხმა მალე დაბრუნდება.', 'Пока напишите сообщение текстом. Голос скоро вернётся.', 'Şimdilik mesajınızı yazın. Ses yakında geri gelecek.', 'اكتب رسالتك الآن من فضلك. سيعود الصوت قريبًا.', 'בינתיים כתבו את ההודעה. הקול יחזור בקרוב.'],
};

// META ADS — NOTIFICATION WORDS, SIX LOCALES. One catalog for in-app, push
// and email, rendered in the RECIPIENT's language at emission. Parameters are
// campaign names, percentages and amounts — never a lead's name, phone or
// email (lock screens and inboxes are not private). Pure.
//
// Order in every tuple: en, ka, ru, tr, ar, he.

import type { EventType, Transition } from './events.ts';

export type Locale = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';
const L: Locale[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
type T6 = [string, string, string, string, string, string];

interface Copy { title: T6; body: T6; why: T6; action: T6 | null }

const C: Record<EventType, Copy> = {
  PERFORMANCE_DETERIORATED: {
    title: ['Cost per result is rising', 'შედეგის ღირებულება იზრდება', 'Стоимость результата растёт', 'Sonuç başına maliyet artıyor', 'تكلفة النتيجة ترتفع', 'העלות לתוצאה עולה'],
    body: ['{{campaign}}: cost per result is up {{pct}}% on the previous period.', '{{campaign}}: შედეგის ღირებულება წინა პერიოდთან შედარებით {{pct}}%-ით გაიზარდა.', '{{campaign}}: стоимость результата выросла на {{pct}}% к прошлому периоду.', '{{campaign}}: sonuç başına maliyet önceki döneme göre %{{pct}} arttı.', '{{campaign}}: ارتفعت تكلفة النتيجة بنسبة {{pct}}% مقارنة بالفترة السابقة.', '{{campaign}}: העלות לתוצאה עלתה ב־{{pct}}% לעומת התקופה הקודמת.'],
    why: ['The same budget is now producing fewer results.', 'იგივე ბიუჯეტი ახლა ნაკლებ შედეგს იძლევა.', 'Тот же бюджет теперь даёт меньше результатов.', 'Aynı bütçe artık daha az sonuç getiriyor.', 'الميزانية نفسها تحقق الآن نتائج أقل.', 'אותו תקציב מניב כעת פחות תוצאות.'],
    action: ['Open the campaign to see what changed and HOMATCH\'s recommendation.', 'გახსენით კამპანია, რომ ნახოთ რა შეიცვალა და HOMATCH-ის რეკომენდაცია.', 'Откройте кампанию, чтобы увидеть изменения и рекомендацию HOMATCH.', 'Neyin değiştiğini ve HOMATCH önerisini görmek için kampanyayı açın.', 'افتح الحملة لمعرفة ما تغيّر وتوصية HOMATCH.', 'פתחו את הקמפיין כדי לראות מה השתנה ואת ההמלצה של HOMATCH.'],
  },
  PERFORMANCE_IMPROVED: {
    title: ['Your campaign is getting more efficient', 'თქვენი კამპანია უფრო ეფექტური ხდება', 'Кампания становится эффективнее', 'Kampanyanız daha verimli hale geliyor', 'حملتك أصبحت أكثر كفاءة', 'הקמפיין שלכם נעשה יעיל יותר'],
    body: ['{{campaign}}: cost per result is down {{pct}}% on the previous period.', '{{campaign}}: შედეგის ღირებულება წინა პერიოდთან შედარებით {{pct}}%-ით შემცირდა.', '{{campaign}}: стоимость результата снизилась на {{pct}}% к прошлому периоду.', '{{campaign}}: sonuç başına maliyet önceki döneme göre %{{pct}} düştü.', '{{campaign}}: انخفضت تكلفة النتيجة بنسبة {{pct}}% مقارنة بالفترة السابقة.', '{{campaign}}: העלות לתוצאה ירדה ב־{{pct}}% לעומת התקופה הקודמת.'],
    why: ['Each result now costs less.', 'თითოეული შედეგი ახლა ნაკლები ღირს.', 'Каждый результат теперь стоит дешевле.', 'Her sonuç artık daha ucuz.', 'كل نتيجة تكلف الآن أقل.', 'כל תוצאה עולה כעת פחות.'],
    action: null,
  },
  LEAD_QUALITY_CHANGED: {
    title: ['Lead quality changed', 'ლიდების ხარისხი შეიცვალა', 'Качество заявок изменилось', 'Potansiyel müşteri kalitesi değişti', 'تغيّرت جودة العملاء المحتملين', 'איכות הלידים השתנתה'],
    body: ['{{campaign}}: the share of qualified leads changed noticeably.', '{{campaign}}: კვალიფიციური ლიდების წილი შესამჩნევად შეიცვალა.', '{{campaign}}: доля квалифицированных заявок заметно изменилась.', '{{campaign}}: nitelikli potansiyel müşteri oranı belirgin şekilde değişti.', '{{campaign}}: تغيّرت نسبة العملاء المحتملين المؤهلين بشكل ملحوظ.', '{{campaign}}: שיעור הלידים האיכותיים השתנה באופן ניכר.'],
    why: ['Cheap leads are only useful if they are the right people.', 'იაფი ლიდები სასარგებლოა მხოლოდ მაშინ, თუ ისინი სწორი ადამიანები არიან.', 'Дешёвые заявки полезны, только если это нужные люди.', 'Ucuz potansiyel müşteriler ancak doğru kişilerse işe yarar.', 'العملاء المحتملون الرخيصون مفيدون فقط إذا كانوا الأشخاص المناسبين.', 'לידים זולים שימושיים רק אם הם האנשים הנכונים.'],
    action: ['Review the latest leads and keep their status up to date.', 'გადახედეთ ბოლო ლიდებს და განაახლეთ მათი სტატუსი.', 'Просмотрите последние заявки и обновите их статус.', 'Son potansiyel müşterileri inceleyin ve durumlarını güncel tutun.', 'راجع أحدث العملاء المحتملين وحدّث حالتهم.', 'עברו על הלידים האחרונים ועדכנו את הסטטוס שלהם.'],
  },
  CREATIVE_FATIGUE: {
    title: ['A creative may be wearing out', 'კრეატივი შესაძლოა იღლება', 'Креатив, возможно, выгорает', 'Bir kreatif yıpranıyor olabilir', 'قد يكون أحد التصاميم قد استُنفد', 'ייתכן שקריאייטיב נשחק'],
    body: ['{{campaign}}: one ad is showing several signs of fatigue.', '{{campaign}}: ერთ რეკლამას დაღლილობის რამდენიმე ნიშანი აქვს.', '{{campaign}}: у одного объявления несколько признаков выгорания.', '{{campaign}}: bir reklamda birkaç yıpranma işareti var.', '{{campaign}}: يُظهر أحد الإعلانات عدة علامات على الاستنفاد.', '{{campaign}}: מודעה אחת מראה כמה סימני שחיקה.'],
    why: ['People have seen it often and respond less.', 'ხალხს ის ხშირად უნახავს და ნაკლებად რეაგირებს.', 'Люди видели его часто и реагируют слабее.', 'İnsanlar onu sık gördü ve daha az tepki veriyor.', 'رآه الناس كثيرًا ويتفاعلون معه أقل.', 'אנשים ראו אותה הרבה ומגיבים פחות.'],
    action: ['Consider adding a fresh creative.', 'განიხილეთ ახალი კრეატივის დამატება.', 'Рассмотрите добавление нового креатива.', 'Yeni bir kreatif eklemeyi düşünün.', 'فكّر في إضافة تصميم جديد.', 'שקלו להוסיף קריאייטיב חדש.'],
  },
  PLACEMENT_FINDING: {
    title: ['A placement is standing out', 'ერთი განთავსება გამოირჩევა', 'Одно размещение выделяется', 'Bir yerleşim öne çıkıyor', 'موضع عرض يبرز', 'מיקום אחד בולט'],
    body: ['{{campaign}}: one placement is delivering results more efficiently.', '{{campaign}}: ერთი განთავსება შედეგს უფრო ეფექტურად იძლევა.', '{{campaign}}: одно размещение даёт результаты эффективнее.', '{{campaign}}: bir yerleşim daha verimli sonuç veriyor.', '{{campaign}}: أحد مواضع العرض يحقق نتائج بكفاءة أعلى.', '{{campaign}}: מיקום אחד מביא תוצאות ביעילות רבה יותר.'],
    why: ['Knowing where results come from helps the next decision.', 'ცოდნა, საიდან მოდის შედეგი, შემდეგ გადაწყვეტილებას ეხმარება.', 'Понимание источника результатов помогает следующему решению.', 'Sonuçların nereden geldiğini bilmek sonraki kararı kolaylaştırır.', 'معرفة مصدر النتائج تساعد في القرار التالي.', 'הבנה מאין מגיעות התוצאות עוזרת בהחלטה הבאה.'],
    action: null,
  },
  AUDIENCE_FINDING: {
    title: ['An audience segment is standing out', 'აუდიტორიის ერთი სეგმენტი გამოირჩევა', 'Один сегмент аудитории выделяется', 'Bir kitle segmenti öne çıkıyor', 'شريحة من الجمهور تبرز', 'פלח קהל אחד בולט'],
    body: ['{{campaign}}: one audience segment is responding more efficiently.', '{{campaign}}: აუდიტორიის ერთი სეგმენტი უფრო ეფექტურად რეაგირებს.', '{{campaign}}: один сегмент аудитории откликается эффективнее.', '{{campaign}}: bir kitle segmenti daha verimli yanıt veriyor.', '{{campaign}}: شريحة من الجمهور تستجيب بكفاءة أعلى.', '{{campaign}}: פלח קהל אחד מגיב ביעילות רבה יותר.'],
    why: ['It shows who is most interested right now.', 'ეს აჩვენებს, ვინ არის ახლა ყველაზე დაინტერესებული.', 'Это показывает, кто сейчас наиболее заинтересован.', 'Şu anda en çok kimin ilgilendiğini gösterir.', 'يُظهر ذلك من هم الأكثر اهتمامًا الآن.', 'זה מראה מי הכי מתעניין כרגע.'],
    action: null,
  },
  NEW_RECOMMENDATION: {
    title: ['New HOMATCH recommendation', 'HOMATCH-ის ახალი რეკომენდაცია', 'Новая рекомендация HOMATCH', 'Yeni HOMATCH önerisi', 'توصية جديدة من HOMATCH', 'המלצה חדשה של HOMATCH'],
    body: ['{{campaign}}: HOMATCH has enough data to recommend a change.', '{{campaign}}: HOMATCH-ს საკმარისი მონაცემები აქვს ცვლილების რეკომენდაციისთვის.', '{{campaign}}: у HOMATCH достаточно данных, чтобы рекомендовать изменение.', '{{campaign}}: HOMATCH bir değişiklik önermek için yeterli veriye sahip.', '{{campaign}}: لدى HOMATCH بيانات كافية للتوصية بتغيير.', '{{campaign}}: ל־HOMATCH יש מספיק נתונים כדי להמליץ על שינוי.'],
    why: ['It is based on a meaningful amount of real results.', 'ის ეფუძნება რეალური შედეგების მნიშვნელოვან რაოდენობას.', 'Она основана на значимом объёме реальных результатов.', 'Anlamlı miktarda gerçek sonuca dayanıyor.', 'تستند إلى قدر كافٍ من النتائج الحقيقية.', 'היא מבוססת על כמות משמעותית של תוצאות אמיתיות.'],
    action: ['Review it and choose Apply, Dismiss or Remind me later.', 'გადახედეთ და აირჩიეთ „გამოყენება“, „უარყოფა“ ან „შემახსენე მოგვიანებით“.', 'Посмотрите и выберите «Применить», «Отклонить» или «Напомнить позже».', 'İnceleyin ve Uygula, Kapat ya da Daha sonra hatırlat seçin.', 'راجعها واختر تطبيق أو تجاهل أو ذكّرني لاحقًا.', 'עברו עליה ובחרו החל, התעלם או הזכר לי מאוחר יותר.'],
  },
  CAMPAIGN_REJECTED: {
    title: ['Meta did not approve your ads', 'Meta-მ თქვენი რეკლამები არ დაამტკიცა', 'Meta не одобрила ваши объявления', 'Meta reklamlarınızı onaylamadı', 'لم توافق Meta على إعلاناتك', 'Meta לא אישרה את המודעות שלכם'],
    body: ['{{campaign}} is not delivering because Meta rejected its ads.', '{{campaign}} არ გადის, რადგან Meta-მ მისი რეკლამები უარყო.', '{{campaign}} не показывается: Meta отклонила объявления.', '{{campaign}} yayında değil çünkü Meta reklamlarını reddetti.', '{{campaign}} لا يُعرض لأن Meta رفضت إعلاناته.', '{{campaign}} לא מוצג כי Meta דחתה את המודעות שלו.'],
    why: ['No one is seeing the campaign until it is fixed.', 'კამპანიას გასწორებამდე ვერავინ ხედავს.', 'Пока это не исправлено, кампанию никто не видит.', 'Düzeltilene kadar kimse kampanyayı görmüyor.', 'لن يرى أحد الحملة حتى يتم إصلاحها.', 'אף אחד לא רואה את הקמפיין עד שזה יתוקן.'],
    action: ['Open the campaign to see Meta\'s reason and fix the ad.', 'გახსენით კამპანია Meta-ს მიზეზის სანახავად და რეკლამის გასასწორებლად.', 'Откройте кампанию, чтобы увидеть причину Meta и исправить объявление.', 'Meta\'nın gerekçesini görmek ve reklamı düzeltmek için kampanyayı açın.', 'افتح الحملة لمعرفة سبب Meta وإصلاح الإعلان.', 'פתחו את הקמפיין כדי לראות את הסיבה של Meta ולתקן את המודעה.'],
  },
  CAMPAIGN_RESTRICTED: {
    title: ['Meta reports an issue with your campaign', 'Meta თქვენს კამპანიაში პრობლემას აფიქსირებს', 'Meta сообщает о проблеме с кампанией', 'Meta kampanyanızda bir sorun bildiriyor', 'تُبلغ Meta عن مشكلة في حملتك', 'Meta מדווחת על בעיה בקמפיין שלכם'],
    body: ['{{campaign}} has an issue that may limit delivery.', '{{campaign}}-ს აქვს პრობლემა, რომელმაც შესაძლოა ჩვენება შეზღუდოს.', 'У {{campaign}} есть проблема, которая может ограничить показ.', '{{campaign}} yayını sınırlayabilecek bir soruna sahip.', 'لدى {{campaign}} مشكلة قد تحد من العرض.', 'ל־{{campaign}} יש בעיה שעלולה להגביל את ההצגה.'],
    why: ['Delivery may be reduced until it is resolved.', 'ჩვენება შესაძლოა შემცირდეს პრობლემის მოგვარებამდე.', 'Показы могут сократиться до решения проблемы.', 'Çözülene kadar gösterim azalabilir.', 'قد يقل العرض حتى يتم حلها.', 'ההצגה עלולה לרדת עד שזה ייפתר.'],
    action: ['Open the campaign for details.', 'დეტალებისთვის გახსენით კამპანია.', 'Откройте кампанию для подробностей.', 'Ayrıntılar için kampanyayı açın.', 'افتح الحملة للتفاصيل.', 'פתחו את הקמפיין לפרטים.'],
  },
  CAMPAIGN_STOPPED: {
    title: ['Campaign stopped', 'კამპანია შეჩერდა', 'Кампания остановлена', 'Kampanya durdu', 'توقفت الحملة', 'הקמפיין הופסק'],
    body: ['{{campaign}} is no longer delivering.', '{{campaign}} აღარ გადის.', '{{campaign}} больше не показывается.', '{{campaign}} artık yayında değil.', 'لم يعد {{campaign}} يُعرض.', '{{campaign}} כבר לא מוצג.'],
    why: ['Its results and leads remain available in HOMATCH.', 'მისი შედეგები და ლიდები HOMATCH-ში რჩება.', 'Результаты и заявки остаются в HOMATCH.', 'Sonuçları ve potansiyel müşterileri HOMATCH\'te kalır.', 'تبقى نتائجها وعملاؤها المحتملون متاحة في HOMATCH.', 'התוצאות והלידים נשארים זמינים ב־HOMATCH.'],
    action: null,
  },
  LAUNCH_FAILED: {
    title: ['Your campaign could not be launched', 'კამპანიის გაშვება ვერ მოხერხდა', 'Не удалось запустить кампанию', 'Kampanyanız başlatılamadı', 'تعذّر إطلاق حملتك', 'לא ניתן היה להשיק את הקמפיין'],
    body: ['{{campaign}} was not launched. Nothing was left running at Meta.', '{{campaign}} არ გაეშვა. Meta-ში არაფერი დარჩენილა გაშვებული.', '{{campaign}} не запущена. В Meta ничего не осталось запущенным.', '{{campaign}} başlatılmadı. Meta\'da çalışır durumda hiçbir şey kalmadı.', 'لم تُطلق {{campaign}}. لم يبقَ أي شيء قيد التشغيل في Meta.', '{{campaign}} לא הושק. שום דבר לא נשאר פעיל ב־Meta.'],
    why: ['The service balance taken for this attempt was returned to your HOMATCH balance.', 'ამ მცდელობისთვის აღებული თანხა თქვენს HOMATCH ბალანსს დაუბრუნდა.', 'Сумма, удержанная для этой попытки, возвращена на баланс HOMATCH.', 'Bu deneme için ayrılan tutar HOMATCH bakiyenize geri döndü.', 'أُعيد المبلغ المحجوز لهذه المحاولة إلى رصيدك في HOMATCH.', 'הסכום שנלקח לניסיון זה הוחזר ליתרת HOMATCH שלכם.'],
    action: ['Open the campaign to see what to fix and try again.', 'გახსენით კამპანია, რომ ნახოთ რა გამოასწოროთ და სცადოთ ხელახლა.', 'Откройте кампанию, чтобы понять, что исправить, и попробуйте снова.', 'Neyi düzelteceğinizi görmek için kampanyayı açın ve yeniden deneyin.', 'افتح الحملة لمعرفة ما يجب إصلاحه ثم حاول مجددًا.', 'פתחו את הקמפיין כדי לראות מה לתקן ונסו שוב.'],
  },
  SERVICE_BALANCE_LOW: {
    title: ['HOMATCH balance needed', 'საჭიროა HOMATCH ბალანსი', 'Нужен баланс HOMATCH', 'HOMATCH bakiyesi gerekli', 'مطلوب رصيد HOMATCH', 'נדרשת יתרת HOMATCH'],
    body: ['Add {{amount}} to your HOMATCH balance to continue.', 'გასაგრძელებლად დაამატეთ {{amount}} თქვენს HOMATCH ბალანსს.', 'Пополните баланс HOMATCH на {{amount}}, чтобы продолжить.', 'Devam etmek için HOMATCH bakiyenize {{amount}} ekleyin.', 'أضف {{amount}} إلى رصيدك في HOMATCH للمتابعة.', 'הוסיפו {{amount}} ליתרת HOMATCH כדי להמשיך.'],
    why: ['The HOMATCH service balance covers the managed-campaign service rate.', 'HOMATCH-ის ბალანსი ფარავს მართული კამპანიის მომსახურების განაკვეთს.', 'Баланс HOMATCH покрывает ставку за управление кампанией.', 'HOMATCH bakiyesi yönetilen kampanya hizmet oranını karşılar.', 'يغطي رصيد HOMATCH رسوم خدمة إدارة الحملة.', 'יתרת HOMATCH מכסה את תעריף השירות של הקמפיין המנוהל.'],
    action: ['Open billing to add funds.', 'თანხის დასამატებლად გახსენით ბილინგი.', 'Откройте оплату, чтобы пополнить баланс.', 'Bakiye eklemek için faturalamayı açın.', 'افتح الفوترة لإضافة رصيد.', 'פתחו חיוב כדי להוסיף יתרה.'],
  },
  EXTERNAL_MODIFICATION: {
    title: ['Campaign changed in Meta', 'კამპანია Meta-ში შეიცვალა', 'Кампания изменена в Meta', 'Kampanya Meta\'da değiştirildi', 'تم تغيير الحملة في Meta', 'הקמפיין שונה ב־Meta'],
    body: ['{{campaign}} was changed directly in Meta Ads Manager. HOMATCH has synchronized the latest status.', '{{campaign}} პირდაპირ Meta Ads Manager-ში შეიცვალა. HOMATCH-მა ბოლო სტატუსი სინქრონიზა.', '{{campaign}} изменена напрямую в Meta Ads Manager. HOMATCH синхронизировал последний статус.', '{{campaign}} doğrudan Meta Ads Manager\'da değiştirildi. HOMATCH son durumu eşitledi.', 'تم تغيير {{campaign}} مباشرة في مدير إعلانات Meta. زامن HOMATCH أحدث حالة.', '{{campaign}} שונה ישירות ב־Meta Ads Manager. HOMATCH סנכרן את הסטטוס האחרון.'],
    why: ['Changes made outside HOMATCH can interrupt optimization and reporting.', 'HOMATCH-ის გარეთ შეტანილმა ცვლილებებმა შესაძლოა ოპტიმიზაცია და ანგარიშგება შეაფერხოს.', 'Изменения вне HOMATCH могут нарушить оптимизацию и отчётность.', 'HOMATCH dışındaki değişiklikler optimizasyonu ve raporlamayı aksatabilir.', 'قد تُعطّل التغييرات خارج HOMATCH التحسين والتقارير.', 'שינויים מחוץ ל־HOMATCH עלולים לשבש את האופטימיזציה והדיווח.'],
    action: ['For the best results, manage this campaign from HOMATCH.', 'საუკეთესო შედეგისთვის მართეთ ეს კამპანია HOMATCH-იდან.', 'Для лучших результатов управляйте кампанией из HOMATCH.', 'En iyi sonuç için bu kampanyayı HOMATCH\'ten yönetin.', 'للحصول على أفضل النتائج، أدِر هذه الحملة من HOMATCH.', 'לתוצאות הטובות ביותר, נהלו את הקמפיין מתוך HOMATCH.'],
  },
  GUARD_WARNING: {
    title: ['Meta Ads warning', 'Meta Ads-ის გაფრთხილება', 'Предупреждение Meta Ads', 'Meta Ads uyarısı', 'تحذير Meta Ads', 'אזהרת Meta Ads'],
    body: ['A managed campaign was repeatedly changed outside HOMATCH.', 'მართული კამპანია არაერთხელ შეიცვალა HOMATCH-ის გარეთ.', 'Управляемую кампанию несколько раз меняли вне HOMATCH.', 'Yönetilen bir kampanya HOMATCH dışında tekrar tekrar değiştirildi.', 'تم تغيير حملة مُدارة خارج HOMATCH بشكل متكرر.', 'קמפיין מנוהל שונה שוב ושוב מחוץ ל־HOMATCH.'],
    why: ['External changes can interrupt optimization and synchronization.', 'გარე ცვლილებებმა შესაძლოა ოპტიმიზაცია და სინქრონიზაცია შეაფერხოს.', 'Внешние изменения могут нарушить оптимизацию и синхронизацию.', 'Dış değişiklikler optimizasyonu ve eşitlemeyi aksatabilir.', 'قد تُعطّل التغييرات الخارجية التحسين والمزامنة.', 'שינויים חיצוניים עלולים לשבש את האופטימיזציה והסנכרון.'],
    action: ['Please manage this campaign from HOMATCH.', 'გთხოვთ, მართეთ ეს კამპანია HOMATCH-იდან.', 'Пожалуйста, управляйте кампанией из HOMATCH.', 'Lütfen bu kampanyayı HOMATCH\'ten yönetin.', 'يرجى إدارة هذه الحملة من HOMATCH.', 'אנא נהלו את הקמפיין מתוך HOMATCH.'],
  },
  GUARD_STRIKE: {
    title: ['Meta Ads warning {{n}} of {{of}}', 'Meta Ads-ის გაფრთხილება {{n}} / {{of}}', 'Предупреждение Meta Ads {{n}} из {{of}}', 'Meta Ads uyarısı {{n}}/{{of}}', 'تحذير Meta Ads رقم {{n}} من {{of}}', 'אזהרת Meta Ads {{n}} מתוך {{of}}'],
    body: ['A managed campaign was changed or copied outside HOMATCH, and the configured protection was applied.', 'მართული კამპანია HOMATCH-ის გარეთ შეიცვალა ან დაკოპირდა და დაცვა ამოქმედდა.', 'Управляемую кампанию изменили или скопировали вне HOMATCH; применена настроенная защита.', 'Yönetilen bir kampanya HOMATCH dışında değiştirildi veya kopyalandı ve koruma uygulandı.', 'تم تغيير حملة مُدارة أو نسخها خارج HOMATCH، وطُبّقت الحماية المضبوطة.', 'קמפיין מנוהל שונה או הועתק מחוץ ל־HOMATCH, והוחלה ההגנה שהוגדרה.'],
    why: ['At {{of}} warnings, Meta Ads access through HOMATCH is paused for this ad account.', '{{of}} გაფრთხილებისას ამ სარეკლამო ანგარიშისთვის HOMATCH-ით Meta Ads-ზე წვდომა შეჩერდება.', 'После {{of}} предупреждений доступ к Meta Ads через HOMATCH для этого рекламного аккаунта приостанавливается.', '{{of}} uyarıda bu reklam hesabı için HOMATCH üzerinden Meta Ads erişimi duraklatılır.', 'عند {{of}} تحذيرات، يتوقف الوصول إلى Meta Ads عبر HOMATCH لهذا الحساب الإعلاني.', 'לאחר {{of}} אזהרות, הגישה ל־Meta Ads דרך HOMATCH מושהית עבור חשבון המודעות הזה.'],
    action: ['Your original campaign setup remains available in HOMATCH.', 'თქვენი თავდაპირველი კამპანიის პარამეტრები HOMATCH-ში რჩება.', 'Исходная настройка кампании сохраняется в HOMATCH.', 'Orijinal kampanya kurulumunuz HOMATCH\'te kalır.', 'يبقى إعداد حملتك الأصلي متاحًا في HOMATCH.', 'הגדרת הקמפיין המקורית שלכם נשארת זמינה ב־HOMATCH.'],
  },
  GUARD_SUSPENDED: {
    title: ['Meta Ads access paused', 'Meta Ads-ზე წვდომა შეჩერდა', 'Доступ к Meta Ads приостановлен', 'Meta Ads erişimi duraklatıldı', 'تم إيقاف الوصول إلى Meta Ads مؤقتًا', 'הגישה ל־Meta Ads הושהתה'],
    body: ['This advertising account reached the campaign-integrity warning limit. Existing statistics and leads remain available.', 'ამ სარეკლამო ანგარიშმა კამპანიის მთლიანობის გაფრთხილებების ლიმიტს მიაღწია. არსებული სტატისტიკა და ლიდები ხელმისაწვდომი რჩება.', 'Этот рекламный аккаунт достиг лимита предупреждений. Статистика и заявки остаются доступными.', 'Bu reklam hesabı kampanya bütünlüğü uyarı sınırına ulaştı. Mevcut istatistikler ve potansiyel müşteriler erişilebilir kalır.', 'بلغ هذا الحساب الإعلاني حد تحذيرات سلامة الحملات. تبقى الإحصاءات والعملاء المحتملون متاحين.', 'חשבון המודעות הזה הגיע למגבלת האזהרות. הנתונים והלידים הקיימים נשארים זמינים.'],
    why: ['New campaigns and changes through HOMATCH are paused for this ad account.', 'ამ სარეკლამო ანგარიშისთვის HOMATCH-ით ახალი კამპანიები და ცვლილებები შეჩერებულია.', 'Новые кампании и изменения через HOMATCH для этого аккаунта приостановлены.', 'Bu reklam hesabı için HOMATCH üzerinden yeni kampanyalar ve değişiklikler duraklatıldı.', 'تم إيقاف الحملات والتغييرات الجديدة عبر HOMATCH لهذا الحساب مؤقتًا.', 'קמפיינים ושינויים חדשים דרך HOMATCH מושהים עבור החשבון הזה.'],
    action: ['Contact support if you believe this was incorrect.', 'თუ ფიქრობთ, რომ ეს შეცდომაა, დაუკავშირდით მხარდაჭერას.', 'Если вы считаете это ошибкой, обратитесь в поддержку.', 'Bunun yanlış olduğunu düşünüyorsanız destekle iletişime geçin.', 'تواصل مع الدعم إذا كنت تعتقد أن هذا غير صحيح.', 'פנו לתמיכה אם אתם סבורים שזו טעות.'],
  },
  CONTROL_ACCESS_LOST: {
    title: ['Meta connection needs attention', 'Meta-სთან კავშირს ყურადღება სჭირდება', 'Подключение к Meta требует внимания', 'Meta bağlantısı ilgi gerektiriyor', 'اتصال Meta يحتاج إلى انتباه', 'החיבור ל־Meta דורש תשומת לב'],
    body: ['HOMATCH can no longer manage your campaigns in Meta.', 'HOMATCH-ს აღარ შეუძლია თქვენი კამპანიების მართვა Meta-ში.', 'HOMATCH больше не может управлять вашими кампаниями в Meta.', 'HOMATCH artık Meta\'daki kampanyalarınızı yönetemiyor.', 'لم يعد بإمكان HOMATCH إدارة حملاتك في Meta.', 'HOMATCH כבר לא יכול לנהל את הקמפיינים שלכם ב־Meta.'],
    why: ['Until you reconnect, HOMATCH cannot pause, resume or report on your campaigns.', 'ხელახლა დაკავშირებამდე HOMATCH ვერ შეაჩერებს, ვერ განაახლებს და ვერ მოგაწვდით ანგარიშებს.', 'Пока вы не переподключитесь, HOMATCH не сможет управлять кампаниями и формировать отчёты.', 'Yeniden bağlanana kadar HOMATCH kampanyalarınızı duraklatamaz, sürdüremez veya raporlayamaz.', 'حتى تعيد الاتصال، لا يمكن لـ HOMATCH إيقاف حملاتك أو استئنافها أو إعداد تقارير عنها.', 'עד שתתחברו מחדש, HOMATCH לא יכול להשהות, לחדש או לדווח על הקמפיינים.'],
    action: ['Reconnect Meta in HOMATCH.', 'ხელახლა დააკავშირეთ Meta HOMATCH-ში.', 'Переподключите Meta в HOMATCH.', 'Meta\'yı HOMATCH\'te yeniden bağlayın.', 'أعد ربط Meta في HOMATCH.', 'חברו מחדש את Meta ב־HOMATCH.'],
  },
  DATA_HEALTH: {
    title: ['Campaign needs a look', 'კამპანიას ყურადღება სჭირდება', 'Кампания требует внимания', 'Kampanyaya bakılması gerekiyor', 'الحملة تحتاج إلى مراجعة', 'הקמפיין דורש בדיקה'],
    body: ['{{campaign}}: delivery or data looks unusual.', '{{campaign}}: ჩვენება ან მონაცემები უჩვეულოდ გამოიყურება.', '{{campaign}}: показы или данные выглядят необычно.', '{{campaign}}: yayın veya veriler olağandışı görünüyor.', '{{campaign}}: يبدو العرض أو البيانات غير معتادة.', '{{campaign}}: ההצגה או הנתונים נראים חריגים.'],
    why: ['HOMATCH noticed it during its regular check.', 'HOMATCH-მა ეს რეგულარული შემოწმებისას შენიშნა.', 'HOMATCH заметил это при регулярной проверке.', 'HOMATCH bunu düzenli kontrolü sırasında fark etti.', 'لاحظ HOMATCH ذلك أثناء فحصه المنتظم.', 'HOMATCH הבחין בכך בבדיקה השגרתית.'],
    action: ['Open the campaign for details.', 'დეტალებისთვის გახსენით კამპანია.', 'Откройте кампанию для подробностей.', 'Ayrıntılar için kampanyayı açın.', 'افتح الحملة للتفاصيل.', 'פתחו את הקמפיין לפרטים.'],
  },
  CAMPAIGN_LIFECYCLE: {
    title: ['Campaign update', 'კამპანიის განახლება', 'Обновление кампании', 'Kampanya güncellemesi', 'تحديث الحملة', 'עדכון קמפיין'],
    body: ['{{campaign}}: {{what}}', '{{campaign}}: {{what}}', '{{campaign}}: {{what}}', '{{campaign}}: {{what}}', '{{campaign}}: {{what}}', '{{campaign}}: {{what}}'],
    why: ['', '', '', '', '', ''],
    action: null,
  },
};

const RESOLVED: T6 = ['Resolved: ', 'მოგვარდა: ', 'Решено: ', 'Çözüldü: ', 'تم الحل: ', 'נפתר: '];
const REMINDER: T6 = ['Reminder: ', 'შეხსენება: ', 'Напоминание: ', 'Hatırlatma: ', 'تذكير: ', 'תזכורת: '];

export function normLocale(v: unknown): Locale {
  const s = String(v ?? '').slice(0, 2).toLowerCase();
  return (L as string[]).includes(s) ? (s as Locale) : 'en';
}

const fill = (t: string, p: Record<string, string | number | null | undefined>) =>
  t.replace(/\{\{(\w+)\}\}/g, (_, k) => (p[k] == null ? '' : String(p[k])));

export function renderEvent(type: EventType, transition: Transition, locale: Locale, params: Record<string, string | number | null | undefined>) {
  const i = L.indexOf(locale);
  const c = C[type];
  const prefix = transition === 'RESOLVED' ? RESOLVED[i] : transition === 'REMINDER' ? REMINDER[i] : '';
  return {
    title: prefix + fill(c.title[i], params),
    body: fill(c.body[i], params),
    why: fill(c.why[i], params),
    action: c.action ? fill(c.action[i], params) : null,
  };
}

export const EMAIL_CTA: T6 = ['Open in HOMATCH', 'HOMATCH-ში გახსნა', 'Открыть в HOMATCH', 'HOMATCH\'te aç', 'افتح في HOMATCH', 'פתחו ב־HOMATCH'];
export const EMAIL_WHY: T6 = ['Why it matters', 'რატომ არის მნიშვნელოვანი', 'Почему это важно', 'Neden önemli', 'لماذا يهم ذلك', 'למה זה חשוב'];
export const EMAIL_ANALYSIS: T6 = ['HOMATCH analysis', 'HOMATCH-ის ანალიზი', 'Анализ HOMATCH', 'HOMATCH analizi', 'تحليل HOMATCH', 'ניתוח HOMATCH'];
export const EMAIL_NEXT: T6 = ['Recommended next step', 'რეკომენდებული შემდეგი ნაბიჯი', 'Рекомендуемый шаг', 'Önerilen sonraki adım', 'الخطوة التالية الموصى بها', 'הצעד הבא המומלץ'];
export const EMAIL_FOOTER: T6 = [
  'You receive this because Meta Ads notifications are on in your HOMATCH settings.',
  'ამ წერილს იღებთ, რადგან HOMATCH-ის პარამეტრებში Meta Ads-ის შეტყობინებები ჩართულია.',
  'Вы получили это письмо, потому что уведомления Meta Ads включены в настройках HOMATCH.',
  'Bunu, HOMATCH ayarlarınızda Meta Ads bildirimleri açık olduğu için alıyorsunuz.',
  'تتلقى هذا لأن إشعارات Meta Ads مفعّلة في إعدادات HOMATCH.',
  'קיבלתם הודעה זו כי התראות Meta Ads מופעלות בהגדרות HOMATCH שלכם.',
];
export const BRIEF_TITLE: Record<'DAILY' | 'WEEKLY', T6> = {
  DAILY: ['Your daily Meta Ads brief', 'თქვენი ყოველდღიური Meta Ads მიმოხილვა', 'Ваша ежедневная сводка Meta Ads', 'Günlük Meta Ads özetiniz', 'ملخصك اليومي لإعلانات Meta', 'סיכום Meta Ads היומי שלכם'],
  WEEKLY: ['Your weekly Meta Ads brief', 'თქვენი ყოველკვირეული Meta Ads მიმოხილვა', 'Ваша еженедельная сводка Meta Ads', 'Haftalık Meta Ads özetiniz', 'ملخصك الأسبوعي لإعلانات Meta', 'סיכום Meta Ads השבועי שלכם'],
};
export const BRIEF_LINES: Record<string, T6> = {
  active: ['Active campaigns: {{n}}', 'აქტიური კამპანიები: {{n}}', 'Активные кампании: {{n}}', 'Aktif kampanyalar: {{n}}', 'الحملات النشطة: {{n}}', 'קמפיינים פעילים: {{n}}'],
  spend: ['Spend {{spend}} · Results {{results}} · Cost per result {{cpr}}', 'დახარჯული {{spend}} · შედეგები {{results}} · შედეგის ღირებულება {{cpr}}', 'Расход {{spend}} · Результаты {{results}} · Цена результата {{cpr}}', 'Harcama {{spend}} · Sonuçlar {{results}} · Sonuç başına maliyet {{cpr}}', 'الإنفاق {{spend}} · النتائج {{results}} · تكلفة النتيجة {{cpr}}', 'הוצאה {{spend}} · תוצאות {{results}} · עלות לתוצאה {{cpr}}'],
  leads: ['Leads {{leads}} · Qualified {{qualified}}', 'ლიდები {{leads}} · კვალიფიციური {{qualified}}', 'Заявки {{leads}} · Квалифицированные {{qualified}}', 'Potansiyel müşteriler {{leads}} · Nitelikli {{qualified}}', 'العملاء المحتملون {{leads}} · المؤهلون {{qualified}}', 'לידים {{leads}} · איכותיים {{qualified}}'],
  attention: ['Needs attention: {{names}}', 'ყურადღებას საჭიროებს: {{names}}', 'Требуют внимания: {{names}}', 'İlgi gerektiriyor: {{names}}', 'تحتاج إلى انتباه: {{names}}', 'דורשים תשומת לב: {{names}}'],
  recommendations: ['Open HOMATCH recommendations: {{n}}', 'HOMATCH-ის ღია რეკომენდაციები: {{n}}', 'Открытые рекомендации HOMATCH: {{n}}', 'Açık HOMATCH önerileri: {{n}}', 'توصيات HOMATCH المفتوحة: {{n}}', 'המלצות HOMATCH פתוחות: {{n}}'],
  resolved: ['Resolved issues: {{n}}', 'მოგვარებული საკითხები: {{n}}', 'Решённые проблемы: {{n}}', 'Çözülen sorunlar: {{n}}', 'المشكلات المحلولة: {{n}}', 'בעיות שנפתרו: {{n}}'],
};

export function t6(tuple: T6, locale: Locale, params: Record<string, string | number | null | undefined> = {}) {
  return fill(tuple[L.indexOf(locale)], params);
}

export const RTL: Record<Locale, boolean> = { en: false, ka: false, ru: false, tr: false, ar: true, he: true };

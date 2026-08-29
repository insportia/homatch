import React from 'react';
import { ArrowRight, Home, Search, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

type Copy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  findProperty: string;
  findPropertyDesc: string;
  findPropertyCta: string;
  findDemand: string;
  findDemandDesc: string;
  findDemandCta: string;
};

const COPY: Record<string, Copy> = {
  en: {
    eyebrow: 'Choose what you want to do',
    title: 'How can Homatch help you today?',
    subtitle: 'Start with the direction that matches your goal. You can switch at any time.',
    findProperty: 'I WANT TO FIND A PROPERTY',
    findPropertyDesc: 'Tell Homatch AI what you want to buy, rent or invest in. Search, compare, verify and connect from one place.',
    findPropertyCta: 'Find a property',
    findDemand: 'I WANT TO FIND A BUYER / TENANT',
    findDemandDesc: 'Add or import your property and Homatch will look for relevant buyer, tenant and investor demand.',
    findDemandCta: 'Add my property',
  },
  ka: {
    eyebrow: 'აირჩიეთ, რისი გაკეთება გსურთ',
    title: 'რით დაგეხმაროთ Homatch დღეს?',
    subtitle: 'დაიწყეთ თქვენი მიზნის შესაბამისი მიმართულებით. მიმართულების შეცვლა ნებისმიერ დროს შეგიძლიათ.',
    findProperty: 'მინდა ვიპოვო უძრავი ქონება',
    findPropertyDesc: 'უთხარით Homatch AI-ს, რისი ყიდვა, დაქირავება ან საინვესტიციოდ მოძიება გსურთ. მოძებნეთ, შეადარეთ, გადაამოწმეთ და დაუკავშირდით ერთ სივრცეში.',
    findPropertyCta: 'უძრავი ქონების მოძებნა',
    findDemand: 'მინდა ვიპოვო მყიდველი / დამქირავებელი',
    findDemandDesc: 'დაამატეთ ან შემოიტანეთ თქვენი ობიექტი და Homatch მოძებნის შესაბამის მყიდველებს, დამქირავებლებსა და ინვესტორებს.',
    findDemandCta: 'ჩემი ობიექტის დამატება',
  },
  ru: {
    eyebrow: 'Выберите, что вы хотите сделать',
    title: 'Чем Homatch может помочь вам сегодня?',
    subtitle: 'Начните с направления, которое соответствует вашей цели. Его можно изменить в любой момент.',
    findProperty: 'Я ХОЧУ НАЙТИ НЕДВИЖИМОСТЬ',
    findPropertyDesc: 'Расскажите Homatch AI, что хотите купить, арендовать или найти для инвестиций. Ищите, сравнивайте, проверяйте и связывайтесь в одном месте.',
    findPropertyCta: 'Найти недвижимость',
    findDemand: 'Я ХОЧУ НАЙТИ ПОКУПАТЕЛЯ / АРЕНДАТОРА',
    findDemandDesc: 'Добавьте или импортируйте объект, и Homatch будет искать подходящий спрос среди покупателей, арендаторов и инвесторов.',
    findDemandCta: 'Добавить мой объект',
  },
  tr: {
    eyebrow: 'Ne yapmak istediğinizi seçin',
    title: 'Homatch bugün size nasıl yardımcı olabilir?',
    subtitle: 'Hedefinize uygun yönden başlayın. İstediğiniz zaman diğer yöne geçebilirsiniz.',
    findProperty: 'GAYRİMENKUL BULMAK İSTİYORUM',
    findPropertyDesc: 'Homatch AI’a satın almak, kiralamak veya yatırım için aradığınız gayrimenkulü anlatın. Tek yerden arayın, karşılaştırın, doğrulayın ve iletişime geçin.',
    findPropertyCta: 'Gayrimenkul bul',
    findDemand: 'ALICI / KİRACI BULMAK İSTİYORUM',
    findDemandDesc: 'Gayrimenkulünüzü ekleyin veya içe aktarın; Homatch uygun alıcı, kiracı ve yatırımcı talebini arasın.',
    findDemandCta: 'Gayrimenkulümü ekle',
  },
  ar: {
    eyebrow: 'اختر ما تريد القيام به',
    title: 'كيف يمكن لـ Homatch مساعدتك اليوم؟',
    subtitle: 'ابدأ بالمسار الذي يناسب هدفك، ويمكنك التبديل بين المسارين في أي وقت.',
    findProperty: 'أريد العثور على عقار',
    findPropertyDesc: 'أخبر Homatch AI بما تريد شراءه أو استئجاره أو الاستثمار فيه. ابحث وقارن وتحقق وتواصل من مكان واحد.',
    findPropertyCta: 'العثور على عقار',
    findDemand: 'أريد العثور على مشترٍ / مستأجر',
    findDemandDesc: 'أضف عقارك أو استورده، وسيبحث Homatch عن طلب مناسب من المشترين والمستأجرين والمستثمرين.',
    findDemandCta: 'إضافة عقاري',
  },
  he: {
    eyebrow: 'בחרו מה תרצו לעשות',
    title: 'איך Homatch יכול לעזור לכם היום?',
    subtitle: 'התחילו במסלול שמתאים למטרה שלכם. אפשר לעבור בין המסלולים בכל עת.',
    findProperty: 'אני רוצה למצוא נכס',
    findPropertyDesc: 'ספרו ל-Homatch AI מה תרצו לקנות, לשכור או למצוא להשקעה. חפשו, השוו, אמתו וצרו קשר במקום אחד.',
    findPropertyCta: 'מציאת נכס',
    findDemand: 'אני רוצה למצוא קונה / שוכר',
    findDemandDesc: 'הוסיפו או ייבאו את הנכס שלכם ו-Homatch יחפש ביקוש מתאים מצד קונים, שוכרים ומשקיעים.',
    findDemandCta: 'הוספת הנכס שלי',
  },
};

export function DashboardIntentPaths() {
  const navigate = useNavigate();
  const { lang, isRTL } = useLanguage();
  const copy = COPY[lang] ?? COPY.en;

  const goFindProperty = () => navigate('/ai', {
    state: {
      mode: 'find-property',
      prompt: lang === 'ka'
        ? 'მინდა ვიპოვო უძრავი ქონება. დამეხმარე მოთხოვნების ჩამოყალიბებაში და შესაბამისი ვარიანტების მოძებნაში.'
        : 'I want to find a property. Help me define my requirements and find relevant options.',
    },
  });

  return (
    <section className="w-full max-w-5xl mx-auto mb-6 md:mb-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/[0.07] to-card p-4 sm:p-5 md:p-6 overflow-hidden">
        <div className="flex items-start gap-3 mb-5 min-w-0">
          <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Home className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 max-w-3xl">
            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.12em] text-primary break-words">{copy.eyebrow}</p>
            <h2 className="mt-1 text-lg sm:text-xl md:text-2xl font-semibold leading-snug text-foreground break-words [overflow-wrap:anywhere]">{copy.title}</h2>
            <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">{copy.subtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <button
            type="button"
            onClick={goFindProperty}
            className="group min-w-0 w-full rounded-xl border border-primary/25 bg-background/60 p-4 sm:p-5 text-start hover:border-primary/55 hover:bg-primary/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
                <Search className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm sm:text-base font-bold leading-snug text-foreground break-words [overflow-wrap:anywhere]">{copy.findProperty}</h3>
                <p className="mt-2 text-xs sm:text-sm leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">{copy.findPropertyDesc}</p>
                <span className="mt-4 inline-flex max-w-full items-center gap-2 text-xs sm:text-sm font-semibold text-primary">
                  <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{copy.findPropertyCta}</span>
                  <ArrowRight className={`h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${isRTL ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`} />
                </span>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/property/add')}
            className="group min-w-0 w-full rounded-xl border border-border bg-background/60 p-4 sm:p-5 text-start hover:border-primary/45 hover:bg-primary/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-accent/20 flex items-center justify-center">
                <Users className="h-5 w-5 text-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm sm:text-base font-bold leading-snug text-foreground break-words [overflow-wrap:anywhere]">{copy.findDemand}</h3>
                <p className="mt-2 text-xs sm:text-sm leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">{copy.findDemandDesc}</p>
                <span className="mt-4 inline-flex max-w-full items-center gap-2 text-xs sm:text-sm font-semibold text-primary">
                  <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{copy.findDemandCta}</span>
                  <ArrowRight className={`h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${isRTL ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`} />
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </section>
  );
}

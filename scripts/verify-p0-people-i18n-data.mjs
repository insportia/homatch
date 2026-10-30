/*
 * Role names for the project-team codes that tasProfessionals.ts now emits
 * from the TAS case files (job 8ba97da9, unit …601). The card's headline stays
 * the document's own Georgian wording (roleText); these are the localized
 * role names for readers in other languages, keyed by role code:
 *
 *   DRAWING_TITLE_BLOCK                → verify_p0_role_drawing_title_block
 *   SAFETY_ASSESSMENT                  → verify_p0_role_safety_expert
 *   GEOTECHNICAL_EXPERT_ASSESSMENT     → verify_p0_role_geotech_expert
 *   CONSTRUCTION_ORGANIZATION_SCHEDULE → verify_p0_role_construction_org
 *   ARCHITECTURAL_ORGANIZATION         → verify_p0_role_design_firm
 *   MEP_ENGINEER (organisation)        → verify_p0_role_mep_firm
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const VERIFY_P0_PEOPLE_STRINGS = {
  verify_p0_role_drawing_title_block: [
    'Named in the drawings\' title block (role not stated)',
    'დასახელებულია ნახაზების ძირითად წარწერაში (როლი მითითებული არ არის)',
    'Указан в штампе чертежей (роль не указана)',
    'Çizimlerin antet bloğunda adı geçiyor (rolü belirtilmemiş)',
    'مذكور في خانة عنوان المخططات (الدور غير مذكور)',
    'מופיע בטבלת הכותרת של השרטוטים (התפקיד לא צוין)',
  ],
  verify_p0_role_safety_expert: ['Expert — building-safety rules compliance', 'ექსპერტი: შენობა-ნაგებობის უსაფრთხოების წესებთან შესაბამისობა', 'Эксперт — соответствие правилам безопасности зданий', 'Uzman — bina güvenliği kurallarına uygunluk', 'خبير — الامتثال لقواعد سلامة المباني', 'מומחה — עמידה בכללי בטיחות מבנים'],
  verify_p0_role_geotech_expert: [
    'Expert assessment of the geological survey',
    'საინჟინრო-გეოლოგიური კვლევის საექსპერტო შეფასება',
    'Экспертная оценка инженерно-геологических изысканий',
    'Jeoteknik etüdün uzman değerlendirmesi',
    'تقييم خبير للمسح الجيولوجي',
    'חוות דעת מומחה על הסקר הגיאולוגי',
  ],
  verify_p0_role_construction_org: [
    'Construction organisation project',
    'მშენებლობის ორგანიზაციის პროექტი',
    'Проект организации строительства',
    'İnşaat organizasyon projesi',
    'مشروع تنظيم البناء',
    'תוכנית ארגון הבנייה',
  ],
  verify_p0_role_design_firm: [
    'Design firm',
    'საპროექტო ორგანიზაცია',
    'Проектная организация',
    'Proje firması',
    'شركة التصميم',
    'משרד התכנון',
  ],
  verify_p0_role_mep_firm: [
    'Engineering systems design company',
    'საინჟინრო სისტემების საპროექტო კომპანია',
    'Компания по проектированию инженерных систем',
    'Mühendislik sistemleri tasarım şirketi',
    'شركة تصميم الأنظمة الهندسية',
    'חברת תכנון מערכות הנדסיות',
  ],
};

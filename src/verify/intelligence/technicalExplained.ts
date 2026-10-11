/*
 * TECHNICAL, EXPLAINED — what the building's technical facts mean, in
 * everyday Georgian.
 *
 * "მონოლითური კარკასი", "ხიმინჯოვანი საძირკველი", "დაბალემისიური შუშა":
 * correct words a buyer cannot use. For each major technical fact the record
 * or the project's public description states, one card answers four
 * questions: what it is, why it matters, what it means for the buyer, and
 * what to check. The text comes from a fixed glossary, never from a model,
 * so it reads the same in every report and cannot drift into praise.
 *
 * Sources, strongest first: technicalSpecs from the city's case files
 * (OFFICIAL), the MEP projects the case files name (OFFICIAL), then the
 * project's public description (PUBLIC; research-agent `publicResearch`).
 * Every specification is a design statement, never a guarantee of how the
 * building was built; the UI says that ONCE, above the cards.
 *
 * Pure and deterministic.
 */

import { stripProvenanceOpening, replaceDashes } from './editorial.ts';

export type TechTopic = 'STRUCTURE' | 'FOUNDATION' | 'SEISMIC' | 'FACADE' | 'WINDOWS' | 'INSULATION' | 'ENERGY' | 'MEP' | 'LIFTS' | 'FINISHES';
export const TECH_TOPIC_ORDER: TechTopic[] = ['STRUCTURE', 'FOUNDATION', 'SEISMIC', 'FACADE', 'WINDOWS', 'INSULATION', 'ENERGY', 'MEP', 'LIFTS', 'FINISHES'];

export type TechSource = 'OFFICIAL' | 'PUBLIC';

export interface TechnicalCard {
  topic: TechTopic;
  /** Glossary terms detected, in order. */
  terms: string[];
  /** Georgian title of the card. */
  title: string;
  /** The fact as the source states it, provenance opening removed. */
  stated: string | null;
  source: TechSource;
  caseRef: string | null;
  date: string | null;
  what: string;
  why: string;
  buyerMeaning: string;
  verify: string;
  /** What the documents establish (and from which kind of source). */
  establishes: string;
  /** What the documents cannot prove about the finished building. */
  cannotProve: string;
}

/** Materials and finishes, told under their own heading (owner copy "მასალები და მოპირკეთება"). */
export const MATERIAL_TOPICS: TechTopic[] = ['FACADE', 'WINDOWS', 'INSULATION', 'FINISHES'];

/* What a design document cannot prove, per topic. Fixed text, never model output. */
const CANNOT_PROVE: Record<TechTopic, string> = {
  STRUCTURE: 'დოკუმენტი ვერ ადასტურებს, რომ ბეტონის მარკა, არმატურა და ელემენტების ზომები მშენებლობისას ზუსტად პროექტით შესრულდა. ამას ტექნიკური ზედამხედველობის ჟურნალი და ლაბორატორიული გამოცდის აქტები აჩვენებს.',
  FOUNDATION: 'დოკუმენტი ვერ ადასტურებს, რა სიღრმეზე და როგორ მოეწყო საძირკველი რეალურად. ამას ფარული სამუშაოების აქტები და ზედამხედველობის ჩანაწერები აჩვენებს.',
  SEISMIC: 'დოკუმენტი გაანგარიშებას აჩვენებს და არა იმას, რამდენად ზუსტად შესრულდა კონსტრუქციული დეტალები, რომლებზეც სეისმომედეგობაა დამოკიდებული.',
  FACADE: 'ნახაზი ან აღწერა ვერ აჩვენებს, რა ხარისხის მასალა დამონტაჟდა და როგორ არის დამაგრებული. ფასადის მდგომარეობა ადგილზე უნდა ნახოთ.',
  WINDOWS: 'დოკუმენტი ვერ ადასტურებს, რომელი მწარმოებლის პროფილი და მინაპაკეტი დამონტაჟდა რეალურად და რა ხარისხით.',
  INSULATION: 'დოკუმენტი ვერ აჩვენებს, რა სისქის და რა ხარისხის თბოიზოლაცია დაიგო ფაქტობრივად. ეს ზამთარში ბინის სითბოზე და გათბობის ხარჯზე აისახება.',
  ENERGY: 'დეკლარაცია გაანგარიშებაა. ბინის რეალური ენერგომოხმარება შესრულების ხარისხსა და ექსპლუატაციაზეა დამოკიდებული.',
  MEP: 'სქემები აჩვენებს, რა იყო დაგეგმილი. ქსელებთან რეალური მიერთება და სისტემების მუშაობა ჩაბარებისას უნდა შემოწმდეს.',
  LIFTS: 'დოკუმენტი ვერ ადასტურებს, რომელი მოდელის ლიფტი დამონტაჟდა და გაიარა თუ არა მან ტექნიკური შემოწმება.',
  FINISHES: 'აღწერა ვერ აჩვენებს, რა მდგომარეობაში ჩაგაბარებთ ბინას. ჩაბარების პირობები ხელშეკრულებაში უნდა ჩაიწეროს.',
};

/** What the documents establish: an official design statement, or the developer's public description. */
export function establishesOf(source: TechSource, date: string | null): string {
  const when = date && /^\d{4}-\d{2}-\d{2}/.test(date) ? ` (${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)})` : '';
  return source === 'OFFICIAL'
    ? `ქალაქში წარდგენილი საპროექტო დოკუმენტი${when} ადგენს, რომ ეს გადაწყვეტა პროექტით იყო გათვალისწინებული.`
    : 'ეს პროექტის საჯარო აღწერაა. ის აჩვენებს, რას აცხადებს დეველოპერი, და არა იმას, რა შეათანხმა ქალაქმა.';
}

interface Term { id: string; topic: TechTopic; re: RegExp; what: string | ((m: RegExpExecArray) => string) }

/* Detection: specific before generic; the first term of a topic leads its card. */
const TERMS: Term[] = [
  { id: 'monolithicFrame', topic: 'STRUCTURE', re: /მონოლით\S*\s+(?:რკინაბეტონ\S*\s+)?კარკას|monolithic\s+(?:reinforced\s+)?concrete|монолитн\S*\s+(?:железобетонн\S*\s+)?каркас/iu,
    what: 'მონოლითური კარკასი ნიშნავს, რომ სვეტები, მზიდი კედლები და სართულშუა გადახურვები ადგილზევე, ყალიბში ჩასხმული ბეტონითა და არმატურით კეთდება და ერთიან ჩონჩხს ქმნის.' },
  { id: 'reinforcedConcrete', topic: 'STRUCTURE', re: /რკინაბეტონ|reinforced\s+concrete|железобетон/iu,
    what: 'რკინაბეტონი ბეტონია, რომლის შიგნითაც ფოლადის არმატურაა ჩაწყობილი. ბეტონი კუმშვას უძლებს, არმატურა კი გაჭიმვას, ამიტომ ერთად მზიდ კონსტრუქციას ქმნიან.' },
  { id: 'frame', topic: 'STRUCTURE', re: /კარკას|frame\b|каркас/iu,
    what: 'კარკასი შენობის ჩონჩხია: სვეტები და გადახურვები, რომლებიც მთელ დატვირთვას იღებს.' },
  { id: 'pileFoundation', topic: 'FOUNDATION', re: /ხიმინჯ|\bpiles?\b|сва[йя]/iu,
    what: 'ხიმინჯოვანი საძირკველი ნიშნავს, რომ შენობა მიწაში ღრმად ჩასულ რკინაბეტონის ხიმინჯებზე დგას, რომლებიც დატვირთვას უფრო მყარ ფენამდე ატარებს.' },
  { id: 'slabFoundation', topic: 'FOUNDATION', re: /ფილოვან\S*\s+საძირკ|საძირკვლის\s+ფილ|slab\s+foundation|raft\s+foundation|плитн\S*\s+фундамент/iu,
    what: 'ფილოვანი საძირკველი მთელი შენობის ქვეშ მოწყობილი ერთიანი სქელი რკინაბეტონის ფილაა, რომელიც წონას ფართო ზედაპირზე ანაწილებს.' },
  { id: 'foundation', topic: 'FOUNDATION', re: /საძირკვ|foundation|фундамент/iu,
    what: 'საძირკველი შენობის ის ნაწილია, რომელიც მთელ წონას გრუნტს გადასცემს.' },
  { id: 'seismicZone', topic: 'SEISMIC', re: /(\d)\s*(?:ბალ|баллов|балл|-?point|magnitude)|სეისმ|seismic|сейсм/iu,
    what: (m) => (m[1]
      ? `სეისმურობა აჩვენებს, რა ძალის მიწისძვრაზეა შენობა გათვლილი. ${m[1]} ბალი ნიშნავს, რომ კონსტრუქცია ამ ინტენსივობის რყევაზეა დაპროექტებული.`
      : 'სეისმური გათვლა აჩვენებს, რა ძალის მიწისძვრაზეა შენობის კონსტრუქცია დაპროექტებული.') },
  { id: 'ventilatedFacade', topic: 'FACADE', re: /ვენტილირებად\S*\s+ფასად|ventilated\s+fa[cç]ade|вентилируем\S*\s+фасад/iu,
    what: 'ვენტილირებადი ფასადის მოსაპირკეთებელი ფილები კედელს პირდაპირ არ ეკვრის: ლითონის კარკასზე კიდია და შუაში ჰაერის ფენაა, რომელიც კედელს ტენისგან აშრობს.' },
  { id: 'travertine', topic: 'FACADE', re: /ტრავერტინ|travertine|травертин/iu,
    what: 'ტრავერტინი ბუნებრივი ქვაა, ოდნავ ფოროვანი ზედაპირით. ლამაზად ბერდება, თუმცა დროდადრო წმენდა სჭირდება.' },
  { id: 'aluminiumProfiles', topic: 'FACADE', re: /ალუმინ\S*\s+(?:\S+\s+)?(?:ლამელ|პროფილ)|alumin\S*\s+(?:lamell|profile|louvre)|алюмини\S*\s+(?:ламел|профил)/iu,
    what: 'ალუმინის ლამელები ფასადზე დამაგრებული ვიწრო პროფილებია. ალუმინი მსუბუქია და არ ჟანგდება.' },
  { id: 'compositePanels', topic: 'FACADE', re: /კომპოზიტ|composite\s+panel|композит/iu,
    what: 'ალუმინის კომპოზიტური პანელი ორი თხელი ალუმინის ფურცელია, შუაში შემავსებლით. მისი ხანძარმედეგობა შემავსებლის კლასზეა დამოკიდებული.' },
  { id: 'temperedGlass', topic: 'FACADE', re: /ნაწრთობ|tempered\s+glass|закал[её]нн/iu,
    what: 'ნაწრთობი შუშა ჩვეულებრივზე გაცილებით მტკიცეა და გატეხვისას წვრილ, ნაკლებად სახიფათო ნამსხვრევებად იშლება.' },
  { id: 'facade', topic: 'FACADE', re: /ფასად|fa[cç]ade|фасад/iu,
    what: 'ფასადი შენობის გარე გარსია, რომელიც კედლებს ამინდისგან იცავს და შენობის იერსახეს ქმნის.' },
  { id: 'lowE', topic: 'WINDOWS', re: /დაბალემისიურ|low[\s-]?e\b|низкоэмисс/iu,
    what: 'დაბალემისიური შუშა თხელ, თვალით შეუმჩნეველ ფენას შეიცავს, რომელიც ზამთარში სითბოს ოთახში აბრუნებს, ზაფხულში კი მზის სიცხეს ამცირებს.' },
  { id: 'doubleGlazing', topic: 'WINDOWS', re: /ორმაგ\S*\s+(?:მინ|შუშ)|მინაპაკეტ|double[\s-]glaz|стеклопакет/iu,
    what: 'მინაპაკეტი ორი ან სამი შუშაა, შუაში ჰაერის ან აირის ფენით. ის სითბოსა და ქუჩის ხმაურს უკეთ აჩერებს.' },
  { id: 'aluminiumWindows', topic: 'WINDOWS', re: /ალუმინ\S*\s+(?:\S+\s+)?(?:კარ-?ფანჯ|ფანჯ|ვიტრაჟ)|alumin\S*\s+(?:windows?|joinery)|алюмини\S*\s+окн/iu,
    what: 'იზოლირებული ალუმინის კარ-ფანჯარა ჩარჩოს შიგნით სითბოს ჩამკეტ ჩანართს შეიცავს, რომ ზამთარში ჩარჩომ სიცივე არ გაატაროს.' },
  { id: 'windows', topic: 'WINDOWS', re: /ფანჯ|windows?|окн/iu,
    what: 'კარ-ფანჯრები ბინის სითბოს დანაკარგისა და ხმაურის მთავარი გზაა.' },
  { id: 'insulation', topic: 'INSULATION', re: /თბოიზოლ|დათბუნ|ქვაბამბ|პენოპლასტ|insulat|утепл|теплоизол/iu,
    what: 'თბოიზოლაცია კედლებზე დატანილი ფენაა (ხშირად ქვაბამბის ან პენოპლასტის ფილები), რომელიც სითბოს გარეთ გასვლას აფერხებს.' },
  { id: 'energyEfficiency', topic: 'ENERGY', re: /ენერგოეფექტ|energy[\s-]efficien|энергоэффект/iu,
    what: 'ენერგოეფექტურობა აჩვენებს, რამდენ ენერგიას საჭიროებს შენობა გათბობასა და გაგრილებაზე.' },
  { id: 'mep', topic: 'MEP', re: /გაზმომარაგ|გათბობა|ვენტილაცი|ელექტრ|წყალმომარაგ|კანალიზაცი|\bMEP\b|hvac|plumbing|electrical|отоплен|вентиляц|электр/iu,
    what: 'საინჟინრო სისტემები შენობის „შიდა ორგანოებია“: დენი, გაზი, გათბობა, ვენტილაცია, წყალი და კანალიზაცია. თითოეულს ცალკე პროექტი აქვს.' },
  { id: 'lifts', topic: 'LIFTS', re: /ლიფტ|elevator|\blifts?\b|лифт|\bOTIS\b|\bKONE\b|schindler/iu,
    what: 'ლიფტის მწარმოებელი და მოდელი განსაზღვრავს სიჩქარეს, ხმაურს და მომსახურების ხარჯს.' },
  { id: 'finishes', topic: 'FINISHES', re: /მოპირკეთ|მასალ|ფილ(?:ა|ის)|კერამიკ|პარკეტ|ლამინატ|finish|material|tiles?|отделк|материал/iu,
    what: 'მოპირკეთება ის არის, რასაც ბინაში რეალურად ხედავთ და ეხებით: იატაკი, კედლები, კარები და სანტექნიკა.' },
];

const TOPIC: Record<TechTopic, { title: string; why: string; buyerMeaning: string; verify: string }> = {
  STRUCTURE: {
    title: 'კონსტრუქციული სისტემა',
    why: 'კარკასი იღებს სართულების, ადამიანებისა და მიწისძვრის დატვირთვას. ის შენობის სიმტკიცის საფუძველია.',
    buyerMeaning: 'კარკასულ შენობაში ბინის შიდა ტიხრების უმეტესობა მზიდი არ არის, ამიტომ გეგმარების შეცვლა ხშირად შესაძლებელია.',
    verify: 'ნებისმიერ გადაკეთებამდე კონსტრუქციულ ნახაზზე ნახეთ, რომელი კედლები და სვეტებია მზიდი.',
  },
  FOUNDATION: {
    title: 'საძირკველი',
    why: 'საძირკვლის ტიპს გრუნტის კვლევის შედეგით ირჩევენ. სწორად შერჩეული საძირკველი შენობის ჯდომასა და ბზარებს ამცირებს.',
    buyerMeaning: 'საძირკვლის სიმტკიცე იმაზეა დამოკიდებული, რამდენად ზუსტად შესრულდა სამუშაო, და არა მხოლოდ მის ტიპზე.',
    verify: 'ჰკითხეთ, ჩატარდა თუ არა საძირკვლის გამოცდა და არსებობს თუ არა ფარული სამუშაოების აქტები.',
  },
  SEISMIC: {
    title: 'სეისმომედეგობა',
    why: 'საქართველო სეისმურად აქტიური ქვეყანაა, ამიტომ ეს შენობის ერთ-ერთი მთავარი საპროექტო მოთხოვნაა.',
    buyerMeaning: 'პროექტში მითითებული სეისმურობა აჩვენებს, როგორ დაიგეგმა შენობა. ის, რომ ასე აშენდა, ტექნიკური ზედამხედველობის დოკუმენტებით მოწმდება.',
    verify: 'ჰკითხეთ, ვინ აწარმოებდა ტექნიკურ ზედამხედველობას და შეგიძლიათ თუ არა მისი დასკვნის ნახვა.',
  },
  FACADE: {
    title: 'ფასადი',
    why: 'ფასადი შენობას ამინდისგან იცავს. მის მასალაზეა დამოკიდებული მოვლის ხარჯი და კედლების სითბოს დანაკარგი.',
    buyerMeaning: 'ფასადის მოვლა საერთო ხარჯია, რომელსაც მესაკუთრეები ერთად, ამხანაგობის ან მმართველი კომპანიის მეშვეობით იხდიან.',
    verify: 'ნახეთ შენობა ახლოდან: პანელების სიმწორე, ნაკერები და ფანჯრებთან მიერთების ადგილები.',
  },
  WINDOWS: {
    title: 'კარ-ფანჯრები და მინა',
    why: 'ფანჯრები ბინის სითბოს დანაკარგისა და ქუჩის ხმაურის მთავარი გზაა.',
    buyerMeaning: 'კარგი კარ-ფანჯრები გათბობისა და გაგრილების ხარჯს ამცირებს და ბინას უფრო მშვიდს ხდის.',
    verify: 'ბინაში ნახეთ მინაპაკეტზე დატანილი მარკირება და შეამოწმეთ, მჭიდროდ იკეტება თუ არა ფრთები.',
  },
  INSULATION: {
    title: 'თბოიზოლაცია',
    why: 'თბოიზოლაცია ზამთარში სითბოს, ზაფხულში კი სიგრილეს ინარჩუნებს და კედლებზე ნესტის რისკს ამცირებს.',
    buyerMeaning: 'კარგად დათბუნებულ ბინაში კომუნალური ხარჯი ნაკლებია და კედლის კუთხეებში ობი იშვიათად ჩნდება.',
    verify: 'ჰკითხეთ, რა მასალით და რა სისქით დაითბუნა კედლები.',
  },
  ENERGY: {
    title: 'ენერგოეფექტურობა',
    why: 'ეს პირდაპირ აისახება ყოველთვიურ გათბობისა და გაგრილების ხარჯზე.',
    buyerMeaning: 'პროცენტი პროექტის აღწერაში შედარებითი მაჩვენებელია. მისი აზრი იმაზეა დამოკიდებული, რას ედრება.',
    verify: 'ჰკითხეთ, არსებობს თუ არა ენერგოეფექტურობის სერტიფიკატი ან გათვლა და რას ედრება მითითებული მაჩვენებელი.',
  },
  MEP: {
    title: 'საინჟინრო სისტემები',
    why: 'ამ სისტემების ხარისხი ყოველდღიურ კომფორტსა და უსაფრთხოებას განსაზღვრავს.',
    buyerMeaning: 'ცალკე პროექტები ნიშნავს, რომ სისტემები დაგეგმილია. ბინაში რეალური მიერთება ცალკე საკითხია.',
    verify: 'ბინაში შეამოწმეთ დენის, გაზისა და წყლის მრიცხველები და ჰკითხეთ, ვის სახელზეა ისინი რეგისტრირებული.',
  },
  LIFTS: {
    title: 'ლიფტები',
    why: 'ლიფტი ყოველდღიური კომფორტის საკითხია, მაღალ სართულზე კი ხელმისაწვდომობისაც.',
    buyerMeaning: 'ლიფტის მომსახურება საერთო ხარჯია და მისი მდგომარეობა შენობის მართვაზეა დამოკიდებული.',
    verify: 'ჰკითხეთ, ვინ ემსახურება ლიფტს და რამდენი ჯდება ყოველთვიური მომსახურება.',
  },
  FINISHES: {
    title: 'მოპირკეთება და მასალები',
    why: '„პრემიუმ მასალები“ აღწერაში ზოგადი სიტყვაა. რეალური ხარისხი კონკრეტულ ბინაში ჩანს.',
    buyerMeaning: 'ერთ შენობაში ბინები ხშირად სხვადასხვა მდგომარეობით იყიდება, ამიტომ ფასი მოპირკეთებასთან ერთად უნდა შეაფასოთ.',
    verify: 'ნახეთ კონკრეტული ბინა და მოპირკეთების დეტალები დაადასტურეთ მესაკუთრესთან ან გაყიდვების წარმომადგენელთან.',
  },
};

/* Spec keys and public-research fields, with the topic they can only belong to. */
const SPEC_TOPIC: Record<string, TechTopic> = { structuralSystem: 'STRUCTURE', foundationType: 'FOUNDATION', facadeMaterials: 'FACADE', elevator: 'LIFTS' };
const PUBLIC_TOPIC: Record<string, TechTopic> = {
  structuralSystem: 'STRUCTURE', seismicDesign: 'SEISMIC', facade: 'FACADE', windows: 'WINDOWS', insulation: 'INSULATION',
  energyEfficiency: 'ENERGY', MEP: 'MEP', elevators: 'LIFTS', constructionMaterials: 'FINISHES',
};

interface Candidate { topic: TechTopic; text: string; source: TechSource; caseRef: string | null; date: string | null }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The source's sentence, without its provenance opening and without dashes. */
export function cleanStated(text: string): string | null {
  const t = replaceDashes(stripProvenanceOpening(text.replace(/\s+/g, ' ').trim()))
    // a second provenance clause inside the sentence ("…; პროექტის შესახებ საჯაროდ ხელმისაწვდომი ინფორმაციის მიხედვით, 42 …")
    .replace(/;\s*(?:პროექტის\s+(?:შესახებ\s+)?)?საჯაროდ\s+ხელმისაწვდომი\s+ინფორმაციის\s+მიხედვით,?\s*/gu, '; ')
    .trim();
  // A clause about what was NOT published is a statement about the search, never about the building.
  const kept = t.split(/;\s+/).filter((c) => !/არ\s+არის\s+(?:გამოქვეყნ|მითით|ხელმისაწვდ)|ვერ\s+მოიძებნ|not\s+(?:published|disclosed)/iu.test(c)).join('; ').replace(/;?\s*$/, '');
  const out = kept && !/[.!?…]$/.test(kept) ? `${kept}.` : kept;
  if (!out || out.length < 3) return null;
  return out.length > 220 ? `${out.slice(0, 217).trimEnd()}…` : out;
}

function termsIn(topic: TechTopic, text: string): Array<{ term: Term; m: RegExpExecArray }> {
  const out: Array<{ term: Term; m: RegExpExecArray }> = [];
  for (const term of TERMS) {
    if (term.topic !== topic) continue;
    const m = term.re.exec(text);
    if (m) out.push({ term, m });
  }
  // A generic term only when no specific one of its topic was found.
  const generic = new Set(['frame', 'foundation', 'facade', 'windows']);
  const specific = out.filter((x) => !generic.has(x.term.id));
  return specific.length ? specific : out;
}

export interface TechnicalInput {
  specs?: unknown;
  publicResearch?: unknown;
  /** projectTeamV2 — its MEP roles' scopes name the engineering projects on file. */
  team?: unknown;
}

export function explainTechnical(input: TechnicalInput): TechnicalCard[] {
  const cands: Candidate[] = [];
  for (const s of Array.isArray(input.specs) ? (input.specs as Array<Record<string, unknown>>) : []) {
    const topic = SPEC_TOPIC[str(s?.key)];
    const text = str(s?.value);
    if (topic && text) cands.push({ topic, text, source: 'OFFICIAL', caseRef: str(s.caseRef) || null, date: str(s.date).slice(0, 10) || null });
  }
  // The engineering projects filed with the city (gas, heating and ventilation, electricity…).
  const mep: string[] = [];
  let mepRef: { caseRef: string | null; date: string | null } | null = null;
  for (const m of Array.isArray(input.team) ? (input.team as Array<Record<string, unknown>>) : []) {
    for (const r of Array.isArray(m?.roles) ? (m.roles as Array<Record<string, unknown>>) : []) {
      if (str(r?.code).toUpperCase() !== 'MEP_ENGINEER') continue;
      const scope = str(r.scope);
      if (scope && !mep.includes(scope)) mep.push(scope);
      mepRef = mepRef ?? { caseRef: str(r.caseRef) || null, date: str(r.date).slice(0, 10) || null };
    }
  }
  if (mep.length) cands.push({ topic: 'MEP', text: mep.slice(0, 5).join(', '), source: 'OFFICIAL', caseRef: mepRef?.caseRef ?? null, date: mepRef?.date ?? null });
  const pr = input.publicResearch && typeof input.publicResearch === 'object' ? (input.publicResearch as Record<string, unknown>) : {};
  for (const [field, topic] of Object.entries(PUBLIC_TOPIC)) {
    const text = str(pr[field]);
    if (text) cands.push({ topic, text, source: 'PUBLIC', caseRef: null, date: null });
  }

  const cards: TechnicalCard[] = [];
  for (const topic of TECH_TOPIC_ORDER) {
    const mine = cands.filter((c) => c.topic === topic);
    if (!mine.length) continue;
    // The strongest source states the fact; every source contributes terms.
    const lead = mine.find((c) => c.source === 'OFFICIAL') ?? mine[0];
    const found: Array<{ term: Term; m: RegExpExecArray }> = [];
    for (const c of [lead, ...mine.filter((x) => x !== lead)])
      for (const f of termsIn(topic, c.text)) if (!found.some((x) => x.term.id === f.term.id)) found.push(f);
    // A topic whose text names nothing the glossary knows is not explained by guesswork,
    // except finishes and MEP, where the topic itself is the explanation.
    if (!found.length && topic !== 'FINISHES' && topic !== 'MEP') continue;
    const stated = cleanStated(lead.text);
    if (!stated) continue;
    const t = TOPIC[topic];
    const whatOf = (x: { term: Term; m: RegExpExecArray }) => (typeof x.term.what === 'function' ? x.term.what(x.m) : x.term.what);
    const what = found.length ? found.slice(0, 2).map(whatOf).join(' ') : (TERMS.find((x) => x.topic === topic)?.what as string);
    cards.push({
      topic,
      terms: found.map((f) => f.term.id),
      title: t.title,
      stated,
      source: lead.source,
      caseRef: lead.caseRef,
      date: lead.date,
      what,
      why: t.why,
      buyerMeaning: t.buyerMeaning,
      verify: t.verify,
      establishes: establishesOf(lead.source, lead.date),
      cannotProve: CANNOT_PROVE[topic],
    });
  }
  return cards;
}

/** The persisted cards, read back defensively for the UI. */
export function readTechnicalCards(v: unknown): TechnicalCard[] {
  if (!Array.isArray(v)) return [];
  return (v as Array<Record<string, unknown>>)
    .filter((c) => c && TECH_TOPIC_ORDER.includes(c.topic as TechTopic) && str(c.what) && str(c.title))
    .map((c) => ({
      topic: c.topic as TechTopic,
      terms: Array.isArray(c.terms) ? (c.terms as unknown[]).map(str).filter(Boolean) : [],
      title: str(c.title),
      stated: str(c.stated) || null,
      source: c.source === 'OFFICIAL' ? 'OFFICIAL' : 'PUBLIC',
      caseRef: str(c.caseRef) || null,
      date: str(c.date) || null,
      what: str(c.what),
      why: str(c.why),
      buyerMeaning: str(c.buyerMeaning),
      verify: str(c.verify),
      // Persisted cards from before these two fields get them on read: fixed text, same rule.
      establishes: str(c.establishes) || establishesOf(c.source === 'OFFICIAL' ? 'OFFICIAL' : 'PUBLIC', str(c.date) || null),
      cannotProve: str(c.cannotProve) || CANNOT_PROVE[c.topic as TechTopic],
    }));
}

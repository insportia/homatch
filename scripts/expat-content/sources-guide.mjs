// FOR EXPATS content — sources for the everyday guide topics (topics-guide.mjs).
//
// Same rules as sources.mjs: every page here was OPENED AND READ on
// 2026-10-24, and the excerpt is what it said that day. `official` is true
// only when the publisher is the authority on the thing stated: the
// transport company for its own fares, the registry for its own fees, the
// emergency service for its own number, the national bank for the currency,
// the national tourism administration for its own destination pages.
//
// Two URLs are also cited in sources.mjs (the TTC tariff page and the PwC
// personal income page). They get their own keys here because the excerpt
// read today covers different lines of the same page (payment methods,
// small business status). Same publisher and URL, so the seed keeps one
// citation row for each.
//
// What we could not read is not here: the Georgian Railway site returned
// only its title, the 112 English page returned 404, the National Bank's
// currency page did not state tetri or legal tender, and the Civil Code
// lease chapter could not be reached. The topics say less as a result.

const OBSERVED = '2026-10-24T00:00:00Z';

export const GUIDE_SOURCES = {
  ttcFares: {
    key: 'ttcFares',
    publisher: 'Tbilisi Transport Company',
    url: 'https://ttc.com.ge/en/tariff/10',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Fares for metro, bus, minibus and the Bagebi University ropeway: "1 GEL 90 minutes unlimited free travel"; 3 GEL one day; 20 GEL one week; 40 GEL one month. The 90 minute package can be paid with a Metromoney card or bank cards. Packages of one day and longer only on a subscription card. Paying by mobile app or cash does not give the 90 minute package. Cards sold at metro station payment offices and Bank of Georgia express branches, 2 GEL each; keep the receipt to restore a lost card.',
  },

  tktRailway: {
    key: 'tktRailway',
    publisher: 'TKT.GE (Georgian Railway ticket sales)',
    url: 'https://tkt.ge/en/transport/railway-tickets/tbilisi/batumi',
    // A ticket platform selling the railway's tickets, not the railway.
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Georgian Railway tickets bought online; "Your purchased ticket arrives as a QR code to your email" and is shown on the phone to board. "Passengers must carry a valid ID card or an international passport when traveling by train." Children aged 5 to 10: 50% discount. Routes listed on tkt.ge/railway include Tbilisi to Batumi, Poti, Kutaisi, Ureki and Ozurgeti, with Zugdidi among popular destinations.',
  },

  madlobaBatumiBus: {
    key: 'madlobaBatumiBus',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/faq/city-transport-and-parking/batumi-public-transport-fares/',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Batumi city buses are cheapest with the Batumi Card transport card; a contactless bank card costs more, "about 1 GEL". Municipal buses do not take cash; minibuses do. Fares are set by the municipal company Batumi Autotransport. Checked Oct. 2, 2026.',
  },

  madlobaTaxi: {
    key: 'madlobaTaxi',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/faq/city-transport-and-parking/taxi-in-tbilisi/',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Recommends "the Bolt, Yandex Go or Maxim apps"; with an app "you see the price in advance". Street taxis have no meter, so "agree the fare before you get in". Checked Oct. 2, 2026.',
  },

  madlobaSim: {
    key: 'madlobaSim',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/faq/mobile-and-internet/buying-a-sim-card-in-georgia/',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"You need your passport to buy one, and the operators also offer eSIMs." Three operators: Magti, Silknet and Cellfie (formerly Beeline), with shops including at Tbilisi, Kutaisi and Batumi airports. An eSIM can be had online before arrival with a photo of the passport. "Magti usually has the best coverage in the mountains." Operators change plans often. Checked Oct. 2, 2026.',
  },

  magticomHome: {
    key: 'magticomHome',
    publisher: 'Magticom',
    url: 'https://www.magticom.ge/en',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"eSIM, the latest technologies from Magti!" "Activate eSIM easily via MyMagti APP." "SIM cards for Tourists in Georgian airports!" "Get Magti fiber-optic internet along with Magti IP television and enjoy a discount."',
  },

  madlobaWhereToStay: {
    key: 'madlobaWhereToStay',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/faq/housing/where-to-stay-in-tbilisi/',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"The Old Town is hilly and cobbled, but everything is close by." "Vera and Vake are quieter and greener." "Vake is considered one of the most prestigious residential districts." "Saburtalo suits longer stays, with metro, shops and moderate prices." "Saburtalo and Didube are cheaper with good metro links." Fabrika in Marjanishvili "is lively and full of bars". Checked Oct. 3, 2026.',
  },

  gntaTbilisi: {
    key: 'gntaTbilisi',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/cities-towns/tbilisi',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"historic Old Tbilisi, which was built during the early Middle Ages", a compact walkable core with domed 17th century sulphur baths. Mtatsminda Park, the highest point, "a popular playground for locals and visitors alike", linked to the city by funicular.',
  },

  gntaBatumi: {
    key: 'gntaBatumi',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/cities-towns/batumi',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Batumi is "the best place for a seaside vacation in Georgia", on the south eastern Black Sea coast, the administrative centre of the "Autonomous Republic of Adjara". Recommends a walk along Batumi Boulevard; early autumn is the "velvet season".',
  },

  gntaMtskheta: {
    key: 'gntaMtskheta',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/cities-towns/mtskheta',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Former capital, about 20 minutes by road from Tbilisi, "sometimes called Little Jerusalem". Svetitskhoveli Cathedral (1010 to 1129) and Jvari Church (6th to 7th century). "Three of Mtskheta\'s churches are part of the UNESCO World Heritage List": Jvari, Svetitskhoveli and Samtavro.',
  },

  gntaKakheti: {
    key: 'gntaKakheti',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/regions/kakheti',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Kakheti is "Georgia\'s premiere winegrowing region", with qvevri winemaking and grapes such as Saperavi and Rkatsiteli, and "the palace of King Erekle (Heraclius) II in Telavi".',
  },

  gntaSighnaghi: {
    key: 'gntaSighnaghi',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/cities-towns/sighnaghi',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Sighnaghi was "dubbed a City of Love" after restoration from 2007; a nearly intact fortress wall built in 1762; "breathtaking views of Alazani valley and the Greater Caucasus Mountains".',
  },

  gntaKazbegi: {
    key: 'gntaKazbegi',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/regions/mtskheta-mtianeti',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"After Tbilisi and Batumi, Kazbegi is one of Georgia\'s most popular tourist destinations." Attractions include "the mountain village of Stepantsminda" and "the picture-perfect 14th-century Gergeti Trinity Church" below Kazbegi Mountain (5054m). Gudauri is "the country\'s premier ski resort".',
  },

  gntaSvaneti: {
    key: 'gntaSvaneti',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/regions/samegrelo-zemo-svaneti',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Zemo Svaneti is "a high-mountain region and hotspot of tourism and alpinism"; Mestia is its centre. Svan towers "standing 20 to 25 meters high". Zugdidi is "the main city of Samegrelo", with the Dadiani palace, now a state museum.',
  },

  gntaImereti: {
    key: 'gntaImereti',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/regions/imereti',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"Kutaisi was the capital until the Middle Ages." Gelati is a UNESCO World Heritage monument. Bagrati Cathedral, built in 1003, is "a symbol of the country\'s unity". Prometheus Cave and Sataplia are listed among the "natural wonders worth seeing in Imereti".',
  },

  gntaBorjomi: {
    key: 'gntaBorjomi',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/regions/samtskhe-javakheti',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"One of Georgia\'s most well-known mineral waters has its roots in Borjomi"; visitors can drink from a spring in the central park. Borjomi-Kharagauli National Park has hiking routes of one to three days. Vardzia is "a city and monastery carved into a cliffside".',
  },

  madlobaRentingLaw: {
    key: 'madlobaRentingLaw',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/blog/laws-of-georgia/legal-subtleties-of-renting-in-georgia/',
    official: false,
    publishedOn: '2026-03-04',
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"a written rental agreement is not legally required for short-term or household rentals", but a written record is advisable. Lists "Rights to receive and return a deposit" (Civil Code Article 537). "Notarization is needed only in certain situations", such as residence permit applications and registration at a place of residence. Updated Sept. 27, 2026.',
  },

  madlobaRentHousing: {
    key: 'madlobaRentHousing',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/blog/real-estate-in-georgia/rent-housing-in-georgia-how-to-rent-where-to-look-how-much-does-it-cost/',
    official: false,
    publishedOn: '2026-04-10',
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Long term: a contract is often required, with a deposit of one to two months (the page writes "1 to 2" with a dash). Apartments: "Utilities are usually paid separately." "Don\'t sign a contract immediately." Updated October 19, 2026.',
  },

  naprRegistry: {
    key: 'naprRegistry',
    publisher: 'National Agency of Public Registry',
    url: 'https://napr.gov.ge/en',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Registry services listed: "Real Estate Registry", "Extract from the public register", "Information from the Register of Restrictions, Liens and Leases", "Business Registry".',
  },

  naprFees: {
    key: 'naprFees',
    publisher: 'National Agency of Public Registry',
    url: 'https://napr.gov.ge/en/page/fees-and-terms',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Registration of an individual entrepreneur: 1 working day, 26 GEL; on the day of filing the application, 75 GEL. Registration of an entrepreneur (except for an individual entrepreneur): 1 working day, 200 GEL; on the day of filing the application, 400 GEL. (The page separates term and fee with a dash.)',
  },

  investGeorgiaRegister: {
    key: 'investGeorgiaRegister',
    publisher: 'Invest in Georgia',
    url: 'https://www.investingeorgia.org/resources/how-to-register-a-business/',
    // A government investment agency describing another agency's process.
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"The registration is carried out by the National Agency of Public Registry." "all services needed for the business registration are provided by the Public Registry through the Public Service Hall." Founders\' charter signed, notarised and apostilled or legalised; proof of a legal address, a lease or landlord letter notarised by a Georgian notary unless signed before a Public Registry representative.',
  },

  pwcSmallBusiness: {
    key: 'pwcSmallBusiness',
    publisher: 'PwC Worldwide Tax Summaries',
    url: 'https://taxsummaries.pwc.com/georgia/individual/taxes-on-personal-income',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Individual entrepreneurs under the GEL 500,000 turnover limit "may register as a small business", taxed at 1% of turnover; "The rate increases to 3% if annual turnover will exceed GEL 500,000." "Individuals with annual turnover of less than 30,000 Georgian lari (GEL), no employees, and who register as a micro business will be exempt from tax on their business income."',
  },

  pwcVat: {
    key: 'pwcVat',
    publisher: 'PwC Worldwide Tax Summaries',
    url: 'https://taxsummaries.pwc.com/georgia/corporate/other-taxes',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'A person "must register as a VAT payer when its taxable turnover exceeds 100,000 Georgian lari (GEL)".',
  },

  police112: {
    key: 'police112',
    publisher: '112 Georgia (LEPL of the Ministry of Internal Affairs)',
    url: 'https://112.gov.ge/?p=1715',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"Any situation that requires the assistance of Police, Ambulance and/or Fire/Rescue teams, is considered as emergency." Works "24/7 throughout the whole country", "since 2012". Reachable from "Cell phones without SIM cards", "From fixed phone with negative balance" and "From cell phone with negative balance".',
  },

  madlobaHealth: {
    key: 'madlobaHealth',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/faq/healthcare-and-insurance/',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'Ambulance, police and fire "on the single number 112, free from any phone, even without a SIM card". Medical tests are done at private laboratories and multi-specialty clinics, and "most don\'t require a doctor\'s referral". Checked Oct. 3, 2026.',
  },

  madlobaTapWater: {
    key: 'madlobaTapWater',
    publisher: 'Madloba.info',
    url: 'https://madloba.info/en/faq/healthcare-and-insurance/can-you-drink-tap-water-in-georgia/',
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'In Tbilisi and Batumi "the water utilities say tap water meets drinking standards"; older buildings may have worn pipes, so a filter or bottled water is safer there. In villages and mountains spring water "quality is not always tested". Checked Oct. 3, 2026.',
  },

  nbgLari: {
    key: 'nbgLari',
    publisher: 'National Bank of Georgia',
    url: 'https://nbg.gov.ge/en/georgian-money/georgian-lari',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      'The lari is "the basic monetary unit of the Georgian national currency". Coins listed include 50 tetri, 1 lari and 2 lari.',
  },

  gntaTipping: {
    key: 'gntaTipping',
    publisher: 'Georgian National Tourism Administration (georgia.travel)',
    url: 'https://georgia.travel/coming-to-georgia/tipping-culture-in-georgia',
    // Tipping is a custom. Nobody is the authority on it.
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: OBSERVED,
    language: 'en',
    excerpt:
      '"In general, between 10% and 15% of the amount you paid for the service is an optimal tip." "But it depends on you, how much are you willing to pay, and how much you can tip." Tips can be added on Bank of Georgia or TBC Bank cards at the card terminal.',
  },
};

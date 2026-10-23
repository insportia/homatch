// Location F5 fixtures (2026-10-22), copied from production research_jobs
// (read-only SELECT), cut down to the fields the centre resolver reads.
//
// Nothing personal is kept: the registry extracts (owners, ID numbers) and the
// NAPR GetBlob URLs (bearer-like tokens) are dropped. What remains is the
// worker's own envelope, two document titles and the texts of a cadastral
// plan and a situational drawing, which carry only the parcel code, its area,
// UTM grid labels and NAPR's office address.

/* Job 61c1c38c-9e74-4785-bc75-5f4aaa6253e6, cadastral 01.14.07.001.044,
   "ქალაქი თბილისი, წყნეთის გზატკეცილი N31". The TAS_MAP verify_task result
   (SUCCEEDED after 2 attempts) exactly as it reached result_json.browserOfficial,
   minus the fields named above. Note: no ms.gov.ge URL but the start view. */
export const REF_JOB_ID = '61c1c38c-9e74-4785-bc75-5f4aaa6253e6';
export const REF_PARCEL = '01.14.07.001.044';
export const REF_ADDRESS = 'თბილისი, წყნეთის გზატკეცილი 31';

export const REF_TAS_MAP_RESULT = {
  source: 'TAS_MAP',
  sourceName: 'TAS Cadastral Map',
  sourceClass: 'OFFICIAL_GOVERNMENT',
  status: 'SEARCH_CONFIRMED',
  queryEntered: '01.14.07.001.044',
  searchControlUsed: 'input[name="searchText"]',
  submitAction: 'ENTER_KEY_THEN_SUGGESTION_CLICK',
  sourceUrl: 'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19',
  startUrl: 'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19',
  finalUrl: 'http://abstract.reestri.gov.ge/abstract/cad_amo.php?cad_code=01.14.07.001.044',
  frameUrls: [],
  resultContext: 'TAS_MAP FSM reached TAS_MAP_EXHAUSTED',
  retrievedAt: '2026-10-22T11:57:45.881Z',
  documents: [
    {
      title: 'NAPR registration 882025596274',
      source: 'TAS_MAP_NAPR_REGISTRATION',
      rawText: '\n\n483570483600483630483660483690483720483750\n4621770\n4621800\n4621830\n4621860\n4621890\n4621920\n4621950\n4621980\n1:1,204\n-\n0510152.5\nmetri\nmasStabi\nsajaro reestris erovnuli saagento q.Tbilisi vaxtang gorgaslis  q. # 22 tel.: (995 32) 91 04 27; faqsi: (995 32) 91 03 41\nSenoba-nageboba,\npirobiTi nomeri/sarTulianoba\nmiwis nakveTis sakadastro sazRvari\n!!!!!\n!!!!!\n!!!!!\nvaldebuleba\nmSenebare nageboba\nxazobrivi nageboba\nUTM\n(saerTaSoriso)\nsistemis koord.\n0.00\n0.00\nwww.napr.gov.ge\n01/2\nmiwisqveSa nageboba\n30.05.2025\nmomzadebis TariRi\nsaqarTvelos iusticiis saministro\nsajaro reestris erovnuli saagento\n________________________________________\nsituaciuri naxazi\ngancxadebis registraciis nomeri: 882025596274\nwarmosagenia  27/05/2025 14:26:29  qaRaldis versiis Sesabamisi el versi ',
    },
    {
      title: 'NAPR registration 892024029550',
      source: 'TAS_MAP_NAPR_REGISTRATION',
      rawText: '\n\n7/26/2024\nfile:///tmp/tomcat8-tomcat8-tmp/437784d0-4752-4734-b7b0-55feeef43993.html1/1\n \nსაკადასტრო გეგმა\nსაჯარო რეესტრის ეროვნული\n \nსააგენტო\nსაკადასტრო კოდი:\n01.14.07.001.044\nგანცხადების ნომერი:892024029550\nმომზადების თარიღი:26/07/2024\nნაკვეთის დანიშნულება:არასასოფლო სამეურნეო\nფართობი:2509 კვ.მ (WGS 84 / UTM zone 38N)\nN\n0\n1\n.\n0\n0\n.\n3\n8\n8\n0\n1\n.\n0\n4\n.\n3\n2\n7\n02/\n01/7\nპირობითი აღნიშვნები:\nნაკვეთის საზღვარიმშენებარე ნაგებობა\n02/4\nაშენებული ნაგებობამიწისქვეშა ნაგებობა\nხაზობრივი ნაგებობატყის ფონდივალდებულებაქარსაფარი ზოლი\nსაჯარო რეესტრის ეროვნული სააგენტო:ქ. თბილისი, ვახტანგ გორგასლის ქუჩა, 22; ტელ: (995 32) 2 25 15 28; http://napr.gov.ge',
    },
  ],
};

/* The same job's stored synthesis_json.location (V1 shape), places trimmed to two. */
export const REF_STORED_LOCATION = {
  city: 'თბილისი',
  street: 'საბავშვო მოედანი',
  minimal: false,
  nearby: [
    { name: 'Carrefour', note: 'საჯარო აღწერაში პროექტის ახლომდებარე კომერციულ ინფრასტრუქტურად არის ჩამოთვლილი.', whyKey: 'verify_place_why_supermarket', category: 'SUPERMARKET' },
    { name: 'კუს ტბა', note: 'საჯარო აღწერაში პროექტთან დაკავშირებულ დასასვენებელ მიმართულებად არის მითითებული.', whyKey: 'verify_place_why_park', category: 'PARK' },
  ],
  neighborhood: {
    stops: [], center: null, counts: {}, places: [], routes: [], source: 'OSM', status: 'NO_LOCATION', osmBase: null,
    radiusM: 1000, version: 1, fetchedAt: '2026-10-22T12:10:51.939Z', licenseUrl: 'https://www.openstreetmap.org/copyright',
    attribution: '© OpenStreetMap contributors', stopRadiusM: 600, routesWithoutRef: 0,
  },
};

/* ONE manual live Nominatim lookup of the reference address (2026-10-22, from
   a workstation, the production User-Agent), recorded so no test calls it:
   house 31 on Tskneti highway, Bagebi, at house precision. */
export const REF_NOMINATIM = [{
  place_id: 208556559, osm_type: 'way', osm_id: 1044161003, lat: '41.7102748', lon: '44.7311562',
  category: 'building', type: 'apartments', place_rank: 30, addresstype: 'building', name: '',
  display_name: '31, წყნეთის გზატკეცილი, ბაგები, ვაკე, ვაკის რაიონი, თბილისი, 1062, საქართველო',
}];

/* Legacy cadastral plans ("sakadastro gegma") that print the parcel code in pieces. */
export const DIGOMI_PARCEL = '01.72.14.040.030';
export const DIGOMI_LEGACY_PLAN = '\n\n47865 047870 0\n46259 50\n46260 00\n1:500\n-\n02461\nmetri\nmasStabi\nsajaro reestris erovnuli saagento Tbilisi 0102 wm. nikolozis/n. CxeiZis q. 2 tel.: (995 32) 91 04 27; faqsi: (995 32) 91 03 41\nSenoba-nageboba,\npirobiTi nomeri/sarTulianoba\nmiwis nakveTis sakadastro sazRvari\n!!!!!\n!!!!!\n!!!!!\nvaldebuleba\nmSenebare nageboba\nxazobrivi nageboba\nUTM\n(saerTaSoriso)\nsistemis koord.\n0.00\n0.00\nwww.napr.gov.ge\n01/2\nsajaro reestris erovnuli saagento Tbilisi d. aRmaSeneblis gamz. 89/24 tel: (995 32) 94 13 65\nmiwisqveSa nageboba\n040.03014.01.72.\nsasoflo-sameurneo\n1400\n  kv.m.\nsajaro reestris erovnuli saagento\n07.09.12\n882012689917\nsakadastro gegma\nmomzadebis TariRi\nmiwis nakveTis sakadastro kodi:\ngancxadebis registraciis nomeri:\ndaniSnuleba:\nmiwis nakveTis farTobi:\nsaqarTvelos iusticiis saministro';
/* The modern-plan centre stored for that parcel (jobs eeefada9 / dbf04e48). */
export const DIGOMI_PLAN_CENTER = { lat: 41.78529418768781, lng: 44.74318695384861 };

export const KRTSANISI_PARCEL = '01.18.06.019.055';
export const KRTSANISI_LEGACY_PLAN = '\n\n1/ 1\n2/ 2\n3/ 1\n5/ 1\n4/ 1\n485400485450\n4613850\n4613900\n1:500\n-\n048122\nmetri\nmasStabi\nsajaro reestris erovnuli saagento Tbilisi 0102 wm. nikolozis/n. CxeiZis q. 2 tel.: (995 32) 91 04 27; faqsi: (995 32) 91 03 41\nSenoba-nageboba,\npirobiTi nomeri/sarTulianoba\nmiwis nakveTis sakadastro sazRvari\n!!!!!\n!!!!!\n!!!!!\nvaldebuleba\nmSenebare nageboba\nxazobrivi nageboba\nUTM\n(saerTaSoriso)\nsistemis koord.\n0.00\n0.00\nwww.napr.gov.ge\n01/2\nsajaro reestris erovnuli saagento Tbilisi d. aRmaSeneblis gamz. 89/24 tel: (995 32) 94 13 65\nmiwisqveSa nageboba\n019.055\n06.\n01.18.\narasasoflo-sameurneo\n2145\n  kv.m.\nsajaro reestris erovnuli saagento\n22.03.13\n882013110065\nsakadastro gegma\nmomzadebis TariRi\nmiwis nakveTis sakadastro kodi:\ngancxadebis registraciis nomeri:\ndaniSnuleba:\nmiwis nakveTis farTobi:\nsaqarTvelos iusticiis saministro';
/* The ms.gov.ge map centre an earlier check of that parcel stored. */
export const KRTSANISI_MAP_CENTER = { lat: 41.6765159, lng: 44.8246494 };

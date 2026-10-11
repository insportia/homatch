// The REAL official visual set of the .601 report (Villion, Krtsanisi St 6,
// job 8ba97da9, read-only production SQL 2026-10-11): the 24 gallery records,
// the newest case's stored pictures that never reached the gallery, the case
// filing dates, and a ledger excerpt with the budget-skipped images.
// No personal data: TAS document / file ids, public file names, pixel and
// byte sizes only.

const g = (id, kind, category, documentId, attachedFileId, fileName, width, height, bytes, extraction, versionStatus, role = 'SUPPORTING') => ({
  id: id.padEnd(64, '0').slice(0, 64), kind, category, role, documentId, attachedFileId, fileName, width, height, bytes, extraction,
  versionStatus, scope: 'PROJECT', mime: 'image/jpeg', date: null,
});

/** synthesis_json.officialVisuals (24), with each record's byte size from tasApi.visuals. */
export const GALLERY_24 = [
  g('3c76482289e9f62b138bea23e726d184d2966acc1c83c0bf6645b3654b615cd0', 'RENDER', 'BUILDING', '919535', '3807085', '05.effectsResult.jpg', 2200, 1613, 2848212, 'NATIVE_IMAGE', 'HISTORICAL_APPROVED', 'LATEST_RENDER'),
  g('25eade9c805a4780ea7fd89540ada437504295f20bf0bce792044d9bc4691eaa', 'RENDER', 'BUILDING', '919535', '3807186', '022.effectsResult.jpg', 2200, 1442, 2525219, 'NATIVE_IMAGE', 'HISTORICAL_APPROVED'),
  g('27a40253ed091144f8eb4ad14531763aa833b84a6998463f41409db0ee7d1f40', 'PHOTO', 'BUILDING', '639208', '2344309', 'photos gapi.pdf', 1500, 844, 234535, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('8ef96027cb4e7bf1783394671a47435d703d1075d6eaffe78cfae4853f2d03a2', 'PHOTO', 'BUILDING', '639208', '2344309', 'photos gapi.pdf', 1500, 844, 320595, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('af5298ee0c70d8439a003fc12fcf73bce839cb5658b0358b2df7147bf7e083ec', 'PHOTO', 'BUILDING', '639208', '2344309', 'photos gapi.pdf', 1500, 844, 173755, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('f45589d7022c66074f39fded0158b8bbe6b203e3b08c901d6031f14367a6dafc', 'PHOTO', 'BUILDING', '639208', '2344309', 'photos gapi.pdf', 1500, 844, 327552, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('d3befb077382e41df58a2fdb0532e75b0bb801778ef8795e48f3a95d51a859ff', 'ELEVATION', 'ARCHITECTURE', '919535', '3804268', '04. elevations.pdf', 600, 600, 10621, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('2028a05b249f914b28048d3b5e540faea95692d2d54fc2f45acab1e51cc98ae5', 'STRUCTURAL', 'STRUCTURE', '919535', '3894496', '13. geologia, eqspertiza, konstruqciebis eqspertiza.pdf', 1248, 1719, 109976, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('5f80ed72242f4b6d4362e4a4629f3a9ad951f556fb28011f84e55a328b1862df', 'STRUCTURAL', 'STRUCTURE', '919535', '3894496', '13. geologia, eqspertiza, konstruqciebis eqspertiza.pdf', 681, 835, 37029, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('5a6cc242cca374164c8effeacf0867817668068ae2b8f64e0a3a22b4db3f4288', 'OTHER', 'BUILDING', '919535', '3807187', 'Krtsanisi 05.jpg', 3264, 2448, 4884790, 'NATIVE_IMAGE', 'HISTORICAL_APPROVED'),
  g('5a0e3ab9b940e701a131140516184bd7e47f115e890b3c8f482a93eaa9d43687', 'ENGINEERING', 'STRUCTURE', '919535', '3872832', '10. TELASI, GWP, ENERGY - საინჟინრო.pdf', 720, 1600, 129625, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('18002e555185eed1f589426a7935b9be73b042ac5a8e69b666ed6ab95966d8ba', 'ENGINEERING', 'STRUCTURE', '919535', '3872832', '10. TELASI, GWP, ENERGY - საინჟინრო.pdf', 720, 1040, 98989, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('37d742171fc15031b059ab03c14c570f94111098e14aa84510666fd17f0e5526', 'PHOTO', 'BUILDING', '639208', '2392942', 'Photos Taxacia 1+.pdf', 2160, 2160, 2037296, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('5fc8a194637c865de5f05f63f4fc425d9af975df92eba9754fedda2df1a93e32', 'PHOTO', 'BUILDING', '639208', '2392942', 'Photos Taxacia 1+.pdf', 2160, 2160, 3012155, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('8bdecb8be5367b238759e160ab14c5420df31dafc0abd1709a7797d4e4cc1ed9', 'PHOTO', 'BUILDING', '639208', '2392942', 'Photos Taxacia 1+.pdf', 2160, 2160, 1988613, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('97c6a9ba21e7bc6c82d3e934a1dd82addfefd1d3c731a4d2020739e68cc109ca', 'PHOTO', 'BUILDING', '639208', '2392942', 'Photos Taxacia 1+.pdf', 2160, 2160, 2620752, 'PDF_EMBEDDED_IMAGE', 'HISTORICAL_APPROVED'),
  g('6a4affd1cf5d9fbcbdcfe48931e2301b43b0a52f53813245cfa3045ef8b0150b', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 507331, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('c8dc85b529fc55bc4c41a46ef31f4671c2dac47b3fb0591458f873473a779028', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 496470, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('cd65d3a1d161d9c05c50df4c1f591aa4c0d929b13a9d79c7e52095fb450f3ab1', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 628154, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('446d7afd86e683f710e379da43cb89927c5eceff384103b43e813523cd3dd227', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 551456, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('06d91eb8bb8dcf3f3d6ed3a21bbac5da2237c509819545814d49a987c9b21c8f', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 460564, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('a21a1b526421382267ae9f2937c901b3bb5881c471fb835a2d133fb8e62838f3', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 470721, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('777015fef7929c6f549fc08633f5d229f958412d839afeaecec15a947f226e37', 'PHOTO', 'BUILDING', '1161121', '5418977', 'ფოტოები.pdf', 739, 1600, 596118, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
  g('9c4f8fb14d6d12a99940fdeb2bb754a8a97975c5d9ea65afbf32e787e19f31a0', 'FACADE', 'ARCHITECTURE', '1161121', '5418981', 'ფასადები.pdf', 4856, 4857, 790741, 'PDF_EMBEDDED_IMAGE', 'UNDETERMINED'),
];

/** The two grey / near-empty Architecture thumbnails the owner saw. */
export const BLANK_IDS = [GALLERY_24[6].id, GALLERY_24[23].id];

const p = (id, kind, attachedFileId, fileName, width, height, bytes, extraction) => ({
  ...g(id, kind, kind === 'FACADE' ? 'ARCHITECTURE' : 'BUILDING', '1161121', attachedFileId, fileName, width, height, bytes, extraction, 'UNDETERMINED'),
  stored: true, priority: 1,
});

/** tasApi.priorityVisuals of case 1161121 that never reached the gallery (a selection of the 28). */
export const PRIORITY_STORED_NOT_IN_GALLERY = [
  p('23fa6d8a8baa42febff715086c351bccdac56e80d5c5ddc61bb75b9680668602', 'OTHER', '5418987', '1.jpg', 12000, 6750, 2982866, 'NATIVE_IMAGE'),
  p('7004e3c89cd2e0fd9f87d87bbf56ad1c324fe0bd6804998ad0edff0ce0d1fcb6', 'OTHER', '5418988', '2.jpg', 12000, 6750, 4487212, 'NATIVE_IMAGE'),
  p('d2fed051665827182fcdba29a7fe12ea88fd5a1eafc9d0e5589dc9e0617ed4da', 'OTHER', '5418989', '3.jpg', 12000, 6750, 3780979, 'NATIVE_IMAGE'),
  p('86f686b8de46ff42c590c49f2f6916f1888f1ee2c4d2ed93f561682f2731e9d4', 'FACADE', '5418981', 'ფასადები.pdf', 4828, 4828, 780665, 'PDF_EMBEDDED_IMAGE'),
  p('ce38789a8c88c79cf6ff1d1aa5c4236461f1542d2b21ee3deafd9cda7bfe380e', 'FACADE', '5418981', 'ფასადები.pdf', 681, 682, 31006, 'PDF_EMBEDDED_IMAGE'),
  p('f0e2cff4a749d7977e830662c7ac6a800485d0c43312d669eeefb01fe97ff110', 'OTHER', '5418983', 'ძველი მონტაჟი.pdf', 3508, 4656, 2607414, 'PDF_EMBEDDED_IMAGE'),
  p('8ba54326aa819a61b7b1c982b6b01349c36d4c2084178450c7fde37d3c13b096', 'OTHER', '5418986', 'momijnave.pdf', 1700, 2200, 90476, 'PDF_EMBEDDED_IMAGE'),
  // Also in the gallery (the same picture filed twice): never appended twice.
  p('6a4affd1cf5d9fbcbdcfe48931e2301b43b0a52f53813245cfa3045ef8b0150b', 'PHOTO', '5418977', 'ფოტოები.pdf', 739, 1600, 507331, 'PDF_EMBEDDED_IMAGE'),
];

/** synthesis_json.officialDocuments: case filing dates by TAS document id. */
export const CASE_DATES = {
  1161121: { caseRef: 'AR11161121', date: '2026-09-17' },
  1148112: { caseRef: 'AR11148112', date: '2026-06-17' },
  1101896: { caseRef: 'AR11101896', date: '2025-07-29' },
  1084312: { caseRef: 'AR11084312', date: '2025-04-03' },
  942605: { caseRef: 'AR1942605', date: '2022-12-30' },
  919535: { caseRef: 'AR1919535', date: '2022-08-26' },
  639208: { caseRef: 'AR1639208', date: '2018-12-07' },
};

const att = (attachedFileId, fileName, outcome, extra = {}) => ({ attachedFileId, fileName, outcome, format: /\.jpe?g$/i.test(fileName) ? 'jpg' : 'pdf', motionId: null, date: null, ...extra });

/** A result_json shaped like the real one (tasApi.cases[].attachments ledger excerpt). */
export function resultJson601() {
  return {
    officialVisuals: GALLERY_24.map((v) => ({ ...v, storagePath: `tas/${v.id}.jpg`, bytes: undefined })),
    browserOfficial: {
      results: [
        { source: 'mygov' },
        {
          source: 'tas',
          tasApi: {
            searchCadastralCode: '01.18.06.019.055',
            visuals: GALLERY_24.map((v) => ({ ...v, stored: true })),
            priorityVisuals: PRIORITY_STORED_NOT_IN_GALLERY,
            accounting: { attachmentOutcomes: { IMAGE: 6, NOT_PROCESSED_BUDGET: 43, READ_TEXT: 273 } },
            ledger: { deferred: { attachmentsBudget: 43, attachmentsPriority: 0 } },
            cases: [
              {
                documentId: '1161121', registrationNumber: 'AR11161121', date: '2026-09-17', priority: 1, title: 'მშენებლობის ნებართვის ცვლილება', cadastralCodes: ['01.18.06.019.055'],
                attachments: [att('5418987', '1.jpg', 'IMAGE'), att('5418988', '2.jpg', 'IMAGE'), att('5418989', '3.jpg', 'IMAGE'), att('5418977', 'ფოტოები.pdf', 'SCAN_OR_IMAGE_ONLY')],
              },
              {
                documentId: '1084312', registrationNumber: 'AR11084312', date: '2025-04-03', title: 'პროექტის ცვლილება', cadastralCodes: ['01.18.06.019.055'],
                attachments: [att('4850052', '1.jpg', 'NOT_PROCESSED_BUDGET'), att('4850053', '2.jpg', 'NOT_PROCESSED_BUDGET'), att('4850054', '3.jpg', 'NOT_PROCESSED_BUDGET'), att('4850099', 'განმარტებითი ბარათი.pdf', 'NOT_PROCESSED_BUDGET')],
              },
              {
                documentId: '919535', registrationNumber: 'AR1919535', date: '2022-08-26', title: 'არქიტექტურული პროექტი', cadastralCodes: ['01.18.06.019.055'],
                attachments: [att('3807085', '05.effectsResult.jpg', 'IMAGE'), att('3872813', 'Krtsanisi 02.jpg', 'NOT_PROCESSED_BUDGET'), att('3872814', 'Krtsanisi 03.jpg', 'NOT_PROCESSED_BUDGET')],
              },
            ],
          },
        },
      ],
    },
  };
}

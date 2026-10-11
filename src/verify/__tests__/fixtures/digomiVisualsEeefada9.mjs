// The REAL official visual set of the Digomi report (job eeefada9, Kristian
// Stiven St 18, read-only production SQL 2026-10-11): the 12 gallery records
// (ids are the first 12 hex chars, padded), the case filing dates of
// synthesis_json.officialDocuments, and a ledger excerpt of
// tasApi.cases[].attachments with the outcomes the run recorded.
// No personal data: TAS document / file ids, public file names, pixel and
// byte sizes only.

const g = (id, kind, category, documentId, attachedFileId, fileName, width, height, bytes, extraction) => ({
  id: id.padEnd(64, '0'), kind, category, role: 'SUPPORTING', documentId, attachedFileId, fileName, width, height, bytes, extraction,
  versionStatus: 'UNDETERMINED', scope: 'PROJECT', mime: 'image/jpeg', date: null,
  confidence: kind === 'OTHER' ? 0.35 : /fotomontaji/.test(fileName) ? 0.8 : kind === 'RENDER' ? 0.9 : 0.85,
});

/** synthesis_json.officialVisuals (12) as stored by logic v5. */
export const DIGOMI_GALLERY_12 = [
  g('33ec4a7d57bf', 'RENDER', 'BUILDING', '144566', '415285', 'Render.pdf', 2036, 1232, 173504, 'PDF_EMBEDDED_IMAGE'),
  g('1693a1e85698', 'PHOTO', 'BUILDING', '95157', '249565', 'foto.pdf', 1920, 1080, 779304, 'PDF_EMBEDDED_IMAGE'),
  g('df638b6c82e3', 'PHOTO', 'BUILDING', '95157', '249565', 'foto.pdf', 1920, 1080, 795128, 'PDF_EMBEDDED_IMAGE'),
  g('67595eecfb2f', 'PHOTO', 'BUILDING', '95157', '249565', 'foto.pdf', 1920, 1080, 828083, 'PDF_EMBEDDED_IMAGE'),
  g('e51844adecc9', 'PHOTO', 'BUILDING', '95157', '249565', 'foto.pdf', 1920, 1080, 823272, 'PDF_EMBEDDED_IMAGE'),
  g('f0a7ff7014d4', 'STRUCTURAL', 'STRUCTURE', '1022993', '4535555', 'ენერგო ეფექტურობა-საინჟინრო კომუნიკაცია-კონსტრუქცია.pdf', 2479, 3508, 250777, 'PDF_EMBEDDED_IMAGE'),
  g('eb413019d363', 'STRUCTURAL', 'STRUCTURE', '1022993', '4535555', 'ენერგო ეფექტურობა-საინჟინრო კომუნიკაცია-კონსტრუქცია.pdf', 1192, 1017, 202099, 'PDF_EMBEDDED_IMAGE'),
  g('74f397a17eed', 'OTHER', 'BUILDING', '95157', '252210', 'f5uo5 copy.jpg', 2855, 1963, 1321309, 'NATIVE_IMAGE'),
  g('4d7755716a5e', 'PHOTO', 'BUILDING', '95157', '252213', 'fotomontaji da aqsiometriuli xedebi.pdf', 6000, 3375, 6266893, 'PDF_EMBEDDED_IMAGE'),
  g('115cc0d27ffb', 'PHOTO', 'BUILDING', '95157', '252213', 'fotomontaji da aqsiometriuli xedebi.pdf', 2855, 1963, 1164870, 'PDF_EMBEDDED_IMAGE'),
  g('9b42cbfddec5', 'PHOTO', 'BUILDING', '95157', '252213', 'fotomontaji da aqsiometriuli xedebi.pdf', 2855, 1963, 952256, 'PDF_EMBEDDED_IMAGE'),
  g('403b53afc4db', 'PHOTO', 'BUILDING', '95157', '252213', 'fotomontaji da aqsiometriuli xedebi.pdf', 2855, 1963, 870744, 'PDF_EMBEDDED_IMAGE'),
];
/** The blank structural layer (quality gate: never customer-visible). */
export const DIGOMI_BLANK_ID = DIGOMI_GALLERY_12[5].id;

/** synthesis_json.officialDocuments: case refs and filing dates by TAS document id. */
export const DIGOMI_CASES = {
  79674: { caseRef: 'AR179674', date: '2012-09-12' },
  81025: { caseRef: 'AR181025', date: '2012-09-18' },
  95157: { caseRef: 'AR195157', date: '2012-12-04' },
  137104: { caseRef: 'AR1137104', date: '2013-06-07' },
  144566: { caseRef: 'AR1144566', date: '2013-07-06' },
  980594: { caseRef: 'AR1980594', date: '2023-07-26' },
  1014318: { caseRef: 'AR11014318', date: '2024-02-07' },
  1022993: { caseRef: 'AR11022993', date: '2024-03-12' },
  1051702: { caseRef: 'AR11051702', date: '2024-08-05' },
  1059939: { caseRef: 'AR11059939', date: '2024-09-30' },
  1078892: { caseRef: 'AR11078892', date: '2025-02-20' },
  1087185: { caseRef: 'AR11087185', date: '2025-04-14' },
  1110027: { caseRef: 'AR11110027', date: '2025-09-23' },
  1136621: { caseRef: 'AR11136621', date: '2026-04-01' },
  1143236: { caseRef: 'AR11143236', date: '2026-05-18' },
};

const att = (attachedFileId, fileName, outcome) => ({
  attachedFileId, fileName, outcome, format: /\.jpe?g$/i.test(fileName) ? 'jpeg' : /\.tif$/i.test(fileName) ? 'tif' : 'pdf', motionId: null, date: null, sha256: null,
});
const kase = (documentId, attachments) => ({
  documentId, registrationNumber: DIGOMI_CASES[documentId].caseRef, date: `${DIGOMI_CASES[documentId].date}T10:00:00.000Z`,
  title: 'მშენებლობის ნებართვა', cadastralCodes: ['01.72.14.040.030'], attachments,
});

/** A result_json shaped like the real one (the visual part of the ledger, verbatim names and outcomes). */
export function digomiResultJson() {
  return {
    officialVisuals: DIGOMI_GALLERY_12.map((v) => ({ ...v, storagePath: `tas/${v.id}.jpg` })),
    browserOfficial: {
      results: [{
        source: 'tas',
        tasApi: {
          searchCadastralCode: '01.72.14.040.030',
          visuals: DIGOMI_GALLERY_12.map((v) => ({ ...v, stored: true })),
          priorityVisuals: [],
          accounting: { attachmentOutcomes: { IMAGE: 25, NOT_PROCESSED_BUDGET: 67, SCAN_OR_IMAGE_ONLY: 32, READ_TEXT: 80 } },
          ledger: { deferred: { attachmentsBudget: 67, attachmentsPriority: 0 } },
          cases: [
            kase('79674', [att('193982', 'montaji pdf.pdf', 'SCAN_OR_IMAGE_ONLY'), att('198126', 'diRomi.TIF', 'NOT_PROCESSED_BUDGET')]),
            kase('81025', [att('199617', 'montajii.pdf', 'SCAN_OR_IMAGE_ONLY')]),
            kase('95157', [
              att('249565', 'foto.pdf', 'SCAN_OR_IMAGE_ONLY'), att('252213', 'fotomontaji da aqsiometriuli xedebi.pdf', 'SCAN_OR_IMAGE_ONLY'),
              att('252210', 'f5uo5 copy.jpg', 'IMAGE'), att('252211', 'f5uo6 copy.jpg', 'IMAGE'), att('252212', 'f5uo7 copy.jpg', 'IMAGE'),
              att('250105', 'fasadebi z.pdf', 'SCAN_OR_IMAGE_ONLY'), att('249540', 'posi zura.pdf', 'SCAN_OR_IMAGE_ONLY'),
            ]),
            kase('137104', [att('387872', '10.jpg', 'IMAGE'), att('387873', '11.jpg', 'IMAGE'), att('387874', '12.jpg', 'IMAGE')]),
            kase('144566', [att('415285', 'Render.pdf', 'READ_TEXT'), att('415727', 'R-001.jpg', 'IMAGE'), att('415728', 'R-002.jpg', 'IMAGE'), att('426143', 'House.jpg', 'IMAGE'), att('415724', 'photo.pdf', 'SCAN_OR_IMAGE_ONLY')]),
            kase('980594', [att('4182847', 'ფოტო.pdf', 'SCAN_OR_IMAGE_ONLY'), att('4182934', 'მინდობილობა.pdf', 'SCAN_OR_IMAGE_ONLY')]),
            kase('1014318', [att('4402953', '2.jpg', 'IMAGE'), att('4402954', '3.jpg', 'IMAGE'), att('4402955', '4.jpg', 'IMAGE'), att('4402952', 'არსებული ფოტოები.pdf', 'SCAN_OR_IMAGE_ONLY'), att('4402950', 'fotomontaji.pdf', 'READ_TEXT')]),
            kase('1022993', [att('4444786', '2.jpg', 'IMAGE'), att('4444787', '3.jpg', 'IMAGE'), att('4444788', 'მონტაჟი2-1.jpg', 'IMAGE'), att('4444741', 'ფოტოები.pdf', 'SCAN_OR_IMAGE_ONLY'), att('4535555', 'ენერგო ეფექტურობა-საინჟინრო კომუნიკაცია-კონსტრუქცია.pdf', 'READ_TEXT')]),
            kase('1051702', [att('4625008', 'ფოტო 05-08.pdf', 'SCAN_OR_IMAGE_ONLY'), att('4625005', 'მინდობილობა (2).pdf', 'SCAN_OR_IMAGE_ONLY'), att('4630001', 'დემონტაჟის ორგანიზაციის პროექტის ექსპერტიზა-signed.pdf', 'READ_TEXT')]),
            kase('1059939', [att('4679257', 'ფოტო 05-08.pdf', 'NOT_PROCESSED_BUDGET'), att('4679256', 'ექსპერტიზა კონსტრუქცია.pdf', 'NOT_PROCESSED_BUDGET')]),
            kase('1078892', [
              att('4836470', 'რენდ1.jpg', 'IMAGE'), att('4836471', 'რენდ2.jpg', 'IMAGE'), att('4836472', 'რენდ3.jpg', 'IMAGE'),
              att('4813465', '1.jpg', 'IMAGE'), att('4813466', '2.jpg', 'IMAGE'), att('4813467', '3.jpg', 'IMAGE'),
              att('4836469', 'ფოტომონტაჟი.pdf', 'NOT_PROCESSED_BUDGET'), att('4813437', 'ფასადები 20.02.pdf', 'NOT_PROCESSED_BUDGET'), att('4836403', 'ფასადები 14,03.pdf', 'NOT_PROCESSED_BUDGET'),
              att('4850914', 'კორექტირებული პროექტის ექსპერტიზა 030-signed.pdf', 'NOT_PROCESSED_BUDGET'),
            ]),
            kase('1087185', [att('4867063', 'ფოტო 14-04-2025.pdf', 'NOT_PROCESSED_BUDGET'), att('4867060', 'მინდობილობები 22-08.pdf', 'NOT_PROCESSED_BUDGET')]),
            kase('1110027', [
              att('5035669', '1.jpg', 'IMAGE'), att('5035668', '3.jpg', 'IMAGE'), att('5035667', '2.jpg', 'IMAGE'),
              att('5035666', 'ფოტომონტაჟი.pdf', 'NOT_PROCESSED_BUDGET'), att('5035665', 'ფოტომონტაჟი.pdf', 'NOT_PROCESSED_BUDGET'),
              att('5137010', 'ფასადები 27,12.pdf', 'NOT_PROCESSED_BUDGET'), att('5137836', 'მინდობილობა.pdf', 'NOT_PROCESSED_BUDGET'),
            ]),
            kase('1143236', [att('5284946', 'mind guk.pdf', 'SCAN_OR_IMAGE_ONLY')]),
          ],
        },
      }],
    },
  };
}

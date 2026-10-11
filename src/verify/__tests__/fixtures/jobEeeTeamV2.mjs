// projectTeamV2 of the production Verify report for cadastral
// 01.72.14.040.030.01.01.004 (research_jobs eeefada9-…, read 2026-10-11):
// all 13 stored entries, in stored order. The professionals keep their names
// (named in official roles); the private clients and the applicant are
// replaced by placeholders, with the same spelling pair the record holds
// (two spellings of one surname stay two entries: identity is the full name).
// Two entries are drawing/form fragments the reader took for people.
const T = (id) => `https://docs.tbilisi.gov.ge/architect/public.html?docId=${id}`;
const r = (code, date, ref, roleText, extra = {}) => {
  const id = ref.replace(/^AR1/, '');
  return { code, date, scope: null, caseRef: ref, roleText, sourceUrl: T(id), documentTitle: `TAS ${id}`, ...extra };
};
const p = (name, group, roles, extra = {}) => {
  const dates = roles.map((x) => x.date).sort();
  return { kind: 'PERSON', name, group, roles, firstSeen: dates[0], lastSeen: dates[dates.length - 1], official: true, organization: null, ...extra };
};
const CLIENT = 'დამკვეთი';
const CHIEF = 'მთავარი არქიტექტორი/სპეციალისტი';
const APPL = 'განმცხადებელი';

export const EEE_TEAM_V2 = [
  p('ნიკა ბერიძე', 'DEVELOPER', [r('DEVELOPER', '2025-12-19', 'AR11110027', CLIENT), r('DEVELOPER', '2025-03-14', 'AR11078892', CLIENT), r('DEVELOPER', '2024-08-19', 'AR11051702', CLIENT), r('DEVELOPER', '2024-04-05', 'AR11022993', CLIENT), r('DEVELOPER', '2024-02-13', 'AR11014318', CLIENT)]),
  p('თამაზ გელაშვილი', 'DEVELOPER', [r('DEVELOPER', '2025-04-23', 'AR11087185', CLIENT)]),
  p('ლაშა კაპანაძე', 'DEVELOPER', [r('DEVELOPER', '2025-04-23', 'AR11087185', CLIENT), r('DEVELOPER', '2024-10-08', 'AR11059939', CLIENT)]),
  p('ვახტანგ ნოზაძე', 'DEVELOPER', [r('DEVELOPER', '2013-07-17', 'AR1144566', CLIENT), r('APPLICANT', '2013-06-07', 'AR1137104', APPL, { documentTitle: null }), r('DEVELOPER', '2012-12-13', 'AR195157', CLIENT), r('APPLICANT', '2012-12-04', 'AR195157', APPL, { documentTitle: null }), r('APPLICANT', '2012-10-12', 'AR186169', APPL, { documentTitle: null }), r('APPLICANT', '2012-09-18', 'AR181025', APPL, { documentTitle: null }), r('APPLICANT', '2012-09-12', 'AR179674', APPL, { documentTitle: null })]),
  p('ვახტანგ ნოძაძე', 'DEVELOPER', [r('DEVELOPER', '2013-06-18', 'AR1137104', CLIENT)]),
  p('ლუკა ჭკადუა', 'ARCHITECTURE', [r('CHIEF_ARCHITECT', '2025-12-19', 'AR11110027', CHIEF), r('CHIEF_ARCHITECT', '2025-03-14', 'AR11078892', CHIEF), r('CHIEF_ARCHITECT', '2024-04-05', 'AR11022993', CHIEF), r('CHIEF_ARCHITECT', '2024-02-13', 'AR11014318', CHIEF)], { organization: 'შპს ჯეო სითი დიღომი' }),
  p('ილია ხავთასი', 'ARCHITECTURE', [r('CHIEF_ARCHITECT', '2013-07-17', 'AR1144566', CHIEF), r('APPLICANT', '2013-07-06', 'AR1144566', APPL, { documentTitle: null })]),
  p('ნოე სოხაძე', 'ARCHITECTURE', [r('CHIEF_ARCHITECT', '2013-06-18', 'AR1137104', CHIEF)]),
  p('გიორგი როსტიაშვილი', 'ARCHITECTURE', [r('CHIEF_ARCHITECT', '2012-12-13', 'AR195157', CHIEF)]),
  { ...p('შპს ჯეო სითი დიღომი', 'ARCHITECTURE', [r('ARCHITECTURAL_ORGANIZATION', '2025-12-29', 'AR11110027', 'საპროექტო ორგანიზაცია')]), kind: 'ORGANIZATION' },
  p('ასახული კოეფიციენტში', 'LANDSCAPE', [r('LANDSCAPE_SPECIALIST', '2024-02-13', 'AR11014318', 'გამწვანების კოეფიციენტის საანგარიშო ფართობი (კვ.მ და ასახული კოეფიციენტში)')]),
  p('გიორგი წიკლაური', 'OTHER', ['2026-05-18|AR11143236', '2026-04-01|AR11136621', '2025-09-23|AR11110027', '2025-06-17|AR11095988', '2025-04-14|AR11087185', '2025-02-20|AR11078892', '2024-09-30|AR11059939', '2024-08-05|AR11051702', '2024-03-12|AR11022993', '2024-02-07|AR11014318', '2023-07-26|AR1980594']
    .map((s) => { const [d, ref] = s.split('|'); return r('APPLICANT', d, ref, APPL, { documentTitle: null }); })),
  p('არსებული საზღრები', 'OTHER', [{ code: 'OTHER', date: '2013-06-07', scope: null, caseRef: 'AR1137104', roleText: 'საპროექტო შენობა', sourceUrl: 'https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=387866', documentTitle: 'gen-gegma.pdf' }]),
];

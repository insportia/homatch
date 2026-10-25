// MY GEORGIA BY HOMI — the destinations, language independent.
//
// Times are typical door to door figures from Tbilisi by the first transport
// listed, rounded; mountain roads add time in bad weather. Every place has an
// official page to read more: the national tourism site (georgia.travel) or
// the Agency of Protected Areas (apa.gov.ge) for parks and nature reserves.

import type { PlaceMeta } from './types';

const GT = 'georgia.travel';
const APA = 'apa.gov.ge';
const gt = (path: string) => ({ url: `https://georgia.travel/${path}`, publisher: GT });
const apa = (path: string) => ({ url: `https://apa.gov.ge/${path}`, publisher: APA });

export const PLACES: readonly PlaceMeta[] = [
  /* Cities */
  { id: 'tbilisi', types: ['CITIES', 'HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 0, transport: ['CITY'], source: gt('cities-towns/tbilisi') },
  { id: 'kutaisi', types: ['CITIES', 'HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 3.5, transport: ['MINIBUS', 'TRAIN', 'CAR'], source: gt('cities-towns/kutaisi') },
  { id: 'batumi', types: ['SEA', 'CITIES'], seasons: ['SUMMER', 'AUTUMN'], hours: 5, transport: ['TRAIN', 'FLIGHT', 'CAR'], source: gt('cities-towns/batumi') },
  { id: 'telavi', types: ['WINE', 'CITIES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2, transport: ['MINIBUS', 'CAR'], source: gt('cities-towns/telavi') },
  { id: 'zugdidi', types: ['CITIES', 'HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 6, transport: ['TRAIN', 'MINIBUS'], source: gt('regions/samegrelo-zemo-svaneti') },
  { id: 'gori', types: ['CITIES', 'HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 1, transport: ['TRAIN', 'MINIBUS'], source: gt('cities-towns/gori') },
  { id: 'akhaltsikhe', types: ['HISTORIC', 'CITIES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 3, transport: ['MINIBUS', 'CAR'], source: gt('regions/samtskhe-javakheti') },

  /* Mountains */
  { id: 'kazbegi', types: ['MOUNTAINS', 'HISTORIC'], seasons: ['SUMMER', 'AUTUMN', 'WINTER'], hours: 3, transport: ['MINIBUS', 'CAR'], source: gt('cities-towns/stepantsminda') },
  { id: 'truso', types: ['MOUNTAINS'], seasons: ['SUMMER', 'AUTUMN'], hours: 3.5, transport: ['CAR', 'WALK'], source: gt('regions/mtskheta-mtianeti') },
  { id: 'juta', types: ['MOUNTAINS', 'LAKES'], seasons: ['SUMMER'], hours: 3.5, transport: ['CAR', 'WALK'], source: gt('regions/mtskheta-mtianeti') },
  { id: 'mestia', types: ['MOUNTAINS', 'HISTORIC'], seasons: ['SUMMER', 'AUTUMN', 'WINTER'], hours: 9, transport: ['TRAIN', 'MINIBUS', 'FLIGHT'], source: gt('cities-towns/mestia') },
  { id: 'ushguli', types: ['MOUNTAINS', 'HISTORIC'], seasons: ['SUMMER', 'AUTUMN'], hours: 11, transport: ['JEEP'], source: gt('regions/samegrelo-zemo-svaneti') },
  { id: 'tusheti', types: ['MOUNTAINS', 'PARKS'], seasons: ['SUMMER', 'AUTUMN'], hours: 7, transport: ['JEEP'], source: apa('en/protected-areas/cattestone/tushetis-daculi-teritoriebis-administracia') },
  { id: 'shatili', types: ['MOUNTAINS', 'HISTORIC'], seasons: ['SUMMER'], hours: 5, transport: ['JEEP'], source: gt('regions/mtskheta-mtianeti') },
  { id: 'abudelauri', types: ['LAKES', 'MOUNTAINS'], seasons: ['SUMMER'], hours: 4.5, transport: ['JEEP', 'WALK'], source: gt('abudelauri-lakes') },
  { id: 'racha', types: ['MOUNTAINS', 'LAKES', 'WINE'], seasons: ['SUMMER', 'AUTUMN'], hours: 4.5, transport: ['CAR', 'MINIBUS'], source: gt('regions/racha-lechkhumi') },

  /* Resorts and spas */
  { id: 'gudauri', types: ['SPA', 'MOUNTAINS'], seasons: ['WINTER', 'SUMMER'], hours: 2, transport: ['MINIBUS', 'CAR'], source: gt('resorts/gudauri') },
  { id: 'bakuriani', types: ['SPA', 'MOUNTAINS'], seasons: ['WINTER', 'SUMMER'], hours: 3, transport: ['MINIBUS', 'CAR'], source: gt('resorts/bakuriani') },
  { id: 'goderdzi', types: ['SPA', 'MOUNTAINS'], seasons: ['WINTER', 'SUMMER'], hours: 7, transport: ['CAR'], source: gt('resorts/goderdzi') },
  { id: 'borjomi', types: ['SPA', 'CITIES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 2.5, transport: ['MINIBUS', 'TRAIN', 'CAR'], source: gt('top-wellness-resorts-in-georgia') },
  { id: 'tskaltubo', types: ['SPA'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 4, transport: ['MINIBUS', 'CAR'], source: gt('cities-towns/tskaltubo') },
  { id: 'abastumani', types: ['SPA', 'MOUNTAINS'], seasons: ['SUMMER', 'AUTUMN'], hours: 4, transport: ['CAR', 'MINIBUS'], source: gt('resorts/abastumani') },

  /* Wine country */
  { id: 'sighnaghi', types: ['WINE', 'HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 2, transport: ['MINIBUS', 'CAR'], source: gt('cities-towns/sighnaghi') },
  { id: 'tsinandali', types: ['WINE', 'HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2, transport: ['CAR', 'MINIBUS'], source: gt('regions/kakheti') },
  { id: 'kvareli', types: ['WINE', 'HISTORIC', 'LAKES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2.5, transport: ['CAR', 'MINIBUS'], source: gt('regions/kakheti') },

  /* History */
  { id: 'mtskheta', types: ['HISTORIC', 'CITIES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 0.5, transport: ['MINIBUS', 'CAR'], source: gt('cities-towns/mtskheta') },
  { id: 'ananuri', types: ['HISTORIC', 'LAKES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 1.5, transport: ['CAR', 'MINIBUS'], source: gt('regions/mtskheta-mtianeti') },
  { id: 'bodbe', types: ['HISTORIC', 'WINE'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 2, transport: ['MINIBUS', 'CAR'], source: gt('regions/kakheti') },
  { id: 'davit_gareja', types: ['HISTORIC', 'PARKS'], seasons: ['SPRING', 'AUTUMN'], hours: 2, transport: ['CAR'], source: gt('georgia-under-the-ground') },
  { id: 'uplistsikhe', types: ['HISTORIC', 'CAVES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 1.5, transport: ['CAR', 'TRAIN'], source: gt('georgia-under-the-ground') },
  { id: 'vardzia', types: ['HISTORIC', 'CAVES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 4.5, transport: ['CAR', 'MINIBUS'], source: gt('georgia-under-the-ground') },
  { id: 'gelati', types: ['HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 4, transport: ['MINIBUS', 'CAR'], source: gt('gelati-monastery') },
  { id: 'dmanisi', types: ['HISTORIC'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2, transport: ['CAR'], source: gt('unique-places-in-georgia-for-archeology-and-history-lovers') },

  /* Caves and canyons */
  { id: 'prometheus', types: ['CAVES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 4, transport: ['MINIBUS', 'CAR'], source: gt('prometheus-cave') },
  { id: 'sataplia', types: ['CAVES', 'PARKS'], seasons: ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], hours: 4, transport: ['MINIBUS', 'CAR'], source: gt('sataplia-cave-and-nature-reserve') },
  { id: 'martvili', types: ['CAVES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 4.5, transport: ['CAR', 'MINIBUS'], source: gt('martvili-canyon') },
  { id: 'okatse', types: ['CAVES', 'PARKS'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 4.5, transport: ['CAR', 'MINIBUS'], source: gt('okatse-canyon') },
  { id: 'dashbashi', types: ['CAVES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2, transport: ['CAR'], source: gt('tsalka-canyon') },

  /* Lakes */
  { id: 'bazaleti', types: ['LAKES'], seasons: ['SUMMER'], hours: 1.5, transport: ['CAR'], source: gt('regions/mtskheta-mtianeti') },
  { id: 'paravani', types: ['LAKES', 'MOUNTAINS'], seasons: ['SUMMER'], hours: 3, transport: ['CAR'], source: gt('regions/samtskhe-javakheti') },

  /* The sea */
  { id: 'batumi_botanical', types: ['PARKS', 'SEA'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 5.5, transport: ['TRAIN', 'MINIBUS'], source: gt('regions/ajara') },
  { id: 'gonio_sarpi', types: ['SEA', 'HISTORIC'], seasons: ['SUMMER', 'AUTUMN'], hours: 5.5, transport: ['TRAIN', 'MINIBUS'], source: gt('resorts/gonio') },
  { id: 'kobuleti', types: ['SEA'], seasons: ['SUMMER'], hours: 5, transport: ['TRAIN', 'MINIBUS'], source: gt('why-georgia-the-beaches') },
  { id: 'ureki', types: ['SEA'], seasons: ['SUMMER'], hours: 4.5, transport: ['TRAIN', 'MINIBUS'], source: gt('why-georgia-the-beaches') },
  { id: 'anaklia', types: ['SEA'], seasons: ['SUMMER'], hours: 6, transport: ['MINIBUS', 'CAR'], source: gt('why-georgia-the-beaches') },

  /* National parks */
  { id: 'borjomi_park', types: ['PARKS', 'MOUNTAINS'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2.5, transport: ['MINIBUS', 'WALK'], source: apa('en/eco-tourism/servisebi-da-tarifebi/borjom-xaragaulis-daculi-teritoriebi') },
  { id: 'lagodekhi', types: ['PARKS'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 2.5, transport: ['MINIBUS', 'CAR'], source: apa('en/protected-areas/cattestone/lagodexis-daculi-teritoriebis-administracia') },
  { id: 'vashlovani', types: ['PARKS'], seasons: ['SPRING', 'AUTUMN'], hours: 3, transport: ['JEEP'], source: apa('en/protected-areas/cattestone/vashlovanis-daculi-teritoriebis-administracia') },
  { id: 'mtirala', types: ['PARKS'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 5.5, transport: ['TRAIN', 'CAR'], source: gt('mtirala-national-park') },
  { id: 'kolkheti', types: ['PARKS', 'LAKES'], seasons: ['SPRING', 'SUMMER', 'AUTUMN'], hours: 4.5, transport: ['TRAIN', 'CAR'], source: apa('en/protected-areas/cattestone/kolxetis-erovnuli-parkis-administracia') },
];

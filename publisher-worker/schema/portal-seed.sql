-- Registry candidates only; NOT integrations or assisted workflows. Not applied.
-- External operations remain disabled by the table's safe defaults.
insert into public.publisher_portals(id,domain,name,registration_url,adapter_version,verification,metadata)
values
('myhome','myhome.ge','MyHome',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://www.myhome.ge/"}'),
('ss','ss.ge','SS.ge',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://home.ss.ge/ka/udzravi-qoneba"}'),
('livo','livo.ge','Livo',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://statements.livo.ge/ka/statement/create?referrer=livo"}'),
('home','home.ge','Home.ge',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://www.home.ge/"}'),
('korter','korter.ge','Korter',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://korter.ge/"}'),
('place','place.ge','Place.ge','https://place.ge/ge/register_ptk','not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://place.ge/ge/ads/add"}'),
('binebi','binebi.ge','Binebi.ge',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://binebi.ge/login"}'),
('dgiurad','dgiurad.ge','Dgiurad.ge',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://www.dgiurad.ge/"}'),
('makler','makler.ge','Makler.ge','https://www.makler.ge/ka/registration','not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://www.makler.ge/ka/add/"}'),
('binebi_info','binebi.info','Binebi.info',null,'not-implemented','DISCOVERED','{"connectionEnabled":false,"paid":null,"discovery":"web_only","evidenceUrl":"https://binebi.info/ka/login"}');

import {PROPERTY_TYPES} from './ssge-contract.mjs';
export function listingUrl(detailUrl,locale='ka',sourceListingId) {
 if(detailUrl==null||detailUrl==='')return null;
 if(typeof detailUrl!=='string'||!['ka','en'].includes(locale))throw new Error('Invalid detailUrl');
 const prefix=`/${locale}/${locale==='ka'?'udzravi-qoneba':'real-estate'}/`;
 const u=/^https?:\/\//i.test(detailUrl)?new URL(detailUrl):detailUrl.startsWith('/')?new URL(detailUrl,'https://home.ss.ge'):new URL(prefix+detailUrl,'https://home.ss.ge');
 if(u.origin!=='https://home.ss.ge'||u.username||u.password||u.search||u.hash||!u.pathname.startsWith(prefix))throw new Error('Not an individual listing URL');
 const slug=decodeURIComponent(u.pathname.slice(prefix.length));
 if(!slug||/[\/\\?#]/.test(slug)||!/-[1-9]\d*$/.test(slug))throw new Error('Not an individual listing URL with a source ID');
 // The frontend uses the returned detailUrl verbatim. Live source slugs have
 // numeric suffixes that differ from applicationId; do not decode or rewrite.
 // URL-to-ID identity is checked independently against the individual page.
 if(sourceListingId!=null&&!/^[1-9]\d*$/.test(String(sourceListingId)))throw new Error('Invalid source listing ID');
 return u.href;
}
function areaNumber(value) {if(value==null||typeof value==='string'&&value.trim()==='')return null;if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value==='string'&&Number.isFinite(Number(value)))return Number(value);throw new Error('Invalid source area');}
function numericLabel(value) {if(value==null)return null;return typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value;}
// Source fields and numeric area conversion are consumed by frontend components.
export function normalizeList(raw,{observedAt=new Date().toISOString(),provenance={}}={}) {
 if(raw.applicationId==null||raw.applicationId==='')throw new Error('Missing applicationId');
 const address=raw.address??{},p=raw.price??{},currency=p.currencyType===1?'GEL':p.currencyType===2?'USD':null;
 const invert=map=>Object.fromEntries(Object.entries(map).map(([k,v])=>[v,k]));
 if(raw.homeId||raw.houseUrl)throw new Error('Aggregate building/project card cannot be a listing candidate');
 const exactUrl=listingUrl(raw.detailUrl,'ka',raw.applicationId);
 return {source:'ss.ge',sourceListingId:String(raw.applicationId),exactUrl,detailUrl:exactUrl,canonicalUrl:exactUrl,title:raw.title??null,description:null,
 price:p.price??(currency==='USD'?p.priceUsd:currency==='GEL'?p.priceGeo:null)??null,currency,priceUsd:p.priceUsd??null,priceGel:p.priceGeo??null,pricePerSqm:null,
 city:address.cityTitle??null,district:address.districtTitle??null,subdistrict:address.subdistrictTitle??null,street:address.streetTitle??null,address:address.streetNumber??null,
 latitude:null,longitude:null,propertyType:invert(PROPERTY_TYPES)[raw.type]??null,transactionType:({1:'monthly_rent',3:'daily_rent',4:'sale'})[raw.dealType]??null,
 area:areaNumber(raw.totalArea),yardArea:null,rooms:null,bedrooms:numericLabel(raw.numberOfBedrooms),bathrooms:null,floor:numericLabel(raw.floorNumber),totalFloors:numericLabel(raw.totalAmountOfFloor),
 buildingStatus:null,buildingType:null,condition:null,renovation:null,constructionYear:null,furnished:null,parking:null,amenities:null,
 images:raw.appImages==null?null:raw.appImages.map(i=>i.fileName??null).filter(i=>i!==null),publishedAt:null,updatedAt:null,observedAt,seller:raw.userInfo??null,
 raw,provenance:{...provenance,normalizer:'frontend-list-card',individualUrlBinding:'source detailUrl associated with applicationId; page identity pending',locationIds:{cityId:address.cityId??null,districtId:address.districtId??null,subdistrictId:address.subdistrictId??null,streetId:address.streetId??null}}};
}
export function normalizeDetail(raw,{observedAt=new Date().toISOString(),locale='ka',provenance={}}={}) {
 if(raw.applicationId==null)throw new Error('Detail missing applicationId');
 const detailArea=areaNumber(raw.areaOfHouse)??areaNumber(raw.totalArea);
 const n=normalizeList({...raw,type:raw.realEstateTypeId,dealType:raw.realEstateDealTypeId,totalArea:detailArea,numberOfBedrooms:raw.bedrooms,floorNumber:raw.floor,totalAmountOfFloor:raw.floors},{observedAt,provenance});
 n.raw=raw;n.provenance.normalizer='frontend-detail-component';
 n.description=typeof raw.description==='string'?raw.description:raw.description?.[locale]??null;
 n.area=detailArea;n.yardArea=areaNumber(raw.areaOfYard);n.rooms=numericLabel(raw.rooms);
 n.latitude=raw.locationLatitude??null;n.longitude=raw.locationLongitude??null;
 n.condition=raw.state??null;n.renovation=raw.state??null;n.buildingStatus=raw.realEstateStatus??null;
 n.furnished=raw.furniture??null;
 n.amenities=Object.fromEntries(['airConditioning','balcony','basement','cableTelevision','drinkingWater','electricity','elevator','fridge','furniture','withBuiltInKitchen','garage','glazedWindows','heating','hotWater','internet','ironDoor','lastFloor','naturalGas','securityAlarm','sewage','storage','telephone','tv','washingMachine','water','wiFi','withPool'].filter(k=>raw[k]!=null).map(k=>[k,raw[k]]));
 if(!Object.keys(n.amenities).length)n.amenities=null;
 n.provenance.sourceOrderDate=raw.orderDate??null;
 return n;
}

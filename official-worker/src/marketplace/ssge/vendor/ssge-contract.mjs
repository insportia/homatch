import {flattenLocations,resolveLocation} from './locations.mjs';
export const API_BASE='https://api-gateway.ss.ge';
export const ENDPOINTS={search:'/v1/RealEstate/LegendSearch',count:'/v3/RealEstate/legend-search-count',detail:'/v1/RealEstate/details',locations:'/v1/RealEstate/LocationChain',cities:'/v1/RealEstate/visibleCities',municipalities:'/v1/RealEstate/Municipalities',streets:'/v1/RealEstate/Streets',currencyRate:'/v1/RealEstate/currency-rate'};
export const TRANSACTIONS={sale:4,buy:4,monthly_rent:1,daily_rent:3};
export const PROPERTY_TYPES={apartment:5,house:4,land:3,commercial:6,hotel:2,country_house:1};
export const SOURCE_BOOLEAN_FILTERS=['isConstruction','withImageOnly','individualEntityOnly','isExclusive','heating','naturalGas','balcony','garage','lastFloor','storage','elevator','basement','airConditioning','cableTelevision','drinkingWater','electricity','fridge','furniture','withBuiltInKitchen','glazedWindows','hotWater','internet','ironDoor','securityAlarm','sewage','telephone','tv','washingMachine','water','wiFi','withPool','hasRemoteViewing','isPetFriendly'];
// Source IDs are exposed separately from canonical meanings until label dictionaries
// establish their semantics. Values come from SET_MORE_FILTER_ITEM callbacks.
export const SOURCE_ENUM_FILTERS={realEstateStates:[10,11,12,15,16,35,8,9],floorTypes:[409,410,411],balcony_Loggias:[412,413,414,415,416,417],toilets:[418,419,420,421,422,423],projectTypes:[4,17,18,19,20,25,26,27,28,29,30,36,38,5],other:[425,426,427,428]};
const supported=new Set(['transactionType','propertyType','city','districts','subdistricts','streets','priceMinUsd','priceMaxUsd','areaMinSqm','areaMaxSqm','rooms','bedrooms','floor','furnished','sourceFilters']);
function positive(value,key,{integer=false,zero=false}={}) {
 if(typeof value!=='number'||!Number.isFinite(value)||value<(zero?0:1e-12)||(integer&&!Number.isInteger(value))) throw new Error(`Invalid ${key}`);
 return value;
}
function countValues(value,key){const a=Array.isArray(value)?value:[value];if(!a.length)throw new Error(`Empty ${key}`);return [...new Set(a.map(v=>{positive(v,key,{integer:true});if(v>10)throw new Error(`${key}: source supports 1..9 and 10+ bucket`);return v;}))].sort((a,b)=>a-b);}
function range(value,key) {
 if(typeof value==='number')return {from:positive(value,key,{integer:true,zero:true}),to:value};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['from','to'].includes(k)))throw new Error(`Invalid ${key} range`);
 const r={};for(const k of ['from','to'])if(value[k]!=null)r[k]=positive(value[k],`${key}.${k}`,{zero:true,integer:key==='floor'});
 if(!Object.keys(r).length||(r.from!=null&&r.to!=null&&r.from>r.to))throw new Error(`Invalid ${key} bounds`);return r;
}
export function buildFilters(criteria,locations) {
 for(const [k,v]of Object.entries(criteria))if(v!=null&&!supported.has(k))throw new Error(`Unsupported or unproven criterion: ${k}`);
 const body={},advanced={};
 for(const [k,map,target]of [['transactionType',TRANSACTIONS,'realEstateDealType'],['propertyType',PROPERTY_TYPES,'realEstateType']])if(criteria[k]!=null){if(!Object.hasOwn(map,criteria[k]))throw new Error(`Unsupported ${k}: ${criteria[k]}`);body[target]=map[criteria[k]];}
 const rows=locations?flattenLocations(locations):[];
 let city;
 if(criteria.city!=null){city=resolveLocation(rows,'city',criteria.city);body.cityIdList=[city.id];}
 const subIds=new Set();
 if(criteria.districts?.length){if(!city)throw new Error('District requires city');for(const value of criteria.districts){const d=resolveLocation(rows,'district',value,city.id);for(const sub of rows.filter(r=>r.kind==='subdistrict'&&r.parentId===d.id&&r.cityId===city.id))subIds.add(sub.id);}}
 if(criteria.subdistricts?.length){const explicit=new Set();for(const value of criteria.subdistricts){if(!city)throw new Error('Subdistrict requires city');const matches=rows.filter(r=>r.kind==='subdistrict'&&r.cityId===city.id&&(r.id===value||r.title===value));if(matches.length!==1)throw new Error('Unknown or ambiguous subdistrict');if(subIds.size&&!subIds.has(matches[0].id))throw new Error('Subdistrict is outside selected districts');explicit.add(matches[0].id);}subIds.clear();for(const id of explicit)subIds.add(id);}
 if(subIds.size)body.subdistrictIds=[...subIds];
 if(criteria.streets?.length){if(!city)throw new Error('Street requires city');body.streetIds=criteria.streets.map(v=>{const matches=rows.filter(r=>r.kind==='street'&&r.cityId===city.id&&(r.id===v||r.title===v)&&(!subIds.size||subIds.has(r.parentId)));if(matches.length!==1)throw new Error('Unknown or ambiguous street');return matches[0].id;});}
 body.currencyId=2;
 for(const [key,target]of [['priceMinUsd','priceFrom'],['priceMaxUsd','priceTo'],['areaMinSqm','areaFrom'],['areaMaxSqm','areaTo']])if(criteria[key]!=null)body[target]=positive(criteria[key],key,{zero:true});
 if(body.priceFrom!=null||body.priceTo!=null)body.priceType=1;
 for(const [a,b]of [['priceFrom','priceTo'],['areaFrom','areaTo']])if(body[a]!=null&&body[b]!=null&&body[a]>body[b])throw new Error('Minimum exceeds maximum');
 for(const [key,target]of [['rooms','rooms'],['bedrooms','bedroomsCount']])if(criteria[key]!=null){if([3,6].includes(body.realEstateType)||key==='bedrooms'&&body.realEstateType===2)throw new Error(`Source does not expose ${key} for this property type`);body[target]=countValues(criteria[key],key);}
 if(criteria.floor!=null)advanced.floor=range(criteria.floor,'floor');
 if(criteria.furnished!=null){if(criteria.furnished!==true)throw new Error('Unfurnished exclusion is not proven');advanced.furniture=true;}
 for(const [key,value]of Object.entries(criteria.sourceFilters??{})) {
  if(SOURCE_BOOLEAN_FILTERS.includes(key)){if(value!==true)throw new Error(`Only positive ${key} is proven`);advanced[key]=true;}
  else if(['areaOfYard','kitchenArea'].includes(key))advanced[key]=range(value,key);
  else if(Object.hasOwn(SOURCE_ENUM_FILTERS,key)){if(!Array.isArray(value)||!value.length||value.some(v=>!SOURCE_ENUM_FILTERS[key].includes(v)))throw new Error(`Invalid ${key} source IDs`);advanced[key]=[...new Set(value)];}
  else throw new Error(`Unsupported source filter: ${key}`);
 }
 if(Object.keys(advanced).length)body.advancedSearch=advanced;
 // nT frontend model insertion order; undefined fields remain omitted.
 const order=['realEstateType','realEstateStatuses','commercialTypes','realEstateDealType','cityIdList','municipalityId','subdistrictIds','streetIds','subwayStation','subwayStationDistance','areaFrom','areaTo','offerType','currencyId','priceType','priceFrom','priceTo','rooms','bedroomsCount','advancedSearch','statuses','order','searchString','page','applicationIds'];
 return Object.fromEntries(order.filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]));
}
export function publicRequest(endpoint,{method='GET',body,query,locale='ka'}={}) {
 const url=new URL(endpoint,API_BASE);
 for(const [k,v]of Object.entries(query??{}))url.searchParams.set(k,String(v));
 const headers={'accept-language':locale,os:'web',Accept:'application/json, text/plain, */*'};
 if(body!==undefined)headers['Content-Type']='application/json';
 return {url:url.href,options:{method,headers,...body!==undefined?{body:JSON.stringify(body)}:{}}};
}
export const PUBLIC_PAGE_SIZE=16;
export function searchRequest(criteria,locations,page=1){positive(page,'page',{integer:true});return publicRequest(ENDPOINTS.search,{method:'POST',body:{...buildFilters(criteria,locations),page,pageSize:PUBLIC_PAGE_SIZE}});}
export function countRequest(criteria,locations){return publicRequest(ENDPOINTS.count,{method:'POST',body:{...buildFilters(criteria,locations),page:1,pageSize:PUBLIC_PAGE_SIZE}});}
export function detailRequest(id){positive(Number(id),'applicationId',{integer:true});return publicRequest(ENDPOINTS.detail,{method:'PUT',query:{applicationId:id,currencyId:2,updateViewCount:false}});}

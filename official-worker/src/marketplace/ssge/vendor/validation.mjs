import {buildFilters} from './ssge-contract.mjs';
import {listingUrl} from './normalize.mjs';
import {flattenLocations,resolveLocation} from './locations.mjs';
export function validateCriteria(listing,criteria,locations,{requireUrl=true}={}) {
 const body=buildFilters(criteria,locations),raw=listing.raw,ids=listing.provenance.locationIds,failures=[];
 const check=(name,ok)=>{if(!ok)failures.push(name);};
 if(body.realEstateType!=null)check('propertyType',(raw.type??raw.realEstateTypeId)===body.realEstateType);
 if(body.realEstateDealType!=null)check('transactionType',(raw.dealType??raw.realEstateDealTypeId)===body.realEstateDealType);
 if(body.cityIdList)check('city',body.cityIdList.includes(ids.cityId));
 if(criteria.districts?.length){const rows=flattenLocations(locations);const districtIds=criteria.districts.map(value=>resolveLocation(rows,'district',value,body.cityIdList[0]).id);check('district',districtIds.includes(ids.districtId));}
 if(body.subdistrictIds)check('subdistrict',body.subdistrictIds.includes(ids.subdistrictId));
 if(body.streetIds)check('street',body.streetIds.includes(ids.streetId));
 for(const [key,value]of [['priceFrom',listing.priceUsd],['priceTo',listing.priceUsd],['areaFrom',listing.area],['areaTo',listing.area]])if(body[key]!=null)check(key,typeof value==='number'&&Number.isFinite(value)&&(key.endsWith('From')?value>=body[key]:value<=body[key]));
 if(requireUrl)try{check('individualUrl',!!listingUrl(listing.exactUrl,'ka',listing.sourceListingId));}catch{failures.push('individualUrl');}
 return {passed:failures.length===0,failures};
}
export function compareDetail(list,detail,{pageProof}={}) {
 const matched=[],unavailable=[],mismatches=[];
 const fields=['sourceListingId','title','propertyType','transactionType','price','currency','priceUsd','area','rooms','bedrooms','floor','totalFloors','city','district','subdistrict','street','address'];
 for(const field of fields) {
  if(list[field]==null||detail[field]==null)unavailable.push(field);
  else if(list[field]!==detail[field])mismatches.push({field,list:list[field],detail:detail[field]});
  else matched.push(field);
 }
 for(const key of ['cityId','districtId','subdistrictId','streetId']) {
  const l=list.provenance.locationIds[key],d=detail.provenance.locationIds[key],field=`location.${key}`;
  if(l==null||d==null)unavailable.push(field);else if(l===d)matched.push(field);else mismatches.push({field,list:l,detail:d});
 }
 const detailImageUrls=new Set([...(detail.images??[]),...(detail.raw?.appImages??[]).map(image=>image.fileNameThumb).filter(Boolean)]);
 if(list.images?.length&&detailImageUrls.size){if(list.images.some(url=>detailImageUrls.has(url)))matched.push('images');else mismatches.push({field:'images',list:list.images,detail:detail.images});}else unavailable.push('images');
 if(detail.exactUrl){if(detail.exactUrl===list.exactUrl)matched.push('exactUrl');else mismatches.push({field:'exactUrl',list:list.exactUrl,detail:detail.exactUrl});}
 else unavailable.push('detailUrl');
 const required=['sourceListingId','title','price','currency','priceUsd','area','location.cityId','location.subdistrictId'];
 const missingRequired=required.filter(field=>!matched.includes(field));
 const individualPagePassed=pageProof?.passed===true;
 return {passed:!mismatches.length&&!missingRequired.length&&individualPagePassed,matched,unavailable,mismatches,missingRequired,individualPagePassed};
}

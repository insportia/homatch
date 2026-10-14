const text=v=>typeof v==='string'?v.trim():'';
const numeric=v=>v==null||v===''?null:Number(v);
export function normalizeListing(raw){
 const x={};for(const k of ['propertyType','buildingType','condition','city','street','streetNumber','projectType','heating','contactName','contactPhone'])x[k]=Array.isArray(raw[k])?text(raw[k][0]):text(raw[k]);
 x.dealType=text(raw.dealType||raw.transaction);x.currency=text(raw.currency)||'USD';
 x.portalTargets=[...new Set(raw.portalTargets||[raw.portal].filter(Boolean))];
 for(const k of ['area','floor','totalFloors','rooms','bedrooms','price','balconyArea','ceilingHeight','livingArea','yardArea','landArea'])x[k]=numeric(raw[k]);
 x.description=typeof raw.description==='string'?{ka:raw.description,en:'',ru:''}:{ka:text(raw.description?.ka),en:text(raw.description?.en),ru:text(raw.description?.ru)};
 x.photos=Array.isArray(raw.photos)?raw.photos.map(p=>({name:text(p.name),mime:text(p.mime),bytes:numeric(p.bytes),assetId:text(p.assetId)})):[];
 return x;
}
export function validateListing(x){
 const errors=[];for(const k of ['propertyType','dealType','city','street','streetNumber','contactName','contactPhone'])if(!text(x[k]))errors.push({field:k,code:'REQUIRED'});
 if(!['apartment','house','land','commercial','hotel'].includes(x.propertyType))errors.push({field:'propertyType',code:'INVALID'});
 if(!['sale','rent','daily_rent'].includes(x.dealType))errors.push({field:'dealType',code:'INVALID'});
 for(const k of ['area','price'])if(!Number.isFinite(x[k])||x[k]<=0)errors.push({field:k,code:'POSITIVE_REQUIRED'});
 if(!['USD','GEL','EUR'].includes(x.currency))errors.push({field:'currency',code:'INVALID'});
 if(!x.description?.ka)errors.push({field:'description.ka',code:'REQUIRED'});
 if(!Array.isArray(x.portalTargets)||!x.portalTargets.length)errors.push({field:'portalTargets',code:'REQUIRED'});
 if((x.photos?.length||0)>16)errors.push({field:'photos',code:'MYHOME_MAX_16'});
 if(x.floor!=null&&x.totalFloors!=null&&x.floor>x.totalFloors)errors.push({field:'floor',code:'EXCEEDS_TOTAL_FLOORS'});
 for(const k of ['rooms','bedrooms','totalFloors'])if(x[k]!=null&&(!Number.isInteger(x[k])||x[k]<0))errors.push({field:k,code:'INVALID_INTEGER'});
 for(const k of ['floor','balconyArea','ceilingHeight','livingArea','yardArea','landArea'])if(x[k]!=null&&!Number.isFinite(x[k]))errors.push({field:k,code:'INVALID_NUMBER'});
 return {valid:errors.length===0,errors};
}

import {PUBLIC_PAGE_SIZE} from './ssge-contract.mjs';
export function parseCount(raw) {
 for(const key of ['applicationCount','cardCount'])if(!Number.isInteger(raw?.[key])||raw[key]<0)throw new Error(`Invalid search count: ${key}`);
 return {applicationCount:raw.applicationCount,cardCount:raw.cardCount,lastPage:Math.ceil(raw.cardCount/PUBLIC_PAGE_SIZE)};
}
export function parseSearch(raw,count) {
 if(!Array.isArray(raw?.realStateItemModel))throw new Error('Missing realStateItemModel search envelope');
 if(raw.totalCount!=null&&(!Number.isInteger(raw.totalCount)||raw.totalCount<0))throw new Error('Invalid totalCount');
 // Frontend applicationCardCount uses a truthy totalCount, else count.cardCount.
 // Saved successful responses contain totalCount:0 alongside 16 actual cards.
 const total=raw.totalCount||count.cardCount;
 if(!Number.isInteger(total)||total<0)throw new Error('Invalid totalCount');
 const items=raw.realStateItemModel.map(item=>{if(!/^[1-9]\d*$/.test(String(item.applicationId??'')))throw new Error('Missing positive source applicationId');return {sourceListingId:String(item.applicationId),raw:item};});
 return {items,total,lastPage:Math.ceil(total/PUBLIC_PAGE_SIZE),totalSource:raw.totalCount?'search.totalCount':'count.cardCount',reportedSearchTotal:raw.totalCount??null,applicationCount:count.applicationCount,rawResponse:raw};
}

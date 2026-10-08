export async function* paginate(fetchPage,{maxPages=1000,retries=3,backoffMs=250,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onStop=()=>{}}={}) {
  if(!Number.isInteger(maxPages)||maxPages<1||!Number.isInteger(retries)||retries<0) throw new Error('Invalid pagination options');
  const ids=new Set(),fingerprints=new Set();
  for(let page=1;page<=maxPages;page++) {
    let result;
    for(let attempt=0;;attempt++) {
      try { result=await fetchPage(page); break; }
      catch(e) { if(attempt>=retries||e.transient!==true) throw e; await sleep(backoffMs*2**attempt); }
    }
    if(!Array.isArray(result.items)) throw new Error('Invalid page items');
    if(!result.items.length) {await onStop({reason:'empty-page',page,uniqueIds:ids.size});return;}
    const pageIds=result.items.map(x=>{
      if(x.sourceListingId===null||x.sourceListingId===undefined||String(x.sourceListingId)==='') throw new Error('Missing stable listing ID');
      return String(x.sourceListingId);
    });
    const fingerprint=JSON.stringify([...new Set(pageIds)].sort());
    if(fingerprints.has(fingerprint)) {await onStop({reason:'repeated-page',page,uniqueIds:ids.size});return;}
    fingerprints.add(fingerprint);
    const fresh=result.items.filter((item,i)=>{if(ids.has(pageIds[i])) return false;ids.add(pageIds[i]);return true;});
    if(!fresh.length) {await onStop({reason:'no-new-ids',page,uniqueIds:ids.size});return;}
    yield {...result,page,items:fresh,total:result.total??null,lastPage:result.lastPage??null};
    if(result.lastPage!=null) {
      if(!Number.isInteger(result.lastPage)||result.lastPage<page) throw new Error('Invalid last page');
      if(page===result.lastPage) {await onStop({reason:'last-page',page,uniqueIds:ids.size});return;}
    } else if(result.total!=null&&ids.size>=result.total) {await onStop({reason:'total-count',page,uniqueIds:ids.size});return;}
  }
  await onStop({reason:'safety-limit',page:maxPages,uniqueIds:ids.size});
}

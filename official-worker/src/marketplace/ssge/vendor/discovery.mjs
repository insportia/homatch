export const PAGE_URL='https://home.ss.ge/ka/udzravi-qoneba';
export function parseSource(html) {
  const match=html.match(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i);
  if(!match) throw new Error('Missing __NEXT_DATA__');
  const data=JSON.parse(match[1]);
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>new URL(m[1].replaceAll('&amp;','&'),PAGE_URL).href).filter(u=>new URL(u).origin==='https://home.ss.ge');
  return {buildId:data.buildId,page:data.page,locale:data.locale,locales:data.locales,pageProps:data.props?.pageProps??{},scripts:[...new Set(scripts)]};
}
export function scanBundle(text) {
  const patterns=[/https?:\/\/[^\s"'`<>\\]+/g,/["'`]([^"'`\n]{0,160}(?:\/api\/|baseURL|application|search|filter|location|district|subDistrict|pageSize)[^"'`\n]{0,160})["'`]/gi];
  const evidence=[];
  for(const pattern of patterns) for(const m of text.matchAll(pattern)) evidence.push({offset:m.index,text:m[0],context:text.slice(Math.max(0,m.index-200),m.index+m[0].length+200)});
  return evidence;
}

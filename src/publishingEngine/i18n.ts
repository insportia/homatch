import copy from './copy.json';

/** Publishing copy is scoped here to avoid changing unrelated product translations. */
export function publishingTranslator(language:string, fallback:(key:any,params?:any)=>string) {
 return (key:string,params?:Record<string,string|number>)=>{
  const entry=(copy as Record<string,Record<string,string>>)[key];
  let value=entry?.[language];
  if(!value)return fallback(key,params);
  for(const [name,replacement] of Object.entries(params||{}))value=value.split('{'+name+'}').join(String(replacement));
  return value;
 };
}

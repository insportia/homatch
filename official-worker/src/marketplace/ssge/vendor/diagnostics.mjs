const sensitive=/^(authorization|proxy-authorization|cookie|set-cookie|(?:x-)?api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|credentialsToken|client[-_]?secret|password|ss-session-token)$/i;
export function sanitize(value) {
 if(Array.isArray(value))return value.map(sanitize);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':sanitize(v)]));
 if(typeof value==='string')return value.replace(/Bearer\s+(?!realm=|error=|scope=)[^\s"<>]+/gi,'Bearer [REDACTED]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED_JWT]');
 return value;
}
export function sanitizeText(text) {try{return JSON.stringify(sanitize(JSON.parse(text)));}catch{return sanitize(text);}}
export function responseHeaders(headers) {
 return sanitize(Object.fromEntries(headers?.entries?.()??[]));
}
export function sanitizeHttp(record) {
 return {...sanitize(record),...record.text!==undefined?{text:sanitizeText(record.text)}:{}};
}

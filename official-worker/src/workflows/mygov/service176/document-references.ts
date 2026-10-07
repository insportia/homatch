import {URL} from 'node:url';
﻿import {publicUrl} from './api.js';import type {DocumentReference} from './napr.js';
export type ReferenceClassification={documentType:'pdf-document'|'html-status'|'navigation-reference'|'unsupported';sourceField:'BLOB_URI'|'LINK'|'link';sourceReference:string;resolvedDocumentUrl:string|null;classificationEvidence:string;getBlob?:{pid:string;bid:string}};
export function classifyReference(reference:DocumentReference):ReferenceClassification{
 const sourceField=reference.kind==='edocument'?'BLOB_URI':reference.kind==='status'?'LINK':'link';const sourceReference=typeof reference.raw[sourceField]==='string'?reference.raw[sourceField] as string:reference.url;const url=publicUrl(reference.url);
 const isGetBlob=url.origin==='https://bs.napr.gov.ge'&&url.pathname==='/GetBlob';const pid=url.searchParams.get('pid');const bid=url.searchParams.get('bid');
 if(isGetBlob&&(!pid||!bid))return{documentType:'unsupported',sourceField,sourceReference,resolvedDocumentUrl:null,classificationEvidence:'Incomplete source GetBlob reference; never synthesize parameters'};
 if(isGetBlob&&pid&&bid&&reference.raw.ICON==='signed-pdf')return{documentType:'pdf-document',sourceField,sourceReference,resolvedDocumentUrl:url.href,classificationEvidence:'Source-provided GetBlob URL; live record ICON signed-pdf and observed native PDF navigation',getBlob:{pid,bid}};
 if(reference.raw.ICON==='signed-pdf')return{documentType:'pdf-document',sourceField,sourceReference,resolvedDocumentUrl:url.href,classificationEvidence:'Source ICON signed-pdf; response must independently validate as PDF'};
 if(reference.kind==='status'&&reference.raw.ICON==='html')return{documentType:'html-status',sourceField,sourceReference,resolvedDocumentUrl:null,classificationEvidence:'Source status LINK with ICON html; not an expected PDF'};
 return{documentType:isGetBlob?'unsupported':'navigation-reference',sourceField,sourceReference,resolvedDocumentUrl:null,classificationEvidence:isGetBlob?'Incomplete source GetBlob reference; never synthesize parameters':'No source evidence this navigation reference is a PDF'};
}


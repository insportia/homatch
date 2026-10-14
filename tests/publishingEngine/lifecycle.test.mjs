import test from 'node:test';
import assert from 'node:assert/strict';
import { operationAllowed, validateDraft, validatePublication, verifyRemoteResult, retryDelay } from '../../supabase/functions/publishing-engine/lifecycle.ts';

const portal={domains:['ss.ge'],requirements:{required:['city'],maxPhotos:3},verifiedOperations:{EDIT:{verified:true,evidence:'synthetic fixture only'}}};
const operation={id:'operation',kind:'EDIT',desired_revision:4,payload_hash:'latest',external_id:'42'};
const result={verified:true,remoteState:'PUBLISHED',operationId:'operation',revision:4,payloadHash:'latest',readbackHash:'latest',externalId:'42',externalUrl:'https://home.ss.ge/listing/42'};
test('incomplete drafts are free of portal publication requirements',()=>{
 assert.equal(validateDraft({}).valid,true);
 assert.equal(validatePublication({},portal).valid,false);
 assert.equal(validateDraft({floor:8,totalFloors:5}).valid,false);
 assert.equal(validateDraft({price:NaN}).valid,false);
 assert.equal(validatePublication({city:'Tbilisi',price:1,area:1,photos:[1,2,3,4]},portal).valid,false);
});
test('capabilities require independent evidence and reject prototype operation names',()=>{
 assert.equal(operationAllowed('EDIT',portal),true);
 for(const kind of ['DELETE','toString','constructor','__proto__'])assert.equal(operationAllowed(kind,portal),false);
 assert.equal(operationAllowed('EDIT',{...portal,maintenance:true}),false);
 assert.equal(operationAllowed('EDIT',{...portal,verifiedOperations:{EDIT:{verified:true}}}),false);
 assert.equal(operationAllowed('EDIT',{...portal,verifiedOperations:{EDIT:{verified:true,evidence:'paid',paidPromotion:true}}}),false);
});
test('remote completion requires current revision, readback, identity and authorized URL',()=>{
 assert.equal(verifyRemoteResult(operation,result,portal),true);
 for(const change of [{verified:false},{revision:3},{payloadHash:'old'},{readbackHash:'old'},{externalId:'another'},{operationId:'another'},{externalUrl:'https://ss.ge.evil.test/42'},{externalUrl:'https://user:pass@ss.ge/42'},{externalUrl:'http://ss.ge/42'}])assert.equal(verifyRemoteResult(operation,{...result,...change},portal),false);
});
test('visibility operations verify actual state and never substitute deletion for pause',()=>{
 const p={...portal,verifiedOperations:{PAUSE:{verified:true,evidence:'fixture'}}};
 assert.equal(verifyRemoteResult({...operation,kind:'PAUSE'},{...result,remoteState:'PAUSED'},p),true);
 assert.equal(verifyRemoteResult({...operation,kind:'PAUSE'},{...result,remoteState:'DELETED'},p),false);
});
test('retry backoff is bounded',()=>{assert.equal(retryDelay(1),30);assert.equal(retryDelay(2),60);assert.equal(retryDelay(100),3600);});

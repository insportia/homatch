// traversal.js (2026-09-05, structural fix per the user's explicit critique
// of the production Verify run for 01.18.06.019.055.03.01.603):
//
// "STOP AND READ THIS BEFORE CONTINUING... THE EXECUTION WORKFLOW ITSELF IS
// WRONG... Do not allow synthesis to treat SEARCH_CONFIRMED as equivalent to
// completed research... The source must explicitly report its traversal
// state."
//
// This module is the pure, dependency-free (no Playwright, no network) part
// of that fix: it computes a PER-SOURCE, STRUCTURED "how much of the real
// workflow actually happened" object with the EXACT field names the user
// specified, plus a shared, honestly-derived `status` drawn from a single
// five-state completeness ladder:
//
//   SEARCH_CONFIRMED     — the search itself is proven (control found,
//                          query verified, submitted, result area reacted)
//   RESULTS_DISCOVERED   — the source told us HOW MANY relevant items/steps
//                          exist to look at (a count, a popup, an entity
//                          match) but they have not been opened yet
//   RESULTS_TRAVERSED    — every discovered item/step has been opened/
//                          visited (but their documents may not be read)
//   DOCUMENTS_TRAVERSED  — the documents reachable from those items have
//                          been opened and read
//   SOURCE_EXHAUSTED     — nothing relevant and reachable remains unvisited;
//                          per the user's explicit rule this may ONLY be
//                          emitted when unvisitedRelevantItems===0 (or,
//                          for a confirmed-empty search, there was never
//                          anything to visit) — never merely because a
//                          search ran.
//
// Operational states (WAITING_HUMAN / SKIPPED_HUMAN_VERIFICATION / BLOCKED /
// AUTH_REQUIRED / SEARCH_CONTROL_NOT_FOUND / SUBMIT_FAILED / NO_RESULT_
// CONFIRMED / WRONG_SEARCH_CONTEXT / FAILED / NOT_STARTED) always win over
// the completeness ladder — they describe why the ladder never got to run,
// or ran against evidence that cannot be trusted, and must never be
// silently upgraded to a completeness state.
//
// Every function here is a pure calculator over already-computed booleans/
// counts (supplied by index.js from the real page/adapter state) so it can
// be unit-tested without a browser, per the established pure/impure
// separation pattern in this codebase.

const OPERATIONAL_STATUSES=new Set(['WAITING_HUMAN','SKIPPED_HUMAN_VERIFICATION','BLOCKED','AUTH_REQUIRED','SEARCH_CONTROL_NOT_FOUND','SUBMIT_FAILED','WRONG_SEARCH_CONTEXT','FAILED','NOT_STARTED']);

/** Shared operational-status short-circuit: returns the operational status
 * string if one applies, else null — checked BEFORE any source-specific
 * ladder logic runs, so a captcha/block/etc. can never be silently read as
 * traversal progress. */
function operationalStatus({captcha,skippedHumanVerification,blocked,authRequired,searchControlNotFound,submitFailed,wrongSearchContext,failed}={}){
  if(failed)return'FAILED';
  if(captcha)return'WAITING_HUMAN';
  if(skippedHumanVerification)return'SKIPPED_HUMAN_VERIFICATION';
  if(blocked)return'BLOCKED';
  if(authRequired)return'AUTH_REQUIRED';
  if(searchControlNotFound)return'SEARCH_CONTROL_NOT_FOUND';
  if(submitFailed)return'SUBMIT_FAILED';
  if(wrongSearchContext)return'WRONG_SEARCH_CONTEXT';
  return null;
}

/** MSMAP traversal — the exact field list from the spec:
 * layersEnabled, queryEntered, suggestionSelected, identifyActivated,
 * parcelClicked, infoPopupOpened, naprOpened, latestInformationOpened,
 * documentsRead, status.
 * The ladder is a strict chain: each stage requires every earlier stage.
 * A confirmed-empty search (queryEntered && !suggestionSelected, with the
 * search itself causally proven) has nothing left to traverse and is
 * SOURCE_EXHAUSTED immediately — that is a real, evidenced completion, not
 * a shortcut, since the user's own spec only requires opening a popup/NAPR
 * link/latest-info WHEN a parcel was actually located. */
function computeMsmapTraversal(input={}){
  const{queryEntered=false,suggestionSelected=false,layersEnabled=false,identifyActivated=false,parcelClicked=false,infoPopupOpened=false,naprOpened=false,latestInformationOpened=false,documentsRead=false,noResultConfirmed=false}=input;
  const op=operationalStatus(input);
  const base={layersEnabled,queryEntered,suggestionSelected,identifyActivated,parcelClicked,infoPopupOpened,naprOpened,latestInformationOpened,documentsRead};
  if(op)return{...base,status:op};
  if(!queryEntered)return{...base,status:'NOT_STARTED'};
  if(!suggestionSelected)return{...base,status:noResultConfirmed?'SOURCE_EXHAUSTED':'SEARCH_CONFIRMED'};
  // A parcel was located — RESULTS_DISCOVERED (the popup/NAPR chain exists
  // to be opened) as soon as the suggestion is selected.
  if(!infoPopupOpened)return{...base,status:'RESULTS_DISCOVERED'};
  if(!naprOpened)return{...base,status:'RESULTS_TRAVERSED'};
  if(!latestInformationOpened||!documentsRead)return{...base,status:'RESULTS_TRAVERSED'};
  return{...base,status:'SOURCE_EXHAUSTED'};
}

/** TAS traversal — exact field list: originalCadastralCode,
 * resolvedSearchCadastralCode, searchSubmitted, resultsDiscovered,
 * resultsVisited, documentsDiscovered, documentsRead,
 * unvisitedRelevantItems, status.
 * resultsDiscovered MUST be computed independently of whether the row-
 * opening heuristic worked (from the source's own authoritative count,
 * e.g. TAS's "სულ მოიძებნა: N") — a mismatch between "N discovered, 0
 * visited" must be honestly surfaced (unvisitedRelevantItems=N), never
 * silently reported as SOURCE_EXHAUSTED. */
function computeTasTraversal(input={}){
  const{originalCadastralCode=null,resolvedSearchCadastralCode=null,searchSubmitted=false,resultsDiscovered=null,resultsVisited=0,documentsDiscovered=0,documentsRead=0,skippedReasonsCount=0,noResultConfirmed=false}=input;
  const op=operationalStatus(input);
  const base={originalCadastralCode,resolvedSearchCadastralCode,searchSubmitted,resultsDiscovered,resultsVisited,documentsDiscovered,documentsRead};
  if(op)return{...base,unvisitedRelevantItems:resultsDiscovered==null?null:Math.max(0,resultsDiscovered-resultsVisited-skippedReasonsCount),status:op};
  if(!searchSubmitted)return{...base,unvisitedRelevantItems:null,status:'NOT_STARTED'};
  if(noResultConfirmed||resultsDiscovered===0)return{...base,resultsDiscovered:resultsDiscovered??0,unvisitedRelevantItems:0,status:'SOURCE_EXHAUSTED'};
  if(resultsDiscovered==null)return{...base,unvisitedRelevantItems:null,status:'SEARCH_CONFIRMED'};
  const unvisitedRelevantItems=Math.max(0,resultsDiscovered-resultsVisited-skippedReasonsCount);
  if(resultsVisited===0)return{...base,unvisitedRelevantItems,status:'RESULTS_DISCOVERED'};
  if(unvisitedRelevantItems>0)return{...base,unvisitedRelevantItems,status:'RESULTS_DISCOVERED'};
  // Every discovered row has been visited or explicitly accounted for.
  if(documentsDiscovered>0&&documentsRead<documentsDiscovered)return{...base,unvisitedRelevantItems,status:'RESULTS_TRAVERSED'};
  return{...base,unvisitedRelevantItems,status:'SOURCE_EXHAUSTED'};
}

/** MYGOV traversal — exact field list: service176Opened, registryAppOpened,
 * correctSearchContext, queryEntered, searchSubmitted, captchaEncountered,
 * humanCompleted, humanSkipped, resultsDiscovered, resultsVisited,
 * documentsRead, status.
 * correctSearchContext is the direct fix for the false "no matching record"
 * bug: when the field that was actually filled was found only via a weak,
 * generic candidate-scan (not a known-good hint selector, and not even a
 * cadastral-keyword-matched candidate), the source's own confirm/deny text
 * is NOT trustworthy evidence of anything — the ladder is capped at
 * WRONG_SEARCH_CONTEXT instead of ever reaching SEARCH_CONFIRMED/
 * SOURCE_EXHAUSTED, however positive/negative the page text looks. */
function computeMygovTraversal(input={}){
  const{service176Opened=false,registryAppOpened=false,correctSearchContext=false,queryEntered=false,searchSubmitted=false,captchaEncountered=false,humanCompleted=false,humanSkipped=false,resultsDiscovered=null,resultsVisited=0,documentsRead=0,noResultConfirmed=false}=input;
  const op=operationalStatus(input);
  const base={service176Opened,registryAppOpened,correctSearchContext,queryEntered,searchSubmitted,captchaEncountered,humanCompleted,humanSkipped,resultsDiscovered,resultsVisited,documentsRead};
  if(op)return{...base,status:op};
  if(!service176Opened||!registryAppOpened)return{...base,status:'NOT_STARTED'};
  if(!queryEntered||!searchSubmitted)return{...base,status:'SEARCH_CONTROL_NOT_FOUND'};
  if(!correctSearchContext)return{...base,status:'WRONG_SEARCH_CONTEXT'};
  if(noResultConfirmed||resultsDiscovered===0)return{...base,resultsDiscovered:resultsDiscovered??0,status:'SOURCE_EXHAUSTED'};
  if(resultsDiscovered==null)return{...base,status:'SEARCH_CONFIRMED'};
  if(resultsVisited<resultsDiscovered)return{...base,status:'RESULTS_DISCOVERED'};
  if(documentsRead<=0&&resultsDiscovered>0)return{...base,status:'RESULTS_TRAVERSED'};
  return{...base,status:'SOURCE_EXHAUSTED'};
}

/** ENREG traversal — exact field list: entitiesQueued, searchMethod,
 * searchValue, exactEntityMatched, infoIconClicked,
 * verificationStepCompleted, entityPageOpened, latestApplicationDate,
 * latestApplicationOpened, preparedDocumentsOpened,
 * latestRegistryExtractOpened, fullExtractRead,
 * historicalRelevantRecordsRead, status. */
function computeEnregTraversal(input={}){
  const{entitiesQueued=0,searchMethod=null,searchValue=null,exactEntityMatched=false,infoIconClicked=false,verificationStepCompleted=true,entityPageOpened=false,latestApplicationDate=null,latestApplicationOpened=false,preparedDocumentsOpened=false,latestRegistryExtractOpened=false,fullExtractRead=false,historicalRelevantRecordsRead=false,noResultConfirmed=false}=input;
  const op=operationalStatus(input);
  const base={entitiesQueued,searchMethod,searchValue,exactEntityMatched,infoIconClicked,verificationStepCompleted,entityPageOpened,latestApplicationDate,latestApplicationOpened,preparedDocumentsOpened,latestRegistryExtractOpened,fullExtractRead,historicalRelevantRecordsRead};
  if(op)return{...base,status:op};
  if(!searchMethod||!searchValue)return{...base,status:'NOT_STARTED'};
  if(noResultConfirmed||!exactEntityMatched)return{...base,status:exactEntityMatched===false&&infoIconClicked===false&&entityPageOpened===false?'SOURCE_EXHAUSTED':'SEARCH_CONFIRMED'};
  if(!verificationStepCompleted)return{...base,status:'WAITING_HUMAN'};
  if(!infoIconClicked||!entityPageOpened)return{...base,status:'RESULTS_DISCOVERED'};
  if(!latestApplicationOpened||!preparedDocumentsOpened||!latestRegistryExtractOpened)return{...base,status:'RESULTS_TRAVERSED'};
  if(!fullExtractRead||!historicalRelevantRecordsRead)return{...base,status:'DOCUMENTS_TRAVERSED'};
  return{...base,status:'SOURCE_EXHAUSTED'};
}

/** The one gate rule the user stated explicitly and generally: */
function isSourceExhausted(traversal){return traversal?.status==='SOURCE_EXHAUSTED'}

export{OPERATIONAL_STATUSES,operationalStatus,computeMsmapTraversal,computeTasTraversal,computeMygovTraversal,computeEnregTraversal,isSourceExhausted};

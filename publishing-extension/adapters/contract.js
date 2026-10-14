// Shared boundary: portal-specific DOM work implements the canonical listing API.
// Credentials, arbitrary scripts/navigation and paid operations are excluded.
globalThis.HOMATCH_ADAPTER_CONTRACT=Object.freeze({version:2,
 operationActions:Object.freeze({CREATE:'fillListing',PUBLISH:'publishAfterConfirmation',EDIT:'editListing',UPDATE_PHOTOS:'updatePhotos',HIDE:'hideListing',PAUSE:'pauseListing',RESUME:'resumeListing',REFRESH:'refreshListing',DELETE:'deleteListing',CHECK_STATUS:'checkStatus',RECONCILE:'reconcile'}),
 optional:Object.freeze(['validateListing','updatePhotos','hideListing','pauseListing','resumeListing','refreshListing','deleteListing','reconcile']),
 actions:Object.freeze(['checkAuthentication','inspect','fillListing','uploadPhotos','verifyForm','preparePublish','publishAfterConfirmation','extractPublishedListing','editListing','checkStatus']),
 readPublished:Object.freeze(['extractPublishedListing','checkStatus']),
 required:Object.freeze(['checkAuthentication','inspect','fillListing','uploadPhotos','verifyForm','preparePublish','publishAfterConfirmation','extractPublishedListing','editListing','checkStatus'])});

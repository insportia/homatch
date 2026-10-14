// Shared boundary: portal-specific DOM work implements the canonical listing API.
// Credentials, arbitrary scripts/navigation and paid operations are excluded.
globalThis.HOMATCH_ADAPTER_CONTRACT=Object.freeze({version:1,
 actions:Object.freeze(['checkAuthentication','inspect','fillListing','uploadPhotos','verifyForm','preparePublish','publishAfterConfirmation','extractPublishedListing','editListing','checkStatus']),
 readPublished:Object.freeze(['extractPublishedListing','checkStatus']),
 required:Object.freeze(['checkAuthentication','inspect','fillListing','uploadPhotos','verifyForm','preparePublish','publishAfterConfirmation','extractPublishedListing','editListing','checkStatus'])});

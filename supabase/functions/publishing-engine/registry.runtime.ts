// Generated from registry.json; do not edit.
export default {
  "engine": "HOMATCH",
  "version": "0.3.0",
  "portals": [
    {
      "id": "myhome",
      "name": "MyHome.ge",
      "domains": [
        "myhome.ge"
      ],
      "status": "ADAPTER_IMPLEMENTED_NOT_LIVE_VERIFIED",
      "capabilities": {
        "inspect": true,
        "fill": true,
        "create": false,
        "photoUpload": false,
        "publish": false,
        "edit": false,
        "pause": false,
        "resume": false,
        "remove": false,
        "requiresLiveVerification": true
      },
      "browser": {
        "writeOrigins": [
          "https://statements.myhome.ge"
        ],
        "readOrigins": [
          "https://myhome.ge",
          "https://www.myhome.ge"
        ],
        "script": "adapters/myhome/adapter.js",
        "connectUrl": "https://statements.myhome.ge/ka/statement/create?referrer=myhome"
      },
      "execution": {
        "publicationBlocked": true
      },
      "verifiedOperations": {},
      "requirements": {
        "required": [
          "dealType",
          "propertyType",
          "city",
          "price",
          "area"
        ],
        "verificationStatus": "NOT_LIVE_VERIFIED",
        "maxPhotos": 16
      }
    },
    {
      "id": "ssge",
      "name": "SS.ge",
      "domains": [
        "ss.ge"
      ],
      "status": "ADAPTER_IMPLEMENTED_NOT_LIVE_VERIFIED",
      "capabilities": {
        "inspect": true,
        "fill": true,
        "create": false,
        "photoUpload": false,
        "publish": false,
        "edit": false,
        "pause": false,
        "resume": false,
        "remove": false,
        "requiresLiveVerification": true
      },
      "browser": {
        "writeOrigins": [
          "https://home.ss.ge"
        ],
        "readOrigins": [],
        "script": "adapters/ssge/adapter.js",
        "connectUrl": "https://home.ss.ge/"
      },
      "execution": {
        "publicationBlocked": true
      },
      "verifiedOperations": {},
      "requirements": {
        "required": [
          "dealType",
          "propertyType",
          "city",
          "price",
          "area"
        ],
        "verificationStatus": "NOT_LIVE_VERIFIED"
      }
    }
  ]
};

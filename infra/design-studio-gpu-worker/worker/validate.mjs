// Khronos glTF validator over one GLB: prints {"errors":n,"warnings":n} (no paths, no content).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const validator = require('gltf-validator');
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const report = await validator.validateBytes(bytes, { maxIssues: 50, externalResourceFunction: () => Promise.reject(new Error('external resources are not allowed')) });
console.log(JSON.stringify({ errors: report.issues.numErrors, warnings: report.issues.numWarnings }));

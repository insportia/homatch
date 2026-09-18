// THE SIGNER, CHECKED AGAINST AWS'S OWN PUBLISHED ARITHMETIC.
//
// A presigned URL either matches what the server recomputes, byte for byte,
// or it returns SignatureDoesNotMatch. There is no partial credit and no
// useful error message, so the only way to know a hand-written signer is
// right BEFORE pointing it at a real bucket is to reproduce a signature
// somebody else published.
//
// The vector below is AWS's documented query-string authentication example
// (GET examplebucket/test.txt, 20130524, us-east-1). Both the intermediate
// canonical-request hash and the final signature are asserted: if only the
// signature were checked, a wrong answer could not be localised, and the
// canonical request is where hand-written signers actually go wrong.
//
// The rest of the file is about the two things that break a signer in
// production rather than in a doc: an object name with a space or a bracket
// in it, and a key that tries to climb out of the prefix the caller was
// authorised for.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  presign, uriEncode, amzDates, canonicalRequest, canonicalQueryString,
  sha256Hex, signStringToSign,
} from '../sigv4.ts';

// ── AWS's published example ──────────────────────────────────────────────
// docs.aws.amazon.com — "Signature Calculations ... Using Query Parameters"
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const AWS_CANONICAL_HASH = '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04';
const AWS_SIGNATURE = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';

test('canonical request matches the AWS published example exactly', async () => {
  const query = canonicalQueryString({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${AWS_KEY}/20130524/us-east-1/s3/aws4_request`,
    'X-Amz-Date': '20130524T000000Z',
    'X-Amz-Expires': '86400',
    'X-Amz-SignedHeaders': 'host',
  });

  // The slashes inside X-Amz-Credential must come out as %2F. This single
  // character is the most common reason a first attempt gets a 403.
  assert.equal(
    query,
    'X-Amz-Algorithm=AWS4-HMAC-SHA256'
    + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
    + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
  );

  const request = canonicalRequest({
    method: 'GET',
    canonicalUri: '/test.txt',
    canonicalQuery: query,
    host: 'examplebucket.s3.amazonaws.com',
  });

  assert.equal(request, [
    'GET',
    '/test.txt',
    query,
    'host:examplebucket.s3.amazonaws.com',
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n'));

  assert.equal(await sha256Hex(request), AWS_CANONICAL_HASH);
});

test('signing key derivation reproduces the AWS published signature', async () => {
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    '20130524T000000Z',
    '20130524/us-east-1/s3/aws4_request',
    AWS_CANONICAL_HASH,
  ].join('\n');

  assert.equal(
    await signStringToSign({
      secretAccessKey: AWS_SECRET,
      dateStamp: '20130524',
      region: 'us-east-1',
      stringToSign,
    }),
    AWS_SIGNATURE,
  );
});

// ── RFC 3986, which encodeURIComponent does not implement ────────────────

test('uriEncode percent-encodes what S3 expects and nothing else', () => {
  assert.equal(uriEncode('abcXYZ019-_.~'), 'abcXYZ019-_.~');
  assert.equal(uriEncode(' '), '%20');
  // encodeURIComponent leaves all four of these alone; S3 does not.
  assert.equal(uriEncode("!'()*"), '%21%27%28%29%2A');
  assert.equal(uriEncode('a/b'), 'a%2Fb');
  assert.equal(uriEncode('a/b', false), 'a/b');
  // Multi-byte characters encode per UTF-8 byte, uppercase hex.
  assert.equal(uriEncode('ა'), '%E1%83%90');
});

test('amzDates produces the two forms SigV4 uses', () => {
  const { amzDate, dateStamp } = amzDates(new Date('2026-09-19T14:15:30.123Z'));
  assert.equal(amzDate, '20260919T141530Z');
  assert.equal(dateStamp, '20260919');
});

// ── The presigner as callers use it ──────────────────────────────────────

const R2 = {
  endpoint: 'https://acct123.r2.cloudflarestorage.com',
  bucket: 'homatch-storage',
  region: 'auto',
  accessKeyId: 'TESTKEYID',
  secretAccessKey: 'TESTSECRET',
  expiresIn: 300,
  now: new Date('2026-09-19T00:00:00.000Z'),
};

test('presign is deterministic and path-style', async () => {
  const a = await presign({ ...R2, method: 'GET', key: 'dev/a.pdf' });
  const b = await presign({ ...R2, method: 'GET', key: 'dev/a.pdf' });
  assert.equal(a.url, b.url);

  const url = new URL(a.url);
  // Path-style: the bucket is in the path, not the hostname. One bucket, one
  // hostname, no DNS record per bucket.
  assert.equal(url.host, 'acct123.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/homatch-storage/dev/a.pdf');
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.equal(a.expiresAt, '2026-09-19T00:05:00.000Z');
});

test('the verb is part of the signature: a GET URL cannot PUT', async () => {
  const get = await presign({ ...R2, method: 'GET', key: 'dev/a.pdf' });
  const put = await presign({ ...R2, method: 'PUT', key: 'dev/a.pdf' });
  assert.notEqual(
    new URL(get.url).searchParams.get('X-Amz-Signature'),
    new URL(put.url).searchParams.get('X-Amz-Signature'),
  );
});

test('the key is part of the signature: one URL opens one object', async () => {
  const mine = await presign({ ...R2, method: 'GET', key: 'user-a/contract.pdf' });
  const theirs = await presign({ ...R2, method: 'GET', key: 'user-b/contract.pdf' });
  assert.notEqual(
    new URL(mine.url).searchParams.get('X-Amz-Signature'),
    new URL(theirs.url).searchParams.get('X-Amz-Signature'),
  );
});

test('slashes stay separators, everything else in a segment is encoded', async () => {
  const { url } = await presign({ ...R2, method: 'GET', key: 'a b/holiday (1).jpg' });
  // Not %2F between the segments, but the space and brackets encoded.
  assert.ok(url.includes('/homatch-storage/a%20b/holiday%20%281%29.jpg'), url);
});

test('a key that climbs out of its prefix is refused', async () => {
  // The authorisation decision is made about a PREFIX. A key containing ..
  // would be a URL for an object outside the prefix that was checked.
  await assert.rejects(
    presign({ ...R2, method: 'GET', key: 'user-a/../user-b/contract.pdf' }),
    /traversal/,
  );
  await assert.rejects(presign({ ...R2, method: 'GET', key: '/absolute' }), /traversal/);
});

test('expiry is bounded, and a missing credential is refused without naming it', async () => {
  await assert.rejects(presign({ ...R2, method: 'GET', key: 'a', expiresIn: 0 }), /expiresIn/);
  await assert.rejects(
    presign({ ...R2, method: 'GET', key: 'a', expiresIn: 604801 }), /expiresIn/,
  );
  // The message must not say WHICH credential is missing, or a log line
  // becomes a hint about the shape of the configuration.
  await assert.rejects(
    presign({ ...R2, method: 'GET', key: 'a', secretAccessKey: '' }),
    (err) => err.message === 'presign: credentials are not configured',
  );
});

test('a bucket-scoped signature is opt-in, never the result of a missing key', async () => {
  // A listing signs the BUCKET, which is a far broader capability than one
  // object. Forgetting the key must be an error, not a promotion.
  await assert.rejects(presign({ ...R2, method: 'GET', key: '' }), /required/);

  const listing = await presign({
    ...R2, method: 'GET', key: '', bucketScope: true,
    query: { 'list-type': '2', 'max-keys': '1000' },
  });
  const url = new URL(listing.url);
  // The bucket itself, with no trailing object path.
  assert.equal(url.pathname, '/homatch-storage');
  assert.equal(url.searchParams.get('list-type'), '2');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);

  // And it is a DIFFERENT signature from any object under it, so a listing
  // URL cannot be edited into an object URL.
  const object = await presign({ ...R2, method: 'GET', key: 'dev/a.pdf' });
  assert.notEqual(
    url.searchParams.get('X-Amz-Signature'),
    new URL(object.url).searchParams.get('X-Amz-Signature'),
  );
});

test('the secret never appears in the signed URL', async () => {
  const { url } = await presign({
    ...R2, method: 'PUT', key: 'dev/a.pdf',
    accessKeyId: 'AKIDVISIBLE', secretAccessKey: 'SECRETMUSTNOTLEAK',
  });
  // The access key id is public by design and appears in X-Amz-Credential.
  assert.ok(url.includes('AKIDVISIBLE'));
  assert.ok(!url.includes('SECRETMUSTNOTLEAK'));
});

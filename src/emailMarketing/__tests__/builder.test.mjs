// Visual builder + deliverability (owner brief 2026-10-24): the tree refuses placements the
// format cannot hold, new blocks render as email-safe tables, hidden layers never ship, the HTML
// block keeps only the allowlist, compatibility warnings carry real fixes, and the header and
// DNS analyzers report unknown as unknown — never as a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock, normalizeDoc, walkBlocks } from '../designer/document.ts';
import { renderDesignBody } from '../designer/render.ts';
import { emailHtmlToText, sanitizeEmailHtml } from '../designer/emailHtml.ts';
import {
  columnKey, duplicateBlocks, findBlock, groupIntoSection, insertBlocks, isLockedPath, layerRows, locate, moveBlocks, nudge, pasteBlocks,
  removeBlocks, ROOT, sectionKey, ungroupSection,
} from '../designer/tree.ts';
import { analyzeCompat, applyAllFixes, contrast, GMAIL_CLIP_BYTES } from '../designer/compat.ts';
import { buttonsMissingLink, imagesMissingAlt } from '../designer/checks.ts';
import { analyzeHeaders, orgDomain } from '../deliverability/headers.ts';
import { checkDomainAuth, spfLookups } from '../deliverability/dnsCheck.ts';

const B = (type, extra = {}) => ({ ...createBlock(type), ...extra });

test('document: sections, new blocks and layer fields survive normalization, bounded', () => {
  const d = normalizeDoc({ blocks: [
    { type: 'section', bgImage: 'http://x.test/a.jpg', children: [{ type: 'section' }, { type: 'text', text: 'in' }, { type: 'columns', ratio: '33-67', columns: [[{ type: 'badge', text: 'NEW' }], []] }] },
    { type: 'icon', glyph: 'rocket', label: 'x' },
    { type: 'gallery', images: [{ src: 'https://i.test/1.jpg', alt: 'a' }] },
    { type: 'video', thumbSrc: 'https://i.test/t.jpg', href: 'javascript:alert(1)' },
    { type: 'html', html: '<p onclick="x()">Hi<script>alert(1)</script></p>' },
    { type: 'text', text: 'n', name: '  Intro  ', locked: true, hidden: true, margin: { t: 500, b: -4 } },
  ] });
  const [s, icon, gal, vid, html, txt] = d.blocks;
  assert.equal(s.type, 'section');
  assert.equal(s.bgImage, '', 'section background images must be https');
  assert.deepEqual(s.children.map((c) => c.type), ['text', 'columns'], 'no section inside a section');
  assert.equal(s.children[1].ratio, '33-67');
  assert.equal(icon.glyph, 'check');
  assert.equal(gal.images.length, 2, 'a gallery keeps two slots at least');
  assert.equal(vid.href, '');
  assert.equal(html.html, '<p>Hi</p>');
  assert.equal(txt.name, 'Intro'); assert.equal(txt.locked, true); assert.equal(txt.hidden, true);
  assert.deepEqual(txt.margin, { t: 80, b: 0 });
});

test('tree: placements the format cannot hold are refused, moves keep order and ids', () => {
  const sec = B('section', { children: [] });
  const cols = B('columns');
  const a = B('text'), b = B('heading'), c = B('button');
  let blocks = [a, sec, cols, b, c];
  assert.equal(insertBlocks(blocks, { container: sectionKey(sec.id), index: 0 }, [B('section')]), null, 'section into section');
  assert.equal(insertBlocks(blocks, { container: columnKey(cols.id, 0), index: 0 }, [B('columns')]), null, 'columns into a column');
  assert.equal(moveBlocks(blocks, [sec.id], { container: sectionKey(sec.id), index: 0 }), null, 'never into itself');

  blocks = moveBlocks(blocks, [a.id, b.id], { container: sectionKey(sec.id), index: 0 });
  assert.deepEqual(findBlock(blocks, sec.id).children.map((x) => x.id), [a.id, b.id]);
  assert.deepEqual(blocks.map((x) => x.id), [sec.id, cols.id, c.id]);
  blocks = moveBlocks(blocks, [c.id], { container: columnKey(cols.id, 1), index: 0 });
  assert.deepEqual(locate(blocks, c.id), { container: columnKey(cols.id, 1), index: 0 });
  /* Same-container move counts the index in pre-move terms. */
  const x = [B('text'), B('text'), B('text')];
  const moved = moveBlocks(x, [x[0].id], { container: ROOT, index: 3 });
  assert.deepEqual(moved.map((y) => y.id), [x[1].id, x[2].id, x[0].id]);
  assert.deepEqual(nudge(x, x[2].id, -1).map((y) => y.id), [x[0].id, x[2].id, x[1].id]);
  assert.equal(nudge(x, x[0].id, -1), null);
});

test('tree: duplicate, paste, group and ungroup give fresh ids and fall back to the top level', () => {
  const a = B('text'), b = B('image'), cols = B('columns');
  let blocks = [a, b, cols];
  const dup = duplicateBlocks(blocks, [a.id, b.id]);
  assert.equal(dup.blocks.length, 5); assert.notEqual(dup.ids[0], a.id);
  const g = groupIntoSection(blocks, [a.id, b.id], (children) => ({ ...createBlock('section'), children }));
  blocks = g.blocks;
  assert.deepEqual(blocks.map((x) => x.type), ['section', 'columns']);
  /* A section pasted into a column cannot live there: it lands at the top level after the row. */
  const p = pasteBlocks(blocks, { container: columnKey(cols.id, 0), index: 0 }, [findBlock(blocks, g.id)]);
  assert.deepEqual(p.blocks.map((x) => x.type), ['section', 'columns', 'section']);
  const ids = new Set(walkBlocks(p.blocks).map((x) => x.id));
  assert.equal(ids.size, walkBlocks(p.blocks).length, 'ids stay unique after paste');
  const u = ungroupSection(blocks, g.id);
  assert.deepEqual(u.blocks.map((x) => x.id), [a.id, b.id, cols.id]);
  assert.equal(removeBlocks(blocks, [g.id]).length, 1);
  const rows = layerRows(blocks);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 1, 0, 1, 1]);
  const locked = [{ ...createBlock('section'), locked: true, children: [a] }];
  assert.equal(isLockedPath(locked, a.id), true, 'a locked section locks what is inside');
});

test('render: new blocks are tables and inline styles; hidden layers and play-mark video ship correctly', () => {
  const { html, text } = renderDesignBody({ blocks: [
    { type: 'section', background: '#0C1119', bgImage: 'https://i.test/bg.jpg', radius: 12, children: [{ type: 'heading', text: 'Inside' }, { type: 'columns', ratio: '33-67', columns: [[{ type: 'text', text: 'L' }], [{ type: 'text', text: 'R' }]] }] },
    { type: 'badge', text: 'New' },
    { type: 'icon', glyph: 'phone', label: 'Call us' },
    { type: 'gallery', images: [{ src: 'https://i.test/1.jpg', alt: 'One', href: 'https://h.test/1' }, { src: 'https://i.test/2.jpg', alt: 'Two' }] },
    { type: 'video', thumbSrc: 'https://i.test/t.jpg', alt: 'Tour', href: 'https://v.test/tour', caption: 'Watch the tour' },
    { type: 'html', html: '<table><tr><td style="color:#123456;position:fixed">Cell</td></tr></table>' },
    { type: 'text', text: 'SECRET DRAFT', hidden: true },
    { type: 'text', text: 'Spaced', margin: { t: 24, b: 0 } },
  ] });
  assert.match(html, /bgcolor="#0C1119" background="https:\/\/i\.test\/bg\.jpg"/);
  assert.doesNotMatch(html, /<td style="padding:[^"]*background-color:#0C1119;"/, 'the row around a section is not painted');
  assert.match(html, /Inside/); assert.match(html, /width="\d+"[^>]*>.*L/s);
  assert.match(html, /text-transform:uppercase;[^"]*">New</);
  assert.match(html, /☎/);
  assert.equal((html.match(/i\.test\/[12]\.jpg/g) ?? []).length, 2);
  assert.match(html, /href="https:\/\/v\.test\/tour"[^>]*><img src="https:\/\/i\.test\/t\.jpg"/);
  assert.match(html, /style="color:#123456"/); assert.doesNotMatch(html, /position:fixed/);
  assert.doesNotMatch(html, /SECRET DRAFT/); assert.doesNotMatch(text, /SECRET DRAFT/);
  assert.match(html, /height:24px;">&nbsp;<\/td><\/tr><tr><td[^>]*>.*Spaced/s);
  assert.match(text, /Watch the tour: https:\/\/v\.test\/tour/);
  assert.match(text, /One: https:\/\/h\.test\/1/);
  assert.doesNotMatch(html, /<script|on[a-z]+=/i);
});

test('checks reach nested blocks and skip hidden ones', () => {
  const doc = { blocks: [
    { type: 'section', children: [{ id: 'img1', type: 'image', src: 'https://i.test/a.jpg', alt: '' }, { id: 'vid1', type: 'video', thumbSrc: 'https://i.test/t.jpg', alt: 'x', href: '' }] },
    { type: 'section', hidden: true, children: [{ id: 'img2', type: 'image', src: 'https://i.test/b.jpg', alt: '' }] },
    { id: 'gal', type: 'gallery', images: [{ src: 'https://i.test/c.jpg', alt: '' }, { src: '', alt: '' }] },
  ] };
  assert.deepEqual(imagesMissingAlt(doc).sort(), ['gal', 'img1']);
  assert.deepEqual(buttonsMissingLink(doc), ['vid1']);
});

test('HTML block: allowlist only, idempotent, links and images safe, text part readable', () => {
  const dirty = `<div onmouseover="x"><a href="javascript:alert(1)">bad</a><a href="https://ok.test/a?b=1">ok</a>
    <img src="http://insecure.test/a.png"><img src="https://i.test/a.png" onerror="x">
    <iframe src="https://evil.test"></iframe><style>body{}</style><!--[if mso]>x<![endif]-->
    <span style="background:url(javascript:x);color:red;display:flex;font-size:14px">t</span><form><input></form><b>unclosed`;
  const clean = sanitizeEmailHtml(dirty);
  assert.doesNotMatch(clean, /javascript|onmouseover|onerror|iframe|<style|<form|<input|http:\/\/|url\(|display:flex|mso/i);
  assert.match(clean, /<a target="_blank">bad<\/a>|<a>bad<\/a>/);
  assert.match(clean, /href="https:\/\/ok\.test\/a\?b=1"/);
  assert.match(clean, /<img src="https:\/\/i\.test\/a\.png" alt="" \/>/);
  assert.match(clean, /style="color:red;font-size:14px"/);
  assert.match(clean, /<b>unclosed<\/b><\/div>$/);
  assert.equal(sanitizeEmailHtml(clean), clean, 'idempotent');
  assert.equal(emailHtmlToText('<p>One <a href="https://x.test">link</a></p><p>Two</p>'), 'One link (https://x.test)\nTwo');
  assert.ok(sanitizeEmailHtml('<p>' + 'x'.repeat(50000) + '</p>').length <= 20000);
});

test('compatibility: real warnings with email-safe fixes; contrast is WCAG', () => {
  assert.equal(contrast('#000000', '#FFFFFF'), 21);
  const doc = normalizeDoc({ theme: { width: 680 }, blocks: [
    { id: 's1', type: 'section', bgImage: 'https://i.test/bg.jpg', radius: 8, children: [{ type: 'text', text: 'x' }] },
    { id: 'c1', type: 'columns', stackOnMobile: false, columns: [[], []] },
    { id: 't1', type: 'text', text: 'pale', color: '#DDDDDD', fontSize: 11 },
    { id: 'h1', type: 'html', html: '<p>x</p>' },
    { id: 'd1', type: 'text', text: 'desk', hideOnDesktop: true },
  ] });
  const codes = analyzeCompat(doc).map((w) => `${w.code}:${w.blockId ?? ''}`);
  for (const c of ['BG_IMAGE_OUTLOOK:s1', 'COLUMNS_NO_STACK:c1', 'TEXT_SMALL:t1', 'LOW_CONTRAST:t1', 'CUSTOM_HTML:h1', 'HIDE_DESKTOP_STYLE:d1', 'RADIUS_OUTLOOK:s1', 'WIDE_LAYOUT:']) {
    assert.ok(codes.includes(c), c);
  }
  const fixed = applyAllFixes(doc);
  const left = analyzeCompat(fixed).map((w) => w.code);
  for (const c of ['BG_IMAGE_OUTLOOK', 'COLUMNS_NO_STACK', 'TEXT_SMALL', 'LOW_CONTRAST', 'HIDE_DESKTOP_STYLE', 'WIDE_LAYOUT']) assert.ok(!left.includes(c), c);
  assert.ok(left.includes('CUSTOM_HTML'), 'no automatic fix invents a replacement for custom HTML');
  const big = { blocks: Array.from({ length: 60 }, () => ({ type: 'text', text: 'Lorem ipsum dolor sit amet '.repeat(70) })) };
  const clip = analyzeCompat(big).find((w) => w.code === 'GMAIL_CLIP');
  assert.ok(clip && clip.severity === 'warn' && clip.vars.kb * 1024 > GMAIL_CLIP_BYTES);
});

const GMAIL_SPAM = `Delivered-To: owner@gmail.com
Received: by 2002:a05:6a10:1234 with SMTP id abc;
        Fri, 24 Oct 2026 10:00:00 -0700 (PDT)
Authentication-Results: mx.google.com;
       dkim=pass header.i=@homatch.live header.s=resend header.b=AbC;
       dkim=pass header.i=@amazonses.com header.s=224i4yxa header.b=XyZ;
       spf=pass (google.com: domain of bounces@send.homatch.live designates 54.240.0.1 as permitted sender) smtp.mailfrom=bounces@send.homatch.live;
       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=homatch.live
Return-Path: <bounces@send.homatch.live>
Received: from a1-2.smtp-out.amazonses.com (a1-2.smtp-out.amazonses.com. [54.240.0.1])
        by mx.google.com with ESMTPS id x for <owner@gmail.com>
        (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256 bits=128/128);
From: Owner via HOMATCH <CSmarketing@homatch.live>
List-Unsubscribe: <https://www.homatch.live/m/s?esu=1&t=2>
Message-ID: <abc@email.amazonses.com>

body`;

test('headers: what the receiver concluded, alignment computed, absence reported as absence', () => {
  const r = analyzeHeaders(GMAIL_SPAM);
  assert.equal(r.fromDomain, 'homatch.live');
  assert.equal(r.spf.result, 'pass'); assert.equal(r.spf.domain, 'send.homatch.live');
  assert.deepEqual(r.dkim.map((d) => d.domain), ['homatch.live', 'amazonses.com']);
  assert.equal(r.dmarc.result, 'pass'); assert.equal(r.dmarc.policy, 'none');
  assert.equal(r.tls, true); assert.equal(r.listUnsubscribe, true); assert.equal(r.listUnsubscribePost, false);
  const codes = r.findings.map((f) => f.code);
  for (const c of ['SPF_PASS', 'DKIM_ALIGNED_PASS', 'DMARC_PASS', 'DMARC_POLICY_NONE', 'NO_ONE_CLICK']) assert.ok(codes.includes(c), c);
  assert.ok(!codes.includes('SPF_NOT_ALIGNED'), 'send.homatch.live aligns with homatch.live (relaxed)');
  /* No Return-Path header (Gmail often shows none): the envelope domain comes from smtp.mailfrom. */
  const noRp = analyzeHeaders(GMAIL_SPAM.replace(/^Return-Path:.*\n/m, ''));
  assert.equal(noRp.returnPathDomain, null);
  assert.equal(noRp.spf.domain, 'send.homatch.live');
  assert.ok(!noRp.findings.some((f) => f.code === 'SPF_NOT_ALIGNED'), 'never "not aligned" against an unknown domain');
  const none = analyzeHeaders('From: a@b.test\nSubject: x\n\nbody');
  assert.deepEqual(none.findings.map((f) => f.code), ['NO_AUTH_RESULTS', 'NO_LIST_UNSUBSCRIBE']);
  assert.equal(none.spf.result, 'unknown'); assert.equal(none.tls, null);
  const ms = analyzeHeaders('From: a@homatch.live\nAuthentication-Results: spf=fail smtp.mailfrom=x.test; dkim=none; dmarc=fail action=quarantine header.from=homatch.live; compauth=fail reason=000\nX-MS-Exchange-Organization-SCL: 6\n\n');
  const mc = ms.findings.map((f) => f.code);
  for (const c of ['SPF_FAIL', 'DKIM_FAIL', 'DMARC_FAIL', 'MS_COMPAUTH_FAIL', 'MS_SCL_JUNK']) assert.ok(mc.includes(c), c);
  assert.equal(orgDomain('send.homatch.live'), 'homatch.live'); assert.equal(orgDomain('a.b.co.uk'), 'b.co.uk');
});

test('dns check: the live homatch.live shape, failures as UNKNOWN, misconfigurations named', async () => {
  const table = {
    'send.homatch.live TXT': ['"v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all"'],
    'resend._domainkey.homatch.live TXT': ['"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"'],
    '_dmarc.homatch.live TXT': ['"v=DMARC1; p=none;"'],
    'homatch.live TXT': ['"v=spf1 include:_spf.mail.hostinger.com ~all"'],
  };
  const resolve = async (n, t) => table[`${n} ${t}`] ?? [];
  const r = await checkDomainAuth('homatch.live', resolve);
  assert.equal(r.spf.state, 'OK'); assert.equal(r.dkim.state, 'OK');
  assert.equal(r.dmarc.state, 'WARN'); assert.deepEqual(r.dmarc.codes, ['DMARC_POLICY_NONE', 'DMARC_NO_REPORTS']);
  assert.equal(r.alignment.state, 'OK'); assert.equal(r.rootSpf.records, 1);
  const failing = await checkDomainAuth('x.test', async () => null);
  assert.deepEqual([failing.spf.state, failing.dkim.state, failing.dmarc.state, failing.alignment.state], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  const bad = await checkDomainAuth('y.test', async (n, t) => (n === 'y.test' && t === 'TXT' ? ['v=spf1 a ~all', 'v=spf1 mx ~all'] : n === 'resend._domainkey.y.test' ? ['v=DKIM1; p='] : []));
  assert.deepEqual([bad.spf.codes, bad.dkim.codes, bad.dmarc.codes, bad.rootSpf.codes], [['SPF_MISSING'], ['DKIM_REVOKED'], ['DMARC_MISSING'], ['ROOT_SPF_DUPLICATE']]);
  assert.equal(spfLookups('v=spf1 include:a include:b a mx ip4:1.2.3.4 ~all'), 4);
});

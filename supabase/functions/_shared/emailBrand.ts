// EMAIL BRAND — the one HOMATCH email header, shared by every transactional email
// (notifyEmail.ts) and mirrored by the Supabase Auth templates (supabase/templates/auth).
//
// THE LOGO URL (2026-10-30). It used to be https://homatch.live/images/logo/homatch-icon.png.
// That host never serves the image: it answers 308 → www.homatch.live (Vercel's canonical
// domain). Browsers and Gmail's proxy follow the redirect; Outlook desktop and several other
// clients do not follow redirects for images, so the header showed no logo there. The logo
// is now addressed on the host that serves it directly (200 image/png).
//
// The asset is the website's own mark (src/components/common/HomatchLogo.tsx): the gold H on
// a transparent background, a 512×512 PNG shown at 40×40 (crisp on 2×/3× screens). PNG,
// never SVG: Gmail and Outlook do not render SVG images.
//
// Images blocked: the alt text names the brand and the wordmark is real text beside it, so
// the header still reads "HOMATCH". Dark mode: the header is dark by design (#0C1119, gold
// mark and wordmark), set as both bgcolor (Outlook's Word engine ignores CSS backgrounds on
// cells) and CSS, and the document declares light/dark support so clients do not invert it.

export const EMAIL_SITE = 'https://www.homatch.live';
export const EMAIL_LOGO_URL = `${EMAIL_SITE}/images/logo/homatch-icon.png`;
export const EMAIL_LOGO_SIZE = 40;
export const EMAIL_LOGO_ALT = 'HOMATCH';
export const EMAIL_HEADER_BG = '#0C1119';
export const EMAIL_GOLD = '#E8B04B';

/** <head> content every HOMATCH email carries: UTF-8, mobile viewport, light/dark support. */
export function emailHead(title: string): string {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">`
    + `<title>${title}</title>`;
}

/** The header row: the official mark and the HOMATCH wordmark, on the brand's dark band. */
export function emailHeaderRow(o: { rtl: boolean }): string {
  const gap = o.rtl ? 'left' : 'right';
  return `<tr><td bgcolor="${EMAIL_HEADER_BG}" style="background:${EMAIL_HEADER_BG};padding:18px 24px;border-radius:12px 12px 0 0">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td style="padding-${gap}:12px;vertical-align:middle"><img src="${EMAIL_LOGO_URL}" width="${EMAIL_LOGO_SIZE}" height="${EMAIL_LOGO_SIZE}" alt="${EMAIL_LOGO_ALT}" style="display:block;width:${EMAIL_LOGO_SIZE}px;height:${EMAIL_LOGO_SIZE}px;border:0;outline:none;text-decoration:none"></td>`
    + `<td style="vertical-align:middle;color:${EMAIL_GOLD};font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;letter-spacing:.12em">HOMATCH</td>`
    + `</tr></table></td></tr>`;
}

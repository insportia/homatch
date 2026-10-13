# Portal evidence — 2026-10-13

**Not an integration acceptance report. Zero working integrations or assisted workflows are claimed.** The ten candidate domains were checked through web retrieval. Rendered Chromium discovery failed for both priority portals with `ERR_NETWORK_ACCESS_DENIED`; the discovery script then stopped. Failed web retrieval does not establish inactivity.

Common status for all candidates: official publishing API availability unknown; automation permission unverified; create/edit/delete/photo-upload operations not implemented or live-tested; no account authenticated; no authorized live-test account supplied; live-test readiness blocked pending rendered discovery, permitted integration method and owner-authorized test account. Browser feasibility is unknown because environment denial happens before portal inspection. No anti-bot or MFA bypass attempted.

| Domain | Web retrieval / relevance evidence | Account / registration evidence | SMS/MFA evidence | Remaining discovery |
|---|---|---|---|---|
| myhome.ge | [Official property portal](https://www.myhome.ge/) retrieved | Login/registration flow not inspected | Unknown | Priority: rendered login/submission/management and TNET terms/partner API |
| ss.ge | [Official real estate page](https://home.ss.ge/ka/udzravi-qoneba) retrieved, login and placement controls in web output | Registration destination not verified | Unknown | Priority: rendered authentication and placement, terms/partner API |
| livo.ge | [Official portal](https://livo.ge/) retrieved; add link points to [statement creation](https://statements.livo.ge/ka/statement/create?referrer=livo) | Registration destination not verified; statement page returned no readable web content | Unknown | Rendered shared TNET authentication, submission and [terms](https://auth.tnet.ge/ka/rules) |
| home.ge | [Official property portal](https://www.home.ge/) initially retrieved; later requests timed out | Unknown | Unknown | Rendered discovery, registration and permissions |
| korter.ge | [Official portal](https://korter.ge/) retrieved; sale/rent/daily rent and add/login controls visible in web output | Registration destination not verified | Unknown | Rendered account/add flow and partner restrictions |
| place.ge | [Official portal](https://place.ge/) retrieved; [add listing](https://place.ge/ge/ads/add) redirects to login | [Registration page](https://place.ge/ge/register_ptk) shows email/password; [login](https://place.ge/ge/login) offers phone and Facebook | [Terms](https://place.ge/ge/terms_of_use) describe email/mobile confirmation; actual challenge flow not tested | Rendered fields and account management; automation permission; paid options must be checked at submission |
| area.ge | Both bare and www web retrieval failed | Unknown | Unknown | Verify availability with rendered browser before deciding whether replacement needed |
| gancxadebebi.ge | Both bare and www web retrieval failed | Unknown | Unknown | Verify availability/relevance with rendered browser before deciding whether replacement needed |
| binebi.ge | [Official portal](https://binebi.ge/) retrieved; add leads to login | [Login](https://binebi.ge/login) shows email/mobile + password, Google/Facebook; official registration link points to `https://binebi.ge/register/` but destination fetch failed | Login page offers one-time code to mobile or email. Delivery/verification and permitted HOMATCH relay unverified | Rendered registration, challenge, submission, management, terms and API |
| dgiurad.ge | Bare domain web retrieval failed; [www portal](https://www.dgiurad.ge/) retrieved and is relevant to daily rentals | Login/register text visible; no verified standalone registration destination | Unknown | Rendered authentication and daily-rental submission; suitability for other transaction types |

## Interpretation

Web-extracted controls are preliminary discovery evidence, not rendered DOM selector validation. The Place registration page, Binebi login page and TNET creation URL are useful next-session entry points. No invented registration URLs, field limits, free-listing guarantees, external IDs or successful operations have been added to the product.

The resumed investigation retrieved three additional relevant candidates. These are provisional alternatives to inaccessible targets; failure to fetch does not prove inactivity.

| Additional domain | Verified web entry points | Authentication evidence | Limitations |
|---|---|---|---|
| makler.ge | [Official portal](https://www.makler.ge/ka), [registration](https://www.makler.ge/ka/registration), [add listing](https://www.makler.ge/ka/add/) redirects to [login](https://www.makler.ge/ka/login) | Registration/login destinations retrieved; challenges/session behavior unknown | Rendered fields, automation permission, required data, photos, management and live operations unverified |
| binebi.info | [Official portal](https://binebi.info/ka), add/account link leads to [login](https://binebi.info/ka/login) | Web login shows username/email and password. Official registration link fetched as `/ka/ka/register` and failed; no URL invented | Relevant daily-rental candidate; OTP, actual submission fields, limits and management unverified |
| gege24.com | [Official Georgian property marketplace](https://gege24.com/) retrieved | Account/registration unverified | Additional candidate only; no adapter or assisted path claimed |

The initial eight plus Makler and Binebi.info form ten registry candidates. `publisher-worker/schema/portal-seed.sql` records ten disabled `DISCOVERED` entries and only verified registration destinations. This is **not** ten working integrations or assisted workflows. None is connected or production ready.

The installed MCP server initialized/listed tools, but navigation returned a closed-target error. No rendered portal form or selector is validated. See [MCP diagnosis](MCP-SETUP.md).

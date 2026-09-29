/**
 * THE KEY NAMESPACE: WHAT A KEY MAY LOOK LIKE, AND WHAT MAY GO IN IT.
 *
 * WHAT THIS FILE IS NOT
 *
 * It is not the authorisation. That moved into Postgres — `storage_authorize`
 * — because ownership is a question about rows, and a rule that lives away
 * from the rows it is about drifts from them silently. What remains here is
 * everything decidable from the key and the request alone:
 *
 *   * is this a well-formed key at all;
 *   * does this namespace and category exist;
 *   * is this caller even in the right category of person (anonymous versus
 *     signed in) — a coarse gate that runs before a database round trip;
 *   * may a file of this type and this size be written here.
 *
 * Nothing is signed unless BOTH this file and Postgres say yes. That is
 * deliberate belt and braces: this half is exhaustively unit tested and
 * cannot see the data; the other half sees the data and is proven against
 * production. Each catches what the other cannot.
 *
 * THE KEY SHAPE
 *
 *   users/<users.id>/<category>/<entity uuid>/<object uuid>.<ext>
 *   users/<users.id>/<category>/<object uuid>.<ext>
 *
 * The account uuid, because an email address changes and is personal
 * information, and a key ends up in logs, in a dashboard and inside a URL.
 * The object is a uuid rather than the uploaded filename for the same reason:
 * "divorce-settlement-final.pdf" is not something to put in a path. The
 * display name lives in storage_objects.original_filename.
 *
 * Alongside it, unchanged:
 *
 *   <legacy bucket>/<its old path>     objects copied out of Supabase
 *   site-assets/ system/ research/ diagnostics/
 *
 * The legacy shapes exist because a migrated object keeps the path it had.
 * That is what makes the copy a copy and the rollback "read from the old
 * place again" rather than a rewrite of every row that references it.
 */

export type StorageAction = 'READ' | 'WRITE' | 'DELETE';

/**
 * The coarse gate. Fine-grained ownership is Postgres's answer, not this
 * file's — `AUTHENTICATED` here means "a database question follows", never
 * "anyone signed in may have it".
 */
export type Requirement =
  | { kind: 'ANYONE' }
  | { kind: 'AUTHENTICATED' }
  | { kind: 'ADMIN' };

/** What may be written here, and how big. */
export interface ContentPolicy {
  /** An entry ending in `/` matches as a prefix; `*` means no restriction. */
  mime: string[];
  maxBytes: number;
}

const MB = 1024 * 1024;

const IMAGE: ContentPolicy = {
  mime: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/gif'],
  maxBytes: 25 * MB,
};
const DOCUMENT: ContentPolicy = {
  mime: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel',
    // A photographed document is how most people send one.
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'text/plain',
  ],
  maxBytes: 50 * MB,
};
const MEDIA: ContentPolicy = {
  mime: ['image/', 'video/mp4', 'video/webm', 'model/gltf-binary', 'model/gltf+json'],
  maxBytes: 200 * MB,
};
const AUDIO: ContentPolicy = { mime: ['audio/'], maxBytes: 50 * MB };
// HOMATCH Design Studio. A customer floor plan (drawing or PDF), a customer
// 3D model (glTF only: other formats would need a conversion service that
// does not exist), and small version thumbnails.
const DS_FLOORPLAN: ContentPolicy = {
  mime: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxBytes: 25 * MB,
};
const DS_MODEL: ContentPolicy = { mime: ['model/gltf-binary', 'model/gltf+json'], maxBytes: 200 * MB };
const DS_THUMBNAIL: ContentPolicy = { mime: ['image/webp', 'image/jpeg', 'image/png'], maxBytes: 2 * MB };
const ANY_SMALL: ContentPolicy = { mime: ['*'], maxBytes: 25 * MB };

export interface CategoryRules {
  READ: Requirement;
  WRITE: Requirement;
  DELETE: Requirement;
  content: ContentPolicy;
  /** True when an <entity uuid> segment sits between category and object. */
  entityRequired: boolean;
  /** What that entity uuid refers to; recorded on the metadata row. */
  entityType: string | null;
  note?: string;
}

const owned = (
  content: ContentPolicy, entityRequired: boolean, entityType: string | null, note?: string,
): CategoryRules => ({
  READ: { kind: 'AUTHENTICATED' },
  WRITE: { kind: 'AUTHENTICATED' },
  DELETE: { kind: 'AUTHENTICATED' },
  content, entityRequired, entityType, note,
});

/**
 * The categories an account-scoped key may use. An unlisted one is refused
 * rather than defaulted: a key nobody has written rules for is a key nobody
 * has decided the answer for.
 */
export const ACCOUNT_CATEGORIES: Record<string, CategoryRules> = {
  'property-photos': owned(IMAGE, true, 'property'),
  'deal-room-documents': owned(DOCUMENT, true, 'deal_room'),
  'mortgage-documents': owned(DOCUMENT, true, 'mortgage_offer'),
  'expat-attachments': owned(DOCUMENT, true, 'expat_task'),
  'generated-reports': owned(DOCUMENT, false, 'report'),
  // Design Studio: the entity is the ds_projects row; storage_authorize
  // resolves its owner (owner only, Admin read-only).
  'design-studio-floorplans': owned(DS_FLOORPLAN, true, 'ds_project'),
  'design-studio-models': owned(DS_MODEL, true, 'ds_project'),
  'design-studio-thumbnails': owned(DS_THUMBNAIL, true, 'ds_project'),
  'developer-documents': owned(
    DOCUMENT, true, 'dev_workspace',
    'Workspace-owned. The account segment records who uploaded it; the '
    + 'capability decides who may read it, so somebody who leaves the '
    + 'workspace loses the file and their colleagues keep it.',
  ),
  'developer-media': {
    // Public delivery today: live marketing pages link straight at it.
    READ: { kind: 'ANYONE' },
    WRITE: { kind: 'AUTHENTICATED' },
    DELETE: { kind: 'AUTHENTICATED' },
    content: MEDIA, entityRequired: true, entityType: 'dev_workspace',
  },
};

export interface NamespaceRules {
  /** The Supabase bucket whose objects this namespace holds, if any. */
  legacyBucket: string;
  /** ACCOUNT keys carry a users.id; the rest are flat or scope-prefixed. */
  shape: 'ACCOUNT' | 'OWNER' | 'WORKSPACE' | 'FLAT';
  READ: Requirement;
  WRITE: Requirement;
  DELETE: Requirement;
  content: ContentPolicy;
  note?: string;
}

const AUTHED: Requirement = { kind: 'AUTHENTICATED' };
const ADMIN: Requirement = { kind: 'ADMIN' };
const ANYONE: Requirement = { kind: 'ANYONE' };

export const NAMESPACES: Record<string, NamespaceRules> = {
  /** Everything a person owns, from now on. */
  users: {
    legacyBucket: '', shape: 'ACCOUNT',
    // Per-category rules take over once the key is parsed; these are a floor.
    READ: AUTHED, WRITE: AUTHED, DELETE: AUTHED, content: ANY_SMALL,
  },

  // ── Legacy functional namespaces: migrated objects keep their paths ───
  'deal-room-documents': {
    legacyBucket: 'deal-room-documents', shape: 'OWNER',
    READ: AUTHED, WRITE: AUTHED, DELETE: AUTHED, content: DOCUMENT,
  },
  'developer-documents': {
    legacyBucket: 'developer-documents', shape: 'WORKSPACE',
    READ: AUTHED, WRITE: AUTHED, DELETE: AUTHED, content: DOCUMENT,
  },
  'developer-media': {
    legacyBucket: 'developer-media', shape: 'WORKSPACE',
    READ: ANYONE, WRITE: AUTHED, DELETE: AUTHED, content: MEDIA,
    note: 'Public delivery today. Do not privatise without fixing the pages.',
  },
  'mortgage-offer-documents': {
    legacyBucket: 'mortgage-offer-documents', shape: 'OWNER',
    READ: AUTHED, WRITE: AUTHED, DELETE: AUTHED, content: DOCUMENT,
  },
  'property-photos': {
    legacyBucket: 'property-photos', shape: 'OWNER',
    READ: AUTHED, WRITE: AUTHED, DELETE: AUTHED, content: IMAGE,
  },
  'voice-auditions': {
    legacyBucket: 'voice-auditions', shape: 'FLAT',
    READ: ADMIN, WRITE: ADMIN, DELETE: ADMIN, content: AUDIO,
    note: 'Recordings of real people. Staff only, as the live policy has it.',
  },
  'meta-ads-media': {
    legacyBucket: 'meta-ads-media', shape: 'OWNER',
    READ: AUTHED, WRITE: AUTHED, DELETE: AUTHED, content: MEDIA,
    note: 'Ad creatives, sender-prefixed (userId/uuid.ext). Private bucket; '
      + 'the live storage policies bind INSERT to the owner prefix and '
      + 'SELECT to owner-or-admin, and the bucket itself caps files at 50MB '
      + 'with image/jpeg,png,webp + video/mp4,quicktime only.',
  },

  // ── System namespaces ─────────────────────────────────────────────────
  'site-assets': {
    legacyBucket: 'site-assets', shape: 'FLAT',
    READ: ANYONE, WRITE: ADMIN, DELETE: ADMIN, content: MEDIA,
  },
  system: {
    legacyBucket: '', shape: 'FLAT',
    READ: ADMIN, WRITE: ADMIN, DELETE: ADMIN, content: ANY_SMALL,
    note: 'Generated assets belonging to Homatch rather than to a person.',
  },
  research: {
    legacyBucket: '', shape: 'FLAT',
    READ: ADMIN, WRITE: ADMIN, DELETE: ADMIN, content: ANY_SMALL,
    note: 'Evidence for Verify/Research. Nothing persists here yet.',
  },
  diagnostics: {
    legacyBucket: '', shape: 'FLAT',
    READ: ADMIN, WRITE: ADMIN, DELETE: ADMIN, content: ANY_SMALL,
    note: 'Self-test objects only. No product code may write here.',
  },
};

/** S3's own limit. */
const MAX_KEY_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedKey {
  namespace: string;
  rules: NamespaceRules;
  /** The users.id for an account-scoped key, else null. */
  accountId: string | null;
  category: string | null;
  categoryRules: CategoryRules | null;
  /** The entity uuid, where the category carries one. */
  entityId: string | null;
  entityType: string | null;
  /** Everything after the namespace. */
  rest: string;
  /** The content policy that applies to this key. */
  content: ContentPolicy;
}

export class KeyError extends Error {}

/**
 * Turn a key into its parts, or refuse it.
 *
 * Refusal is the point. Every check is a way a key could otherwise name an
 * object that a DIFFERENT authorisation decision was made about: traversal
 * climbs out of a prefix, an empty segment collapses two keys into one, and a
 * backslash is a path separator on whatever eventually writes the file down.
 */
export function parseKey(key: string): ParsedKey {
  if (typeof key !== 'string' || key.length === 0) {
    throw new KeyError('storage key is required');
  }
  if (new TextEncoder().encode(key).length > MAX_KEY_BYTES) {
    throw new KeyError('storage key is too long');
  }
  if (key.startsWith('/') || key.endsWith('/')) {
    throw new KeyError('storage key must not start or end with a separator');
  }
  if (key.includes('\\')) throw new KeyError('storage key must not contain a backslash');
  // Control characters are rejected by codepoint rather than by a regex
  // literal, so this source file never has to contain one itself.
  if ([...key].some((ch) => { const c = ch.codePointAt(0) ?? 0; return c < 32 || c === 127; })) {
    throw new KeyError('storage key must not contain control characters');
  }

  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new KeyError('storage key must not contain empty or relative segments');
  }

  const [namespace, ...rest] = segments;
  const rules = Object.prototype.hasOwnProperty.call(NAMESPACES, namespace)
    ? NAMESPACES[namespace]
    : undefined;
  // An unknown prefix is not "probably fine". It is a key nobody has decided
  // the rules for, and the only safe answer is no.
  if (!rules) throw new KeyError(`unknown storage namespace: ${namespace}`);
  if (rest.length === 0) throw new KeyError('storage key must name an object, not a namespace');

  const base: ParsedKey = {
    namespace, rules, accountId: null, category: null, categoryRules: null,
    entityId: null, entityType: null, rest: rest.join('/'), content: rules.content,
  };

  if (rules.shape === 'ACCOUNT') {
    const [accountId, category, ...tail] = rest;
    if (!UUID.test(accountId ?? '')) {
      throw new KeyError('account-scoped key must begin with a user uuid');
    }
    const categoryRules = Object.prototype.hasOwnProperty.call(ACCOUNT_CATEGORIES, category ?? '')
      ? ACCOUNT_CATEGORIES[category]
      : undefined;
    if (!categoryRules) throw new KeyError(`unknown storage category: ${category}`);

    // A fixed depth, so there is exactly one key for one object and no room
    // to smuggle extra path under a category that was approved.
    if (tail.length !== (categoryRules.entityRequired ? 2 : 1)) {
      throw new KeyError('account-scoped keys have a fixed depth');
    }
    let entityId: string | null = null;
    if (categoryRules.entityRequired) {
      if (!UUID.test(tail[0])) throw new KeyError('entity segment must be a uuid');
      entityId = tail[0];
    }
    // The object is a uuid with an optional extension — never the name the
    // file had on somebody's computer.
    const objectSegment = tail[tail.length - 1];
    if (!UUID.test(objectSegment.replace(/\.[A-Za-z0-9]{1,8}$/, ''))) {
      throw new KeyError('the object segment must be a uuid');
    }

    return {
      ...base,
      accountId, category, categoryRules, entityId,
      entityType: categoryRules.entityType,
      content: categoryRules.content,
    };
  }

  if (rules.shape === 'OWNER' || rules.shape === 'WORKSPACE') {
    if (rest.length < 2) throw new KeyError('storage key must name an object inside its scope');
    if (!UUID.test(rest[0])) throw new KeyError('storage key scope segment must be a uuid');
  }

  return base;
}

/** The coarse requirement for this key and verb, before Postgres is asked. */
export function requirementFor(parsed: ParsedKey, action: StorageAction): Requirement {
  return parsed.categoryRules ? parsed.categoryRules[action] : parsed.rules[action];
}

export interface ContentVerdict { ok: boolean; reason?: string }

/**
 * May a file of this type and this size be written to this key?
 *
 * Checked before signing, because a presigned PUT is a capability: once it is
 * minted, whatever holds it can send anything to that key, and the only
 * moment anybody can say no is now. The declared values come from the caller,
 * so this is a policy gate rather than a guarantee about the bytes — what
 * actually arrived is read back from R2 afterwards and recorded.
 */
export function checkContent(
  parsed: ParsedKey, contentType: string | undefined, byteSize: number | undefined,
): ContentVerdict {
  const policy = parsed.content;
  if (typeof byteSize === 'number') {
    if (!Number.isFinite(byteSize) || byteSize < 0) return { ok: false, reason: 'BAD_SIZE' };
    if (byteSize > policy.maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  }
  if (!policy.mime.includes('*')) {
    const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
    if (!mime) return { ok: false, reason: 'MIME_REQUIRED' };
    const allowed = policy.mime.some((entry) => entry.endsWith('/')
      ? mime.startsWith(entry)
      : mime === entry);
    if (!allowed) return { ok: false, reason: 'MIME_NOT_ALLOWED' };
  }
  return { ok: true };
}

/** Extension chosen from the declared type, never from the uploaded name. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/heic': 'heic', 'image/gif': 'gif', 'application/pdf': 'pdf',
  'model/gltf-binary': 'glb', 'model/gltf+json': 'gltf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4',
};

/**
 * Build an account-scoped key.
 *
 * Note what is NOT an input: the uploaded filename. The extension comes from
 * the declared content type, so `passport — Nino.pdf` becomes `…/6f1c….pdf`
 * and the name it had survives only in the metadata row.
 */
export function accountKey(input: {
  accountId: string;
  category: string;
  entityId?: string | null;
  objectId: string;
  contentType?: string;
}): string {
  const rules = ACCOUNT_CATEGORIES[input.category];
  if (!rules) throw new KeyError(`unknown storage category: ${input.category}`);
  if (!UUID.test(input.accountId)) throw new KeyError('accountId must be a uuid');
  if (!UUID.test(input.objectId)) throw new KeyError('objectId must be a uuid');
  if (rules.entityRequired && !UUID.test(input.entityId ?? '')) {
    throw new KeyError(`${input.category} needs an entity uuid`);
  }
  const ext = EXT_BY_MIME[(input.contentType ?? '').split(';')[0].trim().toLowerCase()];
  const object = ext ? `${input.objectId}.${ext}` : input.objectId;
  return rules.entityRequired
    ? `users/${input.accountId}/${input.category}/${input.entityId}/${object}`
    : `users/${input.accountId}/${input.category}/${object}`;
}

/**
 * The key a migrated object takes: the identity with a prefix.
 *
 * Deliberately NOT re-keyed into users/. `bucket/name` becomes `bucket/name`,
 * so the copy is a copy, every storage_path already recorded in the product's
 * own tables still resolves, and rolling back is reading from the old place
 * again rather than rewriting production rows. Ownership is not lost by this:
 * it is recorded on the metadata row, resolved from the database.
 */
export function keyForLegacyObject(bucket: string, name: string): string {
  const entry = Object.entries(NAMESPACES)
    .find(([, rules]) => rules.legacyBucket === bucket && rules.legacyBucket !== '');
  if (!entry) throw new KeyError(`no storage namespace for bucket: ${bucket}`);
  return `${entry[0]}/${name}`;
}

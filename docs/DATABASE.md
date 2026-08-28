# Homatch — Database Reference

## Overview

PostgreSQL 15+ (via Supabase). All tables are in the `public` schema.
Migrations are in `supabase/migrations/` — apply in numbered order.
RLS is enabled on all tables.

---

## Migrations

| File | Contents |
|---|---|
| `00001_homatch_part1_schema.sql` | Core tables: users, markets, properties, property_facts, property_photos, property_imports, search_profiles, matching_campaigns, activity_events, notifications, user_preferences |
| `00002_part2_matching_credits_signals.sql` | query_packs, source_registry, raw_signals, intent_profiles, matches, match_unlocks, credit_accounts, credit_ledger, payments, cost_events |
| `00003_part3_admin_settings_roles.sql` | admin_settings, provider_health, is_admin on users |

---

## Tables

### users
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Homatch internal ID — used in all relations |
| auth_id | uuid UNIQUE | Supabase auth.uid() |
| email | text | |
| full_name | text | |
| avatar_url | text | |
| is_admin | boolean | Default false — set manually or via migration |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### user_preferences
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users | |
| language | text | KA/EN/RU/TR/AR/HE |

### markets
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| country_code | text | ISO 3166-1 alpha-2 |
| country_name | text | |
| enabled | boolean | Admin-toggleable |
| launch_priority | int | |
| default_currency | text | ISO 4217 |
| supported_languages | text[] | |
| query_pack_id | uuid FK query_packs | Optional |

### properties
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users | Owner |
| title | text | |
| source_type | text | URL_IMPORT / PRIVATE_LISTING |
| source_url | text | Original URL if imported |
| deleted_at | timestamptz | Soft delete |

### property_facts
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| property_id | uuid FK properties | 1:1 |
| country_code | text | |
| city | text | |
| district | text | |
| address | text | |
| property_type | text | Enum |
| transaction_type | text | SALE/RENT/INVESTMENT |
| price_amount | numeric | |
| price_currency | text | |
| bedrooms | int | |
| bathrooms | int | |
| area_sqm | numeric | |
| condition | text | |
| building_type | text | |
| heating_type | text | |
| floor | int | |
| total_floors | int | |
| amenities | text[] | |
| address_visibility | text | FULL/CITY_ONLY/HIDDEN |

### property_photos
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| property_id | uuid FK properties | |
| storage_path | text | Supabase Storage path |
| visibility | text | PUBLIC/PRIVATE/AUTHENTICATED |
| display_order | int | |

### property_imports
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| property_id | uuid FK properties | |
| url | text | |
| status | text | PENDING/PROCESSING/COMPLETED/FAILED/CACHED |
| error_code | text | |
| error_message | text | |
| extraction_provider | text | DIRECT/ZENROWS/SCRAPINGBEE |
| raw_html_cached | boolean | |
| created_at | timestamptz | |

### search_profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| property_id | uuid FK properties | 1:1 |
| intent_types | text[] | What to match against |
| target_countries | text[] | |
| target_cities | text[] | |
| transaction_types | text[] | |
| property_types | text[] | |
| budget_min | numeric | |
| budget_max | numeric | |
| currency | text | |

### matching_campaigns
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| property_id | uuid FK properties | |
| user_id | uuid FK users | |
| status | text | ACTIVE/PAUSED/DRAFT/COMPLETED |
| monthly_budget_credits | numeric | |
| started_at | timestamptz | |
| paused_at | timestamptz | |

### query_packs
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| market_id | uuid FK markets | |
| cache_key | text UNIQUE | Dedup key |
| expires_at | timestamptz | |
| updated_at | timestamptz | |

### source_registry
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| url | text UNIQUE | Canonical URL |
| platform | text | FACEBOOK/TELEGRAM/VK/INSTAGRAM |
| display_name | text | |
| market_id | uuid FK markets | |
| active | boolean | Admin-toggleable |
| quality_score | numeric | 0–10 |
| member_count | int | |
| last_collected_at | timestamptz | |
| discovered_at | timestamptz | |

### raw_signals
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_id | uuid FK source_registry | |
| platform | text | |
| raw_text | text | Original post/message |
| external_id | text | Platform-native ID |
| content_fingerprint | text | SHA-256 of first 200 chars |
| language | text | |
| author_id | text | Platform author ID |
| source_url | text | |
| classification_status | text | PENDING/CLASSIFIED/REJECTED/NOISE |
| discovered_at | timestamptz | |

### intent_profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| raw_signal_id | uuid FK raw_signals | |
| intent_type | text | BUY/RENT/INVEST/RELOCATE_* |
| country | text | |
| city | text | |
| transaction | text | |
| property_types | text[] | |
| bedrooms_min | int | |
| bedrooms_max | int | |
| budget_min | numeric | |
| budget_max | numeric | |
| currency | text | |
| confidence | numeric | 0–1 |
| language | text | |
| created_at | timestamptz | |

### matches
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| property_id | uuid FK properties | |
| user_id | uuid FK users | |
| intent_profile_id | uuid FK intent_profiles | |
| match_score | int | 0–100 |
| signal_strength | text | POTENTIAL/GOOD/STRONG/VERY_STRONG/EXCEPTIONAL |
| unlock_price_credits | numeric | Computed by PricingEngine |
| status | text | LOCKED/PREVIEWED/UNLOCKED |
| preview_* | text/numeric | Redacted preview fields — no full signal |
| created_at | timestamptz | |

### match_unlocks
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| match_id | uuid FK matches UNIQUE | Prevents double-unlock |
| user_id | uuid FK users | |
| credits_charged | numeric | |
| unlocked_at | timestamptz | |

### credit_accounts
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users UNIQUE | |
| balance | numeric | Server-authoritative |
| updated_at | timestamptz | |

### credit_ledger
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users | |
| type | text | TOP_UP/MATCH_UNLOCK/REFUND/ADMIN_ADJUSTMENT |
| amount | numeric | Positive = credit, negative = debit |
| reference_id | uuid | payment_id or match_unlock_id |
| description | text | |
| created_at | timestamptz | Immutable — never updated |

### payments
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users | |
| amount_usd | numeric | |
| credits_granted | numeric | |
| provider | text | stripe / mock |
| provider_reference | text | Stripe session/payment ID |
| idempotency_key | text UNIQUE | Prevents double-grant |
| status | text | PENDING/COMPLETED/FAILED/REFUNDED |
| created_at | timestamptz | |

### cost_events
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| provider | text | DATAFORSEO/APIFY/ZENROWS/OPENAI/etc |
| operation | text | e.g. discover_sources, classify_signal |
| cost_usd | numeric | |
| success | boolean | |
| cache_hit | boolean | |
| property_id | uuid | Optional link |
| raw_signal_id | uuid | Optional link |
| timestamp | timestamptz | |

### activity_events
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users | |
| type | text | ActivityEventType enum |
| metadata | jsonb | |
| created_at | timestamptz | |

### notifications
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK users | |
| type | text | NotificationType enum |
| title | text | |
| body | text | |
| metadata | jsonb | |
| read | boolean | |
| created_at | timestamptz | |

### admin_settings
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| key | text UNIQUE | e.g. spend_cap_global, pricing_base_strong |
| value | jsonb | |
| description | text | |
| updated_by | uuid FK users | |
| updated_at | timestamptz | |

### provider_health
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| provider | text UNIQUE | |
| status | text | NOT_CONFIGURED/MOCK/CONFIGURED_UNVERIFIED/REAL_TEST_PASSED/ERROR |
| last_tested_at | timestamptz | |
| last_success_at | timestamptz | |
| latency_ms | int | |
| last_error | text | |
| success_count | int | |
| failure_count | int | |
| updated_at | timestamptz | |

---

## Key Indexes

```sql
-- Performance
CREATE INDEX idx_properties_user_id ON properties(user_id);
CREATE INDEX idx_matches_property_id ON matches(property_id);
CREATE INDEX idx_matches_user_id ON matches(user_id);
CREATE INDEX idx_credit_ledger_user_id ON credit_ledger(user_id);
CREATE INDEX idx_cost_events_provider ON cost_events(provider);
CREATE INDEX idx_cost_events_timestamp ON cost_events("timestamp");
CREATE INDEX idx_raw_signals_status ON raw_signals(classification_status);
CREATE INDEX idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- Deduplication
CREATE UNIQUE INDEX idx_source_registry_url ON source_registry(url);
CREATE UNIQUE INDEX idx_raw_signals_fingerprint ON raw_signals(content_fingerprint);
CREATE UNIQUE INDEX idx_match_unlocks_match_id ON match_unlocks(match_id);
CREATE UNIQUE INDEX idx_payments_idempotency ON payments(idempotency_key);
```

---

## Export

To export all data:
```bash
# Full schema + data
pg_dump -U postgres homatch > homatch-full.sql

# Data only (for migration to fresh schema)
pg_dump -U postgres --data-only homatch > homatch-data.sql

# Specific tables (e.g. finance audit trail)
pg_dump -U postgres -t credit_ledger -t payments -t cost_events -t match_unlocks homatch > finance-audit.sql
```

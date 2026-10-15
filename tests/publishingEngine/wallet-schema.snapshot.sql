-- Publishing-only staging subset of production schema, captured 2026-10-15.
-- No customer rows, credentials or production mutations. Never run on populated projects.
DO $$ BEGIN IF to_regclass('public.users') IS NOT NULL OR EXISTS(select 1 from auth.users) THEN RAISE EXCEPTION 'EMPTY_ISOLATED_PROJECT_REQUIRED'; END IF; END $$;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
SET search_path=public,extensions;
create type public."address_visibility" as enum ('FULL','CITY_ONLY','HIDDEN');
create type public."building_type" as enum ('PANEL','BRICK','MONOLITH','WOOD','OTHER');
create type public."condition_type" as enum ('NEW','GOOD','NEEDS_RENOVATION','UNDER_CONSTRUCTION');
create type public."heating_type" as enum ('CENTRAL','GAS','ELECTRIC','NONE','OTHER');
create type public."ledger_type" as enum ('TOP_UP','MATCH_UNLOCK','ADMIN_ADJUSTMENT','REFUND','SERVICE_RESERVE','SERVICE_CAPTURE','SERVICE_RELEASE','MEMBERSHIP_GRANT','PROMOTIONAL_GRANT','FIRST_TOPUP_BONUS','EXPIRATION','REVERSAL','REDENOMINATION','BROKER_DISCOVERY','BROKER_DIRECTORY_LISTING');
create type public."matching_status" as enum ('ACTIVE','PAUSED','DRAFT','COMPLETED');
create type public."notification_type" as enum ('IMPORT_COMPLETED','IMPORT_FAILED','MATCHING_STARTED','MATCHING_PAUSED','LOW_CREDITS','MATCH_FOUND','MATCH_AVAILABLE','CREDITS_TOPPED_UP','RESEARCH_PRODUCT_PURCHASED','VERIFY_COMPLETE','DOCUMENT_ANALYZED','SUBSCRIPTION_ACTIVATED','SUBSCRIPTION_RENEWED','SUBSCRIPTION_ENDED','INCLUDED_USAGE_EXHAUSTED','CAMPAIGN_COMPLETED','CAMPAIGN_PAUSED','CAMPAIGN_NEEDS_REVIEW','WHATSAPP_TEMPLATE_REJECTED','WHATSAPP_QUALITY_WARNING','PROVIDER_UNAVAILABLE','PROVIDER_RECOVERED','CALLBACK_REQUESTED','QUALIFIED_LEAD','EXPAT_TASK_DUE','EXPAT_DEADLINE_DUE','NEW_MESSAGE','PROPERTY_ACTION_REQUIRED','SEARCH_COMPLETE','ANNOUNCEMENT','BROKER_APPLICATION','CONTACT_MESSAGE','META_LEAD','META_CAMPAIGN_STATUS','META_ADS_BALANCE','META_GUARD','META_RECOMMENDATION');
create type public."photo_visibility" as enum ('PUBLIC','PRIVATE','AUTHENTICATED');
create type public."property_source_type" as enum ('URL_IMPORT','PRIVATE_LISTING');
create type public."property_type" as enum ('APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','OFFICE','PENTHOUSE','STUDIO','TOWNHOUSE','OTHER');
create type public."supported_language" as enum ('en','ka','ru','tr','ar','he');
create type public."transaction_type" as enum ('SALE','RENT','INVESTMENT');
create table public."admin_settings"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"key" text NOT NULL,
"value" jsonb NOT NULL,
"description" text,
"updated_by" uuid,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."allowance_consumptions"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"product_code" text NOT NULL,
"period_key" text NOT NULL,
"slot_index" integer NOT NULL,
"plan_code" text NOT NULL,
"quality_tier" text NOT NULL,
"reservation_id" uuid,
"job_ref" text,
"released_at" timestamp with time zone,
"release_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."billable_products"(
"code" text NOT NULL,
"name" text NOT NULL,
"billing_mode" text DEFAULT 'VARIABLE'::text NOT NULL,
"requires_reservation" boolean DEFAULT true NOT NULL,
"standard_retail_cents" numeric(14,6) DEFAULT 0 NOT NULL,
"reference_landed_cogs_cents" numeric(12,4) DEFAULT 0 NOT NULL,
"min_gross_margin_bps" integer DEFAULT 3000 NOT NULL,
"estimate_strategy" text DEFAULT 'RANGE'::text NOT NULL,
"pricing_version" integer DEFAULT 1 NOT NULL,
"enabled" boolean DEFAULT true NOT NULL,
"pricing_active" boolean DEFAULT true NOT NULL,
"kill_switch" boolean DEFAULT false NOT NULL,
"sort_order" integer DEFAULT 0 NOT NULL,
"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"min_viable_budget_credits" numeric(18,4) DEFAULT 0 NOT NULL);
create table public."billing_plans"(
"code" text NOT NULL,
"name" text NOT NULL,
"monthly_price_cents" integer DEFAULT 0 NOT NULL,
"membership_credits_grant" numeric(18,4) DEFAULT 0 NOT NULL,
"membership_rollover_cap" numeric(18,4) DEFAULT 0 NOT NULL,
"quality_tier" text DEFAULT 'STANDARD'::text NOT NULL,
"profit_share_to_customer_bps" integer DEFAULT 0 NOT NULL,
"badge_key" text,
"priority_level" integer DEFAULT 0 NOT NULL,
"ai_fair_use_key" text DEFAULT 'ai_chat_daily_limit_free'::text NOT NULL,
"marketing_label_key" text,
"sort_order" integer DEFAULT 0 NOT NULL,
"enabled" boolean DEFAULT true NOT NULL,
"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."broker_directory_listings"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"owner_user_id" uuid NOT NULL,
"broker_id" uuid,
"display_name" text NOT NULL,
"role" text NOT NULL,
"country_code" text DEFAULT 'GE'::text NOT NULL,
"cities" text[] DEFAULT '{}'::text[] NOT NULL,
"languages" text[] DEFAULT '{}'::text[] NOT NULL,
"contact_phone" text,
"contact_email" text,
"website" text,
"status" text DEFAULT 'PENDING_REVIEW'::text NOT NULL,
"paid_until" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"about" text,
"contact_person" text,
"logo_url" text,
"property_types" text[] DEFAULT '{}'::text[] NOT NULL,
"deal_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
"districts" text[] DEFAULT '{}'::text[] NOT NULL,
"experience_years" integer,
"review_note" text,
"whatsapp" text,
"telegram" text,
"segments" text[] DEFAULT '{}'::text[] NOT NULL,
"agency_listing_id" uuid,
"onboarding_completed_at" timestamp with time zone,
"verification_state" text DEFAULT 'UNVERIFIED'::text NOT NULL,
"verification_note" text,
"verification_submitted_at" timestamp with time zone,
"verified_at" timestamp with time zone);
create table public."broker_intelligence"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"key_kind" text NOT NULL,
"natural_key" text NOT NULL,
"role" text NOT NULL,
"display_name" text,
"country_code" text DEFAULT 'GE'::text NOT NULL,
"cities" text[] DEFAULT '{}'::text[] NOT NULL,
"languages" text[] DEFAULT '{}'::text[] NOT NULL,
"deal_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
"last_verified_at" timestamp with time zone,
"content_changed_at" timestamp with time zone,
"validation_state" text DEFAULT 'UNVERIFIED'::text NOT NULL,
"failed_checks" integer DEFAULT 0 NOT NULL,
"observation_count" integer DEFAULT 0 NOT NULL,
"source_count" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."canonical_property_groups"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"canonical_property_id" uuid,
"source_count" integer DEFAULT 0 NOT NULL,
"min_price" numeric(14,2),
"max_price" numeric(14,2),
"price_currency" text,
"price_diff" numeric(14,2),
"last_deduped_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."credit_accounts"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"balance" numeric(12,4) DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"reserved" numeric(18,4) DEFAULT 0 NOT NULL);
create table public."credit_ledger"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"amount" numeric(12,4) NOT NULL,
"balance_before" numeric(12,4) NOT NULL,
"balance_after" numeric(12,4) NOT NULL,
"type" ledger_type NOT NULL,
"reference" text,
"payment_id" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL);
create table public."credit_lot_allocations"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"reservation_id" uuid NOT NULL,
"lot_id" uuid NOT NULL,
"allocated_credits" numeric(18,4) NOT NULL,
"settled_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"released_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"spend_rank" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."credit_lots"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"kind" text NOT NULL,
"credits_granted" numeric(18,4) NOT NULL,
"credits_consumed" numeric(18,4) DEFAULT 0 NOT NULL,
"credits_reserved" numeric(18,4) DEFAULT 0 NOT NULL,
"credits_expired" numeric(18,4) DEFAULT 0 NOT NULL,
"credits_available" numeric(18,4) GENERATED ALWAYS AS ((((credits_granted - credits_consumed) - credits_reserved) - credits_expired)) STORED,
"expires_at" timestamp with time zone,
"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
"source_type" text NOT NULL,
"source_ref" text,
"plan_code" text,
"ledger_entry_id" uuid,
"status" text DEFAULT 'ACTIVE'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."developer_profiles"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"slug" text,
"country" text,
"city" text,
"website" text,
"description" text,
"score" integer,
"score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
"completed_projects" integer DEFAULT 0 NOT NULL,
"active_projects" integer DEFAULT 0 NOT NULL,
"years_active" integer,
"permits" jsonb,
"restrictions" jsonb,
"public_risk_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
"is_sponsored" boolean DEFAULT false NOT NULL,
"last_checked_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."notifications"(
"id" uuid DEFAULT uuid_generate_v4() NOT NULL,
"user_id" uuid NOT NULL,
"type" notification_type NOT NULL,
"title" text NOT NULL,
"body" text,
"read" boolean DEFAULT false NOT NULL,
"property_id" uuid,
"metadata" jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"priority" text DEFAULT 'NORMAL'::text NOT NULL,
"deep_link" text,
"entity_type" text,
"entity_id" uuid,
"seen_at" timestamp with time zone,
"read_at" timestamp with time zone,
"dedupe_key" text,
"group_key" text,
"pushed_at" timestamp with time zone);
create table public."product_plan_entitlements"(
"product_code" text NOT NULL,
"plan_code" text NOT NULL,
"included_per_period" integer DEFAULT 0 NOT NULL,
"period" text DEFAULT 'CALENDAR_MONTH'::text NOT NULL,
"quality_tier" text DEFAULT 'STANDARD'::text NOT NULL,
"result_ceiling" integer,
"provider_budget_ceiling_cents" integer,
"priority_level" integer DEFAULT 0 NOT NULL,
"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."properties"(
"id" uuid DEFAULT uuid_generate_v4() NOT NULL,
"user_id" uuid NOT NULL,
"source_type" property_source_type NOT NULL,
"title" text,
"transaction_type" transaction_type,
"property_type" property_type,
"matching_status" matching_status DEFAULT 'DRAFT'::matching_status NOT NULL,
"matchability_score" integer,
"cover_photo_url" text,
"is_deleted" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"developer_id" uuid,
"canonical_group_id" uuid,
"archived_at" timestamp with time zone,
"homatch_id" integer,
"contact_phone_e164" text,
"contact_phone_raw" text,
"contact_phone_country" text,
"listed_by_role" text DEFAULT 'OWNER'::text NOT NULL,
"broker_listing_id" uuid,
"freshness_anchor_at" timestamp with time zone DEFAULT now() NOT NULL,
"owner_confirmed_at" timestamp with time zone,
"freshness_paused_matching" boolean DEFAULT false NOT NULL);
create table public."property_facts"(
"id" uuid DEFAULT uuid_generate_v4() NOT NULL,
"property_id" uuid NOT NULL,
"source_url" text,
"canonical_url" text,
"external_listing_id" text,
"country" text,
"region" text,
"city" text,
"district" text,
"neighborhood" text,
"address" text,
"latitude" numeric(10,7),
"longitude" numeric(10,7),
"total_price" numeric(16,2),
"price_per_sqm" numeric(12,2),
"currency" text DEFAULT 'USD'::text,
"area" numeric(10,2),
"rooms" integer,
"bedrooms" integer,
"bathrooms" integer,
"floor" integer,
"total_floors" integer,
"construction_status" condition_type,
"condition" condition_type,
"new_build" boolean,
"building_type" building_type,
"parking" boolean,
"balcony" boolean,
"terrace" boolean,
"elevator" boolean,
"security" boolean,
"concierge" boolean,
"yard" boolean,
"furnished" boolean,
"heating" heating_type,
"air_conditioning" boolean,
"view" text,
"description" text,
"original_description" text,
"features" text[],
"cover_image" text,
"gallery_images" text[] DEFAULT '{}'::text[],
"photo_visibility" photo_visibility DEFAULT 'PUBLIC'::photo_visibility NOT NULL,
"address_visibility" address_visibility DEFAULT 'FULL'::address_visibility NOT NULL,
"listing_created_at" timestamp with time zone,
"listing_updated_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"source_domain" text,
"source_language" text,
"country_code" text,
"source_listing_id" text,
"original_title" text,
"extraction_confidence" numeric(4,3) DEFAULT 0,
"imported_at" timestamp with time zone,
"source_status" text DEFAULT 'UNKNOWN'::text NOT NULL,
"source_checked_at" timestamp with time zone,
"source_last_available_at" timestamp with time zone,
"media_last_ok_at" timestamp with time zone,
"source_failed_checks" integer DEFAULT 0 NOT NULL);
create table public."usage_events"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"reservation_id" uuid,
"product_code" text NOT NULL,
"plan_code" text NOT NULL,
"quality_tier" text NOT NULL,
"pricing_version" integer DEFAULT 1 NOT NULL,
"provider" text,
"provider_operation" text,
"provider_request_id" text,
"model" text,
"input_tokens" bigint,
"cached_tokens" bigint,
"output_tokens" bigint,
"search_count" integer,
"provider_units" numeric(18,4),
"enrichment_units" numeric(18,4),
"duration_ms" integer,
"raw_provider_cost_cents" numeric(14,4) DEFAULT 0 NOT NULL,
"ai_cost_cents" numeric(14,4) DEFAULT 0 NOT NULL,
"tax_cents" numeric(14,4) DEFAULT 0 NOT NULL,
"fee_cents" numeric(14,4) DEFAULT 0 NOT NULL,
"landed_cogs_cents" numeric(14,4) DEFAULT 0 NOT NULL,
"charged_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"reserved_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"released_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"allowance_funded" boolean DEFAULT false NOT NULL,
"billable" boolean DEFAULT true NOT NULL,
"outcome" text DEFAULT 'SUCCESS'::text NOT NULL,
"failure_reason" text,
"job_ref" text,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"pricing_state" text);
create table public."usage_reservations"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"product_code" text NOT NULL,
"status" text DEFAULT 'RESERVED'::text NOT NULL,
"plan_code_snapshot" text NOT NULL,
"quality_tier_snapshot" text NOT NULL,
"pricing_version_snapshot" integer DEFAULT 1 NOT NULL,
"profit_share_bps_snapshot" integer DEFAULT 0 NOT NULL,
"result_ceiling_snapshot" integer,
"provider_budget_ceiling_cents_snapshot" integer,
"estimate_min_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"estimate_max_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"authorized_max_credits" numeric(18,4) NOT NULL,
"reserved_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"settled_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"released_credits" numeric(18,4) DEFAULT 0 NOT NULL,
"allowance_consumption_id" uuid,
"job_ref" text,
"idempotency_key" text NOT NULL,
"ledger_reserve_id" uuid,
"ledger_capture_id" uuid,
"ledger_release_id" uuid,
"failure_reason" text,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"expires_at" timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"settled_at" timestamp with time zone);
create table public."user_preferences"(
"id" uuid DEFAULT uuid_generate_v4() NOT NULL,
"user_id" uuid NOT NULL,
"language" supported_language DEFAULT 'en'::supported_language NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."user_subscriptions"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"plan_code" text NOT NULL,
"status" text DEFAULT 'ACTIVE'::text NOT NULL,
"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
"current_period_end" timestamp with time zone NOT NULL,
"cancel_at_period_end" boolean DEFAULT false NOT NULL,
"provider" text,
"provider_subscription_id" text,
"started_at" timestamp with time zone DEFAULT now() NOT NULL,
"ended_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
create table public."users"(
"id" uuid DEFAULT uuid_generate_v4() NOT NULL,
"auth_id" uuid NOT NULL,
"email" text NOT NULL,
"full_name" text,
"avatar_url" text,
"is_admin" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"plan" text DEFAULT 'FREE'::text NOT NULL,
"nickname" text,
"phone" text,
"preferred_language" text,
"username" text,
"username_changed_at" timestamp with time zone,
"account_type" text DEFAULT 'PERSONAL'::text NOT NULL,
"suspended_at" timestamp with time zone,
"suspension_reason" text);
create table public."impersonation_sessions"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"admin_id" uuid NOT NULL,
"target_user_id" uuid NOT NULL,
"reason" text NOT NULL,
"audit_log_id" uuid,
"started_at" timestamp with time zone DEFAULT now() NOT NULL,
"ended_at" timestamp with time zone,
"auth_session_id" uuid,
"target_auth_id" uuid,
"expires_at" timestamp with time zone,
"ended_reason" text,
"revoked_at" timestamp with time zone);
create table public."admin_audit_log"(
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"admin_id" uuid NOT NULL,
"target_id" uuid,
"action" text NOT NULL,
"entity_type" text,
"entity_id" text,
"metadata" jsonb DEFAULT '{}'::jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL);
alter table public."admin_settings" add constraint "admin_settings_pkey" PRIMARY KEY (id);
alter table public."allowance_consumptions" add constraint "allowance_consumptions_pkey" PRIMARY KEY (id);
alter table public."billable_products" add constraint "billable_products_pkey" PRIMARY KEY (code);
alter table public."billing_plans" add constraint "billing_plans_pkey" PRIMARY KEY (code);
alter table public."broker_directory_listings" add constraint "broker_directory_listings_pkey" PRIMARY KEY (id);
alter table public."broker_intelligence" add constraint "broker_intelligence_pkey" PRIMARY KEY (id);
alter table public."canonical_property_groups" add constraint "canonical_property_groups_pkey" PRIMARY KEY (id);
alter table public."credit_accounts" add constraint "credit_accounts_pkey" PRIMARY KEY (id);
alter table public."credit_ledger" add constraint "credit_ledger_pkey" PRIMARY KEY (id);
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_pkey" PRIMARY KEY (id);
alter table public."credit_lots" add constraint "credit_lots_pkey" PRIMARY KEY (id);
alter table public."developer_profiles" add constraint "developer_profiles_pkey" PRIMARY KEY (id);
alter table public."notifications" add constraint "notifications_pkey" PRIMARY KEY (id);
alter table public."product_plan_entitlements" add constraint "product_plan_entitlements_pkey" PRIMARY KEY (product_code, plan_code);
alter table public."properties" add constraint "properties_pkey" PRIMARY KEY (id);
alter table public."property_facts" add constraint "property_facts_pkey" PRIMARY KEY (id);
alter table public."usage_events" add constraint "usage_events_pkey" PRIMARY KEY (id);
alter table public."usage_reservations" add constraint "usage_reservations_pkey" PRIMARY KEY (id);
alter table public."user_preferences" add constraint "user_preferences_pkey" PRIMARY KEY (id);
alter table public."user_subscriptions" add constraint "user_subscriptions_pkey" PRIMARY KEY (id);
alter table public."users" add constraint "users_pkey" PRIMARY KEY (id);
alter table public."impersonation_sessions" add constraint "impersonation_sessions_pkey" PRIMARY KEY (id);
alter table public."admin_audit_log" add constraint "admin_audit_log_pkey" PRIMARY KEY (id);
alter table public."admin_settings" add constraint "admin_settings_key_key" UNIQUE (key);
alter table public."broker_directory_listings" add constraint "broker_directory_listings_owner_broker_key" UNIQUE (owner_user_id, broker_id);
alter table public."broker_intelligence" add constraint "broker_intelligence_identity" UNIQUE (key_kind, natural_key);
alter table public."credit_accounts" add constraint "credit_accounts_user_id_key" UNIQUE (user_id);
alter table public."developer_profiles" add constraint "developer_profiles_slug_key" UNIQUE (slug);
alter table public."property_facts" add constraint "property_facts_property_id_key" UNIQUE (property_id);
alter table public."user_preferences" add constraint "user_preferences_user_id_key" UNIQUE (user_id);
alter table public."users" add constraint "users_auth_id_key" UNIQUE (auth_id);
alter table public."allowance_consumptions" add constraint "allowance_consumptions_slot_index_check" CHECK (slot_index >= 1);
alter table public."billable_products" add constraint "billable_products_billing_mode_check" CHECK (billing_mode = ANY (ARRAY['FIXED'::text, 'VARIABLE'::text, 'FREE'::text]));
alter table public."billable_products" add constraint "billable_products_estimate_strategy_check" CHECK (estimate_strategy = ANY (ARRAY['FIXED'::text, 'RANGE'::text, 'PER_UNIT'::text]));
alter table public."billable_products" add constraint "billable_products_min_gross_margin_bps_check" CHECK (min_gross_margin_bps >= 0 AND min_gross_margin_bps <= 9999);
alter table public."billing_plans" add constraint "billing_plans_profit_share_to_customer_bps_check" CHECK (profit_share_to_customer_bps >= 0 AND profit_share_to_customer_bps <= 10000);
alter table public."billing_plans" add constraint "billing_plans_quality_tier_check" CHECK (quality_tier = ANY (ARRAY['STANDARD'::text, 'ENHANCED'::text, 'MAXIMUM'::text]));
alter table public."broker_directory_listings" add constraint "broker_directory_listings_name_check" CHECK (length(btrim(display_name)) > 0);
alter table public."broker_directory_listings" add constraint "broker_directory_listings_role_check" CHECK (role = ANY (ARRAY['AGENCY'::text, 'BROKER'::text]));
alter table public."broker_directory_listings" add constraint "broker_directory_listings_status_check" CHECK (status = ANY (ARRAY['DRAFT'::text, 'PENDING_REVIEW'::text, 'APPROVED'::text, 'NEEDS_CHANGES'::text, 'REJECTED'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'EXPIRED'::text]));
alter table public."broker_directory_listings" add constraint "broker_directory_listings_verification_state_check" CHECK (verification_state = ANY (ARRAY['UNVERIFIED'::text, 'PENDING'::text, 'VERIFIED'::text, 'REJECTED'::text, 'SUSPENDED'::text]));
alter table public."broker_intelligence" add constraint "broker_intelligence_counts_check" CHECK (observation_count >= 0 AND source_count >= 0 AND failed_checks >= 0);
alter table public."broker_intelligence" add constraint "broker_intelligence_key_kind_check" CHECK (key_kind = ANY (ARRAY['COMPANY_ID'::text, 'DOMAIN'::text, 'TELEGRAM'::text, 'PHONE'::text, 'PROFILE_URL'::text]));
alter table public."broker_intelligence" add constraint "broker_intelligence_natural_key_check" CHECK (length(btrim(natural_key)) > 0);
alter table public."broker_intelligence" add constraint "broker_intelligence_role_check" CHECK (role = ANY (ARRAY['AGENCY'::text, 'BROKER'::text]));
alter table public."broker_intelligence" add constraint "broker_intelligence_validation_state_check" CHECK (validation_state = ANY (ARRAY['UNVERIFIED'::text, 'VALID'::text, 'INVALID'::text, 'REMOVED'::text, 'UNVERIFIABLE'::text]));
alter table public."credit_accounts" add constraint "credit_accounts_balance_check" CHECK (balance >= 0::numeric);
alter table public."credit_accounts" add constraint "credit_accounts_balance_non_negative" CHECK (balance >= 0::numeric);
alter table public."credit_accounts" add constraint "credit_accounts_reserved_non_negative" CHECK (reserved >= 0::numeric);
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_allocated_credits_check" CHECK (allocated_credits >= 0::numeric);
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_balanced" CHECK ((settled_credits + released_credits) <= allocated_credits);
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_released_credits_check" CHECK (released_credits >= 0::numeric);
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_settled_credits_check" CHECK (settled_credits >= 0::numeric);
alter table public."credit_lots" add constraint "credit_lots_credits_consumed_check" CHECK (credits_consumed >= 0::numeric);
alter table public."credit_lots" add constraint "credit_lots_credits_expired_check" CHECK (credits_expired >= 0::numeric);
alter table public."credit_lots" add constraint "credit_lots_credits_granted_check" CHECK (credits_granted > 0::numeric);
alter table public."credit_lots" add constraint "credit_lots_credits_reserved_check" CHECK (credits_reserved >= 0::numeric);
alter table public."credit_lots" add constraint "credit_lots_kind_check" CHECK (kind = ANY (ARRAY['PURCHASED'::text, 'MEMBERSHIP'::text, 'PROMOTIONAL'::text, 'ADJUSTMENT'::text]));
alter table public."credit_lots" add constraint "credit_lots_not_overdrawn" CHECK ((credits_consumed + credits_reserved + credits_expired) <= credits_granted);
alter table public."credit_lots" add constraint "credit_lots_purchased_never_expire" CHECK (kind <> 'PURCHASED'::text OR expires_at IS NULL);
alter table public."credit_lots" add constraint "credit_lots_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'EXHAUSTED'::text, 'EXPIRED'::text]));
alter table public."developer_profiles" add constraint "developer_profiles_score_check" CHECK (score IS NULL OR score >= 0 AND score <= 100);
alter table public."notifications" add constraint "notifications_deep_link_is_a_path" CHECK (deep_link IS NULL OR deep_link ~ '^/[A-Za-z0-9/_%\-\?=&\.]*$'::text);
alter table public."notifications" add constraint "notifications_priority_check" CHECK (priority = ANY (ARRAY['CRITICAL'::text, 'HIGH'::text, 'NORMAL'::text, 'LOW'::text]));
alter table public."product_plan_entitlements" add constraint "product_plan_entitlements_period_check" CHECK (period = ANY (ARRAY['CALENDAR_MONTH'::text, 'BILLING_CYCLE'::text]));
alter table public."product_plan_entitlements" add constraint "product_plan_entitlements_quality_tier_check" CHECK (quality_tier = ANY (ARRAY['STANDARD'::text, 'ENHANCED'::text, 'MAXIMUM'::text]));
alter table public."properties" add constraint "properties_contact_phone_e164_shape" CHECK (contact_phone_e164 IS NULL OR contact_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text) NOT VALID;
alter table public."properties" add constraint "properties_homatch_id_range" CHECK (homatch_id IS NULL OR homatch_id >= 100000 AND homatch_id <= 999999) NOT VALID;
alter table public."properties" add constraint "properties_listed_by_role_check" CHECK (listed_by_role = ANY (ARRAY['OWNER'::text, 'BROKER'::text, 'AGENCY'::text]));
alter table public."property_facts" add constraint "property_facts_source_status_check" CHECK (source_status = ANY (ARRAY['AVAILABLE'::text, 'TEMPORARILY_UNREACHABLE'::text, 'LISTING_NOT_FOUND'::text, 'MEDIA_UNAVAILABLE'::text, 'SOURCE_CHANGED'::text, 'UNKNOWN'::text]));
alter table public."usage_events" add constraint "usage_events_outcome_check" CHECK (outcome = ANY (ARRAY['SUCCESS'::text, 'PARTIAL'::text, 'FAILED'::text, 'CANCELLED'::text, 'TIMEOUT'::text]));
alter table public."usage_events" add constraint "usage_events_pricing_state_check" CHECK (pricing_state IS NULL OR (pricing_state = ANY (ARRAY['ACTUAL'::text, 'ESTIMATED'::text, 'PARTIAL'::text, 'UNPRICED'::text, 'ZERO_REAL'::text])));
alter table public."usage_reservations" add constraint "usage_reservations_authorized_max_credits_check" CHECK (authorized_max_credits >= 0::numeric);
alter table public."usage_reservations" add constraint "usage_reservations_quality_tier_snapshot_check" CHECK (quality_tier_snapshot = ANY (ARRAY['STANDARD'::text, 'ENHANCED'::text, 'MAXIMUM'::text]));
alter table public."usage_reservations" add constraint "usage_reservations_released_credits_check" CHECK (released_credits >= 0::numeric);
alter table public."usage_reservations" add constraint "usage_reservations_reserved_credits_check" CHECK (reserved_credits >= 0::numeric);
alter table public."usage_reservations" add constraint "usage_reservations_settle_within_authorization" CHECK (settled_credits <= authorized_max_credits);
alter table public."usage_reservations" add constraint "usage_reservations_settled_credits_check" CHECK (settled_credits >= 0::numeric);
alter table public."usage_reservations" add constraint "usage_reservations_status_check" CHECK (status = ANY (ARRAY['RESERVED'::text, 'SETTLED'::text, 'RELEASED'::text, 'EXPIRED'::text, 'CANCELLED'::text]));
alter table public."user_subscriptions" add constraint "user_subscriptions_status_check" CHECK (status = ANY (ARRAY['ACTIVE'::text, 'CANCELLED'::text, 'PAST_DUE'::text, 'EXPIRED'::text]));
alter table public."users" add constraint "users_account_type_check" CHECK (account_type = ANY (ARRAY['PERSONAL'::text, 'BROKER'::text, 'AGENCY'::text]));
alter table public."users" add constraint "users_plan_check" CHECK (plan = ANY (ARRAY['FREE'::text, 'PLUS'::text, 'PRO'::text, 'VIP'::text, 'PREMIUM'::text]));
alter table public."admin_settings" add constraint "admin_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id);
alter table public."allowance_consumptions" add constraint "allowance_consumptions_plan_code_fkey" FOREIGN KEY (plan_code) REFERENCES billing_plans(code);
alter table public."allowance_consumptions" add constraint "allowance_consumptions_product_code_fkey" FOREIGN KEY (product_code) REFERENCES billable_products(code);
alter table public."allowance_consumptions" add constraint "allowance_consumptions_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES usage_reservations(id) ON DELETE SET NULL;
alter table public."allowance_consumptions" add constraint "allowance_consumptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."broker_directory_listings" add constraint "broker_directory_listings_agency_listing_id_fkey" FOREIGN KEY (agency_listing_id) REFERENCES broker_directory_listings(id) ON DELETE SET NULL;
alter table public."broker_directory_listings" add constraint "broker_directory_listings_broker_id_fkey" FOREIGN KEY (broker_id) REFERENCES broker_intelligence(id) ON DELETE SET NULL;
alter table public."broker_directory_listings" add constraint "broker_directory_listings_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."credit_accounts" add constraint "credit_accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."credit_ledger" add constraint "credit_ledger_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES credit_lots(id) ON DELETE RESTRICT;
alter table public."credit_lot_allocations" add constraint "credit_lot_allocations_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES usage_reservations(id) ON DELETE CASCADE;
alter table public."credit_lots" add constraint "credit_lots_ledger_entry_id_fkey" FOREIGN KEY (ledger_entry_id) REFERENCES credit_ledger(id);
alter table public."credit_lots" add constraint "credit_lots_plan_code_fkey" FOREIGN KEY (plan_code) REFERENCES billing_plans(code);
alter table public."credit_lots" add constraint "credit_lots_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."notifications" add constraint "notifications_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."product_plan_entitlements" add constraint "product_plan_entitlements_plan_code_fkey" FOREIGN KEY (plan_code) REFERENCES billing_plans(code) ON DELETE CASCADE;
alter table public."product_plan_entitlements" add constraint "product_plan_entitlements_product_code_fkey" FOREIGN KEY (product_code) REFERENCES billable_products(code) ON DELETE CASCADE;
alter table public."properties" add constraint "properties_broker_listing_id_fkey" FOREIGN KEY (broker_listing_id) REFERENCES broker_directory_listings(id) ON DELETE SET NULL;
alter table public."properties" add constraint "properties_canonical_group_id_fkey" FOREIGN KEY (canonical_group_id) REFERENCES canonical_property_groups(id) ON DELETE SET NULL;
alter table public."properties" add constraint "properties_developer_id_fkey" FOREIGN KEY (developer_id) REFERENCES developer_profiles(id) ON DELETE SET NULL;
alter table public."properties" add constraint "properties_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."property_facts" add constraint "property_facts_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public."usage_events" add constraint "usage_events_plan_code_fkey" FOREIGN KEY (plan_code) REFERENCES billing_plans(code);
alter table public."usage_events" add constraint "usage_events_product_code_fkey" FOREIGN KEY (product_code) REFERENCES billable_products(code);
alter table public."usage_events" add constraint "usage_events_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES usage_reservations(id) ON DELETE SET NULL;
alter table public."usage_events" add constraint "usage_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."usage_reservations" add constraint "usage_reservations_allowance_fk" FOREIGN KEY (allowance_consumption_id) REFERENCES allowance_consumptions(id) ON DELETE SET NULL;
alter table public."usage_reservations" add constraint "usage_reservations_ledger_capture_id_fkey" FOREIGN KEY (ledger_capture_id) REFERENCES credit_ledger(id);
alter table public."usage_reservations" add constraint "usage_reservations_ledger_release_id_fkey" FOREIGN KEY (ledger_release_id) REFERENCES credit_ledger(id);
alter table public."usage_reservations" add constraint "usage_reservations_ledger_reserve_id_fkey" FOREIGN KEY (ledger_reserve_id) REFERENCES credit_ledger(id);
alter table public."usage_reservations" add constraint "usage_reservations_plan_code_snapshot_fkey" FOREIGN KEY (plan_code_snapshot) REFERENCES billing_plans(code);
alter table public."usage_reservations" add constraint "usage_reservations_product_code_fkey" FOREIGN KEY (product_code) REFERENCES billable_products(code);
alter table public."usage_reservations" add constraint "usage_reservations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."user_preferences" add constraint "user_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."user_subscriptions" add constraint "user_subscriptions_plan_code_fkey" FOREIGN KEY (plan_code) REFERENCES billing_plans(code);
alter table public."user_subscriptions" add constraint "user_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."impersonation_sessions" add constraint "impersonation_sessions_audit_log_id_fkey" FOREIGN KEY (audit_log_id) REFERENCES admin_audit_log(id);
alter table public."impersonation_sessions" add constraint "impersonation_sessions_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_admin_settings_key ON public.admin_settings USING btree (key);
CREATE INDEX idx_admin_settings_updated_by ON public.admin_settings USING btree (updated_by);
CREATE UNIQUE INDEX uidx_allowance_slot ON public.allowance_consumptions USING btree (user_id, product_code, period_key, slot_index) WHERE (released_at IS NULL);
CREATE INDEX idx_allowance_lookup ON public.allowance_consumptions USING btree (user_id, product_code, period_key) WHERE (released_at IS NULL);
CREATE UNIQUE INDEX broker_directory_listings_one_per_owner ON public.broker_directory_listings USING btree (owner_user_id);
CREATE INDEX broker_directory_listings_active_idx ON public.broker_directory_listings USING btree (status, paid_until DESC);
CREATE INDEX broker_directory_listings_broker_idx ON public.broker_directory_listings USING btree (broker_id);
CREATE INDEX broker_intelligence_cities_idx ON public.broker_intelligence USING gin (cities);
CREATE INDEX broker_intelligence_last_seen_idx ON public.broker_intelligence USING btree (last_seen_at DESC);
CREATE INDEX broker_intelligence_role_country_idx ON public.broker_intelligence USING btree (role, country_code);
CREATE INDEX broker_intelligence_state_idx ON public.broker_intelligence USING btree (validation_state) WHERE (validation_state <> 'VALID'::text);
CREATE INDEX idx_credit_accounts_user ON public.credit_accounts USING btree (user_id);
CREATE UNIQUE INDEX credit_ledger_user_type_reference_uidx ON public.credit_ledger USING btree (user_id, type, reference) WHERE (reference IS NOT NULL);
CREATE INDEX idx_credit_ledger_user ON public.credit_ledger USING btree (user_id, created_at DESC);
CREATE INDEX idx_credit_lot_allocations_res ON public.credit_lot_allocations USING btree (reservation_id, spend_rank);
CREATE UNIQUE INDEX uidx_credit_lot_allocations_pair ON public.credit_lot_allocations USING btree (reservation_id, lot_id);
CREATE INDEX idx_credit_lots_expiring ON public.credit_lots USING btree (expires_at) WHERE ((status = 'ACTIVE'::text) AND (expires_at IS NOT NULL));
CREATE INDEX idx_credit_lots_spend_order ON public.credit_lots USING btree (user_id, kind, expires_at, granted_at) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX uidx_credit_lots_source ON public.credit_lots USING btree (user_id, source_type, source_ref) WHERE (source_ref IS NOT NULL);
CREATE INDEX notifications_user_keyset_idx ON public.notifications USING btree (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_dedupe_key_idx ON public.notifications USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX idx_notifications_property ON public.notifications USING btree (property_id) WHERE (property_id IS NOT NULL);
CREATE INDEX notifications_created_idx ON public.notifications USING btree (created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uniq ON public.notifications USING btree (user_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id) WHERE (read = false);
CREATE INDEX notifications_user_recent_idx ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX notifications_group_idx ON public.notifications USING btree (user_id, group_key, created_at DESC) WHERE (group_key IS NOT NULL);
CREATE INDEX properties_canonical_group_idx ON public.properties USING btree (canonical_group_id);
CREATE INDEX idx_properties_status ON public.properties USING btree (matching_status);
CREATE UNIQUE INDEX properties_homatch_id_key ON public.properties USING btree (homatch_id);
CREATE INDEX idx_properties_not_deleted ON public.properties USING btree (user_id) WHERE (is_deleted = false);
CREATE INDEX properties_developer_idx ON public.properties USING btree (developer_id);
CREATE INDEX properties_freshness_sweep_idx ON public.properties USING btree (freshness_anchor_at) WHERE ((is_deleted = false) AND (archived_at IS NULL));
CREATE INDEX properties_created_idx ON public.properties USING btree (created_at DESC);
CREATE INDEX idx_properties_user_id ON public.properties USING btree (user_id);
CREATE INDEX properties_owner_archived_idx ON public.properties USING btree (user_id, archived_at DESC) WHERE ((is_deleted = false) AND (archived_at IS NOT NULL));
CREATE INDEX properties_owner_active_idx ON public.properties USING btree (user_id, created_at DESC) WHERE ((is_deleted = false) AND (archived_at IS NULL));
CREATE INDEX idx_property_facts_country ON public.property_facts USING btree (country);
CREATE INDEX idx_property_facts_property_id ON public.property_facts USING btree (property_id);
CREATE INDEX idx_property_facts_city ON public.property_facts USING btree (city);
CREATE INDEX property_facts_district_idx ON public.property_facts USING btree (district);
CREATE INDEX idx_usage_events_created ON public.usage_events USING btree (created_at DESC);
CREATE INDEX idx_usage_events_user_product ON public.usage_events USING btree (user_id, product_code, created_at DESC);
CREATE INDEX idx_usage_events_reservation ON public.usage_events USING btree (reservation_id) WHERE (reservation_id IS NOT NULL);
CREATE INDEX idx_usage_reservations_open ON public.usage_reservations USING btree (expires_at) WHERE (status = 'RESERVED'::text);
CREATE INDEX idx_usage_reservations_user ON public.usage_reservations USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX uidx_usage_reservations_idem ON public.usage_reservations USING btree (idempotency_key);
CREATE INDEX idx_usage_reservations_job ON public.usage_reservations USING btree (job_ref) WHERE (job_ref IS NOT NULL);
CREATE INDEX idx_user_subscriptions_period_end ON public.user_subscriptions USING btree (current_period_end) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX uidx_user_subscriptions_one_active ON public.user_subscriptions USING btree (user_id) WHERE (status = ANY (ARRAY['ACTIVE'::text, 'PAST_DUE'::text]));
CREATE UNIQUE INDEX uidx_user_subscriptions_provider_sub ON public.user_subscriptions USING btree (provider, provider_subscription_id) WHERE (provider_subscription_id IS NOT NULL);
CREATE INDEX idx_users_auth_id ON public.users USING btree (auth_id);
CREATE UNIQUE INDEX uidx_users_username_lower ON public.users USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX users_email_lower_idx ON public.users USING btree (lower(email));
CREATE INDEX idx_users_is_admin ON public.users USING btree (is_admin) WHERE (is_admin = true);
CREATE INDEX users_auth_id_idx ON public.users USING btree (auth_id);
CREATE INDEX idx_impersonation_sessions_target_user_id ON public.impersonation_sessions USING btree (target_user_id);
CREATE INDEX impersonation_sessions_open_idx ON public.impersonation_sessions USING btree (admin_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_impersonation_sessions_admin ON public.impersonation_sessions USING btree (admin_id, started_at DESC);
CREATE INDEX idx_impersonation_sessions_audit_log_id ON public.impersonation_sessions USING btree (audit_log_id);
CREATE UNIQUE INDEX impersonation_sessions_auth_session_key ON public.impersonation_sessions USING btree (auth_session_id) WHERE (auth_session_id IS NOT NULL);
CREATE OR REPLACE FUNCTION public.account_is_being_viewed(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.impersonation_sessions i
     where i.target_user_id = p_user_id
       and i.ended_at is null
       and coalesce(i.expires_at, i.started_at + interval '1 hour') > now()
  )
$function$
;
CREATE OR REPLACE FUNCTION public.auth_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select u.id
  from public.users as u
  where u.auth_id = auth.uid()
  limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.billing_setting_num(p_key text, p_default numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT CASE
      WHEN (s.value #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
      THEN trim(s.value #>> '{}')::numeric
    END
    FROM public.admin_settings s WHERE s.key = p_key
  ), p_default);
$function$
;
CREATE OR REPLACE FUNCTION public.billing_credits_to_cents(p_credits numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT round(p_credits * 100.0 / public.billing_setting_num('credits_per_usd', 10), 4);
$function$
;
CREATE OR REPLACE FUNCTION public.billing_budget_to_cogs_ceiling(p_product_code text, p_plan_code text, p_authorized_credits numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p record;
  v_plan record;
  v_multiple numeric;
  v_effective numeric;
  v_floor_multiple numeric;
  v_min_bps numeric;
  v_cents numeric;
begin
  select * into v_p from public.billable_products where code = p_product_code;
  if not found or v_p.reference_landed_cogs_cents <= 0 then return 0; end if;
  select * into v_plan from public.billing_plans where code = p_plan_code;
  if not found then return 0; end if;

  v_multiple := v_p.standard_retail_cents::numeric / v_p.reference_landed_cogs_cents;
  v_effective := 1 + (v_multiple - 1) * (1 - v_plan.profit_share_to_customer_bps / 10000.0);

  v_min_bps := greatest(
    COALESCE(v_p.min_gross_margin_bps, 3000),
    public.billing_setting_num('billing_min_gross_margin_bps', 3000));
  v_floor_multiple := 1 / (1 - v_min_bps/10000.0);

  -- The stricter of the two: a budget must never authorise spend we could not
  -- charge for at the floor.
  v_effective := greatest(v_effective, v_floor_multiple);
  if v_effective <= 0 then return 0; end if;

  v_cents := public.billing_credits_to_cents(greatest(COALESCE(p_authorized_credits, 0), 0));
  return round(v_cents / v_effective, 4);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.billing_current_plan(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT s.plan_code FROM public.user_subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('ACTIVE','PAST_DUE')
        AND s.current_period_end > now()
      ORDER BY s.current_period_end DESC LIMIT 1),
    'FREE');
$function$
;
CREATE OR REPLACE FUNCTION public.billing_release_allowance(p_allowance_id uuid, p_reason text DEFAULT 'execution_failed'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update public.allowance_consumptions
     set released_at = now(), release_reason = p_reason
   where id = p_allowance_id and released_at is null;
  return found;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.billing_setting_bool(p_key text, p_default boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT CASE lower(trim(s.value #>> '{}'))
      WHEN 'true' THEN true WHEN 't' THEN true WHEN '1' THEN true WHEN 'yes' THEN true
      WHEN 'false' THEN false WHEN 'f' THEN false WHEN '0' THEN false WHEN 'no' THEN false
    END
    FROM public.admin_settings s WHERE s.key = p_key
  ), p_default);
$function$
;
CREATE OR REPLACE FUNCTION public.billing_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin NEW.updated_at := now(); return NEW; end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_credit_account_for_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.credit_accounts (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.credit_lots_follow_legacy_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_delta numeric;
  v_need numeric;
  v_take numeric;
  v_lot record;
begin
  v_delta := NEW.balance - OLD.balance;
  if v_delta >= 0 then return NEW; end if;
  v_need := -v_delta;

  -- The v2 paths maintain the lots themselves and mark the transaction so
  -- this trigger stands aside.
  if COALESCE(current_setting('homatch.lots_managed', true), '') = 'on' then
    return NEW;
  end if;

  for v_lot in
    select * from public.credit_lots
     where user_id = NEW.user_id and status = 'ACTIVE' and credits_available > 0
       and (expires_at is null or expires_at > now())
     order by case kind when 'PROMOTIONAL' then 0 when 'MEMBERSHIP' then 1
                        when 'ADJUSTMENT' then 2 else 3 end,
              expires_at asc nulls last, granted_at asc
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.credits_available, v_need);
    update public.credit_lots
       set credits_consumed = credits_consumed + v_take,
           status = case when (credits_granted - credits_consumed - v_take - credits_reserved - credits_expired) <= 0
                         then 'EXHAUSTED' else status end,
           updated_at = now()
     where id = v_lot.id;
    v_need := round(v_need - v_take, 4);
  end loop;

  -- An account can legitimately have no lots (created before this migration,
  -- never held a balance). Do not block the spend; the integrity view reports
  -- the drift instead of a customer hitting an error.
  if v_need > 0 then
    raise warning 'credit_lots_follow_legacy_debit: % credits of spend for user % had no lot to draw from',
      v_need, NEW.user_id;
  end if;

  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.homatch_refuse_spend_while_viewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_table_name = 'credit_ledger' then
    if coalesce(new.amount, 0) >= 0 then
      return new;
    end if;
  end if;
  if public.account_is_being_viewed(new.user_id) then
    raise exception 'READ_ONLY_IMPERSONATION: no spend on % while an administrator is viewing this account',
      tg_table_name using errcode = '42501';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.is_impersonated_session()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sid text := coalesce(auth.jwt() ->> 'session_id', '');
begin
  if v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.impersonation_sessions i
     where i.auth_session_id = v_sid::uuid);
end $function$
;
CREATE OR REPLACE FUNCTION public.homatch_refuse_when_impersonated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.is_impersonated_session() then
    raise exception 'READ_ONLY_IMPERSONATION: % on % is not allowed while an administrator is viewing as this user',
      tg_op, tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid() AND u.is_admin = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.notifications_sync_read_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.read AND NEW.read_at IS NULL THEN
    NEW.read_at := now();
    IF NEW.seen_at IS NULL THEN NEW.seen_at := now(); END IF;
  ELSIF NOT NEW.read THEN
    NEW.read_at := NULL;
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.protect_privileged_user_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('homatch.billing_engine', true), '') <> 'on' then
    new.is_admin := old.is_admin;
    new.plan := old.plan;
  end if;
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('homatch.account_rpc', true), '') <> 'on' then
    new.account_type := old.account_type;
    new.suspended_at := old.suspended_at;
    new.suspension_reason := old.suspension_reason;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.require_property_contact_phone()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.contact_phone_e164 is null or btrim(new.contact_phone_e164) = '' then
    raise exception 'a Homatch property needs a contact phone number'
      using errcode = 'HM002',
            hint = 'Set contact_phone_e164 to the canonical form of the owner''s number.';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.user_owns_property(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.properties
    WHERE id = p_id AND user_id = public.get_user_id() AND is_deleted = false
  );
$function$
;
CREATE OR REPLACE FUNCTION public.wallet_grant_credits(p_user_id uuid, p_kind text, p_credits numeric, p_ledger_type text, p_source_type text, p_source_ref text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_plan_code text DEFAULT NULL::text, p_payment_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(lot_id uuid, ledger_entry_id uuid, credits_granted numeric, balance_after numeric, was_duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing record;
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
  v_lot uuid;
  v_reference text;
  v_cap numeric;
  v_held numeric;
  v_grant numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_credits is null or p_credits <= 0 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_kind not in ('PURCHASED','MEMBERSHIP','PROMOTIONAL','ADJUSTMENT') then raise exception 'INVALID_LOT_KIND'; end if;
  if p_source_ref is null then raise exception 'SOURCE_REF_REQUIRED'; end if;
  if p_kind = 'PURCHASED' and p_expires_at is not null then raise exception 'PURCHASED_CREDITS_MUST_NOT_EXPIRE'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_existing from public.credit_lots
   where user_id = p_user_id and source_type = p_source_type and source_ref = p_source_ref;
  if found then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = p_user_id;
    return query select v_existing.id, v_existing.ledger_entry_id, v_existing.credits_granted, v_after, true;
    return;
  end if;

  v_grant := round(p_credits, 4);

  if p_kind = 'MEMBERSHIP' and p_plan_code is not null then
    select membership_rollover_cap into v_cap from public.billing_plans where code = p_plan_code;
    if v_cap is not null and v_cap > 0 then
      select COALESCE(sum(credits_available), 0) into v_held
        from public.credit_lots
       where user_id = p_user_id and kind = 'MEMBERSHIP' and status = 'ACTIVE';
      v_grant := least(v_grant, greatest(v_cap - v_held, 0));
      if v_grant <= 0 then
        return query select null::uuid, null::uuid, 0::numeric,
               (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id), false;
        return;
      end if;
    end if;
  end if;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then
    insert into public.credit_accounts(user_id, balance) values (p_user_id, 0)
      on conflict (user_id) do nothing;
    select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  end if;

  v_after := v_before + v_grant;
  update public.credit_accounts set balance = v_after, updated_at = now() where user_id = p_user_id;

  v_reference := p_source_type || ':' || p_source_ref;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, payment_id, metadata)
  values (p_user_id, v_grant, v_before, v_after, p_ledger_type::public.ledger_type, v_reference, p_payment_id,
          p_metadata || jsonb_build_object('lot_kind', p_kind, 'plan_code', p_plan_code))
  returning id into v_ledger;

  insert into public.credit_lots
    (user_id, kind, credits_granted, expires_at, source_type, source_ref, plan_code, ledger_entry_id)
  values (p_user_id, p_kind, v_grant, p_expires_at, p_source_type, p_source_ref, p_plan_code, v_ledger)
  returning id into v_lot;

  update public.credit_ledger set metadata = metadata || jsonb_build_object('lot_id', v_lot) where id = v_ledger;

  return query select v_lot, v_ledger, v_grant, v_after, false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(p_user_id uuid, p_credits numeric, p_reason text, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_r record;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_credits is null or p_credits = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_credits < 0 then raise exception 'NEGATIVE_ADJUSTMENT_NOT_SUPPORTED: reverse the original entry instead'; end if;

  select * into v_r from public.wallet_grant_credits(
    p_user_id, 'ADJUSTMENT', p_credits, 'ADMIN_ADJUSTMENT', 'adjustment', p_reference,
    NULL, NULL, NULL, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('lot_id', v_r.lot_id, 'credits', v_r.credits_granted,
                            'balance_after', v_r.balance_after, 'duplicate', v_r.was_duplicate);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.wallet_release(p_reservation_id uuid, p_reason text DEFAULT 'execution_failed'::text, p_usage jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(reservation_id uuid, released_credits numeric, balance_after numeric, was_duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_res record;
  v_before numeric;
  v_after numeric;
  v_alloc record;
  v_ledger uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_res from public.usage_reservations r where r.id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status <> 'RESERVED' then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_res.user_id;
    return query select v_res.id, v_res.released_credits, v_after, true;
    return;
  end if;

  for v_alloc in
    select a.* from public.credit_lot_allocations a where a.reservation_id = p_reservation_id for update
  loop
    update public.credit_lots
       set credits_reserved = credits_reserved - v_alloc.allocated_credits, updated_at = now()
     where id = v_alloc.lot_id;
    update public.credit_lot_allocations
       set released_credits = v_alloc.allocated_credits where id = v_alloc.id;
  end loop;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_res.reserved_credits;
  update public.credit_accounts
     set balance = v_after, reserved = reserved - v_res.reserved_credits, updated_at = now()
   where user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (v_res.user_id, v_res.reserved_credits, v_before, v_after, 'SERVICE_RELEASE',
          'res:' || p_reservation_id::text || ':rel',
          jsonb_build_object('reservation_id', p_reservation_id, 'reason', p_reason))
  returning id into v_ledger;

  update public.usage_reservations
     set status = 'RELEASED', released_credits = v_res.reserved_credits, settled_credits = 0,
         ledger_release_id = v_ledger, failure_reason = p_reason, settled_at = now(), updated_at = now()
   where id = p_reservation_id;

  if v_res.allowance_consumption_id is not null then
    perform public.billing_release_allowance(v_res.allowance_consumption_id, p_reason);
  end if;

  if COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0) > 0
     or COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0) > 0 then
    insert into public.usage_events (
      user_id, reservation_id, product_code, plan_code, quality_tier, pricing_version,
      provider, provider_operation, provider_request_id,
      raw_provider_cost_cents, ai_cost_cents, tax_cents, fee_cents, landed_cogs_cents,
      charged_credits, reserved_credits, released_credits,
      allowance_funded, billable, outcome, failure_reason, job_ref, metadata
    ) values (
      v_res.user_id, p_reservation_id, v_res.product_code, v_res.plan_code_snapshot,
      v_res.quality_tier_snapshot, v_res.pricing_version_snapshot,
      p_usage->>'provider', p_usage->>'provider_operation', p_usage->>'provider_request_id',
      COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0),
      COALESCE((p_usage->>'ai_cost_cents')::numeric, 0),
      COALESCE((p_usage->>'tax_cents')::numeric, 0),
      COALESCE((p_usage->>'fee_cents')::numeric, 0),
      COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0),
      0, v_res.reserved_credits, v_res.reserved_credits,
      false, false, 'FAILED', p_reason, v_res.job_ref, COALESCE(p_usage->'metadata','{}'::jsonb)
    );
  end if;

  return query select p_reservation_id, v_res.reserved_credits, v_after, false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.wallet_reserve(p_user_id uuid, p_product_code text, p_authorized_max_credits numeric, p_idempotency_key text, p_estimate_min_credits numeric DEFAULT 0, p_estimate_max_credits numeric DEFAULT 0, p_job_ref text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(reservation_id uuid, reserved_credits numeric, balance_after numeric, was_duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing record;
  v_plan_code text;
  v_plan record;
  v_ent record;
  v_product record;
  v_before numeric;
  v_after numeric;
  v_need numeric;
  v_take numeric;
  v_lot record;
  v_rank integer := 0;
  v_res uuid;
  v_ledger uuid;
  v_alloc jsonb := '[]'::jsonb;
  v_budget_cents numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_authorized_max_credits is null or p_authorized_max_credits <= 0 then raise exception 'INVALID_AUTHORIZED_MAX'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_existing from public.usage_reservations where idempotency_key = p_idempotency_key;
  if found then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_existing.user_id;
    return query select v_existing.id, v_existing.reserved_credits, v_after, true;
    return;
  end if;

  select * into v_product from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT'; end if;
  if not v_product.enabled then raise exception 'PRODUCT_DISABLED'; end if;
  if v_product.kill_switch then raise exception 'PRODUCT_KILL_SWITCH'; end if;
  if not v_product.pricing_active then raise exception 'PRODUCT_PRICING_INACTIVE'; end if;
  if not public.billing_setting_bool('billing_payg_enabled', true) then raise exception 'PAYG_DISABLED'; end if;

  -- A budget below the minimum useful one buys a search not worth running.
  -- Refusing here is kinder than spending the customer's last credits on it.
  if p_authorized_max_credits < COALESCE(v_product.min_viable_budget_credits, 0) then
    raise exception 'BELOW_MIN_VIABLE_BUDGET: % < %',
      p_authorized_max_credits, v_product.min_viable_budget_credits;
  end if;

  v_plan_code := public.billing_current_plan(p_user_id);
  select * into v_plan from public.billing_plans where code = v_plan_code;
  select * into v_ent from public.product_plan_entitlements
   where plan_code = v_plan_code and product_code = p_product_code;

  v_need := round(p_authorized_max_credits, 4);

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_need then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_after := v_before - v_need;
  update public.credit_accounts
     set balance = v_after, reserved = reserved + v_need, updated_at = now()
   where user_id = p_user_id;

  -- The provider spend this budget authorises, at THIS plan's member rate.
  -- Snapshotted as the stricter of the plan's operational ceiling and what the
  -- money actually buys, so the worker has one number to obey.
  v_budget_cents := public.billing_budget_to_cogs_ceiling(p_product_code, v_plan_code, v_need);
  if v_ent.provider_budget_ceiling_cents is not null then
    v_budget_cents := least(v_budget_cents, v_ent.provider_budget_ceiling_cents);
  end if;

  insert into public.usage_reservations (
    user_id, product_code, status,
    plan_code_snapshot, quality_tier_snapshot, pricing_version_snapshot,
    profit_share_bps_snapshot, result_ceiling_snapshot, provider_budget_ceiling_cents_snapshot,
    estimate_min_credits, estimate_max_credits, authorized_max_credits, reserved_credits,
    job_ref, idempotency_key, metadata, expires_at
  ) values (
    p_user_id, p_product_code, 'RESERVED',
    v_plan_code, COALESCE(v_ent.quality_tier, v_plan.quality_tier),
    public.billing_setting_num('billing_pricing_version', 1)::integer,
    v_plan.profit_share_to_customer_bps, v_ent.result_ceiling, floor(v_budget_cents)::integer,
    round(COALESCE(p_estimate_min_credits,0),4), round(COALESCE(p_estimate_max_credits,0),4),
    v_need, v_need,
    p_job_ref, p_idempotency_key,
    COALESCE(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'budget_mode', case when v_need < round(COALESCE(p_estimate_max_credits,0),4) then 'PARTIAL' else 'FULL' end),
    now() + (public.billing_setting_num('billing_reservation_ttl_minutes', 60) || ' minutes')::interval
  ) returning id into v_res;

  for v_lot in
    select * from public.credit_lots
     where user_id = p_user_id and status = 'ACTIVE' and credits_available > 0
       and (expires_at is null or expires_at > now())
     order by case kind when 'PROMOTIONAL' then 0 when 'MEMBERSHIP' then 1
                        when 'ADJUSTMENT' then 2 else 3 end,
              expires_at asc nulls last,
              granted_at asc
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.credits_available, v_need);
    if v_take <= 0 then continue; end if;

    update public.credit_lots
       set credits_reserved = credits_reserved + v_take, updated_at = now()
     where id = v_lot.id;

    insert into public.credit_lot_allocations (reservation_id, lot_id, allocated_credits, spend_rank)
    values (v_res, v_lot.id, v_take, v_rank);

    v_alloc := v_alloc || jsonb_build_object('lot_id', v_lot.id, 'kind', v_lot.kind, 'credits', v_take);
    v_need := round(v_need - v_take, 4);
    v_rank := v_rank + 1;
  end loop;

  if v_need > 0 then
    raise exception 'WALLET_LOT_DRIFT: balance covered the reservation but lots are short by % credits', v_need;
  end if;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (p_user_id, -round(p_authorized_max_credits,4), v_before, v_after, 'SERVICE_RESERVE',
          'res:' || v_res::text,
          jsonb_build_object('reservation_id', v_res, 'product_code', p_product_code,
                             'plan_code', v_plan_code, 'allocations', v_alloc,
                             'provider_budget_cents', floor(v_budget_cents)::integer))
  returning id into v_ledger;

  update public.usage_reservations set ledger_reserve_id = v_ledger where id = v_res;

  return query select v_res, round(p_authorized_max_credits,4), v_after, false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.wallet_settle(p_reservation_id uuid, p_actual_credits numeric, p_usage jsonb DEFAULT '{}'::jsonb, p_outcome text DEFAULT 'SUCCESS'::text)
 RETURNS TABLE(reservation_id uuid, settled_credits numeric, released_credits numeric, balance_after numeric, was_duplicate boolean, clamped boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_res record;
  v_charge numeric;
  v_release numeric;
  v_clamped boolean := false;
  v_before numeric;
  v_after numeric;
  v_alloc record;
  v_left numeric;
  v_take numeric;
  v_ledger_cap uuid;
  v_ledger_rel uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_res from public.usage_reservations r where r.id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status <> 'RESERVED' then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_res.user_id;
    return query select v_res.id, v_res.settled_credits, v_res.released_credits, v_after, true, false;
    return;
  end if;

  v_charge := round(greatest(COALESCE(p_actual_credits, 0), 0), 4);
  if v_charge > v_res.authorized_max_credits then
    v_charge := v_res.authorized_max_credits;
    v_clamped := true;
  end if;
  v_release := round(v_res.reserved_credits - v_charge, 4);

  v_left := v_charge;
  for v_alloc in
    select a.* from public.credit_lot_allocations a
     where a.reservation_id = p_reservation_id order by a.spend_rank
     for update
  loop
    v_take := least(v_alloc.allocated_credits, greatest(v_left, 0));
    update public.credit_lots
       set credits_reserved = credits_reserved - v_alloc.allocated_credits,
           credits_consumed = credits_consumed + v_take,
           status = case when (credits_granted - credits_consumed - v_take - (credits_reserved - v_alloc.allocated_credits) - credits_expired) <= 0
                         then 'EXHAUSTED' else status end,
           updated_at = now()
     where id = v_alloc.lot_id;

    update public.credit_lot_allocations
       set settled_credits = v_take, released_credits = v_alloc.allocated_credits - v_take
     where id = v_alloc.id;

    v_left := round(v_left - v_take, 4);
  end loop;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_release;
  update public.credit_accounts
     set balance = v_after, reserved = reserved - v_res.reserved_credits, updated_at = now()
   where user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (v_res.user_id, 0, v_before, v_before, 'SERVICE_CAPTURE', 'res:' || p_reservation_id::text || ':cap',
          jsonb_build_object('reservation_id', p_reservation_id, 'product_code', v_res.product_code,
                             'charged_credits', v_charge, 'authorized_max', v_res.authorized_max_credits,
                             'clamped', v_clamped, 'outcome', p_outcome,
                             'plan_code', v_res.plan_code_snapshot))
  returning id into v_ledger_cap;

  if v_release > 0 then
    insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
    values (v_res.user_id, v_release, v_before, v_after, 'SERVICE_RELEASE', 'res:' || p_reservation_id::text || ':rel',
            jsonb_build_object('reservation_id', p_reservation_id, 'reason', 'unused_reservation'))
    returning id into v_ledger_rel;
  end if;

  update public.usage_reservations
     set status = 'SETTLED', settled_credits = v_charge, released_credits = v_release,
         ledger_capture_id = v_ledger_cap, ledger_release_id = COALESCE(v_ledger_rel, ledger_release_id),
         settled_at = now(), updated_at = now(),
         metadata = metadata || jsonb_build_object('clamped', v_clamped)
   where id = p_reservation_id;

  insert into public.usage_events (
    user_id, reservation_id, product_code, plan_code, quality_tier, pricing_version,
    provider, provider_operation, provider_request_id, model,
    input_tokens, cached_tokens, output_tokens, search_count, provider_units, enrichment_units, duration_ms,
    raw_provider_cost_cents, ai_cost_cents, tax_cents, fee_cents, landed_cogs_cents,
    charged_credits, reserved_credits, released_credits,
    allowance_funded, billable, outcome, failure_reason, job_ref, metadata
  ) values (
    v_res.user_id, p_reservation_id, v_res.product_code, v_res.plan_code_snapshot,
    v_res.quality_tier_snapshot, v_res.pricing_version_snapshot,
    p_usage->>'provider', p_usage->>'provider_operation', p_usage->>'provider_request_id', p_usage->>'model',
    (p_usage->>'input_tokens')::bigint, (p_usage->>'cached_tokens')::bigint, (p_usage->>'output_tokens')::bigint,
    (p_usage->>'search_count')::integer, (p_usage->>'provider_units')::numeric,
    (p_usage->>'enrichment_units')::numeric, (p_usage->>'duration_ms')::integer,
    COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0),
    COALESCE((p_usage->>'ai_cost_cents')::numeric, 0),
    COALESCE((p_usage->>'tax_cents')::numeric, 0),
    COALESCE((p_usage->>'fee_cents')::numeric, 0),
    COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0),
    v_charge, v_res.reserved_credits, v_release,
    false, (v_charge > 0), p_outcome, p_usage->>'failure_reason', v_res.job_ref,
    COALESCE(p_usage->'metadata', '{}'::jsonb) || jsonb_build_object('clamped', v_clamped)
  );

  return query select p_reservation_id, v_charge, v_release, v_after, false, v_clamped;
end;
$function$
;
CREATE TRIGGER trg_credit_accounts_updated BEFORE UPDATE ON public.credit_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_credit_lots_follow_legacy_debit AFTER UPDATE OF balance ON public.credit_accounts FOR EACH ROW WHEN ((new.balance < old.balance)) EXECUTE FUNCTION credit_lots_follow_legacy_debit();
CREATE TRIGGER trg_refuse_when_impersonated BEFORE INSERT OR DELETE OR UPDATE ON public.credit_accounts FOR EACH ROW EXECUTE FUNCTION homatch_refuse_when_impersonated();
CREATE TRIGGER trg_refuse_spend_while_viewed BEFORE INSERT ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION homatch_refuse_spend_while_viewed();
CREATE TRIGGER trg_refuse_when_impersonated BEFORE INSERT OR DELETE OR UPDATE ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION homatch_refuse_when_impersonated();
CREATE TRIGGER trg_credit_lots_touch BEFORE UPDATE ON public.credit_lots FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();
CREATE TRIGGER notifications_sync_read_at BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION notifications_sync_read_at();
CREATE TRIGGER properties_require_contact_phone BEFORE INSERT ON public.properties FOR EACH ROW EXECUTE FUNCTION require_property_contact_phone();
CREATE TRIGGER trg_refuse_spend_while_viewed BEFORE INSERT ON public.usage_reservations FOR EACH ROW EXECUTE FUNCTION homatch_refuse_spend_while_viewed();
CREATE TRIGGER trg_refuse_when_impersonated BEFORE INSERT OR DELETE OR UPDATE ON public.usage_reservations FOR EACH ROW EXECUTE FUNCTION homatch_refuse_when_impersonated();
CREATE TRIGGER trg_usage_reservations_touch BEFORE UPDATE ON public.usage_reservations FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();
CREATE TRIGGER trg_user_prefs_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_create_credit_account AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION create_credit_account_for_user();
CREATE TRIGGER trg_protect_privileged_user_columns BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION protect_privileged_user_columns();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
alter table public."admin_settings" enable row level security;
revoke all on public."admin_settings" from anon,authenticated;
grant all on public."admin_settings" to service_role;
create policy "Service manages settings" on public."admin_settings" for ALL to "service_role" using ((( SELECT auth.role() AS role) = 'service_role'::text));
create policy "admin_settings_admin_only" on public."admin_settings" for ALL to "authenticated" using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));
alter table public."allowance_consumptions" enable row level security;
revoke all on public."allowance_consumptions" from anon,authenticated;
grant all on public."allowance_consumptions" to service_role;
create policy "allowance_read_own" on public."allowance_consumptions" for SELECT to "authenticated" using (((user_id = auth_user_id()) OR is_admin()));
create policy "allowance_service" on public."allowance_consumptions" for ALL to "service_role" using (true) with check (true);
alter table public."billable_products" enable row level security;
revoke all on public."billable_products" from anon,authenticated;
grant all on public."billable_products" to service_role;
create policy "billable_products_admin" on public."billable_products" for ALL to "authenticated" using (is_admin()) with check (is_admin());
create policy "billable_products_read_enabled" on public."billable_products" for SELECT to "anon","authenticated" using ((enabled = true));
create policy "billable_products_service" on public."billable_products" for ALL to "service_role" using (true) with check (true);
alter table public."billing_plans" enable row level security;
revoke all on public."billing_plans" from anon,authenticated;
grant all on public."billing_plans" to service_role;
create policy "billing_plans_admin_write" on public."billing_plans" for ALL to "authenticated" using (is_admin()) with check (is_admin());
create policy "billing_plans_read" on public."billing_plans" for SELECT to "anon","authenticated" using (((enabled = true) OR is_admin()));
create policy "billing_plans_service" on public."billing_plans" for ALL to "service_role" using (true) with check (true);
alter table public."broker_directory_listings" enable row level security;
revoke all on public."broker_directory_listings" from anon,authenticated;
grant all on public."broker_directory_listings" to service_role;
create policy "broker_directory_owner_reads" on public."broker_directory_listings" for SELECT to "public" using ((auth.uid() = owner_user_id));
alter table public."broker_intelligence" enable row level security;
revoke all on public."broker_intelligence" from anon,authenticated;
grant all on public."broker_intelligence" to service_role;
alter table public."canonical_property_groups" enable row level security;
revoke all on public."canonical_property_groups" from anon,authenticated;
grant all on public."canonical_property_groups" to service_role;
create policy "canonical_groups_read" on public."canonical_property_groups" for SELECT to "authenticated" using (true);
alter table public."credit_accounts" enable row level security;
revoke all on public."credit_accounts" from anon,authenticated;
grant all on public."credit_accounts" to service_role;
create policy "service_all_credits" on public."credit_accounts" for ALL to "service_role" using (true) with check (true);
create policy "user_read_own_credits" on public."credit_accounts" for SELECT to "authenticated" using ((user_id = ( SELECT users.id
   FROM users
  WHERE (users.auth_id = ( SELECT auth.uid() AS uid))
 LIMIT 1)));
alter table public."credit_ledger" enable row level security;
revoke all on public."credit_ledger" from anon,authenticated;
grant all on public."credit_ledger" to service_role;
create policy "service_all_ledger" on public."credit_ledger" for ALL to "service_role" using (true) with check (true);
create policy "user_read_own_ledger" on public."credit_ledger" for SELECT to "authenticated" using ((user_id = ( SELECT users.id
   FROM users
  WHERE (users.auth_id = ( SELECT auth.uid() AS uid))
 LIMIT 1)));
alter table public."credit_lot_allocations" enable row level security;
revoke all on public."credit_lot_allocations" from anon,authenticated;
grant all on public."credit_lot_allocations" to service_role;
create policy "cla_read_own" on public."credit_lot_allocations" for SELECT to "authenticated" using ((is_admin() OR (EXISTS ( SELECT 1
   FROM usage_reservations r
  WHERE ((r.id = credit_lot_allocations.reservation_id) AND (r.user_id = auth_user_id()))))));
create policy "cla_service" on public."credit_lot_allocations" for ALL to "service_role" using (true) with check (true);
alter table public."credit_lots" enable row level security;
revoke all on public."credit_lots" from anon,authenticated;
grant all on public."credit_lots" to service_role;
create policy "credit_lots_read_own" on public."credit_lots" for SELECT to "authenticated" using (((user_id = auth_user_id()) OR is_admin()));
create policy "credit_lots_service" on public."credit_lots" for ALL to "service_role" using (true) with check (true);
alter table public."developer_profiles" enable row level security;
revoke all on public."developer_profiles" from anon,authenticated;
grant all on public."developer_profiles" to service_role;
create policy "developer_profiles_read" on public."developer_profiles" for SELECT to "authenticated" using (true);
alter table public."notifications" enable row level security;
revoke all on public."notifications" from anon,authenticated;
grant all on public."notifications" to service_role;
create policy "notif_select_own" on public."notifications" for SELECT to "authenticated" using ((user_id = ( SELECT auth_user_id() AS auth_user_id)));
create policy "notif_update_own" on public."notifications" for UPDATE to "authenticated" using ((user_id = ( SELECT auth_user_id() AS auth_user_id))) with check ((user_id = ( SELECT auth_user_id() AS auth_user_id)));
alter table public."product_plan_entitlements" enable row level security;
revoke all on public."product_plan_entitlements" from anon,authenticated;
grant all on public."product_plan_entitlements" to service_role;
create policy "ppe_admin_write" on public."product_plan_entitlements" for ALL to "authenticated" using (is_admin()) with check (is_admin());
create policy "ppe_read" on public."product_plan_entitlements" for SELECT to "anon","authenticated" using (true);
create policy "ppe_service" on public."product_plan_entitlements" for ALL to "service_role" using (true) with check (true);
alter table public."properties" enable row level security;
revoke all on public."properties" from anon,authenticated;
grant all on public."properties" to service_role;
create policy "impersonation_no_delete" on public."properties" for DELETE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_insert" on public."properties" for INSERT to "authenticated" with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_update" on public."properties" for UPDATE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session))) with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "props_delete_own" on public."properties" for DELETE to "public" using ((user_id = get_user_id()));
create policy "props_insert_own" on public."properties" for INSERT to "public" with check ((user_id = get_user_id()));
create policy "props_select_own" on public."properties" for SELECT to "public" using ((user_id = get_user_id()));
create policy "props_update_own" on public."properties" for UPDATE to "public" using ((user_id = get_user_id()));
alter table public."property_facts" enable row level security;
revoke all on public."property_facts" from anon,authenticated;
grant all on public."property_facts" to service_role;
create policy "facts_delete_own" on public."property_facts" for DELETE to "public" using (user_owns_property(property_id));
create policy "facts_insert_own" on public."property_facts" for INSERT to "public" with check (user_owns_property(property_id));
create policy "facts_select_own" on public."property_facts" for SELECT to "public" using (user_owns_property(property_id));
create policy "facts_update_own" on public."property_facts" for UPDATE to "public" using (user_owns_property(property_id));
create policy "impersonation_no_delete" on public."property_facts" for DELETE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_insert" on public."property_facts" for INSERT to "authenticated" with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_update" on public."property_facts" for UPDATE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session))) with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
alter table public."usage_events" enable row level security;
revoke all on public."usage_events" from anon,authenticated;
grant all on public."usage_events" to service_role;
create policy "usage_events_admin_read" on public."usage_events" for SELECT to "authenticated" using (is_admin());
create policy "usage_events_service" on public."usage_events" for ALL to "service_role" using (true) with check (true);
alter table public."usage_reservations" enable row level security;
revoke all on public."usage_reservations" from anon,authenticated;
grant all on public."usage_reservations" to service_role;
create policy "usage_reservations_read_own" on public."usage_reservations" for SELECT to "authenticated" using (((user_id = auth_user_id()) OR is_admin()));
create policy "usage_reservations_service" on public."usage_reservations" for ALL to "service_role" using (true) with check (true);
alter table public."user_preferences" enable row level security;
revoke all on public."user_preferences" from anon,authenticated;
grant all on public."user_preferences" to service_role;
create policy "impersonation_no_delete" on public."user_preferences" for DELETE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_insert" on public."user_preferences" for INSERT to "authenticated" with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_update" on public."user_preferences" for UPDATE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session))) with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "prefs_insert_own" on public."user_preferences" for INSERT to "public" with check ((user_id = get_user_id()));
create policy "prefs_select_own" on public."user_preferences" for SELECT to "public" using ((user_id = get_user_id()));
create policy "prefs_update_own" on public."user_preferences" for UPDATE to "public" using ((user_id = get_user_id()));
alter table public."user_subscriptions" enable row level security;
revoke all on public."user_subscriptions" from anon,authenticated;
grant all on public."user_subscriptions" to service_role;
create policy "user_subscriptions_read_own" on public."user_subscriptions" for SELECT to "authenticated" using (((user_id = auth_user_id()) OR is_admin()));
create policy "user_subscriptions_service" on public."user_subscriptions" for ALL to "service_role" using (true) with check (true);
alter table public."users" enable row level security;
revoke all on public."users" from anon,authenticated;
grant all on public."users" to service_role;
create policy "impersonation_no_delete" on public."users" for DELETE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_insert" on public."users" for INSERT to "authenticated" with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "impersonation_no_update" on public."users" for UPDATE to "authenticated" using ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session))) with check ((NOT ( SELECT is_impersonated_session() AS is_impersonated_session)));
create policy "users_insert_own" on public."users" for INSERT to "public" with check ((auth_id = ( SELECT auth.uid() AS uid)));
create policy "users_select_own" on public."users" for SELECT to "public" using ((auth_id = ( SELECT auth.uid() AS uid)));
create policy "users_update_own" on public."users" for UPDATE to "public" using ((auth_id = ( SELECT auth.uid() AS uid)));
alter table public."impersonation_sessions" enable row level security;
revoke all on public."impersonation_sessions" from anon,authenticated;
grant all on public."impersonation_sessions" to service_role;
alter table public."admin_audit_log" enable row level security;
revoke all on public."admin_audit_log" from anon,authenticated;
grant all on public."admin_audit_log" to service_role;
grant select on public."users" to authenticated;
grant select on public."user_preferences" to authenticated;
grant select on public."notifications" to authenticated;
grant select on public."credit_accounts" to authenticated;
grant select on public."credit_ledger" to authenticated;
grant select on public."credit_lots" to authenticated;
grant select on public."credit_lot_allocations" to authenticated;
grant select on public."usage_reservations" to authenticated;
grant select on public."usage_events" to authenticated;
grant select on public."billing_plans" to authenticated;
grant select on public."billable_products" to authenticated;
grant select on public."user_subscriptions" to authenticated;
grant select on public."properties" to authenticated;
grant select on public."property_facts" to authenticated;
grant insert on public.users to authenticated;
grant update(preferred_language,full_name,avatar_url) on public.users to authenticated;
grant update(read_at) on public.notifications to authenticated;
revoke all on function public.account_is_being_viewed(uuid) from public,anon,authenticated;
grant execute on function public.account_is_being_viewed(uuid) to service_role;
grant execute on function public.account_is_being_viewed(uuid) to authenticated;
revoke all on function public.auth_user_id() from public,anon,authenticated;
grant execute on function public.auth_user_id() to service_role;
grant execute on function public.auth_user_id() to authenticated;
revoke all on function public.billing_budget_to_cogs_ceiling(text,text,numeric) from public,anon,authenticated;
grant execute on function public.billing_budget_to_cogs_ceiling(text,text,numeric) to service_role;
revoke all on function public.billing_credits_to_cents(numeric) from public,anon,authenticated;
grant execute on function public.billing_credits_to_cents(numeric) to service_role;
revoke all on function public.billing_current_plan(uuid) from public,anon,authenticated;
grant execute on function public.billing_current_plan(uuid) to service_role;
revoke all on function public.billing_release_allowance(uuid,text) from public,anon,authenticated;
grant execute on function public.billing_release_allowance(uuid,text) to service_role;
revoke all on function public.billing_setting_bool(text,boolean) from public,anon,authenticated;
grant execute on function public.billing_setting_bool(text,boolean) to service_role;
revoke all on function public.billing_setting_num(text,numeric) from public,anon,authenticated;
grant execute on function public.billing_setting_num(text,numeric) to service_role;
revoke all on function public.billing_touch_updated_at() from public,anon,authenticated;
grant execute on function public.billing_touch_updated_at() to service_role;
revoke all on function public.create_credit_account_for_user() from public,anon,authenticated;
grant execute on function public.create_credit_account_for_user() to service_role;
revoke all on function public.credit_lots_follow_legacy_debit() from public,anon,authenticated;
grant execute on function public.credit_lots_follow_legacy_debit() to service_role;
revoke all on function public.get_user_id() from public,anon,authenticated;
grant execute on function public.get_user_id() to service_role;
grant execute on function public.get_user_id() to authenticated;
revoke all on function public.homatch_refuse_spend_while_viewed() from public,anon,authenticated;
grant execute on function public.homatch_refuse_spend_while_viewed() to service_role;
revoke all on function public.homatch_refuse_when_impersonated() from public,anon,authenticated;
grant execute on function public.homatch_refuse_when_impersonated() to service_role;
revoke all on function public.is_admin() from public,anon,authenticated;
grant execute on function public.is_admin() to service_role;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.is_impersonated_session() from public,anon,authenticated;
grant execute on function public.is_impersonated_session() to service_role;
grant execute on function public.is_impersonated_session() to authenticated;
revoke all on function public.notifications_sync_read_at() from public,anon,authenticated;
grant execute on function public.notifications_sync_read_at() to service_role;
revoke all on function public.protect_privileged_user_columns() from public,anon,authenticated;
grant execute on function public.protect_privileged_user_columns() to service_role;
revoke all on function public.require_property_contact_phone() from public,anon,authenticated;
grant execute on function public.require_property_contact_phone() to service_role;
revoke all on function public.update_updated_at() from public,anon,authenticated;
grant execute on function public.update_updated_at() to service_role;
revoke all on function public.user_owns_property(uuid) from public,anon,authenticated;
grant execute on function public.user_owns_property(uuid) to service_role;
grant execute on function public.user_owns_property(uuid) to authenticated;
revoke all on function public.wallet_admin_adjust(uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.wallet_admin_adjust(uuid,numeric,text,text) to service_role;
revoke all on function public.wallet_grant_credits(uuid,text,numeric,text,text,text,timestamp with time zone,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wallet_grant_credits(uuid,text,numeric,text,text,text,timestamp with time zone,text,uuid,jsonb) to service_role;
revoke all on function public.wallet_release(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.wallet_release(uuid,text,jsonb) to service_role;
revoke all on function public.wallet_reserve(uuid,text,numeric,text,numeric,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.wallet_reserve(uuid,text,numeric,text,numeric,numeric,text,jsonb) to service_role;
revoke all on function public.wallet_settle(uuid,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.wallet_settle(uuid,numeric,jsonb,text) to service_role;

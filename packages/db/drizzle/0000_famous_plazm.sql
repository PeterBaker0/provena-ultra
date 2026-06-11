CREATE TYPE "public"."item_category" AS ENUM('ACTIVITY', 'AGENT', 'ENTITY');--> statement-breakpoint
CREATE TYPE "public"."item_subtype" AS ENUM('WORKFLOW_RUN', 'MODEL_RUN', 'STUDY', 'CREATE', 'VERSION', 'PERSON', 'ORGANISATION', 'SOFTWARE', 'MODEL', 'WORKFLOW_TEMPLATE', 'MODEL_RUN_WORKFLOW_TEMPLATE', 'DATASET', 'DATASET_TEMPLATE');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'DEQUEUED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."job_sub_type" AS ENUM('PROV_LODGE_WAKE_UP', 'MODEL_RUN_PROV_LODGE', 'MODEL_RUN_LODGE_ONLY', 'MODEL_RUN_BATCH_SUBMIT', 'LODGE_CREATE_ACTIVITY', 'LODGE_VERSION_ACTIVITY', 'MODEL_RUN_UPDATE', 'MODEL_RUN_UPDATE_LODGE_ONLY', 'REGISTRY_WAKE_UP', 'REGISTER_CREATE_ACTIVITY', 'REGISTER_VERSION_ACTIVITY', 'EMAIL_WAKE_UP', 'SEND_EMAIL', 'GENERATE_REPORT');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('PROV_LODGE', 'REGISTRY', 'EMAIL', 'REPORT');--> statement-breakpoint
CREATE TYPE "public"."lock_action_type" AS ENUM('LOCK', 'UNLOCK');--> statement-breakpoint
CREATE TYPE "public"."prov_relation" AS ENUM('wasInfluencedBy', 'wasGeneratedBy', 'used', 'wasAttributedTo', 'wasAssociatedWith', 'actedOnBehalfOf');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('SEED_ITEM', 'COMPLETE_ITEM');--> statement-breakpoint
CREATE TYPE "public"."released_status" AS ENUM('NOT_RELEASED', 'PENDING', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('PENDING_APPROVAL', 'APPROVED_PENDING_ACTION', 'DENIED_PENDING_DELETION', 'ACTIONED_PENDING_DELETION');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_completion_status" AS ENUM('INCOMPLETE', 'COMPLETE', 'LODGED');--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"item_category" "item_category" NOT NULL,
	"item_subtype" "item_subtype" NOT NULL,
	"owner_username" text NOT NULL,
	"created_timestamp" bigint NOT NULL,
	"updated_timestamp" bigint NOT NULL,
	"record_type" "record_type" NOT NULL,
	"display_name" text,
	"user_metadata" jsonb,
	"versioning_previous_version" text,
	"versioning_version" integer,
	"versioning_reason" text,
	"versioning_next_version" text,
	"create_activity_workflow_id" text,
	"version_activity_workflow_id" text,
	"search_text" text
);
--> statement-breakpoint
CREATE TABLE "item_create" (
	"item_id" text PRIMARY KEY NOT NULL,
	"created_item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_dataset" (
	"item_id" text PRIMARY KEY NOT NULL,
	"collection_format" jsonb NOT NULL,
	"s3_bucket_name" text NOT NULL,
	"s3_path" text NOT NULL,
	"s3_uri" text NOT NULL,
	"release_status" "released_status" DEFAULT 'NOT_RELEASED' NOT NULL,
	"release_approver" text,
	"release_timestamp" bigint,
	"access_info_uri" text,
	"release_history" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_dataset_template" (
	"item_id" text PRIMARY KEY NOT NULL,
	"description" text,
	"defined_resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deferred_resources" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_history" (
	"item_id" text NOT NULL,
	"history_id" integer NOT NULL,
	"timestamp" bigint NOT NULL,
	"reason" text NOT NULL,
	"username" text NOT NULL,
	"domain_info" jsonb NOT NULL,
	CONSTRAINT "item_history_item_id_history_id_pk" PRIMARY KEY("item_id","history_id")
);
--> statement-breakpoint
CREATE TABLE "item_model" (
	"item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"documentation_url" text NOT NULL,
	"source_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_model_run" (
	"item_id" text PRIMARY KEY NOT NULL,
	"record" jsonb NOT NULL,
	"prov_serialisation" text NOT NULL,
	"record_status" "workflow_run_completion_status" DEFAULT 'INCOMPLETE' NOT NULL,
	"study_id" text
);
--> statement-breakpoint
CREATE TABLE "item_model_run_workflow_template" (
	"item_id" text PRIMARY KEY NOT NULL,
	"software_id" text NOT NULL,
	"input_templates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_templates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"annotations" jsonb
);
--> statement-breakpoint
CREATE TABLE "item_organisation" (
	"item_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ror" text
);
--> statement-breakpoint
CREATE TABLE "item_person" (
	"item_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"orcid" text,
	"ethics_approved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_study" (
	"item_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"study_alternative_id" text
);
--> statement-breakpoint
CREATE TABLE "item_version" (
	"item_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"from_item_id" text NOT NULL,
	"to_item_id" text NOT NULL,
	"new_version_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_auth" (
	"item_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"general_roles" text[] DEFAULT '{}' NOT NULL,
	"group_roles" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_lock" (
	"item_id" text PRIMARY KEY NOT NULL,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lock_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"action_type" "lock_action_type" NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"reason" text NOT NULL,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prov_edge" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"relation" "prov_relation" NOT NULL,
	"record_ids" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_request" (
	"username" text NOT NULL,
	"request_id" integer NOT NULL,
	"email" text NOT NULL,
	"status" "request_status" NOT NULL,
	"ui_friendly_status" text NOT NULL,
	"created_timestamp" bigint NOT NULL,
	"updated_timestamp" bigint NOT NULL,
	"expiry" bigint NOT NULL,
	"request_diff_contents" text NOT NULL,
	"complete_contents" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "access_request_username_request_id_pk" PRIMARY KEY("username","request_id")
);
--> statement-breakpoint
CREATE TABLE "dataset_reviewer" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handle" (
	"id" text PRIMARY KEY NOT NULL,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_session" (
	"session_id" text PRIMARY KEY NOT NULL,
	"created_timestamp" bigint NOT NULL,
	"username" text NOT NULL,
	"batch_id" text,
	"job_type" "job_type" NOT NULL,
	"job_sub_type" "job_sub_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"info" text,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "user_group" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"default_data_store_access" text[]
);
--> statement-breakpoint
CREATE TABLE "user_group_member" (
	"group_id" text NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"first_name" text,
	"last_name" text,
	CONSTRAINT "user_group_member_group_id_username_pk" PRIMARY KEY("group_id","username")
);
--> statement-breakpoint
CREATE TABLE "user_person_link" (
	"username" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_create" ADD CONSTRAINT "item_create_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dataset" ADD CONSTRAINT "item_dataset_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_dataset_template" ADD CONSTRAINT "item_dataset_template_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_history" ADD CONSTRAINT "item_history_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_model" ADD CONSTRAINT "item_model_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_model_run" ADD CONSTRAINT "item_model_run_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_model_run_workflow_template" ADD CONSTRAINT "item_model_run_workflow_template_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_organisation" ADD CONSTRAINT "item_organisation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_person" ADD CONSTRAINT "item_person_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_study" ADD CONSTRAINT "item_study_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_version" ADD CONSTRAINT "item_version_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_auth" ADD CONSTRAINT "item_auth_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_lock" ADD CONSTRAINT "item_lock_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lock_event" ADD CONSTRAINT "lock_event_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_subtype_updated_idx" ON "item" USING btree ("item_subtype","updated_timestamp");--> statement-breakpoint
CREATE INDEX "item_subtype_created_idx" ON "item" USING btree ("item_subtype","created_timestamp");--> statement-breakpoint
CREATE INDEX "item_subtype_display_idx" ON "item" USING btree ("item_subtype","display_name");--> statement-breakpoint
CREATE INDEX "item_owner_idx" ON "item" USING btree ("owner_username");--> statement-breakpoint
CREATE INDEX "item_dataset_release_status_idx" ON "item_dataset" USING btree ("release_status");--> statement-breakpoint
CREATE INDEX "item_dataset_release_approver_idx" ON "item_dataset" USING btree ("release_approver");--> statement-breakpoint
CREATE INDEX "item_dataset_access_info_uri_idx" ON "item_dataset" USING btree ("access_info_uri");--> statement-breakpoint
CREATE INDEX "item_model_run_study_idx" ON "item_model_run" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "lock_event_item_idx" ON "lock_event" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prov_edge_unique_idx" ON "prov_edge" USING btree ("source_id","target_id","relation");--> statement-breakpoint
CREATE INDEX "prov_edge_source_idx" ON "prov_edge" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "prov_edge_target_idx" ON "prov_edge" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "job_session_username_idx" ON "job_session" USING btree ("username","created_timestamp");--> statement-breakpoint
CREATE INDEX "job_session_batch_idx" ON "job_session" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "job_session_created_idx" ON "job_session" USING btree ("created_timestamp");--> statement-breakpoint
CREATE INDEX "user_group_member_username_idx" ON "user_group_member" USING btree ("username");--> statement-breakpoint
CREATE INDEX "user_person_link_person_idx" ON "user_person_link" USING btree ("person_id");
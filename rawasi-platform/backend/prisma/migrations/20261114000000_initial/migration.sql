-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'SUPERVISOR_VENDOR', 'CLIENT', 'FIELD_PROMOTER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('SUBMITTED', 'SUPERVISOR_REVIEW', 'PENDING_ADMIN_APPROVAL', 'REJECTION_REQUESTED', 'QUOTED_TO_CLIENT', 'CLIENT_APPROVED', 'CLIENT_REJECTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED_BY_ADMIN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('FULL_SERVICE', 'LABOR_ONLY');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CostItemType" AS ENUM ('BASE', 'EXTRA');

-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('ISSUE', 'RETURN', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "phone" VARCHAR(32),
    "role_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_name" TEXT NOT NULL,
    "registration_number" TEXT,
    "contact_name" TEXT,
    "membership_number" TEXT NOT NULL,
    "card_issued_at" TIMESTAMP(3),
    "card_expires_at" TIMESTAMP(3),
    "card_version" INTEGER NOT NULL DEFAULT 1,
    "promoter_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "hide_initial_price" BOOLEAN NOT NULL DEFAULT true,
    "allow_client_budget" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "supervisor_name" TEXT NOT NULL,
    "region_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "contract_type" "ContractType" NOT NULL,
    "contract_start_date" DATE NOT NULL,
    "contract_end_date" DATE NOT NULL,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_quarterly_ratings" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "rating" DECIMAL(3,2) NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "avg_response_seconds" INTEGER,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vendor_quarterly_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_workers" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "employee_number" TEXT NOT NULL,
    "national_id_number" TEXT NOT NULL,
    "identity_image_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vendor_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_rate_cards" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "agreed_base_cost" DECIMAL(18,2) NOT NULL,
    "max_base_cost" DECIMAL(18,2) NOT NULL,
    "rawasi_markup_percent" DECIMAL(6,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vendor_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "vendor_id" UUID,
    "worker_id" UUID,
    "description" TEXT NOT NULL,
    "client_notes" TEXT,
    "rejection_reason" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "sla_deadline_at" TIMESTAMP(3) NOT NULL,
    "first_response_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cost_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "quote_version" INTEGER NOT NULL,
    "item_type" "CostItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "vendor_cost" DECIMAL(18,2) NOT NULL,
    "client_price" DECIMAL(18,2) NOT NULL,
    "markup_percent" DECIMAL(6,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "order_cost_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "internal_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "available_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_transactions" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" "CustodyType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "reference_no" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "custody_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_id_is_active_idx" ON "users"("role_id", "is_active");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_user_id_key" ON "client_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_membership_number_key" ON "client_profiles"("membership_number");

-- CreateIndex
CREATE INDEX "client_profiles_promoter_id_idx" ON "client_profiles"("promoter_id");

-- CreateIndex
CREATE INDEX "client_profiles_registration_number_idx" ON "client_profiles"("registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");

-- CreateIndex
CREATE INDEX "regions_is_active_deleted_at_idx" ON "regions"("is_active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_code_key" ON "service_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");

-- CreateIndex
CREATE INDEX "services_category_id_is_active_idx" ON "services"("category_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- CreateIndex
CREATE INDEX "vendors_region_id_category_id_status_idx" ON "vendors"("region_id", "category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_quarterly_ratings_vendor_id_year_quarter_key" ON "vendor_quarterly_ratings"("vendor_id", "year", "quarter");

-- CreateIndex
CREATE INDEX "vendor_workers_vendor_id_is_active_idx" ON "vendor_workers"("vendor_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_workers_vendor_id_employee_number_key" ON "vendor_workers"("vendor_id", "employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_workers_id_vendor_id_key" ON "vendor_workers"("id", "vendor_id");

-- CreateIndex
CREATE INDEX "vendor_rate_cards_region_id_service_id_is_active_idx" ON "vendor_rate_cards"("region_id", "service_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_rate_cards_vendor_id_region_id_service_id_currency_key" ON "vendor_rate_cards"("vendor_id", "region_id", "service_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_client_id_created_at_idx" ON "orders"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_vendor_id_status_idx" ON "orders"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "orders_region_id_service_id_status_idx" ON "orders"("region_id", "service_id", "status");

-- CreateIndex
CREATE INDEX "orders_status_sla_deadline_at_idx" ON "orders"("status", "sla_deadline_at");

-- CreateIndex
CREATE INDEX "order_cost_items_order_id_quote_version_idx" ON "order_cost_items"("order_id", "quote_version");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_actor_id_idx" ON "order_status_history"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_sku_key" ON "inventory_items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "custody_transactions_reference_no_key" ON "custody_transactions"("reference_no");

-- CreateIndex
CREATE INDEX "custody_transactions_vendor_id_item_id_created_at_idx" ON "custody_transactions"("vendor_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "custody_transactions_order_id_idx" ON "custody_transactions"("order_id");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_promoter_id_fkey" FOREIGN KEY ("promoter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_quarterly_ratings" ADD CONSTRAINT "vendor_quarterly_ratings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_workers" ADD CONSTRAINT "vendor_workers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_workers" ADD CONSTRAINT "vendor_workers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_rate_cards" ADD CONSTRAINT "vendor_rate_cards_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_rate_cards" ADD CONSTRAINT "vendor_rate_cards_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_rate_cards" ADD CONSTRAINT "vendor_rate_cards_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_worker_id_vendor_id_fkey" FOREIGN KEY ("worker_id", "vendor_id") REFERENCES "vendor_workers"("id", "vendor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cost_items" ADD CONSTRAINT "order_cost_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain constraints that Prisma does not express in the schema.
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_card_dates" CHECK ("card_expires_at" IS NULL OR ("card_issued_at" IS NOT NULL AND "card_expires_at" >= "card_issued_at")), ADD CONSTRAINT "client_card_version_positive" CHECK ("card_version" > 0);
ALTER TABLE "vendors" ADD CONSTRAINT "vendor_contract_term" CHECK ("contract_end_date" >= ("contract_start_date" + INTERVAL '2 years')::date AND "contract_end_date" <= ("contract_start_date" + INTERVAL '5 years')::date);
ALTER TABLE "vendor_quarterly_ratings" ADD CONSTRAINT "vendor_rating_range" CHECK ("rating" BETWEEN 0 AND 5), ADD CONSTRAINT "vendor_rating_period" CHECK ("year" BETWEEN 2000 AND 9999 AND "quarter" BETWEEN 1 AND 4), ADD CONSTRAINT "vendor_rating_counts" CHECK ("sample_count" > 0 AND ("avg_response_seconds" IS NULL OR "avg_response_seconds" >= 0));
ALTER TABLE "vendor_rate_cards" ADD CONSTRAINT "rate_card_costs" CHECK ("agreed_base_cost" >= 0 AND "max_base_cost" >= "agreed_base_cost"), ADD CONSTRAINT "rate_card_markup" CHECK ("rawasi_markup_percent" BETWEEN 0 AND 1), ADD CONSTRAINT "rate_card_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "orders" ADD CONSTRAINT "order_worker_vendor" CHECK ("worker_id" IS NULL OR "vendor_id" IS NOT NULL), ADD CONSTRAINT "order_version_nonnegative" CHECK ("version" >= 0), ADD CONSTRAINT "order_response_time" CHECK ("first_response_at" IS NULL OR "first_response_at" >= "created_at");
ALTER TABLE "order_cost_items" ADD CONSTRAINT "order_cost_nonnegative" CHECK ("vendor_cost" >= 0 AND "client_price" >= 0), ADD CONSTRAINT "order_cost_markup" CHECK ("markup_percent" BETWEEN 0 AND 1), ADD CONSTRAINT "order_quote_version_positive" CHECK ("quote_version" > 0), ADD CONSTRAINT "order_cost_currency" CHECK ("currency" ~ '^[A-Z]{3}$'), ADD CONSTRAINT "order_cost_approval_pair" CHECK (("approved_at" IS NULL) = ("approved_by_id" IS NULL)), ADD CONSTRAINT "order_cost_extra_description" CHECK ("item_type" <> 'EXTRA' OR length(trim("description")) > 0);
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_quantity_positive" CHECK ("quantity" > 0);

-- Custody entries must reference the order's assigned labor-only vendor.
CREATE FUNCTION "check_custody_vendor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_vendor uuid; vendor_contract "ContractType";
BEGIN
  SELECT "contract_type" INTO vendor_contract FROM "vendors" WHERE "id" = NEW."vendor_id" FOR SHARE;
  SELECT "vendor_id" INTO order_vendor FROM "orders" WHERE "id" = NEW."order_id" FOR SHARE;
  IF vendor_contract IS DISTINCT FROM 'LABOR_ONLY'::"ContractType" OR order_vendor IS DISTINCT FROM NEW."vendor_id" THEN
    RAISE EXCEPTION 'Custody requires the order assigned labor-only vendor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "custody_vendor_guard" BEFORE INSERT OR UPDATE OF "vendor_id", "order_id" ON "custody_transactions" FOR EACH ROW EXECUTE FUNCTION "check_custody_vendor"();

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_available_nonnegative" CHECK ("available_quantity" >= 0);

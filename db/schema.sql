-- ============================================================================
-- POS Batch Tracking System - FULL INSTALL SCRIPT
-- ============================================================================
-- Use this to set up the database FRESH on a new machine (e.g. from a flash
-- disk install). It creates every table in its final, current form directly -
-- you do NOT need to run any of the old migration_*.sql files after this.
--
-- ONLY run this against a brand-new, empty database. It does not contain any
-- of your existing shop data - if you're moving an existing installation with
-- real records, take a pg_dump of that database instead of using this script.
--
-- Usage:
--   1. Create a new empty database (e.g. `createdb pos_batch_system`)
--   2. Run this file against it:
--        psql -U your_user -d pos_batch_system -f full_install_schema.sql
--      (or paste it into pgAdmin's Query Tool and execute)
--   3. Set PGDATABASE in your .env to match the database name you used
-- ============================================================================

-- ============================================================================
-- Reference tables (no dependencies)
-- ============================================================================

CREATE TABLE units_of_measure (
    unit_id    SERIAL PRIMARY KEY,
    unit_code  VARCHAR(20) UNIQUE,   -- e.g. UOM-0001, assigned by the app right after insert
    name       VARCHAR(50) UNIQUE NOT NULL,
    short_name VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE categories (
    category_id   SERIAL PRIMARY KEY,
    category_code VARCHAR(20) UNIQUE,  -- e.g. CAT-0001, assigned by the app right after insert
    name          VARCHAR(100) UNIQUE NOT NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE customers (
    customer_id     SERIAL PRIMARY KEY,
    customer_code   VARCHAR(20) UNIQUE,
    name            VARCHAR(150) UNIQUE NOT NULL,
    phone           VARCHAR(30),
    address         VARCHAR(255),
    opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0, -- negative = customer advance, positive = balance owed
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,    -- true only for Walk-in Customer, never deletable
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE suppliers (
    supplier_id     SERIAL PRIMARY KEY,
    supplier_code   VARCHAR(20) UNIQUE,
    name            VARCHAR(150) UNIQUE NOT NULL,
    phone           VARCHAR(30),
    address         VARCHAR(255),
    opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,    -- true only for General Supplier, never deletable
    created_at      TIMESTAMP DEFAULT NOW()
);


-- ============================================================================
-- Items (depends on categories, units_of_measure)
-- ============================================================================

CREATE TABLE items (
    item_id     SERIAL PRIMARY KEY,
    item_code   VARCHAR(20) UNIQUE,   -- system-assigned, always matches item_id zero-padded (e.g. "0001")
    name        VARCHAR(150) NOT NULL,
    sku         VARCHAR(50) UNIQUE,   -- genuinely optional, user-entered product code/barcode
    category_id INT REFERENCES categories(category_id) ON DELETE SET NULL,
    unit_id     INT NOT NULL REFERENCES units_of_measure(unit_id),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Purchases
-- ============================================================================

CREATE TABLE purchases (
    purchase_id         SERIAL PRIMARY KEY,
    purchase_invoice_no VARCHAR(20) UNIQUE NOT NULL,  -- e.g. PUR-0001
    supplier            VARCHAR(150) DEFAULT 'General Supplier', -- free text for now, not linked to suppliers table
    purchase_date       TIMESTAMP DEFAULT NOW(),
    status              VARCHAR(10) CHECK (status IN ('lpo','received')) DEFAULT 'received',
    subtotal            NUMERIC(12,2) DEFAULT 0,
    total               NUMERIC(12,2) DEFAULT 0,
    amount_paid         NUMERIC(12,2) DEFAULT 0,
    payment_method      VARCHAR(10) CHECK (payment_method IN ('cash','mpesa','bank')),
    payment_status      VARCHAR(10) CHECK (payment_status IN ('paid','partial','unpaid')) DEFAULT 'unpaid',
    created_by          VARCHAR(100) DEFAULT 'Admin'
);

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

-- ============================================================================
-- Batches (depends on items, purchases)
-- ============================================================================

-- One row per batch. Created automatically whenever a purchase line is
-- received into stock.
CREATE TABLE batches (
    batch_id       SERIAL PRIMARY KEY,
    item_id        INT NOT NULL REFERENCES items(item_id),
    purchase_id    INT REFERENCES purchases(purchase_id),
    batch_ref_no   VARCHAR(20) UNIQUE NOT NULL,  -- auto-generated (B-0001...), editable afterward
    expiry_date    DATE,
    cost_price     NUMERIC(12,2) DEFAULT 0,
    selling_price  NUMERIC(12,2) NOT NULL,
    qty_in         NUMERIC(12,2) NOT NULL,
    qty_remaining  NUMERIC(12,2) NOT NULL,
    date_received  TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Purchase lines (depends on purchases, items, batches)
-- ============================================================================

-- One row per purchase line, created whether or not stock has been received
-- yet. A line only gets a batch_id once it's actually received into stock.
CREATE TABLE purchase_lines (
    purchase_line_id SERIAL PRIMARY KEY,
    purchase_id      INT NOT NULL REFERENCES purchases(purchase_id),
    item_id          INT NOT NULL REFERENCES items(item_id),
    qty              NUMERIC(12,2) NOT NULL,
    cost_price       NUMERIC(12,2) DEFAULT 0,
    selling_price    NUMERIC(12,2) NOT NULL,
    expiry_date      DATE,
    batch_ref_no     VARCHAR(20),
    batch_id         INT REFERENCES batches(batch_id),
    received         BOOLEAN DEFAULT FALSE
);

-- ============================================================================
-- Sales
-- ============================================================================

CREATE TABLE sales (
    sale_id       SERIAL PRIMARY KEY,
    invoice_no    VARCHAR(30) UNIQUE NOT NULL,   -- e.g. INV-0001
    customer_name VARCHAR(150) DEFAULT 'Walk-in Customer', -- free text for now, not linked to customers table
    sale_date     TIMESTAMP DEFAULT NOW(),
    amount_paid   NUMERIC(12,2) DEFAULT 0,
    total         NUMERIC(12,2) DEFAULT 0,
    status        VARCHAR(10) CHECK (status IN ('paid','unpaid','partial')) DEFAULT 'unpaid',
    created_by    VARCHAR(100) DEFAULT 'Admin'
);


-- ============================================================================
-- Sale lines and payments (depend on sales, items, batches)
-- ============================================================================

-- Every sale line records exactly which batch it drew stock from.
CREATE TABLE sale_items (
    sale_item_id  SERIAL PRIMARY KEY,
    sale_id       INT NOT NULL REFERENCES sales(sale_id),
    item_id       INT NOT NULL REFERENCES items(item_id),
    batch_id      INT NOT NULL REFERENCES batches(batch_id),
    qty           NUMERIC(12,2) NOT NULL,
    unit_price    NUMERIC(12,2) NOT NULL,
    line_total    NUMERIC(12,2) NOT NULL
);

-- One row per payment method used on a sale, so a single sale can be split
-- across cash/mpesa/bank. sales.amount_paid is the running total; this table
-- is the breakdown behind it.
CREATE TABLE sale_payments (
    payment_id SERIAL PRIMARY KEY,
    sale_id    INT NOT NULL REFERENCES sales(sale_id),
    method     VARCHAR(10) CHECK (method IN ('cash','mpesa','bank')),
    amount     NUMERIC(12,2) NOT NULL
);


-- ============================================================================
-- Expenses (standalone)
-- ============================================================================

CREATE TABLE expenses (
    expense_id     SERIAL PRIMARY KEY,
    expense_code   VARCHAR(20) UNIQUE,   -- e.g. EXP-0001
    expense_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    category       VARCHAR(50) NOT NULL,  -- Rent, Utilities, Salaries, Transport, Supplies, Other
    description    VARCHAR(255),
    amount         NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(10) CHECK (payment_method IN ('cash','mpesa','bank')),
    paid_to        VARCHAR(150),
    created_by     VARCHAR(100) DEFAULT 'Admin',
    created_at     TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_purchase_lines_purchase ON purchase_lines (purchase_id);
CREATE INDEX idx_batches_item_fifo ON batches (item_id, date_received);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX idx_sale_items_batch ON sale_items (batch_id);
CREATE INDEX idx_sale_payments_sale ON sale_payments (sale_id);
CREATE INDEX idx_expenses_date ON expenses (expense_date);


-- ============================================================================
-- Seed data - required for the app to function correctly out of the box
-- ============================================================================

-- Default unit of measure. Item registration requires a unit, and the
-- register form pre-selects "Piece" if it exists.
INSERT INTO units_of_measure (name, short_name) VALUES ('Piece', 'Pc');
UPDATE units_of_measure SET unit_code = 'UOM-' || LPAD(unit_id::text, 4, '0') WHERE name = 'Piece';







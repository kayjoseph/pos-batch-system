-- POS Batch Tracking System - Schema
-- Run this once against your Postgres database to set up the tables.

CREATE TABLE IF NOT EXISTS items (
    item_id       SERIAL PRIMARY KEY,
    name          VARCHAR(150) NOT NULL,
    sku           VARCHAR(50) UNIQUE,
    category      VARCHAR(100),
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
    purchase_id   SERIAL PRIMARY KEY,
    supplier      VARCHAR(150),
    purchase_date TIMESTAMP DEFAULT NOW(),
    subtotal      NUMERIC(12,2) DEFAULT 0,
    discount      NUMERIC(12,2) DEFAULT 0,
    total         NUMERIC(12,2) DEFAULT 0
);

-- One row per batch. Created automatically whenever a purchase line is saved.
CREATE TABLE IF NOT EXISTS batches (
    batch_id       SERIAL PRIMARY KEY,
    item_id        INT NOT NULL REFERENCES items(item_id),
    purchase_id    INT REFERENCES purchases(purchase_id),
    batch_ref_no   VARCHAR(20) UNIQUE NOT NULL,
    expiry_date    DATE,
    cost_price     NUMERIC(12,2) DEFAULT 0,
    selling_price  NUMERIC(12,2) NOT NULL,
    qty_in         NUMERIC(12,2) NOT NULL,
    qty_remaining  NUMERIC(12,2) NOT NULL,
    date_received  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
    sale_id       SERIAL PRIMARY KEY,
    invoice_no    VARCHAR(30) UNIQUE NOT NULL,
    sale_date     TIMESTAMP DEFAULT NOW(),
    amount_paid   NUMERIC(12,2) DEFAULT 0,
    total         NUMERIC(12,2) DEFAULT 0,
    status        VARCHAR(10) CHECK (status IN ('paid','unpaid','partial')) DEFAULT 'unpaid'
);

-- Every sale line records exactly which batch it drew stock from.
CREATE TABLE IF NOT EXISTS sale_items (
    sale_item_id  SERIAL PRIMARY KEY,
    sale_id       INT NOT NULL REFERENCES sales(sale_id),
    item_id       INT NOT NULL REFERENCES items(item_id),
    batch_id      INT NOT NULL REFERENCES batches(batch_id),
    qty           NUMERIC(12,2) NOT NULL,
    unit_price    NUMERIC(12,2) NOT NULL,
    line_total    NUMERIC(12,2) NOT NULL
);

-- Helpful indexes for FIFO lookups and item batch views
CREATE INDEX IF NOT EXISTS idx_batches_item_fifo ON batches (item_id, date_received);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_batch ON sale_items (batch_id);

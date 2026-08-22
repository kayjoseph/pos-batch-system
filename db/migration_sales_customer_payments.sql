-- Migration: customer name on sales + split payments across methods
-- Run this once against your EXISTING database. Safe to re-run.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150) DEFAULT 'Walk-in Customer';
UPDATE sales SET customer_name = 'Walk-in Customer' WHERE customer_name IS NULL;

-- One row per payment method used on a sale, so a single sale can be paid
-- partly in cash, partly by M-Pesa, etc. sales.amount_paid is still kept as
-- the running total for quick reads - this table is the breakdown behind it.
CREATE TABLE IF NOT EXISTS sale_payments (
    payment_id SERIAL PRIMARY KEY,
    sale_id    INT NOT NULL REFERENCES sales(sale_id),
    method     VARCHAR(10) CHECK (method IN ('cash','mpesa','bank')),
    amount     NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments (sale_id);

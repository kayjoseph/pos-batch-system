const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { allocateStock, commitAllocation, getAvailableBatches } = require('../db/batchAllocator');

const VALID_METHODS = ['cash', 'mpesa', 'bank'];

/**
 * Generates the next invoice number, e.g. INV-0012, INV-0013...
 * Looks at the trailing digits of every existing invoice_no, regardless of
 * exact format (handles old manually-typed ones like "INV011" just as well
 * as "INV-0011"), takes the highest, and continues from there. This is what
 * keeps POS Terminal and Invoice Entry sharing one continuous sequence.
 */
async function generateNextInvoiceNo(client) {
    const result = await client.query(
        `SELECT MAX((regexp_match(invoice_no, '([0-9]+)$'))[1]::int) AS max_num
         FROM sales
         WHERE invoice_no ~ '[0-9]+$'`
    );
    const maxNum = result.rows[0].max_num;
    const nextNumber = maxNum ? maxNum + 1 : 1;
    return `INV-${String(nextNumber).padStart(4, '0')}`;
}

// GET the next invoice number, read-only - used to prefill the Invoice Entry
// field on page load. Does NOT reserve or write anything; if two people load
// the page around the same time they'd see the same suggestion, but only the
// sale that actually saves first gets that number (the real generation happens
// again, safely inside the transaction, at POST time).
router.get('/next-invoice-no', async (req, res) => {
    try {
        const next = await generateNextInvoiceNo(pool);
        res.json({ next_invoice_no: next });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to compute next invoice number' });
    }
});

// GET batches available for an item, for the "change batch" picker in the cart
router.get('/available-batches/:itemId', async (req, res) => {
    try {
        const batches = await getAvailableBatches(req.params.itemId);
        res.json(batches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch available batches' });
    }
});

// GET all sales (Sales list view)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sales ORDER BY sale_date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch sales' });
    }
});

// GET one sale with its line items and payment breakdown
router.get('/:id', async (req, res) => {
    try {
        const sale = await pool.query('SELECT * FROM sales WHERE sale_id = $1', [req.params.id]);
        if (sale.rows.length === 0) return res.status(404).json({ error: 'Sale not found' });

        const lines = await pool.query(
            `SELECT si.*, i.name AS item_name, b.batch_ref_no
             FROM sale_items si
             JOIN items i ON i.item_id = si.item_id
             JOIN batches b ON b.batch_id = si.batch_id
             WHERE si.sale_id = $1`,
            [req.params.id]
        );

        const payments = await pool.query(
            `SELECT method, amount FROM sale_payments WHERE sale_id = $1`,
            [req.params.id]
        );

        res.json({ ...sale.rows[0], lines: lines.rows, payments: payments.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch sale' });
    }
});

// CREATE a sale (checkout). Body shape:
// {
//   invoice_no: "INV-1001",     // optional - auto-generated if blank (POS Terminal does this)
//   customer_name: "Jane Doe",  // optional - defaults to "Walk-in Customer"
//   payments: [                 // preferred - supports split payment across methods
//     { method: "cash", amount: 200 },
//     { method: "mpesa", amount: 300 }
//   ],
//   amount_paid: 500,           // legacy fallback if "payments" isn't sent (single amount, no method)
//   cart: [
//     { item_id, qty, mode: "fifo" },
//     { item_id, qty, mode: "manual", batch_id: 7 }
//   ]
// }
router.post('/', async (req, res) => {
    const { customer_name, payments, amount_paid: legacyAmountPaid = 0, cart } = req.body;
    let { invoice_no } = req.body;

    if (!Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ error: 'Cart cannot be empty' });
    }

    let amountPaid = 0;
    let paymentRows = [];
    if (Array.isArray(payments) && payments.length > 0) {
        for (const p of payments) {
            if (!VALID_METHODS.includes(p.method)) {
                return res.status(400).json({ error: `Invalid payment method: ${p.method}` });
            }
            if (!p.amount || p.amount <= 0) continue; // skip empty split fields
            amountPaid += Number(p.amount);
            paymentRows.push({ method: p.method, amount: Number(p.amount) });
        }
    } else {
        amountPaid = Number(legacyAmountPaid) || 0;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!invoice_no || !invoice_no.trim()) {
            invoice_no = await generateNextInvoiceNo(client);
        }

        let total = 0;
        const allLines = [];

        for (const cartLine of cart) {
            const { item_id, qty, mode = 'fifo', batch_id = null } = cartLine;
            if (!item_id || !qty || qty <= 0) {
                throw new Error('Each cart line needs a valid item_id and qty');
            }

            const allocations = await allocateStock(item_id, qty, mode, batch_id);

            for (const alloc of allocations) {
                const lineTotal = alloc.qty * alloc.unit_price;
                total += lineTotal;
                allLines.push({
                    item_id,
                    batch_id: alloc.batch_id,
                    qty: alloc.qty,
                    unit_price: alloc.unit_price,
                    line_total: lineTotal,
                });
            }

            await commitAllocation(client, allocations);
        }

        const status = amountPaid >= total && total > 0 ? 'paid' : (amountPaid > 0 ? 'partial' : 'unpaid');

        const saleResult = await client.query(
            `INSERT INTO sales (invoice_no, customer_name, amount_paid, total, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [invoice_no, (customer_name && customer_name.trim()) || 'Walk-in Customer', amountPaid, total, status, 'Admin']
        );
        const sale = saleResult.rows[0];

        for (const line of allLines) {
            await client.query(
                `INSERT INTO sale_items (sale_id, item_id, batch_id, qty, unit_price, line_total)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [sale.sale_id, line.item_id, line.batch_id, line.qty, line.unit_price, line.line_total]
            );
        }

        for (const p of paymentRows) {
            await client.query(
                `INSERT INTO sale_payments (sale_id, method, amount) VALUES ($1, $2, $3)`,
                [sale.sale_id, p.method, p.amount]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ sale, lines: allLines });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        const status = err.code === '23505' ? 400 : 400;
        res.status(status).json({ error: err.message || 'Failed to complete sale' });
    } finally {
        client.release();
    }
});

module.exports = router;

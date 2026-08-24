const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { generateNextBatchRefNo } = require('../db/batchAllocator');

function computePaymentStatus(amountPaid, total) {
    if (Number(amountPaid) >= Number(total) && Number(total) > 0) return 'paid';
    if (Number(amountPaid) > 0) return 'partial';
    return 'unpaid';
}

/**
 * Generates the next purchase invoice number, e.g. PUR-0001, PUR-0002...
 * Same trailing-digit approach as sales invoice numbers, so it keeps working
 * correctly however the existing numbers were formatted.
 */
async function generateNextPurchaseInvoiceNo(client) {
    const result = await client.query(
        `SELECT MAX((regexp_match(purchase_invoice_no, '([0-9]+)$'))[1]::int) AS max_num
         FROM purchases
         WHERE purchase_invoice_no ~ '[0-9]+$'`
    );
    const maxNum = result.rows[0].max_num;
    const nextNumber = maxNum ? maxNum + 1 : 1;
    return `PUR-${String(nextNumber).padStart(4, '0')}`;
}

// GET the next purchase invoice number, read-only - used to prefill Add Purchase.
router.get('/next-invoice-no', async (req, res) => {
    try {
        const next = await generateNextPurchaseInvoiceNo(pool);
        res.json({ next_invoice_no: next });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to compute next purchase invoice number' });
    }
});

// GET all purchases (list view) - with balance computed for convenience
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT *, (total - amount_paid) AS balance
            FROM purchases
            ORDER BY purchase_date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

// GET one purchase with its lines (for the detail/view panel)
router.get('/:id', async (req, res) => {
    try {
        const purchase = await pool.query(
            `SELECT *, (total - amount_paid) AS balance FROM purchases WHERE purchase_id = $1`,
            [req.params.id]
        );
        if (purchase.rows.length === 0) return res.status(404).json({ error: 'Purchase not found' });

        const lines = await pool.query(
            `SELECT pl.*, i.name AS item_name
             FROM purchase_lines pl
             JOIN items i ON i.item_id = pl.item_id
             WHERE pl.purchase_id = $1`,
            [req.params.id]
        );
        res.json({ ...purchase.rows[0], lines: lines.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch purchase' });
    }
});

// CREATE a purchase. Body shape:
// {
//   supplier: "Acme Ltd",
//   status: "received" | "lpo",
//   amount_paid: 0,
//   payment_method: "cash" | "mpesa" | "bank" | null,
//   lines: [
//     { item_id, qty, cost_price, selling_price, expiry_date, batch_ref_no (optional) },
//     ...
//   ]
// }
// status "received" creates batches immediately (stock goes up now).
// status "lpo" only records the order - no batches, no stock change, until
// "Receive Stock" is called later.
router.post('/', async (req, res) => {
    const { supplier, status = 'received', amount_paid = 0, payment_method = null, lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ error: 'At least one purchase line is required' });
    }
    if (!['received', 'lpo'].includes(status)) {
        return res.status(400).json({ error: 'status must be "received" or "lpo"' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let subtotal = 0;
        for (const line of lines) {
            if (!line.item_id || !line.qty || line.selling_price === undefined || line.selling_price === null || line.selling_price === '') {
                throw new Error('Each purchase line needs item_id, qty, and selling_price');
            }
            subtotal += Number(line.cost_price || 0) * Number(line.qty);
        }
        const total = subtotal;
        const paymentStatus = computePaymentStatus(amount_paid, total);
        const purchaseInvoiceNo = await generateNextPurchaseInvoiceNo(client);

        const purchaseResult = await client.query(
            `INSERT INTO purchases (purchase_invoice_no, supplier, status, subtotal, total, amount_paid, payment_method, payment_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [purchaseInvoiceNo, (supplier && supplier.trim()) || 'General Supplier', status, subtotal, total, amount_paid, payment_method, paymentStatus]
        );
        const purchase = purchaseResult.rows[0];

        const createdLines = [];
        for (const line of lines) {
            const { item_id, qty, cost_price, selling_price, expiry_date } = line;
            let batchRefNo = line.batch_ref_no && line.batch_ref_no.trim() ? line.batch_ref_no.trim() : null;
            let batchId = null;
            let received = false;

            if (status === 'received') {
                // Received immediately - create the batch (stock) right now.
                if (!batchRefNo) batchRefNo = await generateNextBatchRefNo(client);
                const batchResult = await client.query(
                    `INSERT INTO batches
                        (item_id, purchase_id, batch_ref_no, expiry_date, cost_price, selling_price, qty_in, qty_remaining)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                     RETURNING *`,
                    [item_id, purchase.purchase_id, batchRefNo, expiry_date || null, cost_price || 0, selling_price, qty]
                );
                batchId = batchResult.rows[0].batch_id;
                received = true;
            }
            // LPO: no batch created yet - just record the ordered line.

            const lineResult = await client.query(
                `INSERT INTO purchase_lines
                    (purchase_id, item_id, qty, cost_price, selling_price, expiry_date, batch_ref_no, batch_id, received)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [purchase.purchase_id, item_id, qty, cost_price || 0, selling_price, expiry_date || null, batchRefNo, batchId, received]
            );
            createdLines.push(lineResult.rows[0]);
        }

        await client.query('COMMIT');
        res.status(201).json({ purchase, lines: createdLines });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        const status = err.code === '23505' ? 400 : 400;
        res.status(status).json({ error: err.message || 'Failed to record purchase' });
    } finally {
        client.release();
    }
});

// RECEIVE STOCK for an LPO - creates batches for every not-yet-received line
// on this purchase, then flips the purchase to "received".
router.post('/:id/receive', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const purchaseResult = await client.query('SELECT * FROM purchases WHERE purchase_id = $1', [req.params.id]);
        if (purchaseResult.rows.length === 0) throw new Error('Purchase not found');
        const purchase = purchaseResult.rows[0];

        const pendingLines = await client.query(
            `SELECT * FROM purchase_lines WHERE purchase_id = $1 AND received = FALSE`,
            [req.params.id]
        );
        if (pendingLines.rows.length === 0) throw new Error('This purchase has already been fully received');

        for (const line of pendingLines.rows) {
            let batchRefNo = line.batch_ref_no && line.batch_ref_no.trim() ? line.batch_ref_no.trim() : await generateNextBatchRefNo(client);

            const batchResult = await client.query(
                `INSERT INTO batches
                    (item_id, purchase_id, batch_ref_no, expiry_date, cost_price, selling_price, qty_in, qty_remaining)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                 RETURNING *`,
                [line.item_id, purchase.purchase_id, batchRefNo, line.expiry_date, line.cost_price, line.selling_price, line.qty]
            );

            await client.query(
                `UPDATE purchase_lines SET batch_id = $1, batch_ref_no = $2, received = TRUE WHERE purchase_line_id = $3`,
                [batchResult.rows[0].batch_id, batchRefNo, line.purchase_line_id]
            );
        }

        await client.query(`UPDATE purchases SET status = 'received' WHERE purchase_id = $1`, [req.params.id]);

        await client.query('COMMIT');
        res.json({ message: 'Stock received', purchase_id: req.params.id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(400).json({ error: err.message || 'Failed to receive stock' });
    } finally {
        client.release();
    }
});

// PAY - record a payment against a purchase (partial or full). Body: { amount, payment_method }
router.post('/:id/pay', async (req, res) => {
    const { amount, payment_method } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'A positive amount is required' });
    if (!['cash', 'mpesa', 'bank'].includes(payment_method)) {
        return res.status(400).json({ error: 'payment_method must be cash, mpesa, or bank' });
    }

    try {
        const purchaseResult = await pool.query('SELECT * FROM purchases WHERE purchase_id = $1', [req.params.id]);
        if (purchaseResult.rows.length === 0) return res.status(404).json({ error: 'Purchase not found' });
        const purchase = purchaseResult.rows[0];

        const newAmountPaid = Number(purchase.amount_paid) + Number(amount);
        const newStatus = computePaymentStatus(newAmountPaid, purchase.total);

        const result = await pool.query(
            `UPDATE purchases SET amount_paid = $1, payment_method = $2, payment_status = $3
             WHERE purchase_id = $4 RETURNING *, (total - amount_paid) AS balance`,
            [newAmountPaid, payment_method, newStatus, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

module.exports = router;

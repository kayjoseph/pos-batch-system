const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { generateNextBatchRefNo } = require('../db/batchAllocator');

// GET all purchases (list view)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM purchases ORDER BY purchase_date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

// CREATE a purchase. Body shape:
// {
//   supplier: "Acme Ltd",
//   discount: 0,
//   lines: [
//     { item_id, qty, cost_price, selling_price, expiry_date, batch_ref_no (optional - auto-generated if blank) },
//     ...
//   ]
// }
// Each line becomes its own new batch row - even if the item already has other batches.
router.post('/', async (req, res) => {
    const { supplier, discount = 0, lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ error: 'At least one purchase line is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let subtotal = 0;
        for (const line of lines) {
            subtotal += Number(line.cost_price) * Number(line.qty);
        }
        const total = subtotal - Number(discount || 0);

        const purchaseResult = await client.query(
            `INSERT INTO purchases (supplier, subtotal, discount, total)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [supplier || null, subtotal, discount, total]
        );
        const purchase = purchaseResult.rows[0];

        const createdBatches = [];
        for (const line of lines) {
            const { item_id, qty, cost_price, selling_price, expiry_date } = line;
            if (!item_id || !qty || selling_price === undefined || selling_price === null || selling_price === '') {
                throw new Error('Each purchase line needs item_id, qty, and selling_price');
            }

            // Auto-generate the batch ref no. if the user left it blank -
            // still editable later from the batch detail view.
            const batchRefNo = line.batch_ref_no && line.batch_ref_no.trim()
                ? line.batch_ref_no.trim()
                : await generateNextBatchRefNo(client);

            const batchResult = await client.query(
                `INSERT INTO batches
                    (item_id, purchase_id, batch_ref_no, expiry_date, cost_price, selling_price, qty_in, qty_remaining)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                 RETURNING *`,
                [item_id, purchase.purchase_id, batchRefNo, expiry_date || null, cost_price || 0, selling_price, qty]
            );
            createdBatches.push(batchResult.rows[0]);
        }

        await client.query('COMMIT');
        res.status(201).json({ purchase, batches: createdBatches });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        const status = err.code === '23505' ? 400 : 500;
        res.status(status).json({ error: err.message || 'Failed to record purchase' });
    } finally {
        client.release();
    }
});

module.exports = router;

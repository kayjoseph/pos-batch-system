const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all batches for one item - batch ref no., qty in, qty remaining, expiry, price
router.get('/item/:itemId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT batch_id, batch_ref_no, expiry_date, cost_price, selling_price,
                    qty_in, qty_remaining, date_received
             FROM batches
             WHERE item_id = $1
             ORDER BY date_received ASC, batch_id ASC`,
            [req.params.itemId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch batches' });
    }
});

// EDIT a batch (e.g. correct batch ref no., expiry date, or selling price)
router.put('/:batchId', async (req, res) => {
    const { batch_ref_no, expiry_date, selling_price } = req.body;
    try {
        const result = await pool.query(
            `UPDATE batches
             SET batch_ref_no = COALESCE($1, batch_ref_no),
                 expiry_date = COALESCE($2, expiry_date),
                 selling_price = COALESCE($3, selling_price)
             WHERE batch_id = $4
             RETURNING *`,
            [batch_ref_no || null, expiry_date || null, selling_price || null, req.params.batchId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That batch reference number is already in use' });
        }
        res.status(500).json({ error: 'Failed to update batch' });
    }
});

// Manual stock adjustment on a specific batch (damages, stock count correction, etc.)
router.patch('/:batchId/adjust', async (req, res) => {
    const { newQtyRemaining } = req.body;
    if (newQtyRemaining === undefined || newQtyRemaining < 0) {
        return res.status(400).json({ error: 'newQtyRemaining must be zero or greater' });
    }
    try {
        const result = await pool.query(
            `UPDATE batches SET qty_remaining = $1 WHERE batch_id = $2 RETURNING *`,
            [newQtyRemaining, req.params.batchId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to adjust batch stock' });
    }
});

module.exports = router;

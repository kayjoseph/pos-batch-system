const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { allocateStock, commitAllocation, getAvailableBatches } = require('../db/batchAllocator');

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

// GET one sale with its line items (including which batch each line drew from)
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
        res.json({ ...sale.rows[0], lines: lines.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch sale' });
    }
});

// CREATE a sale (checkout). Body shape:
// {
//   invoice_no: "INV-1001",
//   amount_paid: 500,
//   cart: [
//     { item_id, qty, mode: "fifo" },                     // default: auto FIFO, auto-splits across batches
//     { item_id, qty, mode: "manual", batch_id: 7 }        // customer asked for a specific batch
//   ]
// }
router.post('/', async (req, res) => {
    const { invoice_no, amount_paid = 0, cart } = req.body;
    if (!invoice_no) return res.status(400).json({ error: 'invoice_no is required' });
    if (!Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ error: 'Cart cannot be empty' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let total = 0;
        const allLines = []; // { item_id, batch_id, qty, unit_price, line_total }

        for (const cartLine of cart) {
            const { item_id, qty, mode = 'fifo', batch_id = null } = cartLine;
            if (!item_id || !qty || qty <= 0) {
                throw new Error('Each cart line needs a valid item_id and qty');
            }

            // allocateStock() decides which batch(es) this line pulls from -
            // FIFO with auto-split, or the single batch the customer picked.
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

            // Deduct stock now, inside the same transaction, so a failure later rolls this back too
            await commitAllocation(client, allocations);
        }

        const status = amount_paid >= total ? 'paid' : (amount_paid > 0 ? 'partial' : 'unpaid');

        const saleResult = await client.query(
            `INSERT INTO sales (invoice_no, amount_paid, total, status)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [invoice_no, amount_paid, total, status]
        );
        const sale = saleResult.rows[0];

        for (const line of allLines) {
            await client.query(
                `INSERT INTO sale_items (sale_id, item_id, batch_id, qty, unit_price, line_total)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [sale.sale_id, line.item_id, line.batch_id, line.qty, line.unit_price, line.line_total]
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

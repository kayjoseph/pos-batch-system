// This file has ONE job: figure out which batch(es) a sale should pull stock
// from. Both "auto FIFO" and "customer picked a specific batch" flow through
// here so there is only one place that ever touches qty_remaining during a sale.

const pool = require('./pool');

/**
 * Generates the next batch reference number, e.g. B-0001, B-0002...
 * Called automatically when a purchase line is saved. The result is just a
 * default value - it can still be edited afterward on the batch record.
 */
async function generateNextBatchRefNo(client) {
    const result = await client.query(
        `SELECT batch_ref_no FROM batches
         WHERE batch_ref_no ~ '^B-[0-9]+$'
         ORDER BY batch_id DESC LIMIT 1`
    );
    if (result.rows.length === 0) return 'B-0001';
    const lastNumber = parseInt(result.rows[0].batch_ref_no.split('-')[1], 10);
    const nextNumber = lastNumber + 1;
    return `B-${String(nextNumber).padStart(4, '0')}`;
}

/**
 * Returns all batches for an item that still have stock, oldest first (FIFO order).
 * Used both for the automatic allocator below and for the "pick a batch manually" UI.
 */
async function getAvailableBatches(itemId) {
    const result = await pool.query(
        `SELECT batch_id, batch_ref_no, expiry_date, selling_price, qty_in, qty_remaining, date_received
         FROM batches
         WHERE item_id = $1 AND qty_remaining > 0
         ORDER BY date_received ASC, batch_id ASC`,
        [itemId]
    );
    return result.rows;
}

/**
 * Allocates a requested quantity of an item across batches.
 *
 * mode 'fifo'    -> pulls from oldest batches first, spilling into the next
 *                   batch automatically if one batch doesn't have enough (the
 *                   "auto-split" behavior).
 * mode 'manual'  -> pulls only from the single batchId given. If that batch
 *                   doesn't have enough stock, it throws - manual selection
 *                   does not silently spill into other batches.
 *
 * Returns an array of allocation lines: [{ batch_id, qty, unit_price }, ...]
 * Does NOT write to the database - call commitAllocation() to actually deduct stock.
 */
async function allocateStock(itemId, qtyRequested, mode = 'fifo', batchId = null) {
    if (qtyRequested <= 0) throw new Error('Quantity must be greater than zero');

    if (mode === 'manual') {
        if (!batchId) throw new Error('batchId is required for manual allocation');
        const result = await pool.query(
            `SELECT batch_id, selling_price, qty_remaining FROM batches WHERE batch_id = $1`,
            [batchId]
        );
        if (result.rows.length === 0) throw new Error('Batch not found');
        const batch = result.rows[0];
        if (Number(batch.qty_remaining) < qtyRequested) {
            throw new Error(
                `Selected batch only has ${batch.qty_remaining} units remaining, ` +
                `but ${qtyRequested} were requested`
            );
        }
        return [{ batch_id: batch.batch_id, qty: qtyRequested, unit_price: Number(batch.selling_price) }];
    }

    // FIFO mode: walk the available batches oldest-first, spilling over as needed
    const batches = await getAvailableBatches(itemId);
    const totalAvailable = batches.reduce((sum, b) => sum + Number(b.qty_remaining), 0);
    if (totalAvailable < qtyRequested) {
        throw new Error(
            `Not enough stock across all batches. Available: ${totalAvailable}, requested: ${qtyRequested}`
        );
    }

    const allocations = [];
    let remaining = qtyRequested;
    for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(batch.qty_remaining));
        if (take <= 0) continue;
        allocations.push({
            batch_id: batch.batch_id,
            qty: take,
            unit_price: Number(batch.selling_price),
        });
        remaining -= take;
    }
    return allocations;
}

/**
 * Actually deducts qty_remaining for a set of allocation lines, inside the
 * caller's transaction client. Call this from within the sale-saving transaction.
 */
async function commitAllocation(client, allocations) {
    for (const alloc of allocations) {
        await client.query(
            `UPDATE batches SET qty_remaining = qty_remaining - $1 WHERE batch_id = $2`,
            [alloc.qty, alloc.batch_id]
        );
    }
}

module.exports = {
    generateNextBatchRefNo,
    getAvailableBatches,
    allocateStock,
    commitAllocation,
};

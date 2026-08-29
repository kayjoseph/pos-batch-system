const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
 
// GET all suppliers
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM suppliers ORDER BY is_default DESC, supplier_id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
});
 
// CREATE supplier - code is auto-generated from the new row's own id (SUP-0001, ...)
router.post('/', async (req, res) => {
    const { name, phone, address, opening_balance } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Supplier name is required' });
    try {
        const insertResult = await pool.query(
            'INSERT INTO suppliers (name, phone, address, opening_balance) VALUES ($1, $2, $3, $4) RETURNING *',
            [name.trim(), (phone && phone.trim()) || null, (address && address.trim()) || null, opening_balance || 0]
        );
        const supplier = insertResult.rows[0];
        const supplierCode = `SUP-${String(supplier.supplier_id).padStart(4, '0')}`;
        const updateResult = await pool.query(
            'UPDATE suppliers SET supplier_code = $1 WHERE supplier_id = $2 RETURNING *',
            [supplierCode, supplier.supplier_id]
        );
        res.status(201).json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That supplier already exists' });
        }
        res.status(500).json({ error: 'Failed to create supplier' });
    }
});
 
// UPDATE supplier details
router.put('/:id', async (req, res) => {
    const { name, phone, address, opening_balance } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Supplier name is required' });
    try {
        const result = await pool.query(
            'UPDATE suppliers SET name = $1, phone = $2, address = $3, opening_balance = $4 WHERE supplier_id = $5 RETURNING *',
            [name.trim(), (phone && phone.trim()) || null, (address && address.trim()) || null, opening_balance || 0, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That supplier already exists' });
        }
        res.status(500).json({ error: 'Failed to update supplier' });
    }
});
 
// DELETE supplier - the default General Supplier can never be removed
router.delete('/:id', async (req, res) => {
    try {
        const supplier = await pool.query('SELECT name, is_default FROM suppliers WHERE supplier_id = $1', [req.params.id]);
        if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
 
        if (supplier.rows[0].is_default) {
            return res.status(400).json({ error: `${supplier.rows[0].name} is a default record and can't be deleted` });
        }
 
        await pool.query('DELETE FROM suppliers WHERE supplier_id = $1', [req.params.id]);
        res.json({ message: 'Supplier deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete supplier' });
    }
});
 
module.exports = router;
 
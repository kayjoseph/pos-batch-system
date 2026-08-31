const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
 
// GET all customers
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY is_default DESC, customer_id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});
 
// CREATE customer - code is auto-generated from the new row's own id (CUS-0001, ...)
router.post('/', async (req, res) => {
    const { name, phone, address, opening_balance } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Customer name is required' });
    try {
        const insertResult = await pool.query(
            'INSERT INTO customers (name, phone, address, opening_balance) VALUES ($1, $2, $3, $4) RETURNING *',
            [name.trim(), (phone && phone.trim()) || null, (address && address.trim()) || null, opening_balance || 0]
        );
        const customer = insertResult.rows[0];
        const customerCode = `CUS-${String(customer.customer_id).padStart(4, '0')}`;
        const updateResult = await pool.query(
            'UPDATE customers SET customer_code = $1 WHERE customer_id = $2 RETURNING *',
            [customerCode, customer.customer_id]
        );
        res.status(201).json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That customer already exists' });
        }
        res.status(500).json({ error: 'Failed to create customer' });
    }
});
 
// UPDATE customer details
router.put('/:id', async (req, res) => {
    const { name, phone, address, opening_balance } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Customer name is required' });
    try {
        const result = await pool.query(
            'UPDATE customers SET name = $1, phone = $2, address = $3, opening_balance = $4 WHERE customer_id = $5 RETURNING *',
            [name.trim(), (phone && phone.trim()) || null, (address && address.trim()) || null, opening_balance || 0, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'That customer already exists' });
        }
        res.status(500).json({ error: 'Failed to update customer' });
    }
});
 
// DELETE customer - the default Walk-in Customer can never be removed
router.delete('/:id', async (req, res) => {
    try {
        const customer = await pool.query('SELECT name, is_default FROM customers WHERE customer_id = $1', [req.params.id]);
        if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
 
        if (customer.rows[0].is_default) {
            return res.status(400).json({ error: `${customer.rows[0].name} is a default record and can't be deleted` });
        }
 
        await pool.query('DELETE FROM customers WHERE customer_id = $1', [req.params.id]);
        res.json({ message: 'Customer deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete customer' });
    }
});
 
module.exports = router;
 
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all expenses
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expenses ORDER BY expense_date DESC, expense_id DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch expenses' });
    }
});

// CREATE expense - code is auto-generated from the new row's own id (EXP-0001, ...)
router.post('/', async (req, res) => {
    const { expense_date, category, description, amount, payment_method, paid_to } = req.body;
    if (!category || !category.trim()) return res.status(400).json({ error: 'Category is required' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'A valid amount is required' });
    try {
        const insertResult = await pool.query(
            `INSERT INTO expenses (expense_date, category, description, amount, payment_method, paid_to)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                expense_date || new Date().toISOString().substring(0, 10),
                category.trim(),
                (description && description.trim()) || null,
                amount,
                payment_method || null,
                (paid_to && paid_to.trim()) || null,
            ]
        );
        const expense = insertResult.rows[0];
        const expenseCode = `EXP-${String(expense.expense_id).padStart(4, '0')}`;
        const updateResult = await pool.query(
            'UPDATE expenses SET expense_code = $1 WHERE expense_id = $2 RETURNING *',
            [expenseCode, expense.expense_id]
        );
        res.status(201).json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to record expense' });
    }
});

// UPDATE expense
router.put('/:id', async (req, res) => {
    const { expense_date, category, description, amount, payment_method, paid_to } = req.body;
    if (!category || !category.trim()) return res.status(400).json({ error: 'Category is required' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'A valid amount is required' });
    try {
        const result = await pool.query(
            `UPDATE expenses
             SET expense_date = $1, category = $2, description = $3, amount = $4, payment_method = $5, paid_to = $6
             WHERE expense_id = $7 RETURNING *`,
            [
                expense_date,
                category.trim(),
                (description && description.trim()) || null,
                amount,
                payment_method || null,
                (paid_to && paid_to.trim()) || null,
                req.params.id,
            ]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update expense' });
    }
});

// DELETE expense - nothing else in the system references an expense, so this
// is a plain delete behind the usual confirm dialog, no orphan risk to check.
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM expenses WHERE expense_id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ message: 'Expense deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
});

module.exports = router;

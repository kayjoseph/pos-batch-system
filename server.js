require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const itemsRouter = require('./routes/items');
const purchasesRouter = require('./routes/purchases');
const salesRouter = require('./routes/sales');
const batchesRouter = require('./routes/batches');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/items', itemsRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/sales', salesRouter);
app.use('/api/batches', batchesRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`POS batch system running at http://localhost:${PORT}`);
});

# POS Batch Tracking System

Simple Node.js/Express + PostgreSQL app implementing batch-level stock (batch no.,
expiry date, per-batch selling price) with FIFO checkout and manual batch override.
Same stack style as the barcode-inventory-system project - plain HTML/CSS/JS frontend,
no framework/build step needed.

## Setup

1. Install dependencies (already done if you got this folder from the assistant):
   ```
   npm install
   ```

2. Create a Postgres database and copy `.env.example` to `.env`, filling in your
   own credentials:
   ```
   cp .env.example .env
   ```

3. Create the tables:
   ```
   psql -U your_user -d pos_batch_system -f db/schema.sql
   ```
   (or run the contents of `db/schema.sql` in your Postgres client of choice)

4. Start the server:
   ```
   npm start
   ```

5. Open http://localhost:3000 in your browser - it lands on the Items page.

## How it's organized

- `server.js` - Express app entry point, mounts the API routes and serves `public/`
- `db/pool.js` - Postgres connection pool
- `db/schema.sql` - table definitions
- `db/batchAllocator.js` - the ONE place that decides which batch(es) a sale pulls
  from (FIFO with auto-split, or a manually chosen batch) and generates batch ref numbers
- `routes/items.js`, `routes/purchases.js`, `routes/sales.js`, `routes/batches.js` - API endpoints
- `public/*.html` - the four modules (Items, Purchase, POS, Sales), plus `batches.html`
  for the per-item batch detail view (reached via "View Batches" on the Items page)

## Key behaviors

- **Stock is never stored directly on an item** - it's always the sum of
  `qty_remaining` across that item's batches. This avoids the item stock number
  and batch totals ever drifting out of sync.
- **FIFO checkout**: adding an item to the POS cart defaults to pulling from the
  oldest batch with stock. If the quantity needed exceeds that batch, it
  automatically spills into the next-oldest batch (auto-split).
- **Manual batch override**: "Change Batch" on a cart line lets you pick a specific
  batch (e.g. a customer asks for a longer-dated batch). If that batch doesn't have
  enough stock, the sale is rejected rather than silently pulling from elsewhere.
- **Batch ref no.** is auto-generated (`B-0001`, `B-0002`, ...) when a purchase line
  is saved, but can be edited afterward from the batch detail view.
- **Every sale line stores which batch it came from**, so sales are traceable back
  to a batch (useful for expiry recalls or margin analysis later).
- Batch expiry dates within 30 days are highlighted amber; past-due are highlighted red.

## Notes / next steps to consider

- There's no authentication yet - add your own login layer before this touches
  a real till.
- Manual "Adjust Stock" on a batch (for damages/stock counts) is a blunt overwrite
  right now - you may want to log the reason for an adjustment later.
- Purchase editing/deleting isn't implemented yet - purchases create batches but
  can't currently be reversed from the UI.

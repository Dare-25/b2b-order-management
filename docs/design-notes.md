## Why order_items stores unit_price: 
It preserves the price the customer agreed to when placing the order. If the product’s price changes later, the order and its invoice still show the correct original amount.

## Why is the stock check done inside a database transaction?
Placing an order changes several rows (stock, order, order items, invoice), so
they must succeed or fail together. If one item is out of stock, the transaction
rolls back and nothing is saved. To stop two simultaneous orders from claiming the
same stock, the stock rows are locked while the order is processed
(SELECT ... FOR UPDATE), or stock is reduced in a single conditional update
(UPDATE products SET stock_qty = stock_qty - n WHERE id = x AND stock_qty >= n).
The second order then waits or is rejected instead of overselling.
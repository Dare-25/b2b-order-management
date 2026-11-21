CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('CUSTOMER','STAFF','ADMIN')),
  company_name  VARCHAR(255),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id        SERIAL PRIMARY KEY,
  sku       VARCHAR(50)  NOT NULL UNIQUE,
  name      VARCHAR(255) NOT NULL,
  price     NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE carts (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id)
);

CREATE TABLE cart_items (
  id         SERIAL PRIMARY KEY,
  cart_id    INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, product_id)
);

CREATE TABLE orders (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     VARCHAR(20) NOT NULL DEFAULT 'PENDING'
             CHECK (status IN ('PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED')),
  total      NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL
);

CREATE TABLE invoices (
  id             SERIAL PRIMARY KEY,
  order_id       INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  invoice_number VARCHAR(30) NOT NULL UNIQUE,
  issued_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  total          NUMERIC(12,2) NOT NULL
);

CREATE TABLE audit_logs (
  id         SERIAL PRIMARY KEY,
  actor_id   INTEGER NOT NULL REFERENCES users(id),
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(50)  NOT NULL,
  entity_id  INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
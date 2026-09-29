/**
 * Bigasan Rice Vending System - Backend Server
 * Provides API endpoints for the kiosk and control panel
 */

const express = require("express");
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const pool = require("./db-connection");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// Serve frontend files from the FRONTEND folder
const frontendPath = path.join(__dirname, "..", "FRONTEND");
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "OK",
      message: "Server is running",
      database: "connected",
    });
  } catch (err) {
    res.json({
      status: "WARN",
      message: "Server is running, but database is unavailable",
      database: "disconnected",
      error: err.message,
    });
  }
});

// ==================== RICE INVENTORY ENDPOINTS ====================

/**
 * GET /api/inventory
 * Get all rice inventory with current stock levels
 */
app.get("/api/inventory", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        ri.id,
        rt.id as rice_type_id,
        rt.name,
        ri.stock,
        ri.capacity,
        ROUND((ri.stock / ri.capacity) * 100, 0) as stock_percent,
        ri.current_price,
        rt.description,
        ri.last_updated
      FROM rice_inventory ri
      JOIN rice_types rt ON ri.rice_type_id = rt.id
      ORDER BY rt.id;
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

/**
 * GET /api/inventory/:id
 * Get specific rice inventory
 */
app.get("/api/inventory/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT 
        ri.id,
        rt.id as rice_type_id,
        rt.name,
        ri.stock,
        ri.capacity,
        ROUND((ri.stock / ri.capacity) * 100, 0) as stock_percent,
        ri.current_price,
        rt.description
      FROM rice_inventory ri
      JOIN rice_types rt ON ri.rice_type_id = rt.id
      WHERE ri.id = ?;
    `,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Inventory not found" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

/**
 * PUT /api/inventory/:id
 * Update rice inventory (stock, price, etc.)
 */
app.put("/api/inventory/:id", async (req, res) => {
  const { stock, capacity, current_price } = req.body;

  try {
    // Validate inputs
    if (stock !== undefined && stock < 0) {
      return res.status(400).json({ error: "Stock cannot be negative" });
    }

    const updateFields = [];
    const updateValues = [];

    if (stock !== undefined) {
      updateFields.push("stock = ?");
      updateValues.push(stock);
    }
    if (capacity !== undefined) {
      updateFields.push("capacity = ?");
      updateValues.push(capacity);
    }
    if (current_price !== undefined) {
      updateFields.push("current_price = ?");
      updateValues.push(current_price);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updateValues.push(req.params.id);

    const [result] = await pool.query(
      `UPDATE rice_inventory SET ${updateFields.join(", ")} WHERE id = ?`,
      updateValues,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Inventory not found" });
    }

    // Return updated inventory
    const [updated] = await pool.query(
      `
      SELECT 
        ri.id,
        rt.id as rice_type_id,
        rt.name,
        ri.stock,
        ri.capacity,
        ROUND((ri.stock / ri.capacity) * 100, 0) as stock_percent,
        ri.current_price
      FROM rice_inventory ri
      JOIN rice_types rt ON ri.rice_type_id = rt.id
      WHERE ri.id = ?;
    `,
      [req.params.id],
    );

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error updating inventory:", error);
    res.status(500).json({ error: "Failed to update inventory" });
  }
});

// ==================== TRANSACTIONS ENDPOINTS ====================

/**
 * POST /api/transactions
 * Record a new transaction (from kiosk)
 */
app.post("/api/transactions", async (req, res) => {
  const {
    client_transaction_id,
    rice_type_id,
    quantity_bought,
    price_per_unit,
    total_price,
    payment_method,
    transaction_status = "completed",
    transaction_timestamp,
  } = req.body;

  let connection;
  try {
    // Validate required fields
    if (
      !rice_type_id ||
      !Number.isFinite(Number(quantity_bought)) ||
      Number(quantity_bought) <= 0 ||
      !Number.isFinite(Number(price_per_unit)) ||
      Number(price_per_unit) <= 0
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["pending", "completed"].includes(transaction_status)) {
      return res.status(400).json({ error: "Invalid transaction status" });
    }

    const calculatedTotal = Number(
      total_price ?? Number(quantity_bought) * Number(price_per_unit),
    );
    if (!Number.isFinite(calculatedTotal) || calculatedTotal <= 0) {
      return res.status(400).json({ error: "Invalid transaction total" });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    let existingTransaction = null;
    if (client_transaction_id) {
      const [existingRows] = await connection.query(
        "SELECT id, rice_type_id, transaction_status FROM transactions WHERE client_transaction_id = ? FOR UPDATE",
        [String(client_transaction_id)],
      );
      existingTransaction = existingRows[0] || null;
    }

    if (existingTransaction) {
      if (
        existingTransaction.transaction_status !== "completed" &&
        transaction_status === "completed"
      ) {
        const [stockResult] = await connection.query(
          "UPDATE rice_inventory SET stock = stock - ? WHERE rice_type_id = ? AND stock >= ?",
          [quantity_bought, existingTransaction.rice_type_id, quantity_bought],
        );
        if (stockResult.affectedRows === 0) {
          await connection.rollback();
          return res
            .status(409)
            .json({ error: "Insufficient inventory stock" });
        }
      }

      await connection.query(
        `UPDATE transactions
         SET quantity_bought = ?, price_per_unit = ?, total_price = ?, payment_method = ?, transaction_status = ?
         WHERE id = ?`,
        [
          quantity_bought,
          price_per_unit,
          calculatedTotal,
          payment_method || "cash",
          transaction_status,
          existingTransaction.id,
        ],
      );
      await connection.commit();
      return res.json({
        success: true,
        transaction_id: existingTransaction.id,
        data: {
          id: existingTransaction.id,
          client_transaction_id: String(client_transaction_id),
          rice_type_id,
          quantity_bought,
          price_per_unit,
          total_price: calculatedTotal,
          transaction_status,
        },
      });
    }

    const [result] = await connection.query(
      `INSERT INTO transactions
       (client_transaction_id, rice_type_id, quantity_bought, price_per_unit, total_price, payment_method, transaction_status, transaction_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
      [
        client_transaction_id ? String(client_transaction_id) : null,
        rice_type_id,
        quantity_bought,
        price_per_unit,
        calculatedTotal,
        payment_method || "cash",
        transaction_status,
        transaction_timestamp || null,
      ],
    );

    if (transaction_status === "completed") {
      const [stockResult] = await connection.query(
        "UPDATE rice_inventory SET stock = stock - ? WHERE rice_type_id = ? AND stock >= ?",
        [quantity_bought, rice_type_id, quantity_bought],
      );
      if (stockResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(409).json({ error: "Insufficient inventory stock" });
      }
    }

    await connection.commit();
    res.json({
      success: true,
      transaction_id: result.insertId,
      data: {
        id: result.insertId,
        client_transaction_id: client_transaction_id || null,
        rice_type_id,
        quantity_bought,
        price_per_unit,
        total_price: calculatedTotal,
        transaction_status,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Failed to create transaction" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/transactions/:id", async (req, res) => {
  const { quantity_bought, price_per_unit, total_price, transaction_status } =
    req.body;
  let connection;

  try {
    if (
      !Number.isFinite(Number(quantity_bought)) ||
      Number(quantity_bought) <= 0 ||
      !Number.isFinite(Number(price_per_unit)) ||
      Number(price_per_unit) <= 0 ||
      !["pending", "completed", "cancelled"].includes(transaction_status)
    ) {
      return res.status(400).json({ error: "Invalid transaction update" });
    }

    connection = await pool.getConnection();

    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT rice_type_id, transaction_status FROM transactions WHERE id = ? FOR UPDATE",
      [req.params.id],
    );
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Transaction not found" });
    }

    const transaction = rows[0];
    if (
      transaction.transaction_status === "completed" &&
      transaction_status !== "completed"
    ) {
      await connection.rollback();
      return res
        .status(409)
        .json({ error: "Completed transactions cannot be reopened" });
    }

    if (
      transaction.transaction_status !== "completed" &&
      transaction_status === "completed"
    ) {
      const [stockResult] = await connection.query(
        "UPDATE rice_inventory SET stock = stock - ? WHERE rice_type_id = ? AND stock >= ?",
        [quantity_bought, transaction.rice_type_id, quantity_bought],
      );
      if (stockResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(409).json({ error: "Insufficient inventory stock" });
      }
    }

    const calculatedTotal = Number(
      total_price ?? Number(quantity_bought) * Number(price_per_unit),
    );
    if (!Number.isFinite(calculatedTotal) || calculatedTotal <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: "Invalid transaction total" });
    }
    await connection.query(
      `UPDATE transactions
       SET quantity_bought = ?, price_per_unit = ?, total_price = ?, transaction_status = ?
       WHERE id = ?`,
      [
        quantity_bought,
        price_per_unit,
        calculatedTotal,
        transaction_status,
        req.params.id,
      ],
    );
    await connection.commit();
    res.json({
      success: true,
      transaction_id: Number(req.params.id),
      transaction_status,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error updating transaction:", error);
    res.status(500).json({ error: "Failed to update transaction" });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * GET /api/transactions
 * Get all transactions with optional filtering
 */
app.get("/api/transactions", async (req, res) => {
  try {
    const { limit = 100, offset = 0, status, startDate, endDate } = req.query;

    let query = `
      SELECT 
        t.id,
        t.rice_type_id,
        t.client_transaction_id,
        rt.name as rice_type_name,
        t.quantity_bought,
        t.price_per_unit,
        t.total_price,
        t.payment_method,
        t.transaction_status,
        t.transaction_timestamp
      FROM transactions t
      JOIN rice_types rt ON t.rice_type_id = rt.id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      query += ` AND t.transaction_status = ?`;
      params.push(status);
    }

    if (startDate) {
      query += ` AND t.transaction_timestamp >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND t.transaction_timestamp <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY t.transaction_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM transactions WHERE 1=1`;
    const countParams = [];

    if (status) {
      countQuery += ` AND transaction_status = ?`;
      countParams.push(status);
    }
    if (startDate) {
      countQuery += ` AND transaction_timestamp >= ?`;
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ` AND transaction_timestamp <= ?`;
      countParams.push(endDate);
    }

    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: rows,
      total: countResult[0].total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

/**
 * GET /api/transactions/stats/daily
 * Get daily sales statistics
 */
app.get("/api/transactions/stats/daily", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        DATE(transaction_timestamp) as date,
        COUNT(*) as transaction_count,
        SUM(quantity_bought) as total_quantity,
        SUM(total_price) as total_revenue,
        AVG(total_price) as avg_transaction_value
      FROM transactions
      WHERE transaction_status = 'completed'
      GROUP BY DATE(transaction_timestamp)
      ORDER BY date DESC
      LIMIT 30;
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching daily stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// ==================== REFILL/RESTOCK ENDPOINTS ====================

/**
 * POST /api/refill
 * Record a refill/restock action
 */
app.post("/api/refill", async (req, res) => {
  const { rice_type_id, refill_amount, operator_id, notes } = req.body;

  try {
    if (!rice_type_id || !refill_amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get current stock
    const [current] = await pool.query(
      "SELECT stock FROM rice_inventory WHERE rice_type_id = ?",
      [rice_type_id],
    );

    if (current.length === 0) {
      return res.status(404).json({ error: "Rice type not found" });
    }

    const previous_stock = current[0].stock;
    const new_stock = previous_stock + refill_amount;

    // Record refill log
    await pool.query(
      `
      INSERT INTO refill_logs 
      (rice_type_id, previous_stock, new_stock, refill_amount, operator_id, notes)
      VALUES (?, ?, ?, ?, ?, ?);
    `,
      [
        rice_type_id,
        previous_stock,
        new_stock,
        refill_amount,
        operator_id || null,
        notes || null,
      ],
    );

    // Update inventory
    await pool.query(
      "UPDATE rice_inventory SET stock = stock + ? WHERE rice_type_id = ?",
      [refill_amount, rice_type_id],
    );

    // Return updated inventory
    const [updated] = await pool.query(
      `
      SELECT 
        ri.id,
        rt.name,
        ri.stock,
        ri.capacity,
        ROUND((ri.stock / ri.capacity) * 100, 0) as stock_percent
      FROM rice_inventory ri
      JOIN rice_types rt ON ri.rice_type_id = rt.id
      WHERE ri.rice_type_id = ?;
    `,
      [rice_type_id],
    );

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error recording refill:", error);
    res.status(500).json({ error: "Failed to record refill" });
  }
});

/**
 * GET /api/refill-logs
 * Get refill history
 */
app.get("/api/refill-logs", async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const [rows] = await pool.query(
      `
      SELECT 
        rl.id,
        rt.name as rice_type_name,
        rl.previous_stock,
        rl.new_stock,
        rl.refill_amount,
        op.username as operator_name,
        rl.notes,
        rl.refill_timestamp
      FROM refill_logs rl
      JOIN rice_types rt ON rl.rice_type_id = rt.id
      LEFT JOIN operators op ON rl.operator_id = op.id
      ORDER BY rl.refill_timestamp DESC
      LIMIT ? OFFSET ?;
    `,
      [parseInt(limit), parseInt(offset)],
    );

    res.json(rows);
  } catch (error) {
    console.error("Error fetching refill logs:", error);
    res.status(500).json({ error: "Failed to fetch refill logs" });
  }
});

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║  Bigasan Rice Vending System - API Server  ║
║  Running on port ${PORT}                    ║
╚════════════════════════════════════════════╝
  `);
  console.log(`API Documentation:`);
  console.log(`  • Inventory:     GET/PUT /api/inventory`);
  console.log(`  • Transactions:  GET/POST /api/transactions`);
  console.log(`  • Refills:       GET/POST /api/refill`);
  console.log(`  • Statistics:    GET /api/transactions/stats/daily`);
  console.log(`  • Health Check:  GET /api/health`);
});

module.exports = app;

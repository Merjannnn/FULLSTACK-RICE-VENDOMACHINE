/**
 * Database Setup Script for Bigasan Rice Vending System
 * Creates tables and initializes default data
 */

const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

async function setupDatabase() {
  let connection;

  try {
    // First, connect without database to create it
    console.log("Connecting to MySQL...");
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
    });

    const dbName = process.env.DB_NAME || "bigasan_rice_vending";

    // Create database
    console.log(`Creating database: ${dbName}`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName};`);

    // Switch to the database
    await connection.query(`USE ${dbName};`);
    console.log("✓ Database selected");

    // Create tables
    console.log("Creating tables...");

    // Rice Types Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS rice_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description VARCHAR(200),
        default_capacity INT DEFAULT 100,
        base_price DECIMAL(10, 2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ rice_types table created");

    // Rice Inventory Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS rice_inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rice_type_id INT NOT NULL,
        stock INT DEFAULT 0,
        capacity INT DEFAULT 100,
        current_price DECIMAL(10, 2) NOT NULL,
        last_refilled TIMESTAMP,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (rice_type_id) REFERENCES rice_types(id) ON DELETE CASCADE,
        UNIQUE KEY unique_inventory (rice_type_id)
      );
    `);
    console.log("✓ rice_inventory table created");

    // Transactions Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_transaction_id VARCHAR(100) NULL,
        rice_type_id INT NOT NULL,
        quantity_bought DECIMAL(10, 2) NOT NULL,
        price_per_unit DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(10, 2) NOT NULL,
        payment_method VARCHAR(50),
        transaction_status ENUM('completed', 'pending', 'failed', 'cancelled') DEFAULT 'completed',
        transaction_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rice_type_id) REFERENCES rice_types(id) ON DELETE RESTRICT,
        UNIQUE KEY uq_transactions_client_id (client_transaction_id),
        INDEX idx_timestamp (transaction_timestamp),
        INDEX idx_status (transaction_status)
      );
    `);
    console.log("✓ transactions table created");
    const [clientIdColumns] = await connection.query(
      "SHOW COLUMNS FROM transactions LIKE 'client_transaction_id'",
    );
    if (clientIdColumns.length === 0) {
      await connection.query(
        "ALTER TABLE transactions ADD COLUMN client_transaction_id VARCHAR(100) NULL",
      );
    }
    const [clientIdIndexes] = await connection.query(
      "SHOW INDEX FROM transactions WHERE Key_name = 'uq_transactions_client_id'",
    );
    if (clientIdIndexes.length === 0) {
      await connection.query(
        "ALTER TABLE transactions ADD UNIQUE KEY uq_transactions_client_id (client_transaction_id)",
      );
    }
    console.log("✓ transaction client IDs are unique");
    await connection.query(
      "ALTER TABLE transactions MODIFY quantity_bought DECIMAL(10, 2) NOT NULL",
    );
    console.log("✓ transaction quantities support fractional kilograms");

    // Operators/Users Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS operators (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(100),
        full_name VARCHAR(100),
        role ENUM('admin', 'operator', 'viewer') DEFAULT 'operator',
        is_active BOOLEAN DEFAULT TRUE,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_username (username)
      );
    `);
    console.log("✓ operators table created");

    // Panel State Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS panel_state (
        id INT AUTO_INCREMENT PRIMARY KEY,
        operator_id INT,
        state_data JSON,
        session_id VARCHAR(100),
        last_action VARCHAR(100),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE SET NULL,
        INDEX idx_operator (operator_id)
      );
    `);
    console.log("✓ panel_state table created");

    // Refill/Restock Log Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS refill_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rice_type_id INT NOT NULL,
        previous_stock INT,
        new_stock INT,
        refill_amount INT NOT NULL,
        operator_id INT,
        notes VARCHAR(500),
        refill_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rice_type_id) REFERENCES rice_types(id) ON DELETE RESTRICT,
        FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE SET NULL,
        INDEX idx_rice_type (rice_type_id),
        INDEX idx_timestamp (refill_timestamp)
      );
    `);
    console.log("✓ refill_logs table created");

    // Insert default rice types
    console.log("Inserting default rice types...");
    await connection.query(`
      INSERT IGNORE INTO rice_types (name, description, default_capacity, base_price) VALUES
      ('Jasmine', 'Premium Jasmine Rice', 100, 55.00),
      ('Sinandomeng', 'Traditional Sinandomeng Rice', 100, 48.00),
      ('Brown Rice', 'Nutritious Brown Rice', 80, 60.00);
    `);
    console.log("✓ Default rice types inserted");

    // Insert default inventory
    console.log("Inserting default inventory...");
    await connection.query(`
      INSERT IGNORE INTO rice_inventory (rice_type_id, stock, capacity, current_price) 
      SELECT id, 10, 
        CASE WHEN name = 'Brown Rice' THEN 80 ELSE 100 END,
        base_price
      FROM rice_types;
    `);
    console.log("✓ Default inventory initialized");

    // Keep the seeded operator aligned with the control panel login.
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash("Admin@1234", 10);

    await connection.query(
      "UPDATE operators SET username = ? WHERE BINARY username = ?",
      ["Admin", "admin"],
    );

    await connection.query(
      `
      INSERT INTO operators (username, password_hash, email, full_name, role, is_active)
      VALUES (?, ?, ?, ?, ?, TRUE)
      ON DUPLICATE KEY UPDATE
        password_hash = VALUES(password_hash),
        email = VALUES(email),
        full_name = VALUES(full_name),
        role = VALUES(role),
        is_active = TRUE;
    `,
      ["Admin", hashedPassword, "admin@bigasan.local", "Admin User", "admin"],
    );
    console.log(
      "✓ Default admin operator configured (username: Admin, password: Admin@1234)",
    );

    console.log("\n✓ Database setup completed successfully!");
    console.log("\nDatabase Connection Details:");
    console.log(`  Host: ${process.env.DB_HOST || "localhost"}`);
    console.log(`  Port: ${process.env.DB_PORT || 3306}`);
    console.log(`  Database: ${dbName}`);
    console.log(`  User: ${process.env.DB_USER || "root"}`);
    console.log("\nYou can now run: npm start");
  } catch (error) {
    console.error("✗ Database setup failed:", error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// Run setup
setupDatabase();

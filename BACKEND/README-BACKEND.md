# Bigasan Rice Vending System - Backend Setup Guide

## Overview

This backend provides a RESTful API for the Bigasan rice vending system, connecting the kiosk and control panel to a MySQL database.

## Project Structure

```
├── server.js                    # Main Express API server
├── db-connection.js             # MySQL connection pool
├── setup-database.js            # Database initialization script
├── package.json                 # Node dependencies
├── .env                         # Environment configuration
└── README.md                    # This file
```

## Prerequisites

- **Node.js** (v14+) - [Download](https://nodejs.org/)
- **MySQL Server** (v5.7+) - [Download](https://www.mysql.com/downloads/mysql/)
- **npm** (comes with Node.js)

## Installation Steps

### 1. Install Node.js Dependencies

```bash
npm install
```

This will install:

- `express` - Web framework
- `mysql2` - MySQL driver
- `cors` - Cross-origin resource sharing
- `dotenv` - Environment variable management
- `body-parser` - Request parsing
- `bcryptjs` - Password hashing
- `jsonwebtoken` - JWT authentication

### 2. Configure Database Connection

Edit `.env` file with your MySQL credentials:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=bigasan_rice_vending
PORT=3001
```

**Default Configuration:**

- Host: `localhost`
- Port: `3306`
- User: `root`
- Password: (leave blank if no password)
- Database: `bigasan_rice_vending` (will be created)

### 3. Initialize the Database

Run the setup script to create tables and insert default data:

```bash
npm run setup-db
```

This will:

- ✓ Create the `bigasan_rice_vending` database
- ✓ Create all necessary tables
- ✓ Insert default rice types (Jasmine, Sinandomeng, Brown Rice)
- ✓ Initialize inventory levels
- ✓ Create default admin operator (username: `Admin`, password: `Admin@1234`)

### 4. Start the Server

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

The server will run on `http://localhost:3001`

## Database Schema

### Tables Created

#### `rice_types`

Stores types of rice available

```sql
id, name, description, default_capacity, base_price, created_at, updated_at
```

#### `rice_inventory`

Tracks current stock levels

```sql
id, rice_type_id, stock, capacity, current_price, last_refilled, last_updated
```

#### `transactions`

Records all kiosk sales

```sql
id, rice_type_id, quantity_bought, price_per_unit, total_price,
payment_method, transaction_status, transaction_timestamp, created_at
```

#### `operators`

System users/operators

```sql
id, username, password_hash, email, full_name, role, is_active,
last_login, created_at, updated_at
```

#### `panel_state`

Control panel session state

```sql
id, operator_id, state_data, session_id, last_action, updated_at
```

#### `refill_logs`

Tracks inventory refills/restocks

```sql
id, rice_type_id, previous_stock, new_stock, refill_amount,
operator_id, notes, refill_timestamp
```

## API Endpoints

### Inventory Management

```
GET    /api/inventory              # Get all inventory
GET    /api/inventory/:id          # Get specific inventory
PUT    /api/inventory/:id          # Update inventory (stock/price)
```

### Transactions

```
POST   /api/transactions           # Record new transaction
PUT    /api/transactions/:id       # Update pending payment / complete sale
GET    /api/transactions           # Get transactions (with filters)
GET    /api/transactions/stats/daily  # Get daily sales stats
```

### Refill/Restock

```
POST   /api/refill                 # Record refill action
GET    /api/refill-logs            # Get refill history
```

### System

```
GET    /api/health                 # Check server status
```

## Example API Usage

### Get All Inventory

```bash
curl http://localhost:3001/api/inventory
```

Response:

```json
[
  {
    "id": 1,
    "rice_type_id": 1,
    "name": "Jasmine",
    "stock": 10,
    "capacity": 100,
    "stock_percent": 10,
    "current_price": "55.00"
  }
]
```

### Record a Transaction

```bash
curl -X POST http://localhost:3001/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "rice_type_id": 1,
    "quantity_bought": 5,
    "price_per_unit": 55.00,
    "payment_method": "cash"
  }'
```

### Refill Inventory

```bash
curl -X POST http://localhost:3001/api/refill \
  -H "Content-Type: application/json" \
  -d '{
    "rice_type_id": 1,
    "refill_amount": 50,
    "operator_id": 1,
    "notes": "Morning restock"
  }'
```

### Get Daily Statistics

```bash
curl http://localhost:3001/api/transactions/stats/daily
```

## Default Login Credentials

After setup, you can log in with:

- **Username:** `Admin`
- **Password:** `Admin@1234`

⚠️ **Important:** Change this password immediately in production!

## Troubleshooting

### "Connection Refused" Error

- Make sure MySQL server is running
- Check DB_HOST and DB_PORT in .env
- Verify MySQL credentials are correct

### "Database doesn't exist"

- Run `npm run setup-db` to create the database

### "Port already in use"

- Change the PORT in .env to a different port (e.g., 3002)
- Or stop the process using that port

### Permission Denied Errors

- Ensure MySQL user has necessary permissions
- Try using `root` user or create a user with proper grants

## Frontend Integration

The frontend applications (kiosk and control panel) can now:

1. Fetch inventory data from `/api/inventory`
2. Submit transactions to `/api/transactions`
3. View sales history
4. Manage refills through `/api/refill`

Update your frontend to point to the API:

```javascript
const API_BASE_URL = "http://localhost:3001/api";

// Example usage in frontend
fetch(`${API_BASE_URL}/inventory`)
  .then((r) => r.json())
  .then((data) => console.log(data));
```

## Performance Considerations

- Connection pool limit: 10 (configurable in db-connection.js)
- Transaction history limited to 100 records by default
- Indexes on frequently queried columns for fast lookups

## Next Steps

1. ✓ Install Node.js and MySQL
2. ✓ Configure .env with your database credentials
3. ✓ Run `npm install`
4. ✓ Run `npm run setup-db`
5. ✓ Run `npm start`
6. Integrate frontend with the API endpoints
7. Test all operations (inventory, transactions, refills)

## Support

For issues or questions, check the error logs and ensure:

- MySQL service is running
- Connection credentials are correct
- Node.js is properly installed
- All dependencies are installed (`npm install`)

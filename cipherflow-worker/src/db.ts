import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Export the pool so other files can use it to run queries
export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

// Export the initialization function
export async function initializeDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      event_id VARCHAR(255) UNIQUE NOT NULL,
      source VARCHAR(255) NOT NULL,
      event_timestamp TIMESTAMP NOT NULL,
      decrypted_payload TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  try {
    await pool.query(createTableQuery);
    console.log('✅ PostgreSQL Database initialized and table verified.');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  }
}
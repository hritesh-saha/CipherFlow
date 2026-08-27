import { Redis } from 'ioredis';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { pool, initializeDB } from './db.js'; 
import http from 'http';
import client from 'prom-client';

dotenv.config();

// Initialize Metrics
client.collectDefaultMetrics();
const eventsProcessedCounter = new client.Counter({
  name: 'worker_events_processed_total',
  help: 'Total number of events processed by the worker'
});

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const STREAM_NAME = 'audit_events_stream';
const GROUP_NAME = 'cipherflow_workers';
const CONSUMER_NAME = `worker-${process.pid}`; 

const SECRET_KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'utf8'); 

const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

function decryptPayload(encryptedHex: string): string {
  try {
    const [ivHex, encryptedTextHex, authTagHex] = encryptedHex.split(':');
    
    if (!ivHex || !encryptedTextHex || !authTagHex) {
      throw new Error('Invalid ciphertext format. Expected iv:ciphertext:authTag');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedTextHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption failed:', error instanceof Error ? error.message : error);
    return '[DECRYPTION_FAILED]';
  }
}

async function initializeGroup() {
  try {
    await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '0', 'MKSTREAM');
    console.log(`✅ Consumer group '${GROUP_NAME}' initialized.`);
  } catch (err: any) {
    if (!err.message.includes('BUSYGROUP')) {
      console.error('Failed to create consumer group:', err);
      process.exit(1);
    }
  }
}

async function processEvents() {
  console.log(`🎧 [${CONSUMER_NAME}] Listening for encrypted events...`);

  while (true) {
    try {
      const response = await redis.xreadgroup(
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'COUNT', 1,
        'BLOCK', 5000,
        'STREAMS', STREAM_NAME, '>'
      );

      if (response && response.length > 0) {
        const stream = response[0];
        if (!stream) continue;

        const messages = stream[1];
        if (!messages) continue;

        for (const message of messages) {
          const messageId = message[0];
          const fields = message[1]; 
          
          if (!fields || fields.length < 2 || !fields[1]) continue;

          const rawData = JSON.parse(fields[1]); 
          console.log(`\n📦 Processing Event: ${rawData.event_id}`);

          const plainText = decryptPayload(rawData.encrypted_payload);

          // Using the imported pool
          const insertQuery = `
            INSERT INTO audit_logs (event_id, source, event_timestamp, decrypted_payload)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (event_id) DO NOTHING;
          `;
          const values = [rawData.event_id, rawData.source, rawData.timestamp, plainText];
          
          await pool.query(insertQuery, values);
          console.log(`💾 Saved to Database: ${rawData.event_id}`);

          await redis.xack(STREAM_NAME, GROUP_NAME, messageId);
          console.log(`✅ Acknowledged Message ID: ${messageId}`);

          // Increment the counter after successful processing!
          eventsProcessedCounter.inc();
        }
      }
    } catch (err) {
      console.error('Error processing stream or database:', err);
    }
  }
}

// Create a tiny HTTP server just for metrics
const metricsServer = http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function start() {
  await initializeDB();
  await initializeGroup();

  // Start listening for Prometheus on port 8000
  metricsServer.listen(8000, () => {
    console.log('📊 Worker metrics server listening on port 8000');
  });

  await processEvents();
}

start();

process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down worker...');
  metricsServer.close(); // Stop the metrics server
  await pool.end();
  redis.quit();
  process.exit(0);
});
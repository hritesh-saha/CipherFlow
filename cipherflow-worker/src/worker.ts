import dotenv from 'dotenv';
dotenv.config();
import { Redis } from 'ioredis';
import crypto from 'crypto';

// 1. Environment & Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const STREAM_NAME = 'audit_events_stream';
const GROUP_NAME = 'cipherflow_workers';
const CONSUMER_NAME = `worker-${process.pid}`; 

// Convert the string from the .env file into a Buffer
const SECRET_KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'utf8');

if (SECRET_KEY.length !== 32) {
  console.error('CRITICAL: ENCRYPTION_KEY must be exactly 32 characters long.');
  process.exit(1);
}

const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

// 2. Cryptographic Engine
function decryptPayload(encryptedHex: string): string {
  try {
    // Strictly destructure to ensure TS knows these are strings, not undefined
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

// 3. Redis Consumer Group Initialization
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

// 4. The Main Event Loop
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

      // Strict null checks to satisfy TypeScript
      if (response && response.length > 0) {
        const stream = response[0];
        if (!stream) continue;

        const messages = stream[1];
        if (!messages) continue;

        for (const message of messages) {
          const messageId = message[0];
          const fields = message[1]; 
          
          // fields is a flat array: ['data', '{"event_id":...}']
          if (!fields || fields.length < 2 || !fields[1]) {
            console.warn('⚠️ Received malformed message fields, skipping.');
            continue;
          }

          const rawData = JSON.parse(fields[1]); 
          
          console.log(`\n📦 Received Event: ${rawData.event_id}`);
          console.log(`🔒 Encrypted Payload: ${rawData.encrypted_payload}`);

          const plainText = decryptPayload(rawData.encrypted_payload);
          console.log(`🔓 Decrypted Payload: ${plainText}`);

          // TODO: Day 3 - Insert into PostgreSQL here

          await redis.xack(STREAM_NAME, GROUP_NAME, messageId);
          console.log(`✅ Acknowledged Message ID: ${messageId}`);
        }
      }
    } catch (err) {
      console.error('Error processing stream:', err);
    }
  }
}

async function start() {
  await initializeGroup();
  await processEvents();
}

start();

process.on('SIGINT', () => {
  console.log('\nGracefully shutting down worker...');
  redis.quit();
  process.exit(0);
});
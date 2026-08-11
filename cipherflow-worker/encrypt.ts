import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const SECRET_KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'utf8');

function encryptTestPayload(text: string) {
  // 1. Generate a random 12-byte Initialization Vector
  const iv = crypto.randomBytes(12);
  
  // 2. Create the Cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  
  // 3. Encrypt the text
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // 4. Get the Authentication Tag
  const authTag = cipher.getAuthTag().toString('hex');
  
  // 5. Format it as iv:ciphertext:authTag
  const finalPayload = `${iv.toString('hex')}:${encrypted}:${authTag}`;
  
  console.log('\n✅ Your matching encrypted payload is:');
  console.log(finalPayload);
  console.log('\n');
}

encryptTestPayload("CipherFlow works perfectly!");
import fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { z } from 'zod';
import { Redis } from 'ioredis';

// 1. Environment Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_STREAM_NAME = 'audit_events_stream';

// 2. Strict Zod Schema for Validation
const AuditEventSchema = z.object({
  event_id: z.string().min(5, 'event_id must be at least 5 characters'),
  source: z.string().min(1, 'source is required'),
  timestamp: z.string().datetime({ message: 'Must be ISO 8601 timestamp' }),
  encrypted_payload: z.string().min(1, 'encrypted_payload is required'),
});

// Infer TypeScript type directly from Schema
type AuditEvent = z.infer<typeof AuditEventSchema>;

// Initialize Fastify and Redis
const app: FastifyInstance = fastify({ logger: true });
const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: 3,
});

// 3. High-Speed Ingestion Endpoint
app.post('/audit/events', async (request, reply) => {
  // Validate request body using Zod
  const parseResult = AuditEventSchema.safeParse(request.body);

  if (!parseResult.success) {
    return reply.status(400).send({
      error: 'Invalid Payload',
      details: parseResult.error.format(),
    });
  }

  const eventData: AuditEvent = parseResult.data;

  try {
    // Push raw JSON into Redis Stream (XADD stream_key * field value)
    const messageId = await redisClient.xadd(
      REDIS_STREAM_NAME,
      '*',
      'data',
      JSON.stringify(eventData)
    );

    // Return 202 Accepted immediately
    return reply.status(202).send({
      status: 'queued',
      stream_id: messageId,
    });
  } catch (err) {
    request.log.error(err, 'Failed to push to Redis stream');
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// 4. Kubernetes Health Probes
app.get('/health/live', async (request, reply) => {
  return reply.status(200).send({ status: 'alive' });
});

app.get('/health/ready', async (request, reply) => {
  try {
    // Verify Redis connection before accepting traffic
    await redisClient.ping();
    return reply.status(200).send({ status: 'ready', redis: 'connected' });
  } catch (err) {
    return reply.status(503).send({ status: 'unhealthy', redis: 'disconnected' });
  }
});

// 5. Graceful Lifecycle & Startup
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '8000', 10);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Ingestion API running on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Handle Shutdown Signal gracefully
process.on('SIGTERM', async () => {
  await app.close();
  redisClient.disconnect();
  process.exit(0);
});

start();
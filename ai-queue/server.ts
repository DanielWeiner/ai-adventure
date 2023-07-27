import 'dotenv/config';

import http from 'http';
import { createItemsWatcher } from "./pipeline/itemsWatcher";
import { createRequestsWatcher } from "./pipeline/requestsWatcher";
import { createLogger } from './pipeline/logger';
import { createRedisClient } from './pipeline/redisClient';
const { REDIS_URL } = process.env;

const logger = createLogger();

async function startServer() {    
    const itemsWatcher = createItemsWatcher({
        itemProcessorRedisClient: await createRedisClient(),
        queueConsumerRedisClient: await createRedisClient()
    });

    const requestsWatcher = createRequestsWatcher({
        resolverRedisClient:      await createRedisClient(),
        queueConsumerRedisClient: await createRedisClient()
    });
    
    logger.info(`Connecting to Redis at ${REDIS_URL}`);

    process.once('SIGTERM', async () => {
        await itemsWatcher.abortWatcher();
        await requestsWatcher.abortWatcher();
    });
    itemsWatcher.watch();
    requestsWatcher.watch();
}

startServer();

if (process.env.NODE_ENV !== 'development') {
    http.createServer((req, res) => {
        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('OK');
        } else {
            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end('Not Found');
        }
    }).listen(80, () => {
        logger.info(`Health check endpoint listening on port 80`)
    });
}

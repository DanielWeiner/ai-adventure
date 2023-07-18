import 'dotenv/config';

import http from 'http';
import { createItemsWatcher } from "./pipeline/itemsWatcher";
import { createPipelinesWatcher } from "./pipeline/pipelinesWatcher";
import { createRequestsWatcher } from "./pipeline/requestsWatcher";
import { createLogger } from './pipeline/logger';
const { REDIS_URL } = process.env;

const logger = createLogger();

async function startServer() {    
    const pipelinesWatcher = await createPipelinesWatcher();
    const itemsWatcher = await createItemsWatcher();
    const requestsWatcher = await createRequestsWatcher();
    
    logger.info(`Connecting to Redis at ${REDIS_URL}`);

    pipelinesWatcher.watch();
    itemsWatcher.watch();
    requestsWatcher.watch();
}

startServer();

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
import 'dotenv/config';

import http from 'http';
import { createItemsWatcher } from "./pipeline/itemsWatcher";
import { createRequestsWatcher } from "./pipeline/requestsWatcher";
import { createLogger } from './pipeline/logger';
import { createRedisClient } from './pipeline/redisClient';

const logger = createLogger();

async function startServer() {    
    const itemsWatcher = createItemsWatcher({
        itemProcessorRedisClient: await createRedisClient(logger, 'Pipeline items processor: '),
        queueConsumerRedisClient: await createRedisClient(logger, 'Pipeline items queue consumer: ')
    });

    const requestsWatcher = createRequestsWatcher({
        resolverRedisClient:      await createRedisClient(logger, 'OpenAI request resolver: '),
        queueConsumerRedisClient: await createRedisClient(logger, 'OpenAI requests queue consumer: ')
    });

    logger.info('AI pipeline queue ready.');

    const interceptExit = (signal: NodeJS.Signals) => {
        process.once(signal, async () => {
            logger.info(`Signal ${signal} recieved, shutting down.`);
            logger.info(`Aborting items watcher.`);
            await itemsWatcher.abortWatcher();
            logger.info(`Aborting requests watcher.`);
            await requestsWatcher.abortWatcher();
            logger.info(`Cleanup done, exiting.`);
            process.kill(process.pid, signal);
        });
    }

    interceptExit('SIGUSR2');
    interceptExit('SIGTERM');

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
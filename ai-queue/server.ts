import { logger, startServer } from "./queue";
import http from 'http';
const { REDIS_URL } = process.env;

logger.info(`Connecting to Redis at ${REDIS_URL}`);
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
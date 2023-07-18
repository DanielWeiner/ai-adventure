import { RedisClientType, createClient } from "redis";
const { REDIS_URL } = process.env;

export const createRedisClient = async () => {
    const client : RedisClientType = createClient({
        
        url: REDIS_URL,
        pingInterval: 1500,
        socket: {
            reconnectStrategy: 10,
        }
    });
    await client.connect();

    return client;
};

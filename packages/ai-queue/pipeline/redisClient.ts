import { RedisClientType, createClient } from "redis";
const { REDIS_URL } = process.env;

export const createRedisClient = async () => {
    const client : RedisClientType = createClient({
        url: REDIS_URL,
        pingInterval: 2000,
        socket: {
            reconnectStrategy: 10
        }
    });
    await client.connect();

    return client;
};

export const useRedisClient = (redisClient?: RedisClientType) => async <T>(callback: (redisClient: RedisClientType) => Promise<T>) => {
    const client : RedisClientType = redisClient ?? await createRedisClient() as RedisClientType;
    const result = await callback(client);
    if (!redisClient) {
        await client.quit();
    }

    return result;
}

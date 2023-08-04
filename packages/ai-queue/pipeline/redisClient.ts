import { RedisClientType, createClient } from "redis";
import { Logger } from "winston";
const { REDIS_URL } = process.env;

const url = new URL(REDIS_URL!);

export const createRedisClient = async (logger?: Logger, prefix?: string) => {
    logger?.info(`${prefix ?? ''}Connecting to redis at ${url.protocol}//${url.host}`);

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

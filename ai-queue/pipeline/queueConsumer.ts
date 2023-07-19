import { RedisClientType } from "redis";
import { v4 as uuid } from 'uuid';

const DEFAULT_CHUNK_SIZE = 10;
const DEFAULT_POLL_TIME = 1000;
const TEMP_GROUP = '__temp__';

function checkPromise<T>(promise: Promise<T>) : Promise<boolean> {
    return new Promise((resolve, reject) => {
        let resolved = false;

        promise.then(() => {
            if (!resolved) {
                resolved = true;
                resolve(true);
            }
        }, err => {
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });

        setImmediate(() => {
            if (!resolved) {
                resolved = true;
                resolve(false)
            }
        });
    });
}

export default class QueueConsumer {
    #redisClient              : RedisClientType;
    #prevRedisClient          : RedisClientType | null = null;
    readonly #key             : string;
    readonly #consumerGroupId : string;
    readonly #id              : string;
    readonly #chunkSize       : number;
    readonly #pollTime        : number;
    readonly #startMessageId  : string;
    
    constructor({ 
        redisClient, 
        key, 
        consumerGroupId, 
        id = uuid(),
        chunkSize = DEFAULT_CHUNK_SIZE,
        pollTime = DEFAULT_POLL_TIME,
        startMessageId = '0'
    } : { 
        redisClient:     RedisClientType, 
        key:             string, 
        consumerGroupId: string, 
        id?:             string, 
        chunkSize?:      number, 
        pollTime?:       number,
        startMessageId?: string
    }) {
        this.#redisClient = redisClient;
        this.#key = key;
        this.#consumerGroupId = consumerGroupId;
        this.#id = id;
        this.#chunkSize = chunkSize;
        this.#pollTime = pollTime;
        this.#startMessageId = startMessageId;
    }

    async *watch(until: Promise<void>) : AsyncGenerator<{ id: string, message: { [key in string]: string }}> {
        const checkUntil = () => checkPromise(until);

        await this.#redisClient
            .multi()
                .xGroupCreate(this.#key, TEMP_GROUP, '0', { MKSTREAM: true })
                .xGroupDestroy(this.#key, TEMP_GROUP)
            .exec();
        
        const cleanup = until.then(async () => {
            const newClient = this.#redisClient.duplicate();
            await newClient.connect();
            this.#prevRedisClient = this.#redisClient;
            this.#redisClient = newClient;
        });

        mainLoop:
        while (!await checkUntil()) {
            await this.#ensureGroupExists();
            const items = await Promise.race([
                until,
                this.#redisClient.xReadGroup(this.#consumerGroupId, this.#id, {
                    key: this.#key,
                    id: '>',
                }, {
                    COUNT: this.#chunkSize,
                    BLOCK: this.#pollTime
                }).then(async (data) => {
                    const prevClient = this.#prevRedisClient;
                    this.#prevRedisClient = null;
                    if (prevClient !== null && prevClient) {
                        prevClient.on('error', () => {});
                        prevClient.on('end', () => {});
                        await prevClient.disconnect();
                    }
                    return data;
                })
            ]);


            if (!items?.[0]?.messages?.length) {
                continue;
            }

            for (const message of items?.[0].messages) {
                if (await checkUntil()) {
                    break mainLoop;
                }
                
                yield message;
            }
        }
        await cleanup;
    }

    async #ensureGroupExists() {
        const groups = await this.#redisClient.xInfoGroups(this.#key);
        if (!groups.some(({ name }) => this.#consumerGroupId === name)) {
            await this.#redisClient.xGroupCreate(this.#key, this.#consumerGroupId, this.#startMessageId);
        }
    }
    async destroy() {
        await this.#redisClient.xGroupDelConsumer(this.#key, this.#consumerGroupId, this.#id);
        await this.quit();
    }

    async quit() {
        await this.#redisClient.quit();
    }

    async ack(messageId: string) {
        await this.#redisClient.xAck(this.#key, this.#consumerGroupId, messageId);
    }
}
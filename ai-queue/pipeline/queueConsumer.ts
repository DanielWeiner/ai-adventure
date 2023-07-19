import { RedisClientType } from "redis";
import { v4 as uuid } from 'uuid';

const DEFAULT_CHUNK_SIZE = 10;
const DEFAULT_POLL_TIME = 1000;
const TEMP_GROUP = '__temp__';

export default class QueueConsumer {
    #redisClient              : RedisClientType;
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
        let done = false;
        const whenDone = until.then(() => { done = true; });
        
        await this.#redisClient
            .multi()
                .xGroupCreate(this.#key, TEMP_GROUP, '0', { MKSTREAM: true })
                .xGroupDestroy(this.#key, TEMP_GROUP)
            .exec();

        mainLoop:
        while (!done) {
            await this.#ensureGroupExists();
            const items = await Promise.race([
                whenDone,
                this.#redisClient.xReadGroup(this.#consumerGroupId, this.#id, {
                    key: this.#key,
                    id: '>',
                }, {
                    COUNT: this.#chunkSize,
                    BLOCK: this.#pollTime
                })
            ]);
            if (done) {
                break;
            }

            if (!items?.[0]?.messages?.length) {
                continue;
            }

            for (const message of items?.[0].messages) {
                if (done) {
                    break mainLoop;
                }
                
                yield message;
            }
        }
        const newClient = this.#redisClient.duplicate();
        await newClient.connect();
        const prevClient = this.#redisClient;
        this.#redisClient = newClient;
        prevClient.on('error', () => {});
        prevClient.on('end', () => {});
        prevClient.disconnect();
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
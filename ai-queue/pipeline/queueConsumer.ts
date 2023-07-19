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
    #done                     : boolean = false;
    #donePromise              : Promise<void>;
    #resolveDone              : () => void = () => {};
    
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
        this.#donePromise = new Promise(resolve => { this.#resolveDone = resolve; });
    }

    async *watch() : AsyncGenerator<{ id: string, message: { [key in string]: string }}> {
        await this.#redisClient
            .multi()
                .xGroupCreate(this.#key, TEMP_GROUP, '0', { MKSTREAM: true })
                .xGroupDestroy(this.#key, TEMP_GROUP)
            .exec();

        mainLoop:
        while (!this.#done) {
            await this.#ensureGroupExists();
            const items = await Promise.race([
                this.#donePromise,
                this.#redisClient.xReadGroup(this.#consumerGroupId, this.#id, {
                    key: this.#key,
                    id: '>',
                }, {
                    COUNT: this.#chunkSize,
                    BLOCK: this.#pollTime
                })
            ]);
            if (this.#done) {
                break;
            }

            if (!items?.[0]?.messages?.length) {
                continue;
            }

            for (const message of items?.[0].messages) {
                if (this.#done) {
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

    breakLoop() {
        this.#done = true;
        this.#resolveDone();
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
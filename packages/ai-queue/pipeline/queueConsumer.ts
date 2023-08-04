import { RedisClientType } from "redis";
import { v4 as uuid } from 'uuid';
import EventEmitter from "events";

const DEFAULT_CHUNK_SIZE = 10;
const DEFAULT_POLL_TIME = 10000;
const TEMP_GROUP = '__temp__';

type ReadResults = ReturnType<RedisClientType['xReadGroup']> extends Promise<infer T> ? T : never;

export default class QueueConsumer {
    #redisClient              : RedisClientType;
    readonly #key             : string;
    readonly #consumerGroupId : string;
    readonly #id              : string;
    readonly #chunkSize       : number;
    readonly #pollTime        : number;
    readonly #startMessageId  : string;
    #done                     : boolean = false;
    #abortEmitter             : EventEmitter = new EventEmitter();
    
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

    async *watch() : AsyncGenerator<{ id: string, message: { [key in string]: string }}> {
        const onAbort = () => {
            const oldClient = this.#redisClient;
            this.#redisClient = oldClient.duplicate();
            oldClient.on('error', () => {});
            oldClient.disconnect();
            oldClient.unref();
        };
        
        mainLoop:
        while (!this.#done) {
            let items : ReadResults;
            let aborted : boolean = false;

            this.#abortEmitter.on('abort', onAbort);
            try {
                await this.#ensureGroupExists();
                items = await this.#redisClient.xReadGroup(this.#consumerGroupId, this.#id, {
                    key: this.#key,
                    id: '>',
                }, {
                    COUNT: this.#chunkSize,
                    BLOCK: this.#pollTime
                });
            } catch {
                this.#done = true;
                aborted = true;
                items = null;
            }
            this.#abortEmitter.off('abort', onAbort);

            if (aborted || this.#done) {
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

        if (!this.#redisClient.isOpen) {
            await this.#redisClient.connect();
        }
    }

    breakLoop() {
        this.#done = true;
        this.#abortEmitter.emit('abort');
    }

    async #ensureGroupExists() {
        await this.#redisClient
            .multi()
                .xGroupCreate(this.#key, TEMP_GROUP, '0', { MKSTREAM: true })
                .xGroupDestroy(this.#key, TEMP_GROUP)
            .exec();

        const groups = await this.#redisClient.xInfoGroups(this.#key);
        if (!groups.some(({ name }) => this.#consumerGroupId === name)) {
            await this.#redisClient.xGroupCreate(this.#key, this.#consumerGroupId, this.#startMessageId);
        }
    }

    async destroy() {
        if (await this.#redisClient.exists(this.#key)) {
            await this.#redisClient.xGroupDelConsumer(this.#key, this.#consumerGroupId, this.#id);
        }
    }

    async quit() {
        await this.#redisClient.quit();
    }

    async ack(messageId: string) {
        await this.#redisClient.xAck(this.#key, this.#consumerGroupId, messageId);
    }
}
import { v4 as uuid } from 'uuid';
import { PipelineItemCollection, buildItemCollection } from './itemCollection';
import { PipelineItemConfig } from './config';
import { PIPELINE_ITEMS_QUEUE } from './constants';
import { PipelineItem } from './pipelineItem';
import { RedisClientType } from 'redis';
import { useRedisClient } from './redisClient';

export interface PipelineConfig {
    id:      string;
    beginId: string;
    endId:   string;
    items:   PipelineItemCollection;
}

export class Pipeline {
    readonly #config : PipelineConfig;

    private constructor(config: PipelineConfig) {
        this.#config = config;
    }

    static fromItems(config: PipelineItemConfig, id: string = uuid()) {
        const beginId = uuid();
        const endId = uuid();

        return new Pipeline({
            id,
            beginId,
            endId,
            items: buildItemCollection(config, beginId, endId)
        });
    }

    static async fromId(pipelineId: string, redisClient: RedisClientType) {
        const pipelineStr = await redisClient.get(Pipeline.calculateRedisKey(pipelineId));

        if (!pipelineStr) {
            return null;
        }

        return Pipeline.fromString(pipelineStr);
    }

    static fromString(configStr: string) {
        return new Pipeline(JSON.parse(configStr));
    }

    static fromConfig(config: PipelineConfig) {
        return new Pipeline(config);
    }

    async saveToQueue(redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client => {
            const multi = client
                .multi()
                .set(this.calculateRedisKey(), this.toString())
                .xAdd(PIPELINE_ITEMS_QUEUE, '*', {
                    pipelineId: this.getId(),
                    itemId:     this.getBeginId()
                });
            
            for (const item of this.getItems()) {
                multi.incrBy(item.calculatePrevIdsKey(), item.getPrevIds().length);
            }

            await multi.exec();
        });
    }

    async destroyItem(itemId: string, redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client =>{
            const item = this.getItem(itemId);
            if (!item) {
                return;
            }

            await client
                .multi()
                    .del(item.calculateContentKey())
                    .del(item.calculateDoneKey())
                    .del(item.calculateStreamKey())
                    .del(item.calculatePrevIdsKey())
                .exec();
        });
    }

    async destroy(redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client => {
            const multi = client.multi();
        
            for (const key of Object.keys(this.#config.items)) {
                const item = this.getItem(key)!;

                multi
                    .del(item.calculateContentKey())
                    .del(item.calculateDoneKey())
                    .del(item.calculateStreamKey())
                    .del(item.calculatePrevIdsKey())
            }
            
            await multi
                .del(this.calculateRedisKey())
                .exec();
        });
    }

    static calculateRedisKey(id: string) {
        return `aiq:pipelines:${id}`;
    }

    getItemByRequestAlias(requestAlias: string) {
        for (const [itemId, item] of Object.entries(this.#config.items)) {
            if (item.request.alias === requestAlias) {
                return new PipelineItem(itemId, this.getId(), item);
            }
        }

        return null;
    }

    getItem(itemId: string) : PipelineItem | null {
        return this.#config.items[itemId] ? new PipelineItem(itemId, this.getId(), this.#config.items[itemId]) : null;
    }

    getItems() {
        return Object.keys(this.#config.items).map(itemId => this.getItem(itemId)!);
    }

    getId() {
        return this.#config.id;
    }

    getEndId() {
        return this.#config.endId;
    }

    getBeginId() {
        return this.#config.beginId;
    }
    
    toString() {
        return JSON.stringify(this.#config);
    }

    calculateRedisKey() {
        return Pipeline.calculateRedisKey(this.#config.id);
    }
}
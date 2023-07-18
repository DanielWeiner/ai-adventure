import { RedisClientType } from "redis"
import { Pipeline } from "./pipeline";
import { Logger } from "winston";
import { PipelineItem } from "./pipelineItem";
import { PIPELINE_ITEMS_QUEUE, PIPELINE_ITEM_EVENT_BEGIN, PIPELINE_ITEM_EVENT_END, PIPELINE_REQUESTS_QUEUE } from "./constants";

export class PipelineItemProcessor {
    readonly #redisClient : RedisClientType;
    readonly #logger : Logger;
    
    constructor(redisClient: RedisClientType, logger: Logger) {
        this.#redisClient = redisClient;
        this.#logger = logger;
    }

    async processItem(pipelineId: string, itemId: string) {
        const pipelineKey = Pipeline.calculateRedisKey(pipelineId);
        const pipelineStr = await this.#redisClient.get(pipelineKey);

        if (!pipelineStr) {
            this.#logger.warn(`could not find pipeline ${pipelineKey}.`);
            return;
        }

        const pipeline = Pipeline.fromString(pipelineStr);
        const item = pipeline.getItem(itemId);
        if (!item) {
            this.#logger.warn(`pipeline item id ${itemId} not found in pipeline ${pipeline.getId()}`);
            return;
        }
        
        if (item.isBegin()) {
            await this.#begin(pipeline, item);
        } else if (item.isEnd()) {
            await this.#end(item);
        } else {
            await this.#startRequest(item)
        }
    }

    async #begin(pipeline: Pipeline, item: PipelineItem) {
        const multi = this.#redisClient.multi();
        item.getNextIds().forEach(itemId => {
            const otherItem = pipeline.getItem(itemId);

            if (!otherItem) {
                this.#logger.warn(`pipeline item ${item.getId()} found no next item ${itemId} in pipeline ${pipeline.getId()}`);
                return;
            }

            multi
                .xAdd(PIPELINE_ITEMS_QUEUE, '*', { pipelineId: item.getPipelineId(), itemId })
        });

        this.#logger.info(`triggering the begin item for pipeline ${item.getPipelineId()}`);
        await multi
                .set(item.calculateContentKey(), '')
                .set(item.calculateDoneKey(), '1')
                .xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_BEGIN })
                .xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_END })
            .exec();
    }

    async #end(item: PipelineItem) {
        this.#logger.info(`triggering the end item for pipeline ${item.getPipelineId()}`);
        await this.#redisClient
            .multi()
                .set(item.calculateContentKey(), '')
                .set(item.calculateDoneKey(), '1')
                .xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_BEGIN })
                .xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_END })
            .exec();
    }

    async #startRequest(item: PipelineItem) {
        this.#logger.info(`triggering request for item ${item.getAlias()} of pipeline ${item.getPipelineId()}`);

        await this.#redisClient
            .multi()
                .set(item.calculateContentKey(), '')
                .set(item.calculateDoneKey(), '0')
                .xAdd(PIPELINE_REQUESTS_QUEUE, '*', {
                    pipelineId: item.getPipelineId(),
                    itemId:     item.getId(),
                    request:    JSON.stringify(item.getRequest())
                })
            .exec();
    }

    async quit() {
        await this.#redisClient.quit();
    }
}
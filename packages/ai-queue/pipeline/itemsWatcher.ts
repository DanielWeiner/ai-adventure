import QueueConsumer from "./queueConsumer";
import { PipelineItemProcessor } from "./pipelineItemProcessor";
import { PIPELINE_ITEMS_CONSUMER_GROUP, PIPELINE_ITEMS_QUEUE } from "./constants";
import { v4 as uuid } from 'uuid';
import { createLogger } from "./logger";
import { RedisClientType } from "redis";

class ItemsWatcher {
    readonly #queueConsumer : QueueConsumer;
    readonly #itemProcessor : PipelineItemProcessor;
    #watchPromise           : Promise<void> = Promise.resolve();
    #resolveWatchPromise    : () => void = () => {};

    constructor(queueConsumer: QueueConsumer, itemProcessor: PipelineItemProcessor) {
        this.#queueConsumer = queueConsumer;
        this.#itemProcessor = itemProcessor;
    }

    async watch() {
        this.#watchPromise = new Promise((resolve) => {
            this.#resolveWatchPromise = resolve;
        });

        for await(const { id, message: { pipelineId, itemId } } of this.#queueConsumer.watch()) {
            await this.#itemProcessor.processItem(pipelineId, itemId);
            await this.#queueConsumer.ack(id);
        }

        await this.quit();
        this.#resolveWatchPromise();
    }

    async abortWatcher() {
        this.#queueConsumer.breakLoop();
        await this.#watchPromise;
    }

    async quit() {
        await this.#queueConsumer.destroy();
    }
}

export function createItemsWatcher({ 
    queueConsumerRedisClient, 
    itemProcessorRedisClient 
} : { 
    queueConsumerRedisClient: RedisClientType,
    itemProcessorRedisClient: RedisClientType
}) {
    const queueConsumer = new QueueConsumer({
        redisClient:     queueConsumerRedisClient,
        consumerGroupId: PIPELINE_ITEMS_CONSUMER_GROUP,
        key:             PIPELINE_ITEMS_QUEUE,
        id:              `${PIPELINE_ITEMS_CONSUMER_GROUP}:${uuid()}`
    });
    const itemProcessor = new PipelineItemProcessor(itemProcessorRedisClient, createLogger());
    return new ItemsWatcher(queueConsumer, itemProcessor);
}
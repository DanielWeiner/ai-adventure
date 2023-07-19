import QueueConsumer from "./queueConsumer";
import { PipelineItemProcessor } from "./pipelineItemProcessor";
import { createRedisClient } from "./redisClient";
import { PIPELINE_ITEMS_CONSUMER_GROUP, PIPELINE_ITEMS_QUEUE } from "./constants";
import { v4 as uuid } from 'uuid';
import { createLogger } from "./logger";

class ItemsWatcher {
    readonly #queueConsumer : QueueConsumer;
    readonly #itemProcessor : PipelineItemProcessor;
    #watchPromise           : Promise<void> = Promise.resolve();
    #resolveWatchPromise    : () => void = () => {};
    #donePromise            : Promise<void> = Promise.resolve();
    #resolveDonePromise     : () => void = () => {};

    constructor(queueConsumer: QueueConsumer, itemProcessor: PipelineItemProcessor) {
        this.#queueConsumer = queueConsumer;
        this.#itemProcessor = itemProcessor;
    }

    async watch() {
        this.#watchPromise = new Promise((resolve) => {
            this.#resolveWatchPromise = resolve;
        });
        this.#donePromise = new Promise((resolve) => {
            this.#resolveDonePromise = resolve;
        });

        for await(const { id, message: { pipelineId, itemId } } of this.#queueConsumer.watch(this.#donePromise)) {
            await this.#itemProcessor.processItem(pipelineId, itemId);
            await this.#queueConsumer.ack(id);
        }

        await this.quit();
        this.#resolveWatchPromise();
    }

    async abortWatcher() {
        this.#resolveDonePromise();
        await this.#watchPromise;
    }

    async quit() {
        await this.#queueConsumer.destroy();
        await this.#itemProcessor.quit();
    }
}

export async function createItemsWatcher() {
    const queueConsumer = new QueueConsumer({
        redisClient:     await createRedisClient(),
        consumerGroupId: PIPELINE_ITEMS_CONSUMER_GROUP,
        key:             PIPELINE_ITEMS_QUEUE,
        id:              `${PIPELINE_ITEMS_CONSUMER_GROUP}:${uuid()}`
    });
    const itemProcessor = new PipelineItemProcessor(await createRedisClient(), createLogger());
    const itemsWatcher = new ItemsWatcher(queueConsumer, itemProcessor)

    process.once('SIGTERM', async () => {
        await itemsWatcher.abortWatcher();
    });

    return itemsWatcher;
}
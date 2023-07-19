import { Logger } from "winston";
import { Pipeline } from "./pipeline";
import QueueConsumer from "./queueConsumer";
import { RedisClientType } from "redis";
import { PIPELINES_CONSUMER_GROUP, PIPELINES_QUEUE, PIPELINE_ITEMS_QUEUE } from "./constants";
import { createLogger } from "./logger";
import { createRedisClient } from "./redisClient";
import { v4 as uuid } from 'uuid';

class PipelinesWatcher {
    readonly #itemsWriterClient : RedisClientType;
    readonly #queueConsumer     : QueueConsumer;
    readonly #logger            : Logger;
    #watchPromise               : Promise<void> = Promise.resolve();
    #resolveWatchPromise        : () => void = () => {};


    constructor(queueConsumer: QueueConsumer, logger: Logger, itemsWriterClient: RedisClientType) {
        this.#queueConsumer = queueConsumer;
        this.#logger = logger;
        this.#itemsWriterClient = itemsWriterClient;
    }

    async watch() {
        this.#watchPromise = new Promise((resolve) => {
            this.#resolveWatchPromise = resolve;
        });

        for await(const { id, message: { content } } of this.#queueConsumer.watch()) {
            let pipelineConfig : Pipeline;
            try {
                pipelineConfig = Pipeline.fromConfig(JSON.parse(content));
            } catch (e: any) {
                this.#logger.error(`error when parsing ${content}: ${e.stack}`);
                continue;
            }

            await this.#savePipeline(id, pipelineConfig);
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
        await this.#itemsWriterClient.quit();
    }

    async #savePipeline(messageId: string, pipeline: Pipeline) {
        try {
            const multi = this.#itemsWriterClient
                .multi()
                .set(pipeline.calculateRedisKey(), pipeline.toString())
                .xAdd(PIPELINE_ITEMS_QUEUE, '*', {
                    pipelineId: pipeline.getId(),
                    itemId:     pipeline.getBeginId()
                })
                .xAck(PIPELINES_QUEUE, PIPELINES_CONSUMER_GROUP, messageId);
            
            for (const item of pipeline.getItems()) {
                multi.incrBy(item.calculatePrevIdsKey(), item.getPrevIds().length);
            }

            await multi.exec();
        } catch (e: any) {
            this.#logger.error(`error when saving pipeline: ${e.stack}`);
        }
    }
}

export async function createPipelinesWatcher() {
    const logger = createLogger();
    const queueConsumer = new QueueConsumer({
        redisClient:     await createRedisClient(),
        consumerGroupId: PIPELINES_CONSUMER_GROUP,
        key:             PIPELINES_QUEUE,
        id:             `${PIPELINES_CONSUMER_GROUP}:${uuid()}`
    });
    const itemsWriterClient = await createRedisClient();
    const queueWatcher = new PipelinesWatcher(queueConsumer, logger, itemsWriterClient);
    
    process.once('SIGTERM', async () => {
        await queueWatcher.abortWatcher();
    });

    return queueWatcher;
}
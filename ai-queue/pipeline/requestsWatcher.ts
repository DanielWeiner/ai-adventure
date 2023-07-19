import { RedisClientType } from "redis";
import { PIPELINE_REQUESTS_CONSUMER_GROUP, PIPELINE_REQUESTS_QUEUE } from "./constants";
import { createLogger } from "./logger";
import { createOpenAiApi } from "./openai";
import QueueConsumer from "./queueConsumer";
import { RequestResolver } from "./requestResolver";
import { v4 as uuid } from 'uuid';

class RequestsWatcher {
    readonly #queueConsumer : QueueConsumer;
    readonly #requestResolver : RequestResolver;
    #watchPromise           : Promise<void> = Promise.resolve();
    #resolveWatchPromise    : () => void = () => {};

    constructor(queueConsumer: QueueConsumer, requestResolver: RequestResolver) {
        this.#queueConsumer = queueConsumer;
        this.#requestResolver = requestResolver;
    }

    async watch() {
        this.#watchPromise = new Promise((resolve) => {
            this.#resolveWatchPromise = resolve;
        });

        for await (const { id, message: { pipelineId, itemId, request } } of this.#queueConsumer.watch()) {            
            this.#requestResolver.resolveRequest(id, pipelineId, itemId, JSON.parse(request));
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

export function createRequestsWatcher({ queueConsumerRedisClient, resolverRedisClient } : { queueConsumerRedisClient: RedisClientType; resolverRedisClient: RedisClientType }) {
    const queueConsumer = new QueueConsumer({
        redisClient: queueConsumerRedisClient,
        consumerGroupId: PIPELINE_REQUESTS_CONSUMER_GROUP,
        key: PIPELINE_REQUESTS_QUEUE,
        id: `${PIPELINE_REQUESTS_CONSUMER_GROUP}:${uuid()}`
    });
    const requestResolver = new RequestResolver(resolverRedisClient, createOpenAiApi(), createLogger());
    return new RequestsWatcher(queueConsumer, requestResolver);
}
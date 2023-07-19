import { PIPELINE_REQUESTS_CONSUMER_GROUP, PIPELINE_REQUESTS_QUEUE } from "./constants";
import { createLogger } from "./logger";
import { createOpenAiApi } from "./openai";
import QueueConsumer from "./queueConsumer";
import { createRedisClient } from "./redisClient";
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
        await this.#requestResolver.quit();
    }
}

export async function createRequestsWatcher() {
    const queueConsumer = new QueueConsumer({
        redisClient: await createRedisClient(),
        consumerGroupId: PIPELINE_REQUESTS_CONSUMER_GROUP,
        key: PIPELINE_REQUESTS_QUEUE,
        id: `${PIPELINE_REQUESTS_CONSUMER_GROUP}:${uuid()}`
    });
    const requestResolver = new RequestResolver(await createRedisClient(), createOpenAiApi(), createLogger());
    const requestsWatcher = new RequestsWatcher(queueConsumer, requestResolver);

    process.once('SIGTERM', async () => {
        await requestsWatcher.abortWatcher();
    });

    return requestsWatcher;
}
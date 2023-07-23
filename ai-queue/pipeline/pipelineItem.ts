import { RedisClientType } from "redis";
import { PIPELINE_ITEMS_QUEUE, PIPELINE_ITEM_EVENT_END, PipelineItemEvent } from "./constants";
import { PipelineItemCollectionItem } from "./itemCollection";
import QueueConsumer from "./queueConsumer";
import { createRedisClient, useRedisClient } from "./redisClient";
import { Pipeline } from "./pipeline";

export class PipelineItem {
    #id:             string;
    #pipeline:       Pipeline;
    #collectionItem: PipelineItemCollectionItem;

    constructor(id: string, pipeline: Pipeline, collectionItem: PipelineItemCollectionItem) {
        this.#id = id;
        this.#pipeline = pipeline;
        this.#collectionItem = collectionItem;
    }

    static calculateContentKey(itemId: string) {
        return `aiq:pipelineItems:${itemId}:content`;
    }

    static calculateStreamKey(itemId: string) {
        return `aiq:pipelineItems:${itemId}:stream`;
    }

    static calculateDoneKey(itemId: string) {
        return `aiq:pipelineItems:${itemId}:done`;
    }

    static calculatePrevIdsKey(itemId: string) {
        return `aiq:pipelineItems:${itemId}:prevIds`;
    }

    static calculateDoneChannel(itemId: string) {
        return `aiq:pipelineItems:channels:${itemId}:done`;
    }

    isBegin() {
        return this.#collectionItem.isBegin;
    }

    isEnd() {
        return this.#collectionItem.isEnd;
    }

    getRequest() {
        return this.#collectionItem.request;
    }

    getId() {
        return this.#id;
    }

    getPipelineId() {
        return this.#pipeline.getId();
    }

    getPrevIds() {
        return this.#collectionItem.prevIds;
    }

    getNextIds() {
        return this.#collectionItem.nextIds;
    }

    calculateContentKey() {
        return PipelineItem.calculateContentKey(this.#id);
    }

    calculateDoneKey() {
        return PipelineItem.calculateDoneKey(this.#id);
    }

    calculateDoneChannel() {
        return PipelineItem.calculateDoneChannel(this.#id);
    }

    calculateStreamKey() {
        return PipelineItem.calculateStreamKey(this.#id);
    }

    calculatePrevIdsKey() {
        return PipelineItem.calculatePrevIdsKey(this.#id);
    }

    getAlias() {
        return this.#collectionItem.request.alias;
    }

    async isDone(redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client => {
            return await client.get(this.calculateDoneKey()) === '1';
        });
    }

    async getContent(redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client => {
            return await client.get(this.calculateContentKey()) || '';
        })
    }

    async endOtherStreamWatchers(redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client => {
            return client.publish(this.calculateDoneChannel(), '1');
        });
    }

    async confirmCompleted(redisClient?: RedisClientType) {
        return useRedisClient(redisClient)(async client => {
            if (await this.isDone(client)) {
                return;
            }

            await client.multi()
                .set(this.calculateDoneKey(), '1')
                .publish(this.calculateDoneChannel(), '1')
            .exec();

            const nextItems = this.getNextIds().map(id => this.#pipeline.getItem(id)!);

            if (nextItems.length) {
                const multi = client.multi();
                for (const item of nextItems) {
                    multi.decr(item.calculatePrevIdsKey());
                }

                const results = await multi.exec() as number[];
                const requestsToTrigger = nextItems.filter((_, i) => !results[i]);
                
                if (requestsToTrigger.length) {
                    const multi = client.multi();
                    for (const item of requestsToTrigger) {
                        multi.xAdd(PIPELINE_ITEMS_QUEUE, '*', {
                            pipelineId: item.getPipelineId(),
                            itemId:     item.getId()
                        });
                    }
                    await multi.exec();
                }
            }
        });
    }

    async *watchStream({
        consumerGroupId,
        consumerId,
        timeout,
        events = []
    } : { 
        consumerGroupId: string; 
        consumerId:      string; 
        timeout:         number;
        events?:         PipelineItemEvent[];
    }) : AsyncGenerator<{ content: string, event: PipelineItemEvent }> {
        const subscriber = await createRedisClient();
        const consumerClient = await createRedisClient();
        const queueConsumer = new QueueConsumer({
            redisClient: consumerClient,
            consumerGroupId,
            id: consumerId,
            key: this.calculateStreamKey(),
            startMessageId: '0'
        });        
        
        let timeoutHandle : NodeJS.Timeout;
        const subscription = (val: string) => {
            if (val === '1') {
                clearTimeout(timeoutHandle);
                queueConsumer.breakLoop();
            }
        };
        timeoutHandle = setTimeout(() => { 
            queueConsumer.breakLoop();
        }, timeout);

        subscriber.subscribe(this.calculateDoneChannel(), subscription);
        
        for await (const { id, message: { content, event } } of queueConsumer.watch()) {
            if (!events.length || events.includes(event as PipelineItemEvent)) {
                await queueConsumer.ack(id);
                yield { content, event } as { content: string; event: PipelineItemEvent };
            }
        }

        await queueConsumer.destroy();
        await subscriber.quit();
        try {
            await consumerClient.quit();
        } catch {}
    }
}
import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { getConversationCollection, processIntentDetectionResults } from "../../../conversation";
import { v4 as uuid } from 'uuid';
import { MongoClient } from "mongodb";

import { processChatIntents } from "@/app/lib/intent/processor";
import { Pipeline } from "@/ai-queue/pipeline/pipeline";
import { PIPELINE_ITEM_EVENT_CONTENT, PIPELINE_ITEM_EVENT_END } from "@/ai-queue/pipeline/constants";
import { Intent } from "@/app/lib/intent";
import { createRedisClient } from "@/ai-queue/pipeline/redisClient";

const defaultHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Content-Encoding': 'none',
    'X-Accel-Buffering': 'no'
};

const API_TIMEOUT = 8000;

function encodeEvent(payload: string) {
    return new TextEncoder().encode(`data: ${payload}\n\n`);
}

class SSEEmitter<T> implements AsyncIterable<T> {
    #done = false;
    #updatePromise : Promise<void>;
    #resolve : ({ done } : { done: boolean }) => void = ({ done }) => {
        this.#done = done;
    };
    #queue : T[] = [];
    
    #promiseCallback = (resolve: () => void) => {
        this.#resolve = ({ done } : { done: boolean }) => {
            this.#done = done;
            this.#resolve = ({ done }) => {
                this.#done = done;
            };
            resolve(); 
        };
    }

    constructor() {
        this.#updatePromise = new Promise(this.#promiseCallback);
    }

    push(data: T) {
        this.#queue.unshift(data);
        this.#resolve({ done: false });
    }

    async process(cb: () => Promise<void>) {
        await cb();
        this.finish();
    }

    finish() {
        this.#resolve({ done: true });
    }
    
    async *[Symbol.asyncIterator](): AsyncIterator<T, any, undefined> {
        while (!this.#done) {
            await this.#updatePromise;
            this.#updatePromise = new Promise(this.#promiseCallback);
            let value : T | undefined;
            while(value = this.#queue.pop(), value !== undefined) {
                yield value;
            }
        }
    }
}

class Route {
    @authorize
    @mongo
    async GET(req: NextRequest, { params: { conversationId, session, mongoClient, mongoKeepOpen } } : { params: { session: Session, conversationId: string, userMessageId: string, mongoClient: MongoClient, mongoKeepOpen: () => {} } }) {
        const conversations = getConversationCollection(mongoClient);
        const conversation = await conversations.findOne({ '_id': conversationId, userId: session.user.id });
        const searchParams =  new URL(req.url).searchParams;
        const requestId = searchParams.get('requestId') || uuid();
        const requestRevision = ((num: number) => isNaN(num) ? 0 : num)(parseInt(searchParams.get('revision') || '0'))
        const redisClient = await createRedisClient();

        if (!conversation) {
            return NextResponse.json('Bad Request', { status: 400 });
        }

        const { messages } = conversation;

        const emitter = new SSEEmitter<Uint8Array>();
        const responseMessage = messages[messages.length - 1];

        if (responseMessage.pending) {
            const pipeline = await Pipeline.fromId(responseMessage.aiPipelineId, redisClient);
            if (!pipeline) {
                return NextResponse.json('Internal server error', { status: 500 });
            }

            mongoKeepOpen();
            emitter.process(async () => {
                await Promise.all([
                    (async () => {  
                        const chatItem = pipeline.getItemByRequestAlias('chat')!;
    
                        for await (const { content } of chatItem.watchStream({
                            consumerGroupId: requestId, 
                            consumerId:      requestId, 
                            timeout:         API_TIMEOUT,
                            events:          [PIPELINE_ITEM_EVENT_CONTENT]
                        })) {
                            emitter.push(encodeEvent(JSON.stringify({ delta: true, messageId: responseMessage.id, message: content })));
                        }
                    })(),
                    (async () => {
                        const chatItem = pipeline.getItemByRequestAlias('chat')!;
                        if (await chatItem.isDone(redisClient)) {
                            return;
                        }
    
                        for await (const {} of chatItem.watchStream({
                            consumerGroupId: 'chat', 
                            consumerId:      requestId, 
                            timeout:         API_TIMEOUT,
                            events:          [PIPELINE_ITEM_EVENT_END]
                        })) {
                            const chatContent = await chatItem.getContent(redisClient);
   
                            await conversations.updateOne({ 
                                _id: conversationId, 
                                messages: {
                                    $elemMatch: { 
                                        id: responseMessage.id,
                                    } 
                                } 
                            }, {
                                $set: {
                                    'messages.$.content': chatContent
                                }
                            });

                            emitter.push(encodeEvent(JSON.stringify({ delta: false, messageId: responseMessage.id, content: chatContent })));

                            await chatItem.endOtherStreamWatchers();
                            await chatItem.confirmCompleted(redisClient);
                        }
                    })(),
                    (async () => {
                        const intentDetectionItem = pipeline.getItemByRequestAlias('intentDetection');
                        if (!intentDetectionItem || await intentDetectionItem.isDone(redisClient)) {
                            return;
                        }
    
                        for await (const {} of intentDetectionItem.watchStream({
                            consumerGroupId: 'intentDetection', 
                            consumerId:      requestId, 
                            timeout:         API_TIMEOUT,
                            events:          [PIPELINE_ITEM_EVENT_END]
                        })) {
                            const events : { name: string; description: string }[] = [];

                            let results : { intents: Intent[] };
                            try {
                                results = JSON.parse(await intentDetectionItem.getContent(redisClient));
                            } catch {
                                results = { intents: [] };
                            }

                            const intents = [...processIntentDetectionResults(results)];

                            const revision = conversation.revision || 0;
                            for await (const event of processChatIntents(mongoClient, conversationId, intents, revision, revision + 1)) {
                                events.push(event);
                            }
                        
                            if (events.length) {
                                await conversations.updateOne({ _id: conversationId }, { 
                                    $push: {
                                        events: { 
                                            $each: events.map(({ description }) => ({
                                                after: messages[messages.length - 1].id,
                                                description: `EVENT LOG: ${description}`,
                                                id: uuid()
                                            }))
                                        }
                                    }
                                });
                                emitter.push(encodeEvent(JSON.stringify({ events })));
                            }

                            await intentDetectionItem.endOtherStreamWatchers();
                            await intentDetectionItem.confirmCompleted(redisClient);
                        }
                    })(),
                    (async () => {
                        const endItem = pipeline.getItem(pipeline.getEndId())!;
                        const chatItem = pipeline.getItemByRequestAlias('chat')!;

                        const finalize = async () => {
                            await conversations.updateOne({ 
                                _id: conversationId, 
                                messages: {
                                    $elemMatch: { 
                                        id: responseMessage.id,
                                    } 
                                }  
                            }, { 
                                $set: {
                                    'messages.$.pending': false
                                } 
                            });
                            
                            
                            await endItem.endOtherStreamWatchers();
                            await chatItem.endOtherStreamWatchers();

                            emitter.push(encodeEvent(JSON.stringify({ delta: false, messageId: responseMessage.id, message: await chatItem.getContent(redisClient) })));
                            emitter.push(encodeEvent(JSON.stringify({ done: true })));

                            await pipeline.destroy(redisClient);
                        };

                        for await (const {} of endItem.watchStream({
                            consumerGroupId: 'end',
                            consumerId:      requestId, 
                            timeout:         API_TIMEOUT,
                            events:          [PIPELINE_ITEM_EVENT_END]
                        })) {
                            await finalize();
                        }
                    })()
                ]).finally(async () => {
                    await mongoClient.close();
                });
            });
        } else {
            emitter.push(encodeEvent(JSON.stringify({ done: true })));
            emitter.finish();
        }

        const outStream = Readable.toWeb(Readable.from(emitter)) as ReadableStream<any>;
        const response = new NextResponse(outStream, {
            headers: {
                ...defaultHeaders
            }
        });

        return response;
    }
}

export const { GET } = new Route();
import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { findRelevantInformation, getConversationCollection, processIntentDetectionResults, startIntentDetection } from "../../../conversation";
import { v4 as uuid } from 'uuid';
import { MongoClient } from "mongodb";

import { getLastCompletionId, watchCompletionStream } from "@/ai-queue/queue";
import { processChatIntents } from "@/app/lib/intent/processor";

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
    async GET(_: NextRequest, { params: { conversationId, session, mongoClient, mongoKeepOpen } } : { params: { session: Session, conversationId: string, userMessageId: string, mongoClient: MongoClient, mongoKeepOpen: () => {} } }) {
        const conversations = getConversationCollection(mongoClient);
        const conversation = await conversations.findOne({ '_id': conversationId, userId: session.user.id });
    
        if (!conversation || conversation.locked) {
            return NextResponse.json('Bad Request', { status: 400 });
        }

        await conversations.updateOne({ _id: conversationId }, { $set: { locked: true } });
        const { messages, purpose } = conversation;

        const emitter = new SSEEmitter<Uint8Array>();
        const responseMessage = messages[messages.length - 1];

        if (!(responseMessage.chatPending || responseMessage.intentDetectionPending)) {
            return NextResponse.json('Bad Request', { status: 400 });
        }

        const relevantInfo = await findRelevantInformation(conversationId, purpose.type, purpose.context);

        emitter.process(async () => {
            await Promise.all([
                (async () => {
                    if (!responseMessage.chatPending) return;

                    for await (const streamItem of watchCompletionStream(uuid(), conversationId, responseMessage.lastSeenMessageId, API_TIMEOUT)) {
                        if (streamItem.timeout) break;
                        if (!streamItem.message) continue;

                        if (streamItem.message.label === 'chat') {
                            emitter.push(encodeEvent(JSON.stringify({ delta: true, messageId: responseMessage.id, message: streamItem.message.content })));
                            if (streamItem.done) {
                                break;
                            }
                        }
                    }
                })(),
                (async () => {
                    let messageContent = responseMessage.content;
                    let chatPending = responseMessage.chatPending;
                    let intentDetectionPending = responseMessage.intentDetectionPending;

                    for await (const streamItem of watchCompletionStream(`${responseMessage.id}-chats`, conversationId, responseMessage.lastSeenMessageId, API_TIMEOUT)) {
                        if (streamItem.timeout) break;
                        if (!streamItem.message) continue;
                        const events : { name: string; description: string }[] = [];

                        if (streamItem.message.label === 'chat') {
                            messageContent += streamItem.message.content;
                            chatPending = !streamItem.done;
                        } else if (streamItem.message.label === 'splitSentences') {
                            startIntentDetection(conversationId, messages, streamItem.message.content, relevantInfo);
                        } else if (streamItem.message.label === 'intentDetection') {
                            intentDetectionPending = false;

                            for await (const intent of processIntentDetectionResults(JSON.parse(streamItem.message.content))) {
                                events.push(...await processChatIntents(mongoClient, conversationId, intent));
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
                            }

                            emitter.push(encodeEvent(JSON.stringify({ events })));

                            await conversations.updateOne({ 
                                _id: conversationId, 
                                messages: {
                                    $elemMatch: { 
                                        id: responseMessage.id,
                                    } 
                                } 
                            }, {
                                $set: {
                                    'messages.$.intentDetectionPending': false,
                                    'messages.$.lastSeenMessageId':      await getLastCompletionId()
                                }
                            });
                        }

                        if (!(chatPending || intentDetectionPending)) {
                            break;
                        }
                    }

                    await conversations.updateOne({ 
                        _id: conversationId, 
                        messages: {
                            $elemMatch: { 
                                id: responseMessage.id,
                            } 
                        } 
                    }, {
                        $set: {
                            'messages.$.content':                messageContent,
                            'messages.$.chatPending':            chatPending,
                            'messages.$.lastSeenMessageId':      await getLastCompletionId()
                        }
                    });
                })(),
            ]).then(async () => {
                const conversation = await conversations.findOne({ _id: conversationId });
                if (!conversation) return;
                const lastMessage = conversation.messages[conversation.messages.length - 1];
                if (!(lastMessage.chatPending || lastMessage.intentDetectionPending)) {
                    emitter.push(encodeEvent(JSON.stringify({ done: true })));
                }
            }).catch(async e => {
                console.error(e);
                emitter.push(encodeEvent(JSON.stringify({ done: true, error: e.toString() })));
            }).finally(async () => {
                await conversations.updateOne({ _id: conversationId }, { $set: { locked: false } });
                await mongoClient.close();
            });
        });

        const outStream = Readable.toWeb(Readable.from(emitter)) as ReadableStream<any>;

        mongoKeepOpen();

        return new NextResponse(outStream, {
            headers: {
                ...defaultHeaders
            }
        });
    }
}

export const { GET } = new Route();
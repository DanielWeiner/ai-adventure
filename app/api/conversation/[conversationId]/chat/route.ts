import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { findRelevantInformation, getConversationCollection, processIntentDetectionResults, startIntentDetection } from "../../../conversation";
import { v4 as uuid } from 'uuid';
import { MongoClient } from "mongodb";

import { watchCompletionStream } from "@/ai-queue/queue";
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
    
        if (!conversation) {
            return NextResponse.json('Bad Request', { status: 400 });
        }

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

                    for await (const streamItem of watchCompletionStream({
                        consumerGroupId:   uuid(),
                        messageGroupId:    conversationId,
                        lastSeenMessageId: responseMessage.lastSeenChatId,
                        timeout:           API_TIMEOUT,
                        until:             streamItem => streamItem.message?.label === 'chat' && streamItem.done
                    })) {
                        if (!streamItem.message) continue;

                        if (streamItem.message.label === 'chat') {
                            emitter.push(encodeEvent(JSON.stringify({ delta: true, messageId: responseMessage.id, message: streamItem.message.content })));
                        }
                    }
                })(),
                (async () => {
                    if (!responseMessage.splitSentencesPending) return;
                    
                    let splitSentencesDone = false;

                    for await (const streamItem of watchCompletionStream({
                        consumerGroupId:   `${responseMessage.id}-splitSentences`,
                        messageGroupId:    conversationId,
                        lastSeenMessageId: responseMessage.lastSeenIntentDetectionId,
                        timeout:           API_TIMEOUT,
                        until:             () => splitSentencesDone
                    })) {
                        if (!streamItem.message || !streamItem.id) continue;

                        if (streamItem.message.label === 'splitSentences') {
                            splitSentencesDone = true;
                            startIntentDetection(conversationId, messages, streamItem.message.content, relevantInfo);

                            await conversations.updateOne({ 
                                _id: conversationId, 
                                messages: {
                                    $elemMatch: { 
                                        id: responseMessage.id,
                                    } 
                                } 
                            }, {
                                $set: {
                                    'messages.$.splitSentencesPending':     false,
                                    'messages.$.lastSeenIntentDetectionId': streamItem.id
                                }
                            });
                        }
                    }
                })(),
                (async () => {
                    if (!responseMessage.intentDetectionPending) return;
                    let intentDetectionPending = true;

                    const events : { name: string; description: string }[] = [];

                    for await (const streamItem of watchCompletionStream({
                        consumerGroupId:   `${responseMessage.id}-intentDetection`,
                        messageGroupId:    conversationId,
                        lastSeenMessageId: responseMessage.lastSeenIntentDetectionId,
                        timeout:           API_TIMEOUT,
                        until:             () => !intentDetectionPending
                    })) {
                        if (!streamItem.message || !streamItem.id) continue;
                        if (streamItem.message.label === 'intentDetection') {                            
                            intentDetectionPending = false;

                            await conversations.updateOne({ 
                                _id: conversationId, 
                                messages: {
                                    $elemMatch: { 
                                        id: responseMessage.id,
                                    } 
                                } 
                            }, {
                                $set: {
                                    'messages.$.intentDetectionPending':    intentDetectionPending,
                                    'messages.$.lastSeenIntentDetectionId': streamItem.id
                                }
                            });

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
                        }
                    }
                })(),
                (async () => {
                    let messageContent = responseMessage.content;
                    let chatPending = responseMessage.chatPending;
                    if (!chatPending) return;
                    let lastChatId = responseMessage.lastSeenChatId;

                    for await (const streamItem of watchCompletionStream({
                        consumerGroupId:   `${responseMessage.id}-chats`,
                        messageGroupId:    conversationId,
                        lastSeenMessageId: responseMessage.lastSeenChatId,
                        timeout: API_TIMEOUT,
                        until: () => !chatPending
                    })) {
                        if (!streamItem.message || !streamItem.id) continue;

                        if (streamItem.message.label === 'chat') {
                            messageContent += streamItem.message.content;
                            chatPending = !streamItem.done;
                            lastChatId = streamItem.id;
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
                            'messages.$.content':        messageContent,
                            'messages.$.chatPending':    chatPending,
                            'messages.$.lastSeenChatId': lastChatId
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
                await mongoClient.close();
            });
        });

        const outStream = Readable.toWeb(Readable.from(emitter)) as ReadableStream<any>;
        const response = new NextResponse(outStream, {
            headers: {
                ...defaultHeaders
            }
        });
        
        mongoKeepOpen();

        return response;
    }
}

export const { GET } = new Route();
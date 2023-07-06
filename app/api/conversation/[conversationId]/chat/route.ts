import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { IncomingMessage } from "http";
import { NextRequest, NextResponse } from "next/server";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Readable } from "stream";
import { ConversationContext, ConversationPurposeType, getConversationCollection, Message } from "../../../conversation";
import { AxiosResponse } from "axios";
import { NounType, getConversationNoun } from "@/app/api/noun";
import { MongoClient } from "mongodb";
import { v4 as uuid } from 'uuid';
import { processChatIntents } from "@/app/lib/intent/processor";
import { generateIntentsSchema } from "@/app/lib/intent/schema";
import { Intent } from "@/app/lib/intent";
import { assistantPrompt, systemPrompt, userPrompt } from "@/app/lib/chatPrompt";

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

const contextDescriptions = {
    class: 'character class',
    character: 'character',
    location: 'location in a universe',
    world: 'world or universe or setting in which a narrative takes place',
    species: 'species or race',
    faction: 'faction or organization or government'
};

type ContextPrompts = {
    [ConversationType in ConversationPurposeType]: (context: string, firstTime: boolean) => string
};

type RelevantInformation = {
    type: string;
    name: string; 
    defaultName: string;
    properties: { 
        [key in string]: string;
    }; 
    traits: string[];
}

const systemPrompts : ContextPrompts = {
    create: (context: string, firstTime: boolean) => [
        `You are a helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.`,
        ...firstTime ? [
            `You must start the conversation with "Hi! Let's create a ${context} together."`,
            `Your first and only prompt is for the name of the ${context}, adding some helpful pointers on creating a good name.`,
        ] : [
            `Always refrain from enumerating the properties and traits of the ${context} as a list unless specifically asked. ` +
            'Unless prompted, limit the number suggestions or questions to at most three or four. ' + 
            'The user should be able to provide small, focused answers to your prompts, so don\'t overwhelm the user with questions or suggestions. ' +
            `Your prompt should always elicit more information from the user unless they're satisfied with the ${context} as a whole and have nothing more to add. ` +
            `Keep the questions focused on the ${context}, but leave room for the user to explore aspects of the ${context} that you haven\'t asked about.`
        ],
    ].join(' '),
    adventure: () => ''
};

function listRelevantInformation({ name, defaultName, properties, traits } : RelevantInformation) {
    return [
        `\nname: ${name || 'unknown' }`,
        ...[...Object.entries(properties)].map(([key, val]) => `${key}: ${val}`).join('\n'),
        ...traits.map((val) => `- ${val}`).join('\n')
    ].join('\n').trim();
}

async function findRelevantInformation<T extends ConversationPurposeType>(conversationId: string, conversationType: T, context: ConversationContext[T]) : Promise<RelevantInformation> {
    if (conversationType === 'adventure') {
        return { name: '', properties: {}, traits: [], defaultName: '', type: '' };
    }
    const noun = await getConversationNoun(conversationId);

    if (!noun) {
        return { name: '', properties: {}, traits: [], defaultName: '', type: '' };
    }

    return {
        defaultName: `The ${context} being created`,
        type: context,
        name: noun.name,
        traits: noun.traits || [],
        properties: noun.properties || {}
    };
}

async function* detectIntents(
    openai: OpenAIApi,
    messages: ChatCompletionRequestMessage[], 
    relevantInfo: RelevantInformation
) : AsyncGenerator<Intent> {
    if (messages.length < 2) {
        return;
    }

    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;
    const relevantInfoStr = listRelevantInformation(relevantInfo);
    const splitToken = 'SECOND STAGE';
    const splitInformationPrompt = 
        systemPrompt`            
            First, you will enter information mode. You will enumerate the current information about a ${relevantInfo.type}. Then you will enter chat mode. You will produce a worldbuilding prompt in chat mode. The user will respond to that in chat mode. Then you will exit chat mode and enter sentence breakdown mode.

            You will then follow these instructions:
            
            Output "FIRST STAGE".
            - Summarize the user's response as short, simple sentences on individual lines.
            - If the user provided no new information about the ${relevantInfo.type}, just output NONE.
            - Each sentence must contain one piece of information.
            - Compound information must be split into multiple sentences.
            - References to the assistant prompt should be written as sentences containing that information.
            - Ignore requests for suggestions.
            - Sentences should only be about the ${relevantInfo.type} itself.
            - Do not add novel information that hasn't been added by the user.
            - Do not leave out any information mentioned by the user.


            Then, output "${splitToken}".
            - Process each sentence from the FIRST STAGE further a second time to split them into even smaller pieces of information.
            - Output those smaller sentences.
            - Merge the sentences together to verify that they match the first stage.
        `;

    console.log(splitInformationPrompt.content);

    const splitInformationResult = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            splitInformationPrompt,
            assistantPrompt`Entering information mode. The following is the current ${relevantInfo.type} information.`,
            assistantPrompt`${relevantInfoStr}`,
            assistantPrompt`Exiting information mode. Entering chat mode.`, 
            assistantPrompt`${lastAssistantPrompt}`,
            userPrompt`${lastUserPrompt}`,
            assistantPrompt`Exiting chat mode. Entering sentence breakdown mode.`
        ]
    });

    const infoStatements = (splitInformationResult.data.choices[0].message?.content?.trim() ?? '');

    const brokenDownStatements = infoStatements.includes(splitToken) ? 
        infoStatements.slice(infoStatements.indexOf(splitToken) + splitToken.length).trim()
        : infoStatements;

    console.log(infoStatements);
    
    const result = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0.5,
        messages: [
            systemPrompt`
                You are an intent classifier. 
                Do not generate redundant intents. 
                Do not leave out any user-provided information. 
                Only use the information provided by the user.
                The intent content must closely match the information provided by the user.

                Current up-to-date information about the ${relevantInfo.type}:
                ${relevantInfoStr}
            `,
            userPrompt`${brokenDownStatements}`
        ],
        function_call: {
            name: 'generateIntents'
        },
        functions: [
            generateIntentsSchema(relevantInfo.type)
        ]
    });

    try {
        console.log(result.data.choices[0].message?.function_call);
        if (result.data.choices[0].message?.function_call?.name !== 'generateIntents') {
            return;
        }

        const intentsObj = result.data.choices[0].message?.function_call?.arguments || '{}';
        console.log(intentsObj);
        const { intents } = JSON.parse(intentsObj) as { intents: Intent[] };
        if (!Array.isArray(intents)) {
            return;
        }
        for (const intent of intents) {
            yield intent;
        }
    } catch {
        return;
    }
}


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

        await conversations.updateOne({ _id: conversationId },  { $set: { locked: true } });
    
        const { messages, purpose } = conversation;
    
        const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
        const openai = new OpenAIApi(configuration);

        const openaiMessages = messages.map(({ role, content }) => ({ role, content }));
    
        const relevantInfo = await findRelevantInformation(conversationId, purpose.type, purpose.context);
        const relevantInfoString = listRelevantInformation(relevantInfo);

        const emitter = new SSEEmitter<Uint8Array>();
        
        emitter.process(async () => {
            await Promise.all([
                (async () => {
                    const intents = detectIntents(openai, [ ...openaiMessages ], relevantInfo);
                    const events : { name: string; description: string }[] = [];
    
                    for await (const intent of intents) {
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
                })(),
                (async () => {
                    const { data: stream } = await openai.createChatCompletion({
                        model: "gpt-3.5-turbo",
                        temperature: 0,
                        stream: true,
                        messages: [
                            systemPrompt`
                                ${systemPrompts[purpose.type](purpose.context, openaiMessages.length === 0)}
                                ${openaiMessages.length > 0 ? `
                                    Current known information about the ${purpose.context}:
                                    ${relevantInfoString}
                                    Do not echo this to the user.
                                ` : ''}
                            `,
                            ...openaiMessages.slice(-16),
                        ]
                    }, { responseType: 'stream' }) as any as AxiosResponse<IncomingMessage>;
    
                    const newMessage : Message = { role: 'assistant', content: '', id: uuid() };

                    emitter.push(encodeEvent(JSON.stringify({ newMessage: true, messageId: newMessage.id, after: (messages[messages.length - 1] || {}).id || null })));

                    let cachedChunk = '';
                    for await (const chunk of stream) {
                        const chunkStr = cachedChunk + new TextDecoder().decode(chunk);
                        if (!chunkStr.match(/^(data: .*\n\n)+$/)) {
                            cachedChunk = chunkStr;
                            continue;
                        }
                        
                        cachedChunk = '';
                        const events = chunkStr.match(/data: .*\n\n/g)?.map(str => str.slice(6, -2)) || [];
    
                        for (const event of events) {
                            if (!event) continue;
    
                            if (event === '[DONE]') {
                                await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
                                break;
                            }
    
                            const data = JSON.parse(event);
                            const delta = data.choices[0].delta.content || '';
                            emitter.push(encodeEvent(JSON.stringify({ delta: true, messageId: newMessage.id, message: delta })));
                            newMessage.content += delta;
                        }
                    }
                })()
            ]).then(() => {
                emitter.push(encodeEvent(JSON.stringify({ done: true })));
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
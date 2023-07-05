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
import { systemPrompt, userPrompt } from "@/app/lib/chatPrompt";

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

function listRelevantInformation({ name, type, defaultName, properties, traits } : RelevantInformation) {
    return [
        `\nName of the ${type}: ${name || 'unknown' }`,
        ...Object.keys(properties).length ? [[
            `\nProperties of ${name || defaultName}:`,
            ...[...Object.entries(properties)].map(([key, val]) => `${key}: ${val}`),
        ].join('\n') ] : [],
        ...traits.length ? [[
            `\nAdditional traits for ${name || defaultName}:`,
            ...traits.map((val, i) => `${i}. ${val}`)
        ].join('\n') ] : []
    ].join('\n').trim() + '\n';
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
            You will analyze a user prompt regarding a ${relevantInfo.type}, split the information up, output multiple statements about it, then further break down those statements.
            
            Here's the existing information about the ${relevantInfo.type} prior to the prompt. Do not generate results from it.
            [START ${relevantInfo.type.toUpperCase()} INFO]
            ${relevantInfoStr}
            [END ${relevantInfo.type.toUpperCase()} INFO]
        
            Here's the most recent assistant prompt regarding the ${relevantInfo.type}. Do not generate results from it. 
            [START ASSISTANT PROMPT]
            ${lastAssistantPrompt}
            [END ASSISTANT PROMPT]

            Here's the user's response to the assistant regarding the ${relevantInfo.type}:
            [START USER RESPONSE]
            ${lastUserPrompt}
            [END USER RESPONSE] 

            First, write the words "FIRST STAGE".

            Next, write short but descriptive sentences for all of the information about the ${relevantInfo.type} provided by the user's response to the assistant, following these rules:

            Formatting and structure:
            - Each sentence must only contain one piece of information.
            - Write multiple sentences for compound information.
            - If no new information about the ${relevantInfo.type} was provided, output the word NONE and nothing before or after. This is very important.
            - Make the ${relevantInfo.type} the subject of each sentence, if possible.
            - Each sentence must be written on a new line.
            - Do not embellish the sentences.
            - Keep the sentences as simple as possible.
            - Each sentence must make sense on its own, without any external context or reference to other sentences.

            Conditions for output:
            - Only include information that is new.
            - A request for suggestions does not count as new information about the ${relevantInfo.type}.
            - Any information referenced indirectly by the user should be written explicitly in the output.
            - If the user approves of assistant suggestions, consider it as if those suggestions were said by the user verbatim.

            Avoiding bad output:
            - Only mention new information about the ${relevantInfo.type}.
            - Do not mention any information about the prompt itself, the user, or the user's sentiment.
            - Do not mention any information that hasn't been mentioned by the user.
            - Do not mention any uncertain information.
            - Do not omit any information about the ${relevantInfo.type} that has been provided by the user.
            - Do not provide your own suggestions.

            When you are done creating sentences, write ${splitToken} on a new line.

            Finally, on a new line, split the results of the FIRST STAGE further into even smaller pieces of information, paying special attention to compound information. Do not produce redundant information. Combine the results of the ${splitToken} back into the FIRST STAGE results to ensure they match.
        `;

    console.log(splitInformationPrompt.content);

    const splitInformationResult = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            splitInformationPrompt
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
import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { IncomingMessage } from "http";
import { NextRequest, NextResponse } from "next/server";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Readable } from "stream";
import { ConversationContext, ConversationPurposeType, getConversationCollection, Message } from "../../../conversation";
import { AxiosResponse } from "axios";
import { NounType, getConversationNoun, getNounCollection } from "@/app/api/noun";
import { MongoClient } from "mongodb";

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
    [ConversationType in ConversationPurposeType]: (context: string) => string
};

type RelevantInformation = {
    type: string;
    name: string; 
    defaultName: string;
    attributesMap: { 
        [key in string]: string;
    }; 
    attributes: string[];
}

type UserIntents = {
    [ConversationType in ConversationPurposeType]: {
        [Intent in string]: (context: string) => ({
            description: string,
            data: string[]
        })
    }
}

const intents : UserIntents = {
    create: {
        setName: context => ({
            description: `the name of the ${context} is provided`,
            data: [`the name of the ${context}`]
        }),
        addAttributes: context => ({
            description: `new unnamed information is provided about the ${context}`,
            data: [`the new information as short but descriptive, unlabeled attributes, without grammar or punctuation. Each attribute must make sense on its own without context from other attributes`]
        }),
        removeAttributes: context => ({
            description: `an attribute was requested to be removed from the ${context}'s additional attributes`,
            data: [`zero-indexed indices as strings, for each of the existing attribute to be deleted`]
        }),
    },
    adventure:{}
}

const systemPrompts : ContextPrompts = {
    create: (context: string) => [
        `You are helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.`,
        `Your first chat response starts with "Hi! Let's create a ${context} together."`,
        `Your first priority is to ensure that the ${context} has a name.`,
        `After that, you may continue to assist in creating the ${context}.`,
        `Always refrain from enumerating the attributes of the ${context} as a list unless specifically prompted.`
    ].join(' '),
    adventure: () => ''
};

function calculateIntentList<T extends ConversationPurposeType>(conversationType: T, context: ConversationContext[T]) {
    return [...Object.entries(intents[conversationType])].map(([intentName, intentFn], i) => {
        const { data, description } = intentFn(context);        
        const suffix = data.map((str, i) => (i == 0 ? ' ' : '') + (i === data.length - 1 ? `and ${str}` : str)).join(', ');
        return `${i + 1}. If ${description}, output on a new line a JSON array containing only the string "${intentName}"${suffix}.`
    }).concat([
        `${Object.keys(intents[conversationType]).length + 1}. If no intent can be inferred, or if it was just a request for suggestions, simply output ["none"].`
    ]).join('\n')
}

function listRelevantInformation({ name, type, defaultName, attributesMap, attributes } : RelevantInformation) {
    return [
        `Name of the ${type}: ${name || 'unknown' }`,
        ...Object.keys(attributesMap).length ? [[
            `Named attributes for ${name || defaultName}:`,
            ...[...Object.entries(attributesMap)].map(([key, val]) => `${key}: ${val}`),
        ].join('\n') + '\n'] : [],
        ...attributes.length ? [[
            `Additional attributes for ${name || defaultName}:`,
            ...attributes.map((val, i) => `${i + 1}. ${val}`)
        ].join('\n') + '\n'] : []
    ].join('\n').trim()
}

async function findRelevantInformation<T extends ConversationPurposeType>(conversationId: string, conversationType: T, context: ConversationContext[T]) : Promise<RelevantInformation> {
    if (conversationType === 'adventure') {
        return { name: '', attributesMap: {}, attributes: [], defaultName: '', type: '' };
    }
    const noun = await getConversationNoun(conversationId);

    if (!noun) {
        return { name: '', attributesMap: {}, attributes: [], defaultName: '', type: '' };
    }

    return {
        defaultName: `The ${context} being created`,
        type: context,
        name: noun.name,
        attributes: noun.attributes || [],
        attributesMap: noun.namedAttributes || {}
    };
}

async function* detectIntents<T extends ConversationPurposeType>(
    openai: OpenAIApi, 
    conversationType: T, 
    context: ConversationContext[T], 
    messages: ChatCompletionRequestMessage[], 
    relevantInfo: RelevantInformation
) : AsyncGenerator<string[]> {
    if (messages.length < 2) {
        yield ['none'];
        return;
    }

    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const fullChatLog = chatMessages.slice(-4).map(({ content, role }) => (`${role.toUpperCase()}: ${content}`)).join('\n');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;
    const relevantInfoStr = listRelevantInformation(relevantInfo);
    const splitInformationPrompt = 
        `\n\nHere\'s the most recent up-to-date information about the ${relevantInfo.type}:` +
        '\n[START RELEVANT INFO]\n' +
        relevantInfoStr +
        '\n[END RELEVANT INFO]\n' +
    
        `\nHere\'s the most recent assistant prompt. Do not generate results from it.` +
        '\n[START ASSISTANT PROMPT]\n' +
        lastAssistantPrompt +
        '\n[END ASSISTANT PROMPT]\n' +

        '\nHere\'s the user response. ' +
        'Write short but descriptive sentences for all of the information provided by the user response. ' + 
        'Each sentence must only contain one piece of information. ' +
        'Enumerate all information referenced by the user explicitly as part of the output. ' + 
        'Write multiple sentences for compound information.' +
        '\n[START USER RESPONSE]\n' +
        lastUserPrompt +
        '\n[END USER RESPONSE]';

    console.log(splitInformationPrompt);

    const splitInformationResult = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'user',
                content: splitInformationPrompt
            }
        ]
    });

    const infoStatements = (splitInformationResult.data.choices[0].message?.content?.trim() ?? '');
    console.log(infoStatements);

    const messageContent = 'You are an intent classifier. ' + 
        'You analyze statements about a user\'s last message for intents. ' +
        'Each statement may have multiple intents. ' + 
        'Each intent is output a separate line. ' + 
        'Each intent must be a valid JSON array of strings with nothing before or after. ' +
        'Do add any information that hasn\t been speficied. ' +
        'The format is extremely important.' +

        '\nThe following are the possible intents:\n' +
        calculateIntentList(conversationType, context) +
        '\n' +
        '\nDo not remove any information unless specifically requested. ' +
        '\nDo not add any information that hasn\'t been explicitly specified. ' +
        '\n' +

        '\nGiven the following previous chat log:' + 
        '\n[START CHAT LOG]\n' + 
        fullChatLog +
        '\n[END CHAT LOG]\n' +
        
        '\nAnd the following relevant, up-to-date information:' + 
        '\n[START RELEVANT INFORMATION]\n' + 
        relevantInfoStr +
        '\n[END RELEVANT INFORMATION]\n' +

        '\nAnalyze the intents for the following statements that describe the user\'s last message:' + 
        '\n[START STATEMENTS]\n' +
        infoStatements +
        '\n[END STATEMENTS]';

    console.log(messageContent);
    
    const result = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'user',
                content: messageContent
            }
        ]
    });
    
    const intentText = result.data.choices[0].message?.content?.trim() || '';
    const intents = (intentText || '["none"]').split(/[\r\n]+/g);
    for (const intent of intents) {
        console.log(intent);
        try {
            yield JSON.parse(intent);
        } catch (e) {
            yield [ "none" ];
        }
    }
}

async function processChatIntents(mongoClient: MongoClient, conversationId: string, intentName: string, ...intentData: string[]) {
    if (intentName === 'setName') {
        return setName(mongoClient, conversationId, intentData[0]);
    }

    if (intentName === 'addAttributes') {
        return addAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'removeAttributes') {
        return removeAttributes(mongoClient, conversationId, intentData);
    }

    return [];
}

async function setName(mongoClient: MongoClient, conversationId: string, name: string) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $set: { name } });

    return [{
        name: 'noun.update',
        description: `Set name to ${JSON.stringify(name)}.`
    }];
}

async function addAttributes(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $addToSet: { attributes: { $each: attributes } } });

    return [{
        name: 'noun.update',
        description: `Added [${attributes.map(attr => JSON.stringify(attr)).join(',')}].`
    }];
}

async function removeAttributes(mongoClient: MongoClient, conversationId: string, indices: string[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const attrs = indices.reduce((attrs, index) => {
        return {
            ...attrs,
            [`attributes.${index}`]: 1
        }
    }, {});

    await nouns.updateOne({ conversationId }, { $unset: { ...attrs } });
    await nouns.updateOne({ conversationId }, { $pull: { attributes: null as any } });

    return [ 
        {
            name: 'noun.update',
            description: `Removed [${indices.map(index => JSON.stringify(noun.attributes[+index])).join(',')}].`
        } 
    ];
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
    
        if (!conversation) {
            return NextResponse.json('Bad Request', { status: 400 });
        }
    
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
                    const intents = detectIntents(openai, purpose.type, purpose.context, [ ...openaiMessages ], relevantInfo);
                    const events : { name: string; description: string }[] = [];
    
                    for await (const intent of intents) {
                        events.push(...await processChatIntents(mongoClient, conversationId, ...intent as [string]));
                    }
    
                    if (events.length) {
                        await conversations.updateOne({ _id: conversationId }, { 
                            $push: { 
                                messages: { 
                                    $each: events.map(({ description }) => ({
                                        content: description,
                                        role: 'system'
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
                            { role: 'system', content: systemPrompts[purpose.type](purpose.context) },
                            ...openaiMessages.slice(-16),
                            ...relevantInfoString ? [
                                { role: 'system', content: relevantInfoString } as const
                            ] : []
                        ]
                    }, { responseType: 'stream' }) as any as AxiosResponse<IncomingMessage>;
    
                    const newMessage = { role: 'assistant', content: '' } as Message;
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
    
                            emitter.push(encodeEvent(event));
                            
                            const data = JSON.parse(event);
                            newMessage.content += data.choices[0].delta.content || '';
                        }
                    }
                })()
            ]);
            await mongoClient.close();
            emitter.push(encodeEvent(JSON.stringify({ done: true })));
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
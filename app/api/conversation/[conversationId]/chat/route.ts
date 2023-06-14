import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { IncomingMessage } from "http";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Readable } from "stream";
import { ConversationContext, ConversationPurposeType, getConversationCollection, Message } from "../../../conversation";
import { AxiosResponse } from "axios";
import { NounType, getNounCollection } from "@/app/api/noun";
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
    faction: 'faction or government'
};

type ContextPrompts = {
    [ConversationType in ConversationPurposeType]: (context: string) => string
};

type RelevantInfoPrompts = {
    [ConversationType in ConversationPurposeType]: (context: string) => string
};

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
            description: `the user intended to set the name of the ${context}`,
            data: [`the name of the ${context}`]
        }),
        addAttribute: context => ({
            description: `the user intented to add some additional information about the ${context}`,
            data: [`six-word-maximum summaries for each of the ${context}'s additional attributes`]
        })
    },
    adventure:{}
}

const systemPrompts : ContextPrompts = {
    create: (context: string) => [
        `You are helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.`,
        `Your first chat response starts with "Hi! Let's create a ${context} together."`,
        `Your first priority is to ensure that the ${context} has a name.`,
        `After that, you may continue to assist in creating the ${context}.`
    ].join(' '),
    adventure: () => ''
};


function calculateIntentList<T extends ConversationPurposeType>(conversationType: T, context: ConversationContext[T]) {
    return [...Object.entries(intents[conversationType])].map(([intentName, intentFn]) => {
        const { data, description } = intentFn(context);        
        const suffix = data.map((str, i) => (i == 0 ? ' ' : '') + (i === data.length - 1 ? `and ${str}` : str)).join(', ');
        return `If ${description}, output a JSON string array containing only the string "${intentName}"${suffix}.`
    }).join('\n')
}

async function detectIntent<T extends ConversationPurposeType>(openai: OpenAIApi, conversationType: T, context: ConversationContext[T], messages: ChatCompletionRequestMessage[]) : Promise<string[]> {
    if (messages.length < 2) {
        return ['none'];
    }
    
    const chatLog = messages.slice(0, -2).map(({ content, role }) => (`${role.toUpperCase()}: ${content}`));
    const lastChatLog = messages.slice(-2).map(({ content, role }) => (`${role.toUpperCase()}: ${content}`));
    
    const messageContent = 'You are an intent classifier.' +
        'You output the intent of the user\'s most recent message after analyzing a chat log. ' + 
        'The output must only be JSON, with nothing before or after it. ' +

        '\n\n'+
        'The following are the possible intents:\n' +
        calculateIntentList(conversationType, context) +
        '\n' +
        'If the user\'s most recent message has no known intent, simply output ["none"]. ' +
        '\n\n' +

        'Given the following chat history:' +
        '\n\n[START CHAT HISTORY]\n' + 
        chatLog.join('\n\n') +
        '\n[END CHAT HISTORY]\n\n'  + 

        'Analyze the user\'s intent after the following interaction: ' + 
        '\n\n[START INTERACTION]\n' +
        lastChatLog +
        '\n[END INTERACTION]\n\n' +
        
        'Intent of the user\'s last message: ';
    
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
    
    const intent = result.data.choices[0].message?.content?.trim() ?? '["none"]';
    try {
        return JSON.parse(intent);
    } catch (e) {
        return [ "none" ];
    }
}

async function processChatIntents(mongoClient: MongoClient, conversationId: string, intentName: string, ...intentData: string[]) {
    if (intentName === 'setName') {
        return setName(mongoClient, conversationId, intentData[0]);
    }

    if (intentName === 'addAttribute') {
        return addAttributes(mongoClient, conversationId, intentData);
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

    return ['noun.update'];
}

async function addAttributes(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $addToSet: { attributes: { $each: attributes } } });

    return ['noun.update'];
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
    
        const intent = await detectIntent(openai, purpose.type, purpose.context, openaiMessages);
        const events = await processChatIntents(mongoClient, conversationId, ...intent as [string]);
    
        const { data: stream } = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            temperature: 0,
            stream: true,
            messages: [
                { role: 'system', content: systemPrompts[purpose.type](purpose.context) },
                ...openaiMessages
            ]
        }, { responseType: 'stream' }) as any as AxiosResponse<IncomingMessage>;
    
        const newMessage = { role: 'assistant', content: '', deleted: false } as Message;
        
        async function* mergedStream() {
            yield new TextEncoder().encode(`data: ${JSON.stringify({ events })}\n\n`);
    
            for await (const chunk of stream) {
                yield new Uint8Array(chunk);
                const eventStr = new TextDecoder().decode(chunk).trim();
    
                if (!eventStr.startsWith('data: ')) continue;
    
                const chunkStr = eventStr.slice('data: '.length).trim();
    
                for (const chunkSubStr of chunkStr.split('\n\ndata: ')) {
                    if (!chunkSubStr) continue;
                    if (chunkSubStr === '[DONE]') {
                        await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
    
                        revalidateTag(`conversation_${session.token}_${conversationId}`);
                        continue;
                    }
                    
                    const data = JSON.parse(chunkSubStr);
                    newMessage.content += data.choices[0].delta.content || '';
                }
            }
            
            await mongoClient.close();
        }
    
        const outStream = Readable.toWeb(Readable.from(mergedStream())) as ReadableStream<any>;
    
        mongoKeepOpen();

        return new NextResponse(outStream, {
            headers: {
                ...defaultHeaders
            }
        });
    }
}

export const { GET } = new Route();
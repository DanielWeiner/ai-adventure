import { getMongoDatabase } from "@/app/mongo";
import { Collection, MongoClient } from "mongodb";
import { ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum, OpenAIApi } from "openai";
import { apiUrl } from "./api";
import { cookies } from "next/headers";
import { NounType, getConversationNoun } from "./noun";
import { getLastCompletionId, sendCompletionRequest } from "@/ai-queue/queue";
import { systemPrompt, assistantPrompt, userPrompt } from "../lib/chatPrompt";
import { v4 as uuid } from 'uuid';
import { Intent } from "../lib/intent";
import { generateIntentsSchema } from "../lib/intent/schema";

export interface Message {
    id:                        string;
    content:                   string;
    role:                      ChatCompletionRequestMessageRoleEnum;
    chatPending:               boolean;
    splitSentencesPending:     boolean;
    intentDetectionPending:    boolean;
    lastSeenChatId:            string;
    lastSeenIntentDetectionId: string;
}

export type ConversationPurposeType = 'create' | 'adventure';

export interface ConversationContext {
    create: NounType;
    adventure: 'adventure';
}

export type ConversationPurpose = {
    [key in keyof ConversationContext]: {
        type: key;
        context: ConversationContext[key];
    }
}[ConversationPurposeType];

export interface Conversation {
    _id: string;
    userId: string;
    messages: Message[];
    purpose: ConversationPurpose;
    locked: boolean;
    events: {
        after: string;
        description: string;
        id: string;
    }[];
}

const splitSentencePrefix = 'SECOND STAGE';

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

export async function findRelevantInformation<T extends ConversationPurposeType>(conversationId: string, conversationType: T, context: ConversationContext[T]) : Promise<RelevantInformation> {
    if (conversationType === 'adventure') {
        return { name: '', properties: {}, traits: [], type: '' };
    }
    const noun = await getConversationNoun(conversationId);

    if (!noun) {
        return { name: '', properties: {}, traits: [], type: '' };
    }

    return {
        type: context,
        name: noun.name,
        traits: noun.traits || [],
        properties: noun.properties || {}
    };
}

type RelevantInformation = {
    type: string;
    name: string; 
    properties: { 
        [key in string]: string;
    }; 
    traits: string[];
}

export function listRelevantInformation({ name, properties, traits } : RelevantInformation) {
    return [
        `name: ${name || 'unknown' }`,
        ...[...Object.entries(properties)].map(([key, val]) => `${key}: ${val}`),
        ...traits.map((val) => `- ${val}`)
    ].join('\n').trim();
}

export function startSentenceSplitting(messages: ChatCompletionRequestMessage[], relevantInfo: RelevantInformation, messageGroupId: string) {
    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;
    const relevantInfoStr = listRelevantInformation(relevantInfo);

    return sendCompletionRequest({
        messageGroupId,
        kind: 'message',
        label: 'splitSentences',
        systemMessage: `            
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

            Then, output "${splitSentencePrefix}".
            - Process each sentence from the FIRST STAGE further a second time to split them into even smaller pieces of information.
            - Output those smaller sentences.
            - Merge the sentences together to verify that they match the first stage.
        `,
        messages: [
            assistantPrompt`Entering information mode. The following is the current ${relevantInfo.type} information.`,
            assistantPrompt`${relevantInfoStr}`,
            assistantPrompt`Exiting information mode. Entering chat mode.`, 
            assistantPrompt`${lastAssistantPrompt}`,
            userPrompt`${lastUserPrompt}`,
            assistantPrompt`Exiting chat mode. Entering sentence breakdown mode.`
        ]
    });
}

export function getConversationCollection(mongoClient: MongoClient) : Collection<Conversation> {
    return getMongoDatabase(mongoClient).collection<Conversation>('conversations');
}

export async function getMessages(conversationId: string) {
    const response = await fetch(apiUrl(`conversation/${conversationId}/message`), {
        headers: {
            Cookie: cookies().toString()
        },
        cache: 'no-cache'
    });

    return response.json();
}

export async function startAssistantPrompt(mongoClient: MongoClient, conversationId: string, intentDetection: boolean, relevantInfo: RelevantInformation) {
    const conversations = getConversationCollection(mongoClient);
    const lastId = await getLastCompletionId();
    const responseMessage : Message = {
        role:                      'assistant',
        content:                   '',
        id:                        uuid(),
        chatPending:               true,
        splitSentencesPending:     intentDetection,
        intentDetectionPending:    intentDetection,
        lastSeenChatId:            lastId,
        lastSeenIntentDetectionId: lastId
    };

    const conversation = await conversations.findOne({ _id: conversationId });
    if (!conversation) {
        throw new Error('Conversation not found');
    }
    const { messages, purpose } = conversation;

    await conversations.updateOne({ _id: conversationId }, { $push: { messages: responseMessage } });
    const openaiMessages = messages.map(({ role, content }) => ({ role, content }));
    const relevantInfoString = listRelevantInformation(relevantInfo);

    await sendCompletionRequest({ 
        messageGroupId: conversationId,
        label:          'chat',
        kind:           'stream',
        systemMessage: `
            ${systemPrompts[purpose.type](purpose.context, openaiMessages.length === 0)}
            ${openaiMessages.length > 0 ? `
                Current known information about the ${purpose.context}:
                ${relevantInfoString}
                Do not echo this to the user.
            ` : ''}
        `,
        messages: [
            ...openaiMessages.slice(-16),
        ]
    });
}

export function processSplitSentences(message: string) {
    return message.includes(splitSentencePrefix) ? 
        message.slice(message.indexOf(splitSentencePrefix) + splitSentencePrefix.length).trim()
        : message;
}

export async function startIntentDetection(conversationId: string, messages: ChatCompletionRequestMessage[], splitSentences: string, relevantInfo: RelevantInformation) {
    if (messages.length < 2) {
        return;
    }

    const relevantInfoStr = listRelevantInformation(relevantInfo);

    await sendCompletionRequest({
        messageGroupId: conversationId,
        label: 'intentDetection',
        kind: 'function',
        functionName: 'generateIntents',
        functions: [generateIntentsSchema(relevantInfo.type)],
        systemMessage: `
            You are an intent classifier. 
            Do not generate redundant intents. 
            Do not leave out any user-provided information. 
            Only use the information provided by the user.
            The intent content must closely match the information provided by the user.

            Current up-to-date information about the ${relevantInfo.type}:
            ${relevantInfoStr}
        `,
        messages: [
            userPrompt`${splitSentences}`
        ]
    });
}

export function* processIntentDetectionResults({ intents }: { intents: Intent[] }) : Generator<Intent> {
    if (!Array.isArray(intents)) {
        return;
    }
    for (const intent of intents) {
        yield intent;
    }
}
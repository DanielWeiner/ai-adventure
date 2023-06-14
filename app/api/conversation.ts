import { getMongoDatabase } from "@/app/mongo";
import { Collection, MongoClient } from "mongodb";
import { ChatCompletionRequestMessageRoleEnum } from "openai";
import { apiUrl } from "./api";
import { cookies } from "next/headers";
import { NounType } from "./noun";

export interface Message {
    content: string;
    role: ChatCompletionRequestMessageRoleEnum;
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
}

export function getConversationCollection(mongoClient: MongoClient) : Collection<Conversation> {
    return getMongoDatabase(mongoClient).collection<Conversation>('conversations');
}

export async function getMessages(sessionToken: string, conversationId: string) {
    const response = await fetch(apiUrl(`conversation/${conversationId}/message`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { 
            tags: [ `conversation_${sessionToken}_${conversationId}` ] 
        }
    });

    return response.json();
}

import { getMongoDatabase } from "@/app/mongo";
import { Collection, MongoClient } from "mongodb";
import { ChatCompletionRequestMessageRoleEnum } from "openai";
import { getSessionToken } from "./auth";
import { apiUrl } from "./api";
import { cookies } from "next/headers";

export interface Message {
    content: string;
    role: ChatCompletionRequestMessageRoleEnum;
}

export interface ConversationPurpose {
    type: 'create' | 'adventure';
    context: string;
}

export interface Conversation {
    _id: string;
    userId: string;
    messages: Message[];
}

export function getConversationCollection(mongoClient: MongoClient) : Collection<Conversation> {
    return getMongoDatabase(mongoClient).collection<Conversation>('conversations');
}

export async function getMessages(conversationId: string) {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
        return null;
    }

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

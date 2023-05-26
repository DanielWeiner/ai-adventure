import { Collection, MongoClient } from "mongodb";
import { ChatCompletionRequestMessageRoleEnum } from "openai";

export interface Message {
    content: string;
    role: ChatCompletionRequestMessageRoleEnum;
}

export interface Conversation {
    _id: string;
    userMessages: {
        _id: string;
        message: string;
    }[];
    messages: Message[];
}

const {
    MONGO_USERNAME,
    MONGO_PASSWORD,
    MONGO_DB,
    MONGO_PORT
} = process.env;

export function createMongoClient() {
    return new MongoClient(`mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@db:${MONGO_PORT}`);
}

export function getConversationCollection(mongoClient: MongoClient) : Collection<Conversation> {
    return mongoClient.db(MONGO_DB).collection<Conversation>('conversations');
}

export async function findOrCreateConversation(collection: Collection<Conversation>,  conversationId: string) {
    const conversation = await collection.findOne({ _id: conversationId });
    if (!conversation) {
        const newConversation = {
            _id: conversationId,
            userMessages: [],
            messages: []
        };
        await collection.insertOne(newConversation);

        return newConversation;
    }

    return conversation;
}
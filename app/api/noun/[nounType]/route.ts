import { createMongoClient, getMongoDatabase } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { getSessionToken, getUser } from "../../auth";
import { v4 as uuid } from 'uuid';
import { Noun } from "../noun";
import { revalidateTag } from "next/cache";
import { Conversation, getConversationCollection } from "../../conversation";

export async function GET(request: NextRequest, { params: { nounType } } : { params: { nounType: string } }) {
    const user = await getUser();
    if (!user) {
        return NextResponse.json("Unauthorized", { status: 401 });
    }

    const mongoClient = createMongoClient();
    await mongoClient.connect();

    const db = getMongoDatabase(mongoClient);
    const nouns = db.collection<Noun>('nouns');
    
    const resultNouns = await nouns.find({ userId: user.id, type: nounType }).toArray();

    await mongoClient.close();
    return NextResponse.json(resultNouns);
}

export async function POST(request: NextRequest, { params: { nounType } } : { params: { nounType: string } }) {
    const user = await getUser();
    if (!user) {
        return NextResponse.json("Unauthorized", { status: 401 });
    }
    const sessionToken = getSessionToken();

    const mongoClient = createMongoClient();
    await mongoClient.connect();
    const db = getMongoDatabase(mongoClient);
    const nouns = db.collection<Noun>('nouns');
    const conversations = getConversationCollection(mongoClient);

    const conversation : Conversation = {
        _id: uuid(),
        userId: user.id,
        messages: [
            { role: 'system', content: `Prompt the user to create a new ${nounType}.` }
        ]
    };
    await conversations.insertOne(conversation);

    const noun : Noun = { 
        _id: uuid(),
        userId: user.id, 
        type: nounType,
        conversationId: conversation._id,
        attributes: [],
        name: `New ${nounType}`
    };

    await nouns.insertOne(noun);
    await mongoClient.close();

    revalidateTag(`conversation_${sessionToken}_${conversation._id}`);
    revalidateTag(`noun_${sessionToken}_${nounType}_${noun._id}`);
    revalidateTag(`noun_${sessionToken}_${nounType}`);

    return NextResponse.json(noun);
}
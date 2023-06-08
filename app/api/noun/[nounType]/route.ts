import { createMongoClient, getMongoDatabase } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../auth";
import { v4 as uuid } from 'uuid';
import { Noun } from "../noun";

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
    
    const nounInput = await request.json() as Noun;
    if (!nounInput?.attributes || !nounInput?.name) {
        return NextResponse.json("Bad Request", { status: 400 });
    }

    const mongoClient = createMongoClient();
    await mongoClient.connect();
    const db = getMongoDatabase(mongoClient);
    const nouns = db.collection<Noun>('nouns');

    const existingNoun = await nouns.findOne({ userId: user.id, type: nounType, name: nounInput.name });
    if (existingNoun) {
        return NextResponse.json("Conflict", { status: 409 });
    }

    const noun = { 
        ...nounInput,
        _id: uuid(),
        userId: user.id, 
        type: nounType 
    }

    await nouns.insertOne(noun);
    await mongoClient.close();

    return NextResponse.json(noun);
}
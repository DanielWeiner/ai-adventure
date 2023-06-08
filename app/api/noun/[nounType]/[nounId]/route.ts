import { getUser } from "@/app/api/auth";
import { createMongoClient, getMongoDatabase } from "@/app/mongo";
import { NextRequest, NextResponse } from "next/server";
import { Noun } from "../../noun";

export async function GET(request: NextRequest, { params: { nounType, nounId } } : { params: { nounType: string, nounId: string } }) {
    const user = await getUser();
    if (!user) {
        return NextResponse.json("Unauthorized", { status: 401 });
    }

    const mongoClient = createMongoClient();
    await mongoClient.connect();

    const db = getMongoDatabase(mongoClient);
    const nouns = db.collection<Noun>('nouns');

    const noun = await nouns.findOne({ userId: user.id, type: nounType, _id: nounId });

    await mongoClient.close();

    if (!noun) {
        return NextResponse.json("Not Found", { status: 404 });
    }

    return NextResponse.json(noun);
}

export async function PUT(request: NextRequest, { params: { nounType, nounId } } : { params: { nounType: string, nounId: string } }) {
    const user = await getUser();
    if (!user) {
        return NextResponse.json("Unauthorized", { status: 401 });
    }

    const nounInput = await request.json() as Noun;
    if (!nounInput?.attributes && !nounInput?.name) {
        return NextResponse.json("Bad Request", { status: 400 });
    }

    const mongoClient = createMongoClient();
    await mongoClient.connect();

    const db = getMongoDatabase(mongoClient);
    const nouns = db.collection<Noun>('nouns');

    const existingNoun = await nouns.findOne({ _id: nounId, userId: user.id, type: nounType });
    if (!existingNoun) {
        return NextResponse.json("Not Found", { status: 404 });
    }

    const noun = { 
        ...existingNoun,
        ...nounInput,
        userId: user.id, 
        type: nounType 
    };

    await nouns.replaceOne({ _id: nounId }, noun);
    await mongoClient.close();

    return NextResponse.json(noun);
}
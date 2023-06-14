import { cookies } from "next/headers";
import { apiUrl } from "./api";
import { Collection, MongoClient } from "mongodb";
import { getMongoDatabase } from "../mongo";

export type NounType = 'class' | 'character' | 'faction' | 'location' | 'species' | 'world';

export interface Noun {
    _id:             string;
    userId:          string;
    conversationId:  string;
    type:            NounType;
    name:            string;
    attributes:      string[];
    namedAttributes: {
        [key in string]: string
    };
}

export function getNounCollection(mongoClient: MongoClient) : Collection<Noun> {
    return getMongoDatabase(mongoClient).collection<Noun>('nouns');
}

export async function getNouns(sessionToken: string, nounType: NounType) : Promise<Noun[]> {
    const response = await fetch(apiUrl(`noun/${nounType}`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { tags: [`noun_${sessionToken}_${nounType}`] } 
    });

    return response.json();
}

export async function getNoun(sessionToken: string, nounType: NounType, nounId: string) : Promise<Noun | null> {
    const response = await fetch(apiUrl(`noun/${nounType}/${nounId}`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { tags: [`noun_${sessionToken}_${nounType}_${nounId}`] } 
    });

    return response.json();
}

export async function getConversationNoun(sessionToken: string, conversationId: string) : Promise<Noun | null> {
    const response = await fetch(apiUrl(`conversation/${conversationId}/noun`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { tags: [`conversationNoun_${sessionToken}_${conversationId}`] } 
    });

    return response.json();
}
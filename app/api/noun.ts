import { cookies } from "next/headers";
import { apiUrl } from "./api";
import { Collection, MongoClient } from "mongodb";
import { getMongoDatabase } from "../mongo";
import { RequestInit } from "next/dist/server/web/spec-extension/request";

export type NounType = 'class' | 'character' | 'faction' | 'location' | 'species' | 'world';

export interface Noun {
    _id:             string;
    userId:          string;
    conversationId:  string;
    type:            NounType;
    name:            string;
    traits:          string[];
    properties: {
        [key in string]: string
    };
}

export function getNounCollection(mongoClient: MongoClient) : Collection<Noun> {
    return getMongoDatabase(mongoClient).collection<Noun>('nouns');
}

const fetchJson = async <T>(url: string, options?: RequestInit) : Promise<T> => {
    const response = await fetch(apiUrl(url), {
        headers: {
            Cookie: cookies().toString()
        },
        cache: 'no-cache',
        ...options
    });

    if (response.status >= 400) {
        throw new Error(await response.json());
    }

    return response.json();
}

export const getNouns = (nounType: NounType) => fetchJson<Noun[]>(`noun/${nounType}`);
export const getNoun = (nounType: NounType, nounId: string) => fetchJson<Noun | null>(`noun/${nounType}/${nounId}`);
export const getConversationNoun = (conversationId: string) => fetchJson<Noun | null>(`conversation/${conversationId}/noun`);
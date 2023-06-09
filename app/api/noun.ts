import { cookies } from "next/headers";
import { apiUrl } from "./api";
import { getSessionToken } from "./auth";
import { Noun } from "./noun/noun";

export async function getNouns(nounType: string) : Promise<Noun[]> {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
        return [];
    }

    const response = await fetch(apiUrl(`noun/${nounType}`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { tags: [`noun_${sessionToken}_${nounType}`] } 
    });

    return response.json();
}

export async function getNoun(nounType: string, nounId: string) : Promise<Noun | null> {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
        return null;
    }

    const response = await fetch(apiUrl(`noun/${nounType}/${nounId}`), {
        headers: {
            Cookie: cookies().toString()
        },
        next: { tags: [`noun_${sessionToken}_${nounType}_${nounId}`] } 
    });

    return response.json();
}
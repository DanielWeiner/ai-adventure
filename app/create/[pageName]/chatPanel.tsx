'use client';

import { Noun } from "@/app/api/noun";
import ChatBox from "@/app/components/chatbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useCreationContext } from "../context";

const ucFirst = (str: string) => str[0].toUpperCase() + str.slice(1);
const fetchJson = async <T,>(url: string, options?: RequestInit) : Promise<T> => (await fetch(`/api/${url}`, options)).json();

const createNoun = (nounType: string) => fetchJson<Noun>(`/noun/${nounType}`, { method: 'POST' });
const getNoun = (nounType: string, nounId: string) => fetchJson<Noun>(`/noun/${nounType}/${nounId}`);
const getNouns = (nounType: string) => fetchJson<Noun[]>(`/noun/${nounType}`);

export default function ChatPanel() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { sessionToken, nounType, nouns: initialNouns, noun: initialNoun } = useCreationContext();

    const nounId = initialNoun?._id ?? null;

    const { data: nouns } = useQuery({ 
        queryKey: [`noun_${sessionToken}_${nounType}`],
        queryFn: () => getNouns(nounType),
        initialData: initialNouns
    });

    const { data: noun } = useQuery({
        queryKey: [
            `noun_${sessionToken}_${nounType}`,
            `noun_${sessionToken}_${nounType}_${nounId}`
        ],
        queryFn: () => nounId ? getNoun(nounType, nounId) : null,
        initialData: initialNoun
    });

    const createNounMutation = useMutation({
        mutationFn: createNoun,
        onSuccess: ({ _id: id }) => {
            queryClient.invalidateQueries([ `noun_${sessionToken}_${nounType}` ]);
            router.push(`/create/${nounType}/${id}`);
        }
    });

    return (
        <>
            <section className="w-2/12">
                <ul className="flex flex-col align-middle items-center text-center">
                    {
                        nouns.map(({ name, _id: id }, i) => (
                            <li className={`p-2 font-medium w-full ${ id === nounId ? 'bg-slate-400' : 'bg-slate-300' } border-b border-b-slate-400`} key={i}><Link href={`/create/${nounType}/${id}`}>{name}</Link></li>
                        ))
                    }
                    <li key="new" className="p-2 w-full font-medium bg-slate-300">
                        <Link href="#" onClick={(e) => {
                            e.preventDefault();
                            createNounMutation.mutate(nounType)
                        }}>New {ucFirst(nounType)}</Link>
                    </li>
                </ul>
            </section>
            <section className="w-6/12">
                {
                    noun ? 
                        <ChatBox conversationId={noun.conversationId} /> 
                        : 
                        <div className="flex flex-col justify-center items-center w-full max-h-full h-full bg-slate-200">
                            <p className="text-center">
                                Select a {nounType} from the panel on the left, or click "New {ucFirst(nounType)}" to create a new one.
                            </p>
                        </div>
                }
            </section>

            <section className="w-4/12">
                {noun ? <div>
                    <p>{noun.name}</p>

                    <ul>
                        {
                            noun.attributes.map((attr, i) => <p key={i}>{attr}</p>)
                        }
                    </ul>
                </div>: null}
            </section>
        </>
    )
}


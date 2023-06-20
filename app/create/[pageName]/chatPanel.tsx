'use client';

import { Noun, NounType } from "@/app/api/noun";
import ChatBox from "@/app/components/chatbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useCreationContext } from "../context";
import { CharacterIcon, ClassIcon, FactionIcon, LocationIcon, SpeciesIcon, TrashIcon, WorldIcon } from "@/app/components/icons";

const ucFirst = (str: string) => str[0].toUpperCase() + str.slice(1);
const fetchJson = async <T,>(url: string, options?: RequestInit) : Promise<T> => {
    const response = await fetch(`/api/${url}`, options);
    if (response.status >= 400) {
        throw new Error(await response.json());
    }

    return response.json();
};

const createNoun = (nounType: string) => fetchJson<Noun>(`/noun/${nounType}`, { method: 'POST' });
const deleteNoun = ({ nounType, nounId } : { nounType: string, nounId: string }) => fetchJson<string>(`/noun/${nounType}/${nounId}`, { method: 'DELETE' });
const getNoun = (nounType: string, nounId: string) => fetchJson<Noun>(`/noun/${nounType}/${nounId}`);
const getNouns = (nounType: string) => fetchJson<Noun[]>(`/noun/${nounType}`);

const icons : { [key in NounType]: (size: string) => React.ReactNode } = {
    character: (size) => <CharacterIcon size={size}/>,
    class: (size) => <ClassIcon size={size}/>,
    faction: (size) => <FactionIcon size={size}/>,
    location: (size) => <LocationIcon size={size}/>,
    species: (size) => <SpeciesIcon size={size}/>,
    world: (size) => <WorldIcon size={size}/>
}

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

    const deleteNounMutation = useMutation({
        mutationFn: deleteNoun,
        onSuccess: () => {
            queryClient.invalidateQueries([ `noun_${sessionToken}_${nounType}` ]);
            
        }
    });

    return (
        <>
            <section className="w-2/12">
                <ul className="flex flex-col align-middle items-center text-center">
                    {
                        nouns.map(({ name, _id: id }, i) => (
                            <li className={`p-2 font-medium w-full ${ id === nounId ? 'bg-slate-400' : 'bg-slate-300' } border-b border-b-slate-400`} key={i}>
                                <span className="flex flex-row">
                                    <Link className="flex-grow" href={`/create/${nounType}/${id}`}>
                                        {name || <span className="text-slate-600 italic">unnamed {nounType}</span>}
                                    </Link>
                                    <TrashIcon 
                                        className="mt-[0.25rem] cursor-pointer mr-2 flex-shrink text-red-800" 
                                        size="1rem"
                                        onClick={e => {
                                            e.preventDefault();
                                            deleteNounMutation.mutate({ nounId: id, nounType });
                                        }}
                                    />
                                </span>
                            </li>
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
                                Select a {nounType} from the panel on the left, or click &quot;New {ucFirst(nounType)}&quot; to create a new one.
                            </p>
                        </div>
                }
            </section>

            <section className="w-4/12">
                {noun ? <div>
                    <p className="text-center font-bold text-xl py-2">{noun.name || <span className="text-slate-600 italic font-medium">unnamed {nounType}</span>}</p>
                    <div className="flex justify-center w-full mt-5">{ icons[nounType as NounType]('100') }</div>
                    <p className="text-center font-medium text-lg pb-5">{ucFirst(nounType)}</p>

                    <ul className="list-disc ml-6">
                        {
                            noun.attributes?.map((attr, i) => <li key={i}>{attr}</li>)
                        }
                    </ul>
                </div>: null}
            </section>
        </>
    )
}


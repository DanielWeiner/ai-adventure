'use client';

import { Noun, NounType } from "@/app/api/noun";
import ChatBox from "@/app/components/chatbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { Fragment, useRef, useState } from "react";
import { useCreationContext } from "../context";
import { CharacterIcon, ClassIcon, FactionIcon, LocationIcon, PlusIcon, SpeciesIcon, TrashIcon, WorldIcon } from "@/app/components/icons";
import { Combobox, Transition } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid'

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
    const [nounQuery, setNounQuery] = useState('');
    const [comboboxFocused, setComboboxFocused] = useState(false);
    const inputElement = useRef<HTMLInputElement | null>(null);

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
        onSuccess: (_, { nounId }) => {
            queryClient.invalidateQueries([ `noun_${sessionToken}_${nounType}` ]);
            if (noun?._id === nounId) {
                queryClient.invalidateQueries([ `noun_${sessionToken}_${nounType}_${nounId}` ]);
                router.push(`/create/${nounType}`);
            }
        }
    });

    const filteredNouns = nouns.filter(({name}) => name.toLowerCase().includes(nounQuery.toLowerCase()));

    return (
        <div className="flex flex-row flex-grow w-full h-full border-l-2 border-l-slate-500">
            <section className="w-8/12 relative">
                <div className="absolute top-0 left-0 right-0 flex flex-row px-5 justify-center items-center shadow-md bg-slate-300 py-2">
                    { nouns.length > 0 ? <Combobox value={noun} onChange={(newNoun) => {
                        if (!newNoun) return;
                        router.push(`/create/${nounType}/${newNoun._id}`)
                    }} >
                        <div className="relative mt-1 flex-grow pr-5">
                            <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-white text-left shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-teal-300 sm:text-sm">
                                <Combobox.Input 
                                    ref={inputElement}
                                    autoComplete="off"
                                    className={`w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:ring-0${ noun && !noun.name ? ' text-slate-600 italic' : '' }`} 
                                    onChange={e => setNounQuery(e.target.value)}
                                    displayValue={(noun: Noun | null) => comboboxFocused ? '' : noun ? noun.name || `unnamed ${nounType}` : ''}
                                    onFocus={() => setComboboxFocused(true)}
                                    onBlur={() => {setComboboxFocused(false); setNounQuery(''); }}
                                    placeholder={`Select a ${nounType}`}
                                />
                                <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronUpDownIcon
                                    className="h-5 w-5 text-gray-400"
                                    aria-hidden="true"
                                />
                                </Combobox.Button>
                            </div>
                            <Transition
                                as={Fragment}
                                leave="transition ease-in duration-100"
                                leaveFrom="opacity-100"
                                leaveTo="opacity-0"
                                afterLeave={() => {
                                    inputElement.current?.blur();
                                }}
                            >
                                <Combobox.Options 
                                    className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
                                >
                                    {
                                        filteredNouns.length === 0 && nounQuery !== '' ? (
                                            <div className="relative cursor-default select-none py-2 px-4 text-gray-700">
                                                Nothing found.
                                            </div>
                                        ) :

                                        filteredNouns.map((nounOption) => (
                                            <Combobox.Option 
                                                className={({ active }) =>
                                                    `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                                        active ? 'bg-teal-600 text-white' : 'text-gray-900'
                                                    }`
                                                }
                                                value={nounOption} 
                                                key={nounOption._id}
                                            >
                                            
                                                {({ selected, active } : { selected: boolean, active: boolean}) => (
                                                    <>
                                                        <span
                                                            className={`block truncate ${
                                                                selected ? 'font-medium' : 'font-normal'
                                                            }`}
                                                            >
                                                            <span className="flex flex-row">
                                                                <span className="flex-grow">
                                                                    {nounOption.name || <span className="text-slate-600 italic">unnamed {nounType}</span>}
                                                                </span>
                                                                <TrashIcon 
                                                                    className="mt-[0.25rem] cursor-pointer mr-2 flex-shrink text-red-800" 
                                                                    size="1rem"
                                                                    onClick={e => {
                                                                        e.preventDefault();
                                                                        deleteNounMutation.mutate({ nounId: nounOption._id, nounType });
                                                                    }}
                                                                />
                                                            </span>
                                                        </span>
                                                        {selected ? (
                                                        <span
                                                            className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                                                            active ? 'text-white' : 'text-teal-600'
                                                            }`}
                                                        >
                                                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                                        </span>
                                                        ) : null}
                                                    </>
                                                )}
                                            </Combobox.Option>
                                        ))
                                    }
                                </Combobox.Options>
                            </Transition>
                        </div>
                    </Combobox> : null }
                    <Link className="align-middle" href="#" onClick={(e) => {
                        e.preventDefault();
                        createNounMutation.mutate(nounType)
                    }}>
                        <PlusIcon size="2rem" className="text-green-600 rounded-full shadow-md mt-1 bg-white" />
                    </Link>
                </div>
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
        </div>
    )
}


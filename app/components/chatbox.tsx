'use client';

import { Message } from "@/app/api/conversation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { useCreationContext } from "../create/context";
import { ArrowCounterClockwiseIcon, PencilIcon, SendIcon, CheckIcon } from "./icons";
import { v4 as uuid } from 'uuid';
import { Noun } from "../api/noun";

const fetchJson = async <T,>(url: string, options?: RequestInit) : Promise<T> => (await fetch(`/api/${url}`, options)).json();
const getMessages = (conversationId: string) => fetchJson<Message[]>(`/conversation/${conversationId}/message`);
const postMessage = ({ conversationId, message } : {conversationId: string, message: string}) => fetchJson<Message>(`conversation/${conversationId}/message`, { method: 'POST', body: JSON.stringify(message) });
const rollbackMessage = ({ 
    conversationId, 
    messageId, 
    content } : { 
        conversationId: string, 
        messageId: string, 
        content: string 
    }) => fetchJson<Message>(`conversation/${conversationId}/message/${messageId}`, { 
        method: 'PUT', 
        body: JSON.stringify({ content }) 
    });

const ChatBubble = ({ 
    role, 
    editable, 
    resetable, 
    children, 
    onReset, 
    onEditStart, 
    onEditConfirm, 
    onEditCancel
} : { 
    children: React.ReactNode, 
    editable: boolean, 
    resetable: boolean, 
    role: string,
    onReset?: () => void, 
    onEditStart?: () => void
    onEditConfirm?: (str: string) => void,
    onEditCancel?: () => void
}) => {
    const inputElement = useRef<HTMLInputElement | null>(null);
    const contentDiv = useRef<HTMLDivElement | null>(null);
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    useEffect(() => {
        if (editing && inputElement.current) {
            console.log(inputElement);
            inputElement.current.focus();
            inputElement.current.setSelectionRange(editContent.length, editContent.length);
        }
    }, [ editing, inputElement.current ])

    return (
        <div className={`w-full mt-4 flex flex-col border-t border-t-slate-400 first:mt-0 first:border-0 px-4 border-opacity-50 ${role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`p-2 whitespace-pre-wrap relative mt-4 rounded-md shadow-sm ring-gray-300 w-fit ${role === 'user' ? 'bg-indigo-500 text-white' : 'bg-slate-50 text-slate-900'}`}>
                <span className="flex flex-row justify-between">
                    <h4 className={`text-xs py-1 ${
                        role === 'user' ? 'text-gray-100' : 'text-gray-500'
                    }`}>{role === 'user' ? 'You' : 'AI' }</h4>
                    <span>
                        { 
                        resetable ? 
                            <div onClick={onReset} className="bg-indigo-500 rounded-full p-1 text-white w-5 h-5 ml-4 mb-2 shadow-md cursor-pointer">
                                <ArrowCounterClockwiseIcon size="100%" />
                            </div> : 
                            editable ? 
                                editing ? 
                                    <div onMouseDown={() =>{
                                        setEditing(false);
                                        if (editContent.trim()) {
                                            onEditConfirm?.(editContent);
                                        }
                                    }} className="bg-white ml-4 mb-2 rounded-full text-indigo-500 p-1 w-5 h-5 shadow-md cursor-pointer">
                                        <CheckIcon size="100%"/>
                                    </div> :
                                    <div onClick={() => {
                                        setEditContent(contentDiv.current?.innerText || '');
                                        setEditing(true);
                                        onEditStart?.();
                                    }} className="bg-white ml-4 mb-2 rounded-full text-indigo-500 p-1 w-5 h-5 shadow-md cursor-pointer">
                                        <PencilIcon size="100%"/>
                                    </div> 
                                : null
                        }
                    </span>
                </span>
                {
                    editing ? <input ref={inputElement} className="bg-indigo-500" onBlur={() => {
                        setEditing(false);
                        onEditCancel?.();
                    }} value={editContent} onChange={(e) => setEditContent(e.target.value)} /> : <div ref={contentDiv}>{children}</div>
                }
                
            </div>
        </div>  
    );
}

export default function ChatBox({ conversationId } : { 
    conversationId: string | null
}) {
    const [ text, setText ] = useState("");
    const [ eventSource, setEventSource ] = useState<EventSource | null>(null);
    const { sessionToken, messages: remoteChatLog, nounType, noun: contextNoun, awaitingNewNoun } = useCreationContext();
    const [ eventSourceHandler, setEventSourceHandler ] = useState<((event: MessageEvent) => void) | null>(null);
    const [ endingEventSource, setEndingEventSource ] = useState(false);
    const scroller = useRef<HTMLDivElement | null>(null);

    const queryClient = useQueryClient();
    const { _id: nounId } = contextNoun || {};
    const conversationQueryKey = `conversation_${sessionToken}_${conversationId ?? 'new' }`;
    const nounsQueryKey = `noun_${sessionToken}_${nounType}`;
    const currentNounQueryKey = `noun_${sessionToken}_${nounType}_${nounId ?? 'new' }`;

    const { fetchStatus: nounFetchStatus } = queryClient.getQueryState([
        nounsQueryKey,
        currentNounQueryKey
    ]) ?? {};
    
    const noun : Noun | undefined = queryClient.getQueryData([
        nounsQueryKey,
        currentNounQueryKey
    ]);
    
    const { data: messages, isFetched: messagesFetched, fetchStatus } = useQuery({
        queryKey: [conversationQueryKey],
        queryFn: () => conversationId ? getMessages(conversationId) : [],
        initialData: remoteChatLog
    });

    const messagesFetching = !messagesFetched || fetchStatus === 'fetching';
    const lastMessage = messages.findLast(message => message.role === 'assistant') ?? { pending: true, content: ''};
    const pendingChat = lastMessage.pending;
    const loadingBubble = pendingChat && !lastMessage.content;
    const nounFetching = nounFetchStatus === 'fetching';
    const chatEnabled = !pendingChat && !nounFetching;

    const postMessageMutation = useMutation({
        mutationFn: postMessage,
        onSuccess: () => {
            queryClient.invalidateQueries([conversationQueryKey]);
        },
        onMutate: ({ message }) => {
            queryClient.setQueryData([conversationQueryKey], (messages: Message[] | undefined) => (messages || []).concat([
                {
                    aiPipelineId: '',
                    content:      message,
                    id:           'new',
                    pending:      true,
                    role:         'user',
                    revision:     noun?.revision || 0
                }
            ]))
            setText('');
        }
    });

    const rollbackMessageMutation = useMutation({
        mutationFn: rollbackMessage,
        onSuccess: () => {
            queryClient.invalidateQueries([conversationQueryKey]);
            queryClient.invalidateQueries([currentNounQueryKey]);
            queryClient.invalidateQueries([nounsQueryKey]);
        }
    })

    

    useEffect(() => {
        if (!awaitingNewNoun) {
            queryClient.invalidateQueries([ conversationQueryKey ]);
        }
    }, [ awaitingNewNoun, conversationQueryKey, queryClient ]);

    useEffect(() => {
        if (!endingEventSource) {
            return;
        }

        queryClient.invalidateQueries([conversationQueryKey]);

        if (eventSourceHandler && eventSource) {
            eventSource.removeEventListener('message', eventSourceHandler);
        }
        if (eventSourceHandler) {
            setEventSourceHandler(null);
        }
        if (eventSource) {
            eventSource.close();
            setEventSource(null);
        }
        setEndingEventSource(false);
    }, [ endingEventSource, conversationQueryKey, eventSource, setEndingEventSource, eventSourceHandler, queryClient ]);

    useEffect(() => {
        if (messagesFetching || nounFetching) return;
        if (!pendingChat || endingEventSource) return;
        if (!eventSource && conversationId) {
            setEventSource(new EventSource(`/api/conversation/${conversationId}/chat?requestId=${uuid()}`));
        }
    }, [ pendingChat, eventSource, setEventSource, conversationId, messagesFetching, endingEventSource, nounFetching]);

    useEffect(() => {
        if (!eventSource || endingEventSource) return;

        const onMessage = (event: MessageEvent) => {        
            try {
                const data = JSON.parse(event.data);
                if (typeof data.messageId === 'string' && typeof data.message === 'string') {
                    queryClient.setQueryData([conversationQueryKey], (messages: Message[] | undefined) => (messages || []).map(({ id, content, ...rest }) => (
                        id === data.messageId ? {
                            id,
                            ...rest,
                            content: data.delta ? content + data.message : data.message
                        } : { id, content, ...rest }
                    ))); 
                    return;
                }

                if (data.events) {
                    if (data.events.some(({ name } : { name: string }) => name === 'noun.update')) {
                        queryClient.invalidateQueries([nounsQueryKey]);
                    }
                    return;
                }
                if (data.done) {
                    return setEndingEventSource(true);
                }
            } catch(e) {
                console.error(e);
                return setEndingEventSource(true);
            }
        }

        setEventSourceHandler((currentHandler: ((message: MessageEvent) => void) | null) => {
            if (currentHandler) {
                eventSource.removeEventListener('message', currentHandler);
            }
            return onMessage;
        });
    }, [ eventSource, conversationQueryKey, nounsQueryKey, queryClient, setEventSourceHandler, endingEventSource, setEndingEventSource ])

    useEffect(() => {
        if (!eventSource || !eventSourceHandler) {
            return;
        }

        eventSource.addEventListener('message', eventSourceHandler);

        return () => {
            eventSource.removeEventListener('message', eventSourceHandler);
        };
    }, [eventSource, eventSourceHandler]);

    useEffect(() => {
        scroller.current?.scrollTo(0, 999999999);
    }, [pendingChat, scroller, messages]);

    return (
        <section className="flex flex-col absolute top-0 left-0 right-0 bottom-0">
            <div className="rounded-sm flex-grow overflow-hidden flex flex-col items-stretch [border-bottom-right-radius:0] [border-bottom-left-radius:0]">
                <div ref={scroller} className="max-h-full flex-1 shadow-inner overflow-y-scroll flex-grow scrollbar-thumb-slate-500 scrollbar-track-slate-300 scrollbar-thin">
                    <div className={`flex flex-col flex-grow py-1 min-h-full justify-end shadow-lg bg-slate-200 pb-3`}>
                        { messages.map(({ content, role, id, revision, pending }, i) => (
                            <React.Fragment key={id}>
                                {
                                    (pending && loadingBubble) ? 
                                        null 
                                    : 
                                        <ChatBubble
                                            editable={!pending && chatEnabled && role === 'user' && !isNaN(revision)} 
                                            resetable={!pending && chatEnabled && role === 'assistant' && !isNaN(revision) && !isNaN(messages[i-1]?.revision)}
                                            role={role} 
                                            onReset={() => {
                                                queryClient.setQueryData([conversationQueryKey], (messages: Message[] | undefined) => {
                                                    return (messages || []).slice(0, i);
                                                });
                                                if (conversationId) {
                                                    rollbackMessageMutation.mutate({
                                                        conversationId,
                                                        messageId: id,
                                                        content: messages[i - 1]?.content || ''
                                                    });
                                                }
                                            }}
                                            onEditConfirm={(editValue) => {
                                                queryClient.setQueryData([conversationQueryKey], (messages: Message[] | undefined) => {
                                                    return (messages || []).slice(0, i).concat([
                                                        {
                                                            aiPipelineId:'',
                                                            content: editValue,
                                                            pending: true,
                                                            id,
                                                            revision,
                                                            role
                                                        }
                                                    ]);
                                                });
                                                if (conversationId && editValue) {
                                                    rollbackMessageMutation.mutate({
                                                        conversationId,
                                                        messageId: id,
                                                        content: editValue
                                                    });
                                                }
                                            }}
                                        >
                                            {content}
                                        </ChatBubble>
                                }
                            </React.Fragment>                            
                        ))}
                        {loadingBubble ? <ChatBubble editable={false} resetable={false} role="assistant">
                            <div className="flex flex-row">
                                <div className="py-2 mx-0.5 animate-bounce">
                                    <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
                                </div>
                                <div className="py-2 mx-0.5 animate-bounce [animation-delay:0.2s]">
                                    <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
                                </div>
                                <div className="py-2 mx-0.5 animate-bounce [animation-delay:0.4s]">
                                    <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
                                </div>
                            </div>
                        </ChatBubble> : null}
                    </div>
                </div>
            </div>
            <form
                className="flex flex-row rounded-md [border-top-left-radius:0] [border-top-right-radius:0]"
                onSubmit={ 
                    (e) => {
                        e.preventDefault();
                        if (text.trim() && !eventSource && conversationId && chatEnabled) {
                            postMessageMutation.mutate({ conversationId, message: text });
                        }
                    } 
                }>
                    <input 
                        disabled={!chatEnabled}
                        type="text"
                        className="block flex-grow min-w-0 h-12 text-md border-0 py-1.5 lg:[border-bottom-left-radius:0.375rem] text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600" 
                        value={text}
                        placeholder="Say something..."
                        onChange={ input => setText(input.target.value) }/>
                    <button disabled={!chatEnabled} type="submit" className="flex bg-indigo-500 h-12 w-12 min-w-[3rem] lg:[border-bottom-right-radius:0.375rem] text-white justify-center items-center disabled:bg-indigo-300">
                        <SendIcon size="1.5rem" className="-mb-1" />
                    </button>
            </form>
        </section>
    )
}
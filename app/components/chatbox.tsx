'use client';

import { Message } from "@/app/api/conversation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCreationContext } from "../create/context";
import { SendIcon } from "./icons";

const fetchJson = async <T,>(url: string, options?: RequestInit) : Promise<T> => (await fetch(`/api/${url}`, options)).json();
const getMessages = (conversationId: string) => fetchJson<Message[]>(`/conversation/${conversationId}/message`);
const postMessage = ({ conversationId, message} : {conversationId: string, message: string}) => fetchJson<Message>(`conversation/${conversationId}/message`, { method: 'POST', body: JSON.stringify(message) });

const ChatBubble = ({ role, children } : { children: React.ReactNode, role: string }) => {
    return (
        <div className={`w-full mt-4 flex flex-col border-t border-t-slate-400 first:mt-0 first:border-0 px-4 border-opacity-50 ${role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`p-2 whitespace-pre-wrap relative mt-4 rounded-md shadow-sm ring-gray-300 w-fit ${role === 'user' ? 'bg-indigo-500 text-white' : 'bg-slate-50 text-slate-900'}`}>
                <h4 className={`text-xs py-1 ${
                    role === 'user' ? 'text-gray-100' : 'text-gray-500'
                }`}>{role === 'user' ? 'You' : 'AI' }</h4>
                {children}
            </div>
        </div>
    );
}

export default function ChatBox({ conversationId } : { 
    conversationId: string
}) {
    const [ text, setText ] = useState("");
    const [ eventSource, setEventSource ] = useState<EventSource | null>(null);
    
    const { sessionToken, messages: remoteChatLog, nounType, noun } = useCreationContext();
    
    const { data: messages, isFetched: messagesFetched, fetchStatus } = useQuery({
        queryKey: [`conversation_${sessionToken}_${conversationId}`],
        queryFn: () => getMessages(conversationId),
        initialData: remoteChatLog
    });

    const lastMessage = messages[messages.length - 1];
    const pendingChat = lastMessage.chatPending || lastMessage.intentDetectionPending;
    const loadingBubble = pendingChat && !lastMessage.content;

    const queryClient = useQueryClient();
    const postMessageMutation = useMutation({
        mutationFn: postMessage,
        onSuccess: ({}, { conversationId }) => {
            queryClient.invalidateQueries([`conversation_${sessionToken}_${conversationId}`]);
        },
        onMutate: () => {
            setText('');
        }
    });

    const scroller = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!messagesFetched || fetchStatus === 'fetching') return;
        if (!pendingChat) return;
        if (!eventSource) {
            console.log('setting event source');
            setEventSource(new EventSource(`/api/conversation/${conversationId}/chat`));
        }
    }, [ pendingChat, eventSource, setEventSource, conversationId, messagesFetched, fetchStatus ]);

    useEffect(() => {
        if (!messagesFetched || fetchStatus === 'fetching') return;
        if (!eventSource) return;
        const queryKey = `conversation_${sessionToken}_${conversationId}`;

        const onMessage = (event: MessageEvent) => {
            const end = () => {
                setEventSource(eventSource => {
                    if (!eventSource) return null;
                    eventSource.removeEventListener('message', onMessage);
                    eventSource.close();
                    return null;
                });
                console.log('invalidating');
                queryClient.invalidateQueries([ queryKey ]);
            };
            
            try {
                const data = JSON.parse(event.data);

                if (data.delta && typeof data.messageId === 'string' && typeof data.message === 'string') {
                    queryClient.setQueryData([queryKey], (messages: Message[] | undefined) => (messages || []).map(({ id, content, ...rest }) => (
                        id === data.messageId ? {
                            id,
                            ...rest,
                            content: content + data.message
                        } : { id, content, ...rest }
                    ))); 
                    return;
                }

                if (data.events) {
                    if (data.events.some(({ name } : { name: string }) => name === 'noun.update')) {
                        queryClient.invalidateQueries([`noun_${sessionToken}_${nounType}`]);
                        queryClient.invalidateQueries([`noun_${sessionToken}_${nounType}_${noun?._id}`]);
                    }
                    return;
                }
                if (data.done) {
                    return end();
                }
            } catch(e) {
                console.error(e);
                return end();
            }
        }

        const onError = (e: any) => console.error(e);
        eventSource.addEventListener('error', onError);
        eventSource.addEventListener('message', onMessage);
        return () => {
            eventSource.removeEventListener('message', onMessage);
            eventSource.removeEventListener('error', onError)
        }
    }, [ eventSource, conversationId, sessionToken, noun?._id, nounType, queryClient, setEventSource, messagesFetched, fetchStatus ])

    useEffect(() => {
        scroller.current?.scrollTo(0, 999999999);
    }, [pendingChat, scroller, messages]);

    return (
        <section className="flex flex-col absolute top-0 left-0 right-0 bottom-0">
            <div className="rounded-sm flex-grow overflow-hidden flex flex-col items-stretch [border-bottom-right-radius:0] [border-bottom-left-radius:0]">
                <div ref={scroller} className="max-h-full flex-1 shadow-inner overflow-y-scroll flex-grow scrollbar-thumb-slate-500 scrollbar-track-slate-300 scrollbar-thin">
                    <div className={`flex flex-col flex-grow py-1 min-h-full justify-end shadow-lg bg-slate-200 pb-3`}>
                        {messages.filter(({ chatPending, intentDetectionPending }) => !((chatPending || intentDetectionPending) && loadingBubble)).map(({ content, role, id }) => <ChatBubble role={role} key={id}>{content}</ChatBubble>)}
                        {loadingBubble ? <ChatBubble role="assistant">
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
                        if (text.trim() && !eventSource) {
                            postMessageMutation.mutate({ conversationId, message: text });
                        }
                    } 
                }>
                    <input 
                        disabled={pendingChat}
                        type="text"
                        className="block flex-grow min-w-0 h-12 text-md border-0 py-1.5 lg:[border-bottom-left-radius:0.375rem] text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600" 
                        value={text}
                        placeholder="Say something..."
                        onChange={ input => setText(input.target.value) }/>
                    <button disabled={pendingChat} type="submit" className="flex bg-indigo-500 h-12 w-12 min-w-[3rem] lg:[border-bottom-right-radius:0.375rem] text-white justify-center items-center disabled:bg-indigo-300">
                        <SendIcon size="1.5rem" className="-mb-1" />
                    </button>
            </form>
        </section>
    )
}
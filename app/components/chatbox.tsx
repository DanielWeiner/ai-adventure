'use client';

import { ConversationPurpose, Message } from "@/app/api/conversation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCreationContext } from "../create/context";

const fetchJson = async <T,>(url: string, options?: RequestInit) : Promise<T> => (await fetch(`/api/${url}`, options)).json();
const getMessages = (conversationId: string) => fetchJson<Message[]>(`/conversation/${conversationId}/message`);

const ChatBubble = ({ role, children } : { children: React.ReactNode, role: string }) => {
    return (
        <div className={`w-full mt-4 flex flex-col border-t border-t-slate-400 first:mt-0 first:border-0 px-4 border-opacity-50 ${role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`p-2 whitespace-pre-wrap relative mt-4 rounded-md shadow-sm ring-gray-300 w-fit ${role === 'user' ? 'bg-blue-500 text-white' : 'bg-slate-50 text-slate-900'}`}>
                <h4 className={`text-xs py-1 ${
                    role === 'user' ? 'text-gray-100' : 'text-gray-500'
                }`}>{role === 'user' ? 'You' : 'AI' }</h4>
                <p>{children}</p>
            </div>
        </div>
    );
}

export default function ChatBox({ conversationId } : { 
    conversationId: string
}) {
    const [ text, setText ] = useState("");
    const [ chatContents, setChatContents ] = useState("");
    const [ eventSource, setEventSource ] = useState<EventSource | null>(null);

    const { sessionToken, messages: remoteChatLog, nounType, noun } = useCreationContext();
    const chatLogRef = useRef(remoteChatLog);
    const [ chatLog, setChatLog ] = useState(remoteChatLog);

    const queryClient = useQueryClient();
    
    const { data: messages } = useQuery({
        queryKey: [`conversation_${sessionToken}_${conversationId}`],
        queryFn: () => getMessages(conversationId),
        initialData: remoteChatLog
    });

    const chatResponseRef = useRef("");
    const [ chatResponse, setChatResponse ] = useState("");
    const scroller = useRef<HTMLDivElement | null>(null);
    const [ pendingChat, setPendingChat ] = useState(messages.length === 0);

    useEffect(() => {
        chatLogRef.current = [...messages];
        setChatLog(chatLogRef.current);
    }, [ messages ]);

    useEffect(() => {
        if (!chatContents) return;

        setChatContents("");
        chatLogRef.current = [...chatLogRef.current, { role: 'user', content: chatContents }];
        setChatLog(chatLogRef.current);
        setText("");

        (async () => {
            const response = await fetch(`/api/conversation/${conversationId}/message`, {
                method: "POST",
                body: JSON.stringify(chatContents)
            });
            
            chatResponseRef.current = "";
            setChatResponse("");
            await response.text();
            setPendingChat(true);
        })();
    }, [ setPendingChat, chatContents, setChatContents, chatResponseRef, setChatResponse, chatLog, setChatLog ]);

    useEffect(() => {
        if (!pendingChat) return;
        if (!eventSource) {
            const newEventSource = new EventSource(`/api/conversation/${conversationId}/chat`);
            
            const end = () => {
                chatLogRef.current = [ ...chatLogRef.current, { role: 'assistant', content: chatResponseRef.current } ];
                newEventSource.close();
                setPendingChat(false);
                setEventSource(null);
                setChatLog(chatLogRef.current);
                setChatResponse("");
                queryClient.invalidateQueries([`conversation_${sessionToken}_${conversationId}`]);
            };
            
            const eventListener = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
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

                    chatResponseRef.current += data.choices[0].delta.content || "";
                    setChatResponse(chatResponseRef.current);
                } catch(e) {
                    return end();
                }
            };

            newEventSource.addEventListener('message', eventListener);
            setEventSource(newEventSource);
            setPendingChat(true);
            return;
        }
    }, [ setPendingChat, pendingChat, eventSource, setEventSource, chatResponseRef, setChatResponse, chatLog, setChatLog ]);

    useEffect(() => {
        scroller.current?.scrollTo(0, 999999999);
    }, [scroller, chatLog, chatResponse])

    return (
        <section className="flex flex-col w-full max-h-full h-full">
            <div className="rounded-sm flex-grow overflow-hidden flex flex-col shadow-md [border-bottom-right-radius:0] [border-bottom-left-radius:0]">
                <div ref={scroller} className="max-h-full flex-1 shadow-inner overflow-y-scroll flex-grow scrollbar-thumb-slate-500 scrollbar-track-slate-300 scrollbar-thin">
                    <div className={`flex flex-col flex-grow py-1 min-h-full justify-end shadow-lg bg-slate-200 pb-3 ${chatLog.length === 0 && !chatResponse ? 'justify-center' : 'justify-end' }`}>
                        {
                            chatLog.length === 0 && !chatResponse ? <p className="text-center text-gray-500 justify-self-center">
                                Start the conversation by sending a message below.
                            </p> : null
                        }

                        {chatLog.map(({ content, role }, i) => <ChatBubble role={role} key={i}>{content}</ChatBubble>)}
                        {chatResponse ? <ChatBubble role="assistant" key={chatLog.length}>{chatResponse}</ChatBubble> : null}
                    </div>
                </div>
            </div>
            <form className="flex-grow-0 flex-shrink-1 pb-4"
                onSubmit={ 
                    (e) => {
                        e.preventDefault();
                        if (!eventSource) { setChatContents(text); }
                    } 
                }>
                <div className="relative rounded-md shadow-md">
                    <input 
                        type="text"
                        className="block h-12 text-md w-full rounded-md border-0 py-1.5 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 [border-top-left-radius:0] [border-top-right-radius:0]" 
                        value={ text }
                        placeholder="Say something..."
                        onChange={ input => setText(input.target.value) }/>
                </div>
            </form>
        </section>
    )
}
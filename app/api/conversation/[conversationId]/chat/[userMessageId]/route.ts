import { getConversationCollection, Message } from "@/app/api/conversation/conversation";
import { createMongoClient } from "@/app/mongo";
import { AxiosResponse } from "axios";
import { IncomingMessage } from "http";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { Configuration, OpenAIApi } from "openai";
import { Readable, Transform } from "stream";

const defaultHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Content-Encoding': 'none',
    'X-Accel-Buffering': 'no'
};

export async function GET(_: NextRequest, { params: { conversationId, userMessageId } } : { params: { conversationId: string, userMessageId: string } }) {
    const mongoClient = createMongoClient();
    const conversations = getConversationCollection(mongoClient);
    const conversation = await conversations.findOne({ 
        '_id': conversationId, 
        'userMessages._id': userMessageId 
    }, { 
        projection: {
            'userMessages.$': 1,
            'messages': 1
        }
    });

    if (!conversation) {
        await mongoClient.close();
        return NextResponse.json('Bad Request', { status: 400 });
    }

    const { userMessages: [ lastMessage ], messages } = conversation;

    if (!lastMessage?.message) {
        await mongoClient.close();
        return NextResponse.json('Bad Request', { status: 400 });
    }

    const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
    const openai = new OpenAIApi(configuration);

    const { data: stream } = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        stream: true,
        messages: [
            ...messages,
            { content: lastMessage.message, role: 'user' }
        ]
    }, { responseType: 'stream' }) as any as AxiosResponse<IncomingMessage>;

    const newMessage = { role: 'assistant', content: '' } as Message;
    
    const outStream = Readable.toWeb(
        stream.pipe(new Transform({
            transform(chunk, _, callback) {
                callback(null, chunk);
                const eventStr = new TextDecoder().decode(chunk).trim();
                if (!eventStr.startsWith('data: ')) return;
                const chunkStr = eventStr.slice('data: '.length).trim();

                chunkStr.split('\n\ndata: ').reduce(async (promise, chunkStr) => {
                    await promise;
                    if (!chunkStr) return;
                    if (chunkStr === '[DONE]') {
                        await conversations.updateOne({ _id: conversationId }, { $push: { messages: { content: lastMessage.message, role: 'user' } } });
                        await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
                        revalidateTag(`conversation_${conversationId}`);
                        return;
                    }
                    
                    const data = JSON.parse(chunkStr);
                    newMessage.content += data.choices[0].delta.content || '';
                }, Promise.resolve());
            }
        })).on('close', () => {
            mongoClient.close();
        })
    ) as ReadableStream<any>;
    
    return new NextResponse(outStream, {
        headers: {
            ...defaultHeaders
        }
    });
}
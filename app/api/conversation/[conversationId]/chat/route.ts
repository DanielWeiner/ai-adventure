import { getSessionToken, getUser } from "@/app/api/auth";
import { createMongoClient } from "@/app/mongo";
import { encode } from "gpt-tokenizer";
import { IncomingMessage } from "http";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { Configuration, OpenAIApi } from "openai";
import { Readable, Transform } from "stream";
import { getConversationCollection, Message } from "../../../conversation";
import { AxiosResponse } from "axios";

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

export async function GET(_: NextRequest, { params: { conversationId } } : { params: { conversationId: string, userMessageId: string } }) {
    const sessionToken = getSessionToken();
    const user = await getUser();
    if (!user) {
        return NextResponse.json('Unauthorized', { status: 401 });
    }
    
    const mongoClient = createMongoClient();
    const conversations = getConversationCollection(mongoClient);
    const conversation = await conversations.findOne({ '_id': conversationId, userId: user.id });

    if (!conversation) {
        await mongoClient.close();
        return NextResponse.json('Bad Request', { status: 400 });
    }

    const { messages } = conversation;

    const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
    const openai = new OpenAIApi(configuration);

    const openaiMessages = messages.map(({role, content}) => ({ role, content }));

    const result = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'user',
                content: 
                    'You are a chat analyzer that decides whether to keep or discard chat history. ' +
                    'If the user requests that this conversation be reset, discarded, deleted, removed, ' + 
                    'or started over, output only the string "reset" with no other words or punctuation. ' +
                    'Otherwise, output only the string "keep" with no other words or punctuation. ' +
                    '\n\n' +
                
                    'Analyze the following chat:' +
                    '\n\n' + 

                    openaiMessages.map(({ content, role }) => (`${role.toUpperCase()}: ${content}`)).join('\n\n') +
                    '\n\n'
            }
        ],
        logit_bias: {
            [encode('keep')[0]]: 20,
            [encode('reset')[0]]: 20
        }
    });
    
    const chatDirective = result.data.choices[0].message?.content;
    console.log(chatDirective);

    const { data: stream } = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        stream: true,
        messages: [...openaiMessages]
    }, { responseType: 'stream' }) as any as AxiosResponse<IncomingMessage>;

    const newMessage = { role: 'assistant', content: '', deleted: false } as Message;
    
    const outStream = Readable.toWeb(
        stream.pipe(new Transform({
            transform(chunk, _, callback) {
                const eventStr = new TextDecoder().decode(chunk).trim();
                if (!eventStr.startsWith('data: ')) return;
                const chunkStr = eventStr.slice('data: '.length).trim();

                chunkStr.split('\n\ndata: ').reduce(async (promise, chunkStr) => {
                    await promise;
                    if (!chunkStr) return;
                    if (chunkStr === '[DONE]') {
                        await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });

                        revalidateTag(`conversation_${sessionToken}_${conversationId}`);
                        return;
                    }
                    
                    const data = JSON.parse(chunkStr);
                    newMessage.content += data.choices[0].delta.content || '';
                }, Promise.resolve()).then(() => {
                    callback(null, chunk);
                });
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

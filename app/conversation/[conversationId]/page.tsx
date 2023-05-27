import ChatBox from "./chatbox";

const { APP_HOST, APP_PORT, APP_PROTOCOL } = process.env;

async function getMessages(conversationId: string) {
    const response = await fetch(`${APP_PROTOCOL}://${APP_HOST}:${APP_PORT}/api/conversation/${conversationId}/messages`, { next: { tags: [ `conversation_${conversationId}` ] } });

    return response.json();
}

export default async function Conversation({ params: { conversationId } } : { params: { conversationId: string }}) {
    const messages = await getMessages(conversationId);
    return (
        <ChatBox initialChatLog={messages} conversationId={conversationId}></ChatBox>
    );
}
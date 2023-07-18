import { Configuration, OpenAIApi } from "openai";

export const createOpenAiApi = () => new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
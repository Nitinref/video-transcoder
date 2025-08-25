"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
// @ts-ignore
const express_1 = __importDefault(require("express"));
const CorsOptions = require("cors");
// @ts-ignore
const google_genai_1 = require("@langchain/google-genai");
// @ts-ignore
const google_genai_2 = require("@langchain/google-genai");
// @ts-ignore
const qdrant_1 = require("@langchain/qdrant");
// @ts-ignore
const prompts_1 = require("@langchain/core/prompts");
// @ts-ignore
const output_parsers_1 = require("@langchain/core/output_parsers");
// --- 1. Initialize Express App ---
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
// --- 2. Middleware ---
app.use(CorsOptions());
app.use(express_1.default.json());
// --- 3. Define the Chat API Endpoint ---
app.post("/api/chat", async (req, res) => {
    const { query: userQuery } = req.body;
    if (!userQuery) {
        return res.status(400).json({
            error: "Missing required field: 'query' is required."
        });
    }
    console.log(`Received user query: "${userQuery}"`);
    try {
        const embeddings = new google_genai_2.GoogleGenerativeAIEmbeddings({
            model: 'embedding-001'
        });
        const vectorStore = await qdrant_1.QdrantVectorStore.fromExistingCollection(embeddings, {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            collectionName: "video_transcripts"
        });
        const retriever = vectorStore.asRetriever({
            k: 3
        });
        const prompt = prompts_1.ChatPromptTemplate.fromTemplate(`You are an expert AI assistant for a video course. Your job is to answer the user's question based only on the provided context from the video transcripts.

Your answer must be concise and directly address the question.

After providing the answer, you MUST cite the source from the context. For example: [Source: video_main.mp4, Timestamp: 00:08:25].

<context>
{context}
</context>

Question: {input}`);
        const chatModel = new google_genai_1.ChatGoogleGenerativeAI({
            model: "gemini-1.5-flash-latest",
            temperature: 0.1,
        });
        console.log("Searching for relevant documents...");
        const retrievedDocs = await retriever.invoke(userQuery);
        const formattedContext = retrievedDocs.map(doc => `---
Context from transcript:
Video ID: ${doc.metadata.videoId}
Start Time: ${doc.metadata.startTime}
Content: ${doc.pageContent}
---`).join("\n\n");
        console.log("Generating an answer...");
        const chain = prompt.pipe(chatModel).pipe(new output_parsers_1.StringOutputParser());
        const result = await chain.invoke({
            input: userQuery,
            context: formattedContext,
        });
        console.log("AI Response Generated.");
        res.status(200).json({
            answer: result
        });
    }
    catch (error) {
        console.error("An error occurred during the chat process:", error);
        res.status(500).json({
            error: "Failed to process chat request.",
            details: error.message
        });
    }
});
// --- 5. Start Server ---
app.listen(PORT, () => {
    console.log(`⚡ Unified server running at http://localhost:${PORT}`);
    console.log("📡 Ready at POST /api/ingest and POST /api/chat");
});
//# sourceMappingURL=chat.js.map
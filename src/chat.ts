import "dotenv/config";
// @ts-ignore
import express from "express";
// @ts-ignore
import multer from "multer";
import CorsOptions = require("cors");
// @ts-ignore
import fs from "fs";
// @ts-ignore
import srtParser2 from "srt-parser-2";
// @ts-ignore
import { YoutubeTranscript } from "youtube-transcript";
// @ts-ignore
import { Document } from "@langchain/core/documents";
// @ts-ignore
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// @ts-ignore
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
// @ts-ignore
import { QdrantVectorStore } from "@langchain/qdrant";
// @ts-ignore
import { ChatPromptTemplate } from "@langchain/core/prompts";
// @ts-ignore
import { StringOutputParser } from "@langchain/core/output_parsers";

const app = express();
// Use a single port for the unified server. Prioritize the chat server port if different.
const PORT = process.env.PORT || 4000;

app.use(CorsOptions());
app.use(express.json());

// Set up multer for file uploads
const upload = multer({ dest: "uploads/" });

// ===============================================
// INGESTION ENDPOINTS
// ===============================================

app.post("/api/ingest", upload.single("transcriptFile"), async (req, res) => {
  try {
    const { videoId, videoName, videoNumber, topicName } = req.body;
    const file = req.file;

    if (!file || !videoId || !videoName || !videoNumber || !topicName) {
      return res.status(400).json({
        error: "All fields are required: 'transcriptFile', 'videoId', 'videoName', 'videoNumber', 'topicName'.",
      });
    }

    console.log(`📥 Received transcript upload for video: ${videoId} (${videoName})`);

    const srtData = fs.readFileSync(file.path, "utf-8");
    const parser = new srtParser2();
    const srtResult = parser.fromSrt(srtData);

    const allDocs = srtResult.map((entry, i) => {
      return new Document({
        pageContent: entry.text,
        metadata: {
          videoId,
          videoName,
          videoNumber: parseInt(videoNumber, 10),
          topicName,
          source: "transcript",
          startTime: entry.startTime,
          endTime: entry.endTime,
          index: i,
        },
      });
    });

    console.log(`📄 Loaded ${allDocs.length} transcript segments`);
    if (allDocs.length > 0) {
        console.log("🔎 Example document with new metadata:", allDocs[0]);
    }

    const embeddings = new GoogleGenerativeAIEmbeddings({ model: "embedding-001" });

    console.log("🚀 Sending docs to Qdrant...");
    await QdrantVectorStore.fromDocuments(allDocs, embeddings, {
      url: process.env.QDRANT_URL || "http://localhost:6333",
      collectionName: "video_transcripts",
    });

    console.log(`✅ Ingestion complete for videoId: ${videoId}`);
    fs.unlinkSync(file.path);

    return res.status(200).json({
      message: "Transcript ingested successfully with all metadata!",
      documentsIndexed: allDocs.length,
      videoId,
    });
  } catch (error: any) {
    console.error("❌ Ingestion error:", error);
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({
      error: "Failed to ingest transcript.",
      details: error.message,
    });
  }
});

// ===============================================
// CHAT & ENHANCEMENT ENDPOINTS
// ===============================================

app.post("/api/enhance-query", async (req, res) => {
    const { query: userQuery } = req.body;

    if (!userQuery || userQuery.trim().length < 3) {
        return res.status(400).json({ 
            error: "Field 'query' must be at least 3 characters long." 
        });
    }

    console.log(`✨ Received query to enhance: "${userQuery}"`);

    try {
        const enhancerPromptTemplate = `You are an expert AI assistant that refines a user's question to be more effective for a semantic search system that queries video course transcripts.
Your goal is to rephrase and expand the user's query to improve its clarity and specificity.
- Do NOT answer the question.
- Preserve the original intent of the user's question.
- The output must ONLY be the refined question, with no preamble or explanation.

Example 1:
User Query: "what about functions"
Refined Query: "Can you provide a detailed explanation of how functions are defined and used according to the video transcript?"

Example 2:
User Query: "cors error"
Refined Query: "Explain what a CORS error is and how to resolve it based on the context from the video transcripts."

User Query: "{query}"
Refined Query:`;

        const enhancerPrompt = ChatPromptTemplate.fromTemplate(enhancerPromptTemplate);
        const chatModel = new ChatGoogleGenerativeAI({
            model: "gemini-1.5-flash-latest",
            temperature: 0.2,
        });
        const chain = enhancerPrompt.pipe(chatModel).pipe(new StringOutputParser());

        console.log("Enhancing user query...");
        const result = await chain.invoke({ query: userQuery });
        console.log(`Enhanced query: "${result}"`);

        res.status(200).json({ enhancedQuery: result.trim() });
    } catch (error: any) {
        console.error("An error occurred during query enhancement:", error);
        res.status(500).json({ 
            error: "Failed to enhance query.",
            details: error.message 
        });
    }
});

app.post("/api/chat", async (req, res) => {
    const { query: userQuery } = req.body;

    if (!userQuery) {
        return res.status(400).json({ 
            error: "Missing required field: 'query' is required." 
        });
    }

    console.log(`💬 Received user query: "${userQuery}"`);

    try {
        const embeddings = new GoogleGenerativeAIEmbeddings({ model: 'embedding-001' });

        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            collectionName: "video_transcripts"
        });

        const retriever = vectorStore.asRetriever({ k: 5 }); // Increased k for more context
        
        // --- MODIFIED: Updated prompt to use the new structured metadata ---
        const prompt = ChatPromptTemplate.fromTemplate(`You are an expert AI assistant for a video course. Your job is to answer the user's question based ONLY on the provided context from the video transcripts.

Your answer must be concise, directly address the question, and be formatted in markdown.

For each piece of information you provide, you MUST cite the source using the format: "[Video {videoNumber}: {videoName} - {topicName} at {startTime}]". The timestamp must be clickable in the final UI.

<context>
{context}
</context>

Question: {input}`);

        const chatModel = new ChatGoogleGenerativeAI({
            model: "gemini-1.5-flash-latest",
            temperature: 0.1,
        });

        console.log("Searching for relevant documents...");
        const retrievedDocs = await retriever.invoke(userQuery);

        // --- MODIFIED: Updated context formatting to include all new metadata ---
        const formattedContext = retrievedDocs.map(doc => 
            `---
Context from transcript:
Video Number: ${doc.metadata.videoNumber}
Video Name: ${doc.metadata.videoName}
Topic: ${doc.metadata.topicName}
Timestamp: ${doc.metadata.startTime}
Content: ${doc.pageContent}
---`
        ).join("\n\n");

        console.log("Generating an answer...");
        
        const chain = prompt.pipe(chatModel).pipe(new StringOutputParser());

        // @ts-ignore
        const result = await chain.invoke({
            input: userQuery,
            context: formattedContext,
        });

        console.log("AI Response Generated.");

        res.status(200).json({ answer: result });
    } catch (error: any) {
        console.error("An error occurred during the chat process:", error);
        res.status(500).json({ 
            error: "Failed to process chat request.",
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
  console.log(`⚡ Unified server running at http://localhost:${PORT}`);
  console.log("📡 Ready at POST /api/ingest, /api/ingest-youtube, /api/chat, and /api/enhance-query");
});
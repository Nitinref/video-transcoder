"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
// @ts-ignore
const express_1 = __importDefault(require("express"));
// @ts-ignore
const multer_1 = __importDefault(require("multer"));
const CorsOptions = require("cors");
// @ts-ignore
const fs_1 = __importDefault(require("fs"));
// @ts-ignore
const srt_parser_2_1 = __importDefault(require("srt-parser-2"));
// @ts-ignore
const youtube_transcript_1 = require("youtube-transcript");
// @ts-ignore
const documents_1 = require("@langchain/core/documents");
// @ts-ignore
const google_genai_1 = require("@langchain/google-genai");
// @ts-ignore
const qdrant_1 = require("@langchain/qdrant");
// --- 1. Initialize Express App ---
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// --- 2. Middleware ---
app.use(CorsOptions());
app.use(express_1.default.json());
// Configure multer to save uploaded files to a temporary 'uploads/' directory
const upload = (0, multer_1.default)({ dest: "uploads/" });
// --- 3. File Ingestion API Endpoint (SRT with timestamps) ---
app.post("/api/ingest", upload.single("transcriptFile"), async (req, res) => {
    try {
        const { videoId } = req.body;
        const file = req.file;
        if (!file || !videoId) {
            return res.status(400).json({
                error: "A transcript file ('transcriptFile') and a 'videoId' are required.",
            });
        }
        console.log(`📥 Received transcript upload for video: ${videoId}`);
        // --- STEP 1: Parse SRT manually with srt-parser-2 ---
        const srtData = fs_1.default.readFileSync(file.path, "utf-8");
        const parser = new srt_parser_2_1.default();
        const srtResult = parser.fromSrt(srtData);
        const allDocs = srtResult.map((entry, i) => {
            return new documents_1.Document({
                pageContent: entry.text,
                metadata: {
                    videoId,
                    source: "transcript",
                    startTime: entry.startTime, // ✅ timestamp
                    endTime: entry.endTime, // ✅ timestamp
                    index: i,
                },
            });
        });
        console.log(`📄 Loaded ${allDocs.length} transcript segments`);
        console.log("🔎 Example document with timestamps:", allDocs[0]);
        // --- STEP 2: Generate embeddings ---
        const embeddings = new google_genai_1.GoogleGenerativeAIEmbeddings({
            model: "embedding-001",
        });
        // --- STEP 3: Store in Qdrant ---
        console.log("🚀 Sending docs to Qdrant...");
        await qdrant_1.QdrantVectorStore.fromDocuments(allDocs, embeddings, {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            collectionName: "video_transcripts",
        });
        console.log(`✅ Ingestion complete for videoId: ${videoId}`);
        // --- STEP 4: Clean up uploaded file ---
        fs_1.default.unlinkSync(file.path);
        return res.status(200).json({
            message: "Transcript ingested successfully with timestamps!",
            documentsIndexed: allDocs.length,
            videoId,
        });
    }
    catch (error) {
        console.error("❌ Ingestion error:", error);
        if (req.file) {
            fs_1.default.unlinkSync(req.file.path);
        }
        return res.status(500).json({
            error: "Failed to ingest transcript.",
            details: error.message,
        });
    }
});
// --- 4. YouTube Ingestion API Endpoint ---
app.post("/api/ingest-youtube", async (req, res) => {
    try {
        const { youtubeUrl, videoId } = req.body;
        if (!youtubeUrl || !videoId) {
            return res.status(400).json({
                error: "A 'youtubeUrl' and a 'videoId' are required.",
            });
        }
        console.log(`📥 Received YouTube transcript request for video: ${videoId}`);
        const transcript = await youtube_transcript_1.YoutubeTranscript.fetchTranscript(youtubeUrl);
        const allDocs = transcript.map((segment, i) => {
            const startTime = new Date(segment.offset).toISOString().substr(11, 8);
            return new documents_1.Document({
                pageContent: segment.text,
                metadata: {
                    videoId,
                    source: "youtube",
                    startTime, // ✅ timestamp
                    index: i,
                },
            });
        });
        console.log(`📄 Loaded ${allDocs.length} YouTube transcript segments`);
        const embeddings = new google_genai_1.GoogleGenerativeAIEmbeddings({
            model: "embedding-001",
        });
        console.log("🚀 Sending YouTube docs to Qdrant...");
        await qdrant_1.QdrantVectorStore.fromDocuments(allDocs, embeddings, {
            url: process.env.QDRANT_URL || "http://localhost:6333",
            collectionName: "video_transcripts",
        });
        console.log(`✅ YouTube ingestion complete for videoId: ${videoId}`);
        return res.status(200).json({
            message: "YouTube transcript ingested successfully with timestamps!",
            documentsIndexed: allDocs.length,
            videoId,
        });
    }
    catch (error) {
        console.error("❌ YouTube Ingestion error:", error);
        return res.status(500).json({
            error: "Failed to ingest YouTube transcript.",
            details: error.message,
        });
    }
});
// --- 5. Start Server ---
app.listen(PORT, () => {
    console.log(`⚡ Unified server running at http://localhost:${PORT}`);
    console.log("📡 Ready at POST /api/ingest and POST /api/ingest-youtube");
});
//# sourceMappingURL=index.js.map
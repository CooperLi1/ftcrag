import { buildRagSystemPrompt, searchRelevantChunks } from "@/lib/rag";
import { extractJsonObject, generateGeminiText, generateGeminiTextWithMeta } from "@/lib/gemini";

export const runtime = "nodejs";

type PlannerOutput = {
  needsCode: boolean;
  isHard: boolean;
  needsConversationContext: boolean;
  ragQueries: string[];
  shouldShortCircuit: boolean;
  directResponse: string;
};

type SourceFragment = {
  title: string;
  url: string | null;
  excerpt: string;
};

type FinalModelOutput = {
  answer: string;
  usedSourceNumbers: number[];
};

type ParsedFinalModelOutput = FinalModelOutput & {
  ok: boolean;
};

const PLANNER_MODEL = process.env.GEMINI_PLANNER_MODEL ?? "gemini-2.0-flash-lite";
const EASY_NONCODE_MODEL = process.env.GEMINI_EASY_NONCODE_MODEL ?? "gemini-2.0-flash";
const EASY_CODE_MODEL = process.env.GEMINI_EASY_CODE_MODEL ?? "gemini-2.0-flash";
const HARD_NONCODE_MODEL = process.env.GEMINI_HARD_NONCODE_MODEL ?? "gemini-2.5-pro";
const HARD_CODE_MODEL = process.env.GEMINI_HARD_CODE_MODEL ?? "gemini-2.5-pro";

function parsePlannerOutput(raw: string, fallbackQuestion: string): PlannerOutput {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return {
      needsCode: true,
      isHard: true,
      needsConversationContext: true,
      ragQueries: [fallbackQuestion],
      shouldShortCircuit: false,
      directResponse: "",
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<PlannerOutput>;
    const ragQueries = Array.isArray(parsed.ragQueries)
      ? parsed.ragQueries.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];
    const needsCode = typeof parsed.needsCode === "boolean" ? parsed.needsCode : true;
    const isHard = typeof parsed.isHard === "boolean" ? parsed.isHard : true;
    const needsConversationContext =
      typeof parsed.needsConversationContext === "boolean" ? parsed.needsConversationContext : true;
    const shouldShortCircuit =
      typeof parsed.shouldShortCircuit === "boolean" ? parsed.shouldShortCircuit : false;
    const directResponse =
      typeof parsed.directResponse === "string" ? parsed.directResponse.trim() : "";

    return {
      needsCode,
      isHard,
      needsConversationContext,
      ragQueries: ragQueries.length > 0 ? ragQueries : [fallbackQuestion],
      shouldShortCircuit,
      directResponse,
    };
  } catch {
    return {
      needsCode: true,
      isHard: true,
      needsConversationContext: true,
      ragQueries: [fallbackQuestion],
      shouldShortCircuit: false,
      directResponse: "",
    };
  }
}

function chooseFinalModel(plan: PlannerOutput): string {
  if (plan.needsCode && plan.isHard) return HARD_CODE_MODEL;
  if (plan.needsCode && !plan.isHard) return EASY_CODE_MODEL;
  if (!plan.needsCode && plan.isHard) return HARD_NONCODE_MODEL;
  return EASY_NONCODE_MODEL;
}

function buildRetrievalQueries(question: string, plannerQueries: string[]): string[] {
  const queries = new Set<string>();
  const normalizedQuestion = question.trim();
  if (normalizedQuestion) {
    queries.add(normalizedQuestion);
    queries.add(`FTC DECODE season question: ${normalizedQuestion}`);
  }

  for (const q of plannerQueries) {
    const trimmed = q.trim();
    if (trimmed) queries.add(trimmed);
  }

  // Common user phrasing may say "balls" while DECODE docs say "ARTIFACTS".
  if (/\bballs?\b/i.test(normalizedQuestion)) {
    queries.add(normalizedQuestion.replace(/\bballs?\b/gi, "ARTIFACTS"));
  }

  return [...queries];
}

function dedupeChunks<T extends { id?: string; source: string; metadata: Record<string, unknown> | null }>(
  chunks: T[]
): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const chunk of chunks) {
    const chunkIndex =
      typeof chunk.metadata?.chunk_index === "number"
        ? String(chunk.metadata.chunk_index)
        : typeof chunk.metadata?.chunk_index === "string"
          ? chunk.metadata.chunk_index
          : "na";
    const key = chunk.id ?? `${chunk.source}:${chunkIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(chunk);
  }
  return output;
}

function splitForStream(text: string): string[] {
  return text
    .split(/(\n+)/)
    .flatMap((part) => {
      if (part.trim() === "") return [part];
      return part.match(/.{1,120}/g) ?? [part];
    })
    .filter((part) => part.length > 0);
}

function getSourceFragmentsByNumber(
  chunks: Awaited<ReturnType<typeof searchRelevantChunks>>,
  usedSourceNumbers: number[]
): SourceFragment[] {
  const normalizedNumbers = [...new Set(usedSourceNumbers)]
    .filter((n) => Number.isInteger(n) && n > 0 && n <= chunks.length)
    .sort((a, b) => a - b);

  return normalizedNumbers.map((sourceNumber) => {
    const chunk = chunks[sourceNumber - 1];
    const sourceUrl =
      typeof chunk.metadata?.source_url === "string" && chunk.metadata.source_url.trim().length > 0
        ? chunk.metadata.source_url.trim()
        : null;
    const sourceTitle =
      typeof chunk.metadata?.source_title === "string" && chunk.metadata.source_title.trim().length > 0
        ? chunk.metadata.source_title.trim()
        : chunk.source;

    return {
      title: `[${sourceNumber}] ${sourceTitle}`,
      url: sourceUrl,
      excerpt: chunk.content.trim(),
    };
  });
}

function parseFinalModelOutput(raw: string): ParsedFinalModelOutput {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return {
      answer: "",
      usedSourceNumbers: [],
      ok: false,
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<FinalModelOutput>;
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const usedSourceNumbers = Array.isArray(parsed.usedSourceNumbers)
      ? parsed.usedSourceNumbers.filter((n): n is number => typeof n === "number")
      : [];

    return {
      answer,
      usedSourceNumbers,
      ok: answer.length > 0,
    };
  } catch {
    return {
      answer: "",
      usedSourceNumbers: [],
      ok: false,
    };
  }
}

function extractAnswerFallbackText(raw: string): string {
  const match = raw.match(/"answer"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*})/);
  if (match?.[1]) {
    return match[1]
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .trim();
  }

  const stripped = raw
    .replace(/^[\s`]*\{?[\s\S]*?"answer"\s*:\s*/i, "")
    .replace(/"usedSourceNumbers"[\s\S]*$/i, "")
    .replace(/[{}[\]"]/g, "")
    .trim();
  return stripped;
}

function normalizeAssistantMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const escapedNewlineCount = (normalized.match(/\\n/g) ?? []).length;
  const realNewlineCount = (normalized.match(/\n/g) ?? []).length;

  if (escapedNewlineCount > 0 && (realNewlineCount === 0 || escapedNewlineCount >= realNewlineCount * 2)) {
    return normalized.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  return normalized;
}

export async function POST(req: Request) {
  const { messages } = (await req.json()) as {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  };

  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  if (!latestUserMessage?.trim()) {
    return new Response("Missing user question.", { status: 400 });
  }

  // Step 1: question is captured as soon as it arrives.
  const question = latestUserMessage.trim();
  const conversationTranscript = messages
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  // Step 2: planner model decides complexity/routing and RAG queries.
  const plannerRaw = await generateGeminiText({
    model: PLANNER_MODEL,
    systemInstruction: [
      "You are a routing planner for a RAG assistant.",
      "Default season assumption: if the user does not specify a season/year, assume they mean the current FTC season, DECODE.",
      "If user/context clearly indicates another season, use that instead.",
      "You have full conversation context. Resolve pronouns, shorthand, and follow-up references using prior turns.",
      "Treat this as a multi-turn dialog, not an isolated one-shot prompt.",
      "If the latest question depends on earlier turns, set needsConversationContext=true.",
      "Read the conversation carefully and ground your decision in the actual user wording instead of assumptions.",
      "When uncertain, be conservative and escalate complexity.",
      "Return only valid JSON with this exact schema:",
      "{",
      '  "needsCode": boolean,',
      '  "isHard": boolean,',
      '  "needsConversationContext": boolean,',
      '  "ragQueries": string[],',
      '  "shouldShortCircuit": boolean,',
      '  "directResponse": string',
      "}",
      "Be conservative: when unsure set needsCode=true and isHard=true.",
      "If question may depend on previous turns, set needsConversationContext=true.",
      "Only set shouldShortCircuit=true for very simple social/acknowledgement messages that need no retrieval or deeper reasoning (e.g. hi, hello, thanks).",
      "When shouldShortCircuit=true, provide a concise directResponse and set ragQueries to an empty array.",
      "ragQueries should be specific retrieval prompts needed to answer the user.",
      "No extra keys. No prose.",
    ].join("\n"),
    userPrompt: `Conversation so far:\n${conversationTranscript}\n\nLatest user question:\n${question}`,
    temperature: 0.1,
    maxOutputTokens: 500,
    responseMimeType: "application/json",
  });
  const plan = parsePlannerOutput(plannerRaw, question);
  if (plan.shouldShortCircuit && plan.directResponse) {
    return new Response(plan.directResponse);
  }

  // Step 3: model selection by difficulty/code axes.
  const finalModel = chooseFinalModel(plan);

  // Step 4: run RAG on all planner prompts.
  const ragMatchCount = Number(process.env.RAG_MATCH_COUNT ?? "6");
  const retrievalQueries = buildRetrievalQueries(question, plan.ragQueries);
  let contextChunks: Awaited<ReturnType<typeof searchRelevantChunks>> = [];
  try {
    const ragResults = await Promise.all(
      retrievalQueries.map((ragPrompt) => searchRelevantChunks(ragPrompt, ragMatchCount))
    );
    contextChunks = dedupeChunks(ragResults.flat());
  } catch (error) {
    console.error("RAG retrieval failed, continuing without context:", error);
  }

  // Step 5: final model gets question + RAG + optional conversation context.
  const ragPrompt = buildRagSystemPrompt(contextChunks);
  const contextualBlock = plan.needsConversationContext
    ? `Conversation context:\n${conversationTranscript}\n\n`
    : "";
  const finalModelMaxOutputTokens = Number(process.env.FINAL_MODEL_MAX_OUTPUT_TOKENS ?? "3072");
  const finalModelSystemInstruction = [
    "You are FTC Assistant.",
    "Default season assumption: if the user does not specify a season/year, assume they mean the current FTC season, DECODE.",
    "If user/context clearly indicates another season, use that instead.",
    "Read all reference notes closely before answering.",
    "Reason from the provided evidence first; do not rely on preconceived assumptions or prior bias.",
    "If notes conflict, resolve explicitly and prefer the most direct rule text.",
    "Act as a single direct assistant. Do not mention internal pipeline steps, retrieval, provided context, or that you were given documents.",
    "Never say phrases like 'based on the provided information' or 'according to the retrieved context'.",
    "Never refer to excerpts, context blocks, source fragments, retrieved notes, or documents in your visible answer.",
    "Return ONLY JSON with this exact schema:",
    '{ "answer": string, "usedSourceNumbers": number[] }',
    "usedSourceNumbers must contain only the numeric context labels you actually relied on (e.g., [1], [3]).",
    "If no context was used, return an empty array.",
    "Do not include citations, source labels, or a Sources section inside the answer field.",
    "Include concise, actionable answers and answer in a smooth, natural tone.",
    "If unsure, state uncertainty directly without mentioning hidden context/retrieval.",
    ragPrompt,
  ].join("\n\n");
  const finalModelUserPrompt = `${contextualBlock}User question:\n${question}`;

  let finalAnswerResult = await generateGeminiTextWithMeta({
    model: finalModel,
    systemInstruction: finalModelSystemInstruction,
    userPrompt: finalModelUserPrompt,
    temperature: 0.2,
    maxOutputTokens: finalModelMaxOutputTokens,
    responseMimeType: "application/json",
  });

  if (finalAnswerResult.finishReason === "MAX_TOKENS") {
    console.warn("Final answer hit MAX_TOKENS; retrying with a larger output budget.");
    finalAnswerResult = await generateGeminiTextWithMeta({
      model: finalModel,
      systemInstruction: `${finalModelSystemInstruction}\n\nYour previous attempt was cut off. Return a complete JSON object in one response.`,
      userPrompt: finalModelUserPrompt,
      temperature: 0.2,
      maxOutputTokens: Math.max(finalModelMaxOutputTokens, 4096),
      responseMimeType: "application/json",
    });
  }

  const finalAnswer = finalAnswerResult.text;
  let parsedFinal = parseFinalModelOutput(finalAnswer);
  if (!parsedFinal.ok) {
    try {
      const repaired = await generateGeminiText({
        model: finalModel,
        systemInstruction: [
          "You are a strict JSON formatter.",
          "Given malformed model output, return only valid JSON with this exact schema:",
          '{ "answer": string, "usedSourceNumbers": number[] }',
          "Do not add commentary.",
        ].join("\n"),
        userPrompt: `Malformed output:\n${finalAnswer}`,
        temperature: 0,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      });
      parsedFinal = parseFinalModelOutput(repaired);
    } catch {
      // Ignore repair failure; fallback below.
    }
  }

  const visibleAnswer =
    parsedFinal.answer || extractAnswerFallbackText(finalAnswer) || "I’m sorry, I couldn’t generate a complete answer.";
  const normalizedVisibleAnswer = normalizeAssistantMarkdown(visibleAnswer);
  const sourceFragments = getSourceFragmentsByNumber(
    contextChunks,
    parsedFinal.ok ? parsedFinal.usedSourceNumbers : []
  );
  const metadataMarker =
    `\n\n<<RAG_CONTEXT_JSON>>${JSON.stringify({ sourceFragments })}<<END_RAG_CONTEXT_JSON>>`;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of splitForStream(normalizedVisibleAnswer)) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      controller.enqueue(encoder.encode(metadataMarker));
      controller.close();
    },
  });

  return new Response(stream);
}

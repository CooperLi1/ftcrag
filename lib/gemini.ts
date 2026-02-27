import fs from "node:fs/promises";
import path from "node:path";

type GeminiRequest = {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
};

type GeminiTextResult = {
  text: string;
  finishReason: string | null;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    message?: string;
  };
};

type GeminiModeConfig =
  | {
      mode: "api_key";
      endpoint: string;
      headers: Record<string, string>;
    }
  | {
      mode: "vertex";
      endpoint: string;
      headers: Record<string, string>;
    };

let gcredsLoaded = false;
let googleCredsProjectId: string | undefined;
let cachedVertexToken: { token: string; expiresAtMs: number } | null = null;

async function loadGoogleCredentialsOnce() {
  if (gcredsLoaded) return;
  const base64 = process.env.GOOGLECREDENTIALS;
  if (!base64) return;

  const decoded = Buffer.from(base64, "base64").toString("utf8");
  const tmpPath = path.join("/tmp", "google-credentials.json");
  await fs.writeFile(tmpPath, decoded);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;

  try {
    const parsed = JSON.parse(decoded) as { project_id?: string };
    googleCredsProjectId = parsed.project_id;
  } catch {
    // ignore parse failure; auth library may still read file
  }

  gcredsLoaded = true;
}

async function getVertexAccessTokenFromGoogleCredentials(): Promise<string | null> {
  if (!process.env.GOOGLECREDENTIALS) return null;
  await loadGoogleCredentialsOnce();

  const now = Date.now();
  if (cachedVertexToken && cachedVertexToken.expiresAtMs - now > 60_000) {
    return cachedVertexToken.token;
  }

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token ?? null;
  if (!token) return null;

  cachedVertexToken = {
    token,
    expiresAtMs: now + 45 * 60 * 1000,
  };
  return token;
}

async function getGeminiConfig(model: string): Promise<GeminiModeConfig> {
  const vertexAccessToken =
    process.env.VERTEX_ACCESS_TOKEN ?? (await getVertexAccessTokenFromGoogleCredentials());
  const vertexProjectId = process.env.VERTEX_PROJECT_ID;
  const vertexLocation = process.env.VERTEX_LOCATION ?? "us-central1";
  const resolvedProjectId = vertexProjectId ?? googleCredsProjectId;

  if (vertexAccessToken && resolvedProjectId) {
    return {
      mode: "vertex",
      endpoint: `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${resolvedProjectId}/locations/${vertexLocation}/publishers/google/models/${model}:generateContent`,
      headers: {
        Authorization: `Bearer ${vertexAccessToken}`,
      },
    };
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.VERTEXAI_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Gemini credentials. Use GEMINI_API_KEY/GOOGLE_API_KEY for Gemini API, or VERTEX_ACCESS_TOKEN + VERTEX_PROJECT_ID for Vertex AI."
    );
  }

  return {
    mode: "api_key",
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    headers: {},
  };
}

export async function generateGeminiTextWithMeta({
  model,
  systemInstruction,
  userPrompt,
  temperature = 0.2,
  maxOutputTokens = 2048,
  responseMimeType,
}: GeminiRequest): Promise<GeminiTextResult> {
  const config = await getGeminiConfig(model);

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
        ...(responseMimeType ? { responseMimeType } : {}),
      },
    }),
  });

  const data = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    const rawErrorMessage = data?.error?.message ?? `Gemini request failed: ${response.status}`;
    const errorMessage =
      rawErrorMessage.includes("API keys are not supported by this API")
        ? `${rawErrorMessage}. If using Vertex AI, set VERTEX_ACCESS_TOKEN + VERTEX_PROJECT_ID (+ optional VERTEX_LOCATION). If using API key auth, use GEMINI_API_KEY/GOOGLE_API_KEY.`
        : rawErrorMessage;
    throw new Error(errorMessage);
  }

  if (data?.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked prompt: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) {
    throw new Error("Gemini returned empty text.");
  }

  return {
    text,
    finishReason: candidate?.finishReason ?? null,
  };
}

export async function generateGeminiText(request: GeminiRequest): Promise<string> {
  const result = await generateGeminiTextWithMeta(request);
  return result.text;
}

export function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1];

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini(model, prompt, apiKey) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");

  return extractJson(text);
}

function extractJson(text) {
  // 1. Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // 3. Find the first JSON array or object in the text
  const arrayStart = text.indexOf("[");
  const objectStart = text.indexOf("{");
  const start = arrayStart === -1 ? objectStart : objectStart === -1 ? arrayStart : Math.min(arrayStart, objectStart);

  if (start !== -1) {
    // Find the matching closing bracket by scanning forward
    const opener = text[start];
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === opener) depth++;
      else if (text[i] === closer) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
  }

  throw new Error(`Gemini response was not valid JSON: ${text.slice(0, 200)}`);
}
